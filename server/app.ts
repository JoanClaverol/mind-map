import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { nanoid } from 'nanoid';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { migrateMapFile } from '../src/model/migrate';
import { SCHEMA_VERSION, normalizeFolderName, type MapFile } from '../src/model/types';
import * as events from './events';
import { fulfillExport } from './exports';
import { setActiveView } from './presence';
import { createMcpServer } from './mcp-server';
import * as storage from './storage';

export const app = new Hono();

/**
 * Localhost-only guard. The server binds 127.0.0.1, but a malicious web page
 * can still reach it: via DNS rebinding (Host is the attacker's domain) or a
 * CORS-"simple" cross-site POST (Origin is the attacker's site, Content-Type
 * text/plain). Reject both before any route runs.
 */
const LOCAL_HOST_RE = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
const LOCAL_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
app.use('*', async (c, next) => {
  const host = c.req.header('host');
  if (host && !LOCAL_HOST_RE.test(host)) return c.json({ error: 'forbidden host' }, 403);
  const origin = c.req.header('origin');
  if (origin && origin !== 'null' && !LOCAL_ORIGIN_RE.test(origin)) return c.json({ error: 'forbidden origin' }, 403);
  const method = c.req.method;
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS' && method !== 'DELETE') {
    const type = c.req.header('content-type') ?? '';
    if (!/^application\/json\b/i.test(type)) return c.json({ error: 'content-type must be application/json' }, 415);
  }
  await next();
});

// One MCP server + transport per client session: a single shared transport
// accepts exactly one `initialize`, which locks out a second client (or the
// same client after a restart) until the server is restarted.
const mcpSessions = new Map<string, WebStandardStreamableHTTPServerTransport>();

async function newMcpSession(): Promise<WebStandardStreamableHTTPServerTransport> {
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => nanoid(12),
    onsessioninitialized: (id) => void mcpSessions.set(id, transport),
    onsessionclosed: (id) => void mcpSessions.delete(id),
  });
  transport.onclose = () => {
    if (transport.sessionId) mcpSessions.delete(transport.sessionId);
  };
  await createMcpServer().connect(transport);
  return transport;
}

app.all('/mcp', async (c) => {
  const parsedBody = c.req.method === 'POST' ? await c.req.json().catch(() => undefined) : undefined;
  const sessionId = c.req.header('mcp-session-id');
  let transport = sessionId ? mcpSessions.get(sessionId) : undefined;
  if (!transport) {
    if (sessionId) return c.json({ jsonrpc: '2.0', error: { code: -32001, message: 'Session not found' }, id: null }, 404);
    // No session yet: only an initialize may open one (the transport rejects anything else).
    transport = await newMcpSession();
  }
  return transport.handleRequest(c.req.raw, { parsedBody });
});

// Live channel: pushes map changes made outside the browser (MCP tools) to open
// tabs. Event name = kind, data = the full event JSON. Pings keep the stream alive.
app.get('/api/events', (c) =>
  streamSSE(c, async (s) => {
    let close!: () => void;
    const closed = new Promise<void>((resolve) => (close = resolve));
    const unsub = events.subscribe((e) => void s.writeSSE({ event: e.kind, data: JSON.stringify(e) }));
    const ping = setInterval(() => void s.writeSSE({ event: 'ping', data: '' }), 15_000);
    s.onAbort(() => {
      unsub();
      clearInterval(ping);
      close();
    });
    await closed;
  }),
);

// The tab reports what the user is looking at, so MCP clients can ask (get_active_view).
app.post('/api/view', async (c) => {
  const body = await c.req.json<{ mapId?: unknown; selectedId?: unknown; hoistId?: unknown }>().catch(() => null);
  const str = (v: unknown) => (typeof v === 'string' && v.length <= 64 ? v : null);
  const mapId = str(body?.mapId);
  if (mapId !== null && !storage.isValidId(mapId)) return c.json({ error: 'invalid map id' }, 400);
  setActiveView({ mapId, selectedId: str(body?.selectedId), hoistId: str(body?.hoistId) });
  return c.json({ ok: true });
});

// The tab's answer to an export-request (see exports.ts).
app.post('/api/exports/:requestId', async (c) => {
  const body = await c.req.json<{ format?: unknown; data?: unknown }>().catch(() => null);
  if (!body || (body.format !== 'png' && body.format !== 'svg') || typeof body.data !== 'string') {
    return c.json({ error: 'format (png|svg) and data are required' }, 400);
  }
  const ok = fulfillExport(c.req.param('requestId'), { format: body.format, data: body.data });
  return ok ? c.json({ ok: true }) : c.json({ error: 'no pending export' }, 404);
});

app.get('/api/maps', async (c) => {
  const { maps, warnings } = await storage.listMaps();
  return c.json({ maps, warnings });
});

app.post('/api/maps', async (c) => {
  const body = await c.req.json<{ title?: string }>().catch(() => ({}) as { title?: string });
  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'Untitled map';
  const now = new Date().toISOString();
  const map: MapFile = {
    schemaVersion: SCHEMA_VERSION,
    id: nanoid(12),
    title,
    createdAt: now,
    updatedAt: now,
    root: { id: nanoid(12), text: title, children: [] },
  };
  await storage.writeMap(map);
  events.publish({ kind: 'map-created', mapId: map.id, title: map.title });
  return c.json(map, 201);
});

app.get('/api/maps/:id', async (c) => {
  const id = c.req.param('id');
  if (!storage.isValidId(id)) return c.json({ error: 'invalid map id' }, 400);
  const map = await storage.readMap(id);
  if (!map) return c.json({ error: 'map not found' }, 404);
  return c.json(map);
});

/** Structural check of a FileNode tree: a bad PUT must never brick the map on disk. */
function isValidTree(node: unknown, depth = 0): boolean {
  if (depth > 500 || typeof node !== 'object' || node === null) return false;
  const n = node as { id?: unknown; text?: unknown; children?: unknown };
  return (
    typeof n.id === 'string' &&
    typeof n.text === 'string' &&
    Array.isArray(n.children) &&
    n.children.every((child) => isValidTree(child, depth + 1))
  );
}

app.put('/api/maps/:id', async (c) => {
  const id = c.req.param('id');
  if (!storage.isValidId(id)) return c.json({ error: 'invalid map id' }, 400);
  const body = await c.req.json<MapFile>().catch(() => null);
  if (!body || body.schemaVersion !== SCHEMA_VERSION || body.id !== id || typeof body.root !== 'object') {
    return c.json({ error: 'invalid map document' }, 400);
  }
  let incoming: MapFile;
  try {
    incoming = migrateMapFile(body);
    if (!isValidTree(incoming.root) || !(incoming.floating ?? []).every((f) => isValidTree(f.root))) {
      throw new Error('malformed node tree');
    }
  } catch (err) {
    return c.json({ error: `invalid map document: ${err instanceof Error ? err.message : String(err)}` }, 400);
  }
  const updatedAt = new Date().toISOString();
  // Curation fields are server-owned (PATCH): the tab's copy may be stale or
  // lack them entirely, so they ride along from disk.
  const written = await storage.updateMap(id, (onDisk) => {
    const next: MapFile = { ...incoming, createdAt: onDisk.createdAt, updatedAt };
    if (onDisk.folder) next.folder = onDisk.folder;
    else delete next.folder;
    if (onDisk.pinned) next.pinned = true;
    else delete next.pinned;
    return next;
  });
  if (!written) await storage.writeMap({ ...incoming, updatedAt }); // file vanished — recreate it
  return c.json({ updatedAt });
});

app.patch('/api/maps/:id', async (c) => {
  const id = c.req.param('id');
  if (!storage.isValidId(id)) return c.json({ error: 'invalid map id' }, 400);
  const body = await c.req.json<{ title?: string; pinned?: boolean; folder?: string | null }>().catch(() => null);
  const hasTitle = typeof body?.title === 'string' && !!body.title.trim();
  const hasPinned = typeof body?.pinned === 'boolean';
  const hasFolder = body?.folder !== undefined;
  if (!body || (!hasTitle && !hasPinned && !hasFolder)) {
    return c.json({ error: 'title, pinned, or folder is required' }, 400);
  }
  let folder: string | undefined;
  if (hasFolder && body.folder !== null && body.folder !== '') {
    folder = normalizeFolderName(body.folder) ?? undefined;
    if (!folder) return c.json({ error: 'invalid folder name' }, 400);
    // Auto-add to the manifest so the folder keeps its place if the map later leaves.
    const manifest = await storage.readFolders();
    if (!manifest.some((f) => f.toLowerCase() === folder!.toLowerCase())) {
      await storage.writeFolders([...manifest, folder]);
    }
  }
  const updated = await storage.updateMap(id, (map) => {
    const next: MapFile = { ...map };
    // Pinning and foldering are curation, not editing — only a title change bumps updatedAt.
    if (hasTitle) {
      next.title = body.title!.trim();
      next.updatedAt = new Date().toISOString();
    }
    if (hasPinned) {
      if (body.pinned) next.pinned = true;
      else delete next.pinned;
    }
    if (hasFolder) {
      if (folder) next.folder = folder;
      else delete next.folder;
    }
    return next;
  });
  if (!updated) return c.json({ error: 'map not found' }, 404);
  return c.json({
    title: updated.title,
    pinned: updated.pinned ?? false,
    folder: updated.folder ?? null,
    updatedAt: updated.updatedAt,
  });
});

app.get('/api/folders', async (c) => {
  return c.json({ folders: await storage.listFolders() });
});

app.post('/api/folders', async (c) => {
  const body = await c.req.json<{ name?: string }>().catch(() => null);
  const name = normalizeFolderName(body?.name);
  if (!name) return c.json({ error: 'invalid folder name' }, 400);
  const folders = await storage.listFolders();
  if (folders.some((f) => f.name.toLowerCase() === name.toLowerCase())) {
    return c.json({ error: 'folder already exists' }, 409);
  }
  await storage.writeFolders([...(await storage.readFolders()), name]);
  return c.json({ folders: await storage.listFolders() }, 201);
});

app.patch('/api/folders/:name', async (c) => {
  const oldName = c.req.param('name');
  const body = await c.req.json<{ name?: string }>().catch(() => null);
  const newName = normalizeFolderName(body?.name);
  if (!newName) return c.json({ error: 'invalid folder name' }, 400);
  const folders = await storage.listFolders();
  if (!folders.some((f) => f.name.toLowerCase() === oldName.toLowerCase())) {
    return c.json({ error: 'folder not found' }, 404);
  }
  if (
    newName.toLowerCase() !== oldName.toLowerCase() &&
    folders.some((f) => f.name.toLowerCase() === newName.toLowerCase())
  ) {
    return c.json({ error: 'folder already exists' }, 409);
  }
  const manifest = await storage.readFolders();
  const idx = manifest.findIndex((f) => f.toLowerCase() === oldName.toLowerCase());
  if (idx === -1) manifest.push(newName);
  else manifest[idx] = newName;
  await storage.writeFolders(manifest);
  const { maps } = await storage.listMaps();
  for (const m of maps) {
    if (m.folder && m.folder.toLowerCase() === oldName.toLowerCase()) {
      await storage.setMapFolder(m.id, newName);
    }
  }
  return c.json({ folders: await storage.listFolders() });
});

app.delete('/api/folders/:name', async (c) => {
  const name = c.req.param('name');
  const folders = await storage.listFolders();
  if (!folders.some((f) => f.name.toLowerCase() === name.toLowerCase())) {
    return c.json({ error: 'folder not found' }, 404);
  }
  const manifest = await storage.readFolders();
  const next = manifest.filter((f) => f.toLowerCase() !== name.toLowerCase());
  if (next.length !== manifest.length) await storage.writeFolders(next);
  const { maps } = await storage.listMaps();
  for (const m of maps) {
    if (m.folder && m.folder.toLowerCase() === name.toLowerCase()) {
      await storage.setMapFolder(m.id, undefined);
    }
  }
  return c.json({ folders: await storage.listFolders() });
});

app.delete('/api/maps/:id', async (c) => {
  const id = c.req.param('id');
  if (!storage.isValidId(id)) return c.json({ error: 'invalid map id' }, 400);
  const deleted = await storage.deleteMap(id);
  if (!deleted) return c.json({ error: 'map not found' }, 404);
  events.publish({ kind: 'map-deleted', mapId: id });
  return c.json({ ok: true });
});
