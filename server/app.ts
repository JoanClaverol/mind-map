import { Hono } from 'hono';
import { stream } from 'hono/streaming';
import { nanoid } from 'nanoid';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { SCHEMA_VERSION, normalizeFolderName, type ChatTurn, type MapFile } from '../src/model/types';
import { createMcpServer } from './mcp-server';
import { createTodo, saveNote } from './mcp';
import { refineEnabled, refineText, streamMapAnswer, structureTranscript } from './openrouter';
import { transcribeAudio, transcriberHealthy } from './transcriber';
import * as storage from './storage';

const MAX_AUDIO_BYTES = 100 * 1024 * 1024;

export const app = new Hono();

const mcpServer = createMcpServer();
const mcpTransport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: () => nanoid(12) });
await mcpServer.connect(mcpTransport);

app.all('/mcp', async (c) => {
  const parsedBody = c.req.method === 'POST' ? await c.req.json().catch(() => undefined) : undefined;
  return mcpTransport.handleRequest(c.req.raw, { parsedBody });
});

app.get('/api/config', async (c) => {
  return c.json({ refine: refineEnabled(), transcriber: await transcriberHealthy() });
});

app.post('/api/transcribe', async (c) => {
  if (Number(c.req.header('content-length') ?? 0) > MAX_AUDIO_BYTES) {
    return c.json({ error: 'audio too large' }, 413);
  }
  const form = await c.req.formData().catch(() => null);
  const file = form?.get('audio');
  if (!(file instanceof File) || file.size === 0) {
    return c.json({ error: 'audio file is required (multipart field "audio")' }, 400);
  }
  try {
    return c.json(await transcribeAudio(file));
  } catch (err) {
    console.error('[transcribe] failed:', err instanceof Error ? err.message : err);
    return c.json({ error: 'transcription failed — is the transcriber container running?' }, 502);
  }
});

app.post('/api/structure', async (c) => {
  if (!refineEnabled()) return c.json({ error: 'AI structuring disabled (no OPENROUTER_API_KEY)' }, 503);
  const body = await c.req.json<{ text?: string }>().catch(() => null);
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text) return c.json({ error: 'text is required' }, 400);
  try {
    return c.json({ markdown: await structureTranscript(text) });
  } catch (err) {
    console.error('[structure] failed:', err instanceof Error ? err.message : err);
    return c.json({ error: 'AI structuring failed' }, 502);
  }
});

app.post('/api/refine', async (c) => {
  if (!refineEnabled()) return c.json({ error: 'refine disabled (no OPENROUTER_API_KEY)' }, 503);
  const body = await c.req.json<{ text?: string; instruction?: string }>().catch(() => null);
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  const instruction = typeof body?.instruction === 'string' ? body.instruction.trim() : '';
  if (!text || !instruction) return c.json({ error: 'text and instruction are required' }, 400);
  try {
    return c.json({ text: await refineText(text, instruction) });
  } catch (err) {
    console.error('[refine] failed:', err instanceof Error ? err.message : err);
    return c.json({ error: 'refine failed' }, 502);
  }
});

app.post('/api/chat', async (c) => {
  if (!refineEnabled()) return c.json({ error: 'AI chat disabled (no OPENROUTER_API_KEY)' }, 503);
  const body = await c.req.json<{ markdown?: string; messages?: ChatTurn[] }>().catch(() => null);
  const markdown = typeof body?.markdown === 'string' ? body.markdown.trim() : '';
  const messages = Array.isArray(body?.messages)
    ? body!.messages.filter(
        (m): m is ChatTurn =>
          !!m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && !!m.content.trim(),
      )
    : [];
  if (!markdown) return c.json({ error: 'markdown is required' }, 400);
  if (messages.length === 0) return c.json({ error: 'at least one message is required' }, 400);
  c.header('Content-Type', 'text/plain; charset=utf-8');
  // Streaming: once tokens start flowing the status is already 200, so a mid-stream
  // failure just ends the stream early — the client treats a short answer as failed.
  return stream(c, async (s) => {
    try {
      for await (const token of streamMapAnswer(markdown, messages)) await s.write(token);
    } catch (err) {
      console.error('[chat] failed:', err instanceof Error ? err.message : err);
    }
  });
});

app.post('/api/note', async (c) => {
  const body = await c.req.json<{ title?: string; text?: string }>().catch(() => null);
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text) return c.json({ error: 'text is required' }, 400);
  const title = typeof body?.title === 'string' && body.title.trim() ? body.title.trim() : 'Nota de veu';
  try {
    const { raw } = await saveNote(title, text);
    return c.json({ ok: true, message: raw });
  } catch (err) {
    console.error('[note] failed:', err instanceof Error ? err.message : err);
    return c.json({ error: 'segon-cervell unreachable' }, 502);
  }
});

app.post('/api/todo', async (c) => {
  const body = await c.req.json<{ text?: string; planned_for?: string }>().catch(() => null);
  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text) return c.json({ error: 'text is required' }, 400);
  const plannedFor = /^\d{4}-\d{2}-\d{2}$/.test(body?.planned_for ?? '') ? body!.planned_for : undefined;
  try {
    const { todoId, raw } = await createTodo(text, plannedFor);
    console.log(`[todo] pushed "${text}" (${plannedFor ?? 'backlog'}) → ${raw}`);
    return c.json({ todoId });
  } catch (err) {
    console.error('[todo] push failed:', err instanceof Error ? err.message : err);
    return c.json({ error: 'segon-cervell unreachable' }, 502);
  }
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
  return c.json({ ok: true });
});
