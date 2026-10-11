import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SCHEMA_VERSION, type MapFile } from '../src/model/types';

let mapsDir: string;
type App = (typeof import('./app'))['app'];
type Storage = typeof import('./storage');

// MAPS_DIR is captured at module load — re-import per test for isolation.
async function fresh(): Promise<{ app: App; storage: Storage }> {
  vi.resetModules();
  const storage = await import('./storage.js');
  const { app } = await import('./app.js');
  return { app, storage };
}

function makeMap(id: string, overrides: Partial<MapFile> = {}): MapFile {
  const now = '2026-06-01T00:00:00.000Z';
  return {
    schemaVersion: SCHEMA_VERSION,
    id,
    title: id,
    createdAt: now,
    updatedAt: now,
    root: { id: `${id}-root`, text: id, children: [] },
    ...overrides,
  };
}

const LOCAL = { host: 'localhost:5454', 'content-type': 'application/json' };
const MCP_HEADERS = { ...LOCAL, accept: 'application/json, text/event-stream' };
const INIT = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
};

beforeEach(() => {
  mapsDir = mkdtempSync(path.join(tmpdir(), 'mindmap-app-'));
  process.env.MAPS_DIR = mapsDir;
});

afterEach(() => {
  rmSync(mapsDir, { recursive: true, force: true });
  delete process.env.MAPS_DIR;
});

describe('localhost guard', () => {
  it('rejects a rebinding Host header', async () => {
    const { app } = await fresh();
    const res = await app.request('/api/maps', { headers: { host: 'evil.example' } });
    expect(res.status).toBe(403);
  });

  it('rejects a cross-site Origin', async () => {
    const { app } = await fresh();
    const res = await app.request('/api/maps', {
      method: 'POST',
      headers: { ...LOCAL, origin: 'https://evil.example' },
      body: '{}',
    });
    expect(res.status).toBe(403);
  });

  it('rejects a CORS-simple text/plain POST', async () => {
    const { app } = await fresh();
    const res = await app.request('/api/maps', {
      method: 'POST',
      headers: { host: 'localhost:5454', 'content-type': 'text/plain;a=application/json' },
      body: '{"title":"x"}',
    });
    expect(res.status).toBe(415);
  });

  it('allows same-origin requests', async () => {
    const { app } = await fresh();
    const res = await app.request('/api/maps', { headers: { ...LOCAL, origin: 'http://localhost:5454' } });
    expect(res.status).toBe(200);
  });
});

describe('PUT /api/maps/:id', () => {
  it('keeps server-owned curation fields (folder, pinned, createdAt) from disk', async () => {
    const { app, storage } = await fresh();
    await storage.writeMap(makeMap('abcdef', { folder: 'Work', pinned: true, createdAt: '2020-01-01T00:00:00.000Z' }));
    const body = makeMap('abcdef', { title: 'edited', createdAt: '2026-01-01T00:00:00.000Z' }); // tab lacks folder/pinned
    const res = await app.request('/api/maps/abcdef', { method: 'PUT', headers: LOCAL, body: JSON.stringify(body) });
    expect(res.status).toBe(200);
    const map = await storage.readMap('abcdef');
    expect(map).toMatchObject({ title: 'edited', folder: 'Work', pinned: true, createdAt: '2020-01-01T00:00:00.000Z' });
  });

  it('rejects a malformed tree', async () => {
    const { app } = await fresh();
    const body = { ...makeMap('abcdef'), root: { nope: true } };
    const res = await app.request('/api/maps/abcdef', { method: 'PUT', headers: LOCAL, body: JSON.stringify(body) });
    expect(res.status).toBe(400);
  });
});

describe('storage concurrency', () => {
  it('serializes concurrent writes without losing any or leaking temp files', async () => {
    const { storage } = await fresh();
    await storage.writeMap(makeMap('abcdef'));
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        storage.updateMap('abcdef', (m) => ({
          ...m,
          root: { ...m.root, children: [...m.root.children, { id: `n${i}`, text: `${i}`, children: [] }] },
        })),
      ),
    );
    const map = await storage.readMap('abcdef');
    expect(map?.root.children).toHaveLength(8);
    expect(readdirSync(mapsDir).filter((f) => f.startsWith('.'))).toEqual([]);
  });
});

describe('/mcp sessions', () => {
  it('lets several clients initialize independently', async () => {
    const { app } = await fresh();
    for (let i = 0; i < 2; i++) {
      const res = await app.request('/mcp', { method: 'POST', headers: MCP_HEADERS, body: JSON.stringify(INIT) });
      expect(res.status).toBe(200);
      expect(res.headers.get('mcp-session-id')).toBeTruthy();
    }
  });

  it('404s an unknown session id', async () => {
    const { app } = await fresh();
    const res = await app.request('/mcp', {
      method: 'POST',
      headers: { ...MCP_HEADERS, 'mcp-session-id': 'nope' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    });
    expect(res.status).toBe(404);
  });
});
