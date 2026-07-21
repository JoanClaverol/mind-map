import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { nanoid } from 'nanoid';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { SCHEMA_VERSION, normalizeFolderName, type MapFile } from '../src/model/types';
import * as events from './events';
import { createMcpServer } from './mcp-server';
import * as storage from './storage';

export const app = new Hono();

// Lazily initialized on first request so createMcpServer reads env that the
// dev server may only populate after module top-levels have evaluated.
let mcpTransportPromise: Promise<WebStandardStreamableHTTPServerTransport> | null = null;
function getMcpTransport(): Promise<WebStandardStreamableHTTPServerTransport> {
  mcpTransportPromise ??= (async () => {
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: () => nanoid(12) });
    await createMcpServer().connect(transport);
    return transport;
  })();
  return mcpTransportPromise;
}

app.all('/mcp', async (c) => {
  const mcpTransport = await getMcpTransport();
  const parsedBody = c.req.method === 'POST' ? await c.req.json().catch(() => undefined) : undefined;
  return mcpTransport.handleRequest(c.req.raw, { parsedBody });
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

app.put('/api/maps/:id', async (c) => {
  const id = c.req.param('id');
  if (!storage.isValidId(id)) return c.json({ error: 'invalid map id' }, 400);
  const body = await c.req.json<MapFile>().catch(() => null);
  if (!body || body.schemaVersion !== SCHEMA_VERSION || body.id !== id || typeof body.root !== 'object') {
    return c.json({ error: 'invalid map document' }, 400);
  }
  const updatedAt = new Date().toISOString();
  await storage.writeMap({ ...body, updatedAt });
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
  const map = await storage.readMap(id);
  if (!map) return c.json({ error: 'map not found' }, 404);
  const updated: MapFile = { ...map };
  // Pinning and foldering are curation, not editing — only a title change bumps updatedAt.
  if (hasTitle) {
    updated.title = body.title!.trim();
    updated.updatedAt = new Date().toISOString();
  }
  if (hasPinned) {
    if (body.pinned) updated.pinned = true;
    else delete updated.pinned;
  }
  if (hasFolder) {
    if (body.folder === null || body.folder === '') {
      delete updated.folder;
    } else {
      const folder = normalizeFolderName(body.folder);
      if (!folder) return c.json({ error: 'invalid folder name' }, 400);
      updated.folder = folder;
      // Auto-add to the manifest so the folder keeps its place if the map later leaves.
      const manifest = await storage.readFolders();
      if (!manifest.some((f) => f.toLowerCase() === folder.toLowerCase())) {
        await storage.writeFolders([...manifest, folder]);
      }
    }
  }
  await storage.writeMap(updated);
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
