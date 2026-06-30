import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SCHEMA_VERSION, type MapFile } from '../src/model/types';

let mapsDir: string;
type Storage = typeof import('./storage');

// MAPS_DIR is captured at module load, so reset modules and re-import per test
// to get an isolated maps directory each time.
async function freshStorage(): Promise<Storage> {
  vi.resetModules();
  return import('./storage.js');
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

beforeEach(() => {
  mapsDir = mkdtempSync(path.join(tmpdir(), 'mind-map-storage-'));
  process.env.MAPS_DIR = mapsDir;
});

afterEach(() => {
  rmSync(mapsDir, { recursive: true, force: true });
});

describe('folder manifest', () => {
  it('returns [] for a missing or malformed manifest', async () => {
    const storage = await freshStorage();
    expect(await storage.readFolders()).toEqual([]);
    writeFileSync(path.join(mapsDir, 'folders.json'), 'not json');
    expect(await storage.readFolders()).toEqual([]);
  });

  it('round-trips, dedupes case-insensitively, and drops invalid names', async () => {
    const storage = await freshStorage();
    await storage.writeFolders(['Work', 'work', '  Personal  ', '', 'bad/name']);
    expect(await storage.readFolders()).toEqual(['Work', 'Personal']);
  });
});

describe('listMaps', () => {
  it('skips folders.json and carries the folder field', async () => {
    const storage = await freshStorage();
    await storage.writeMap(makeMap('aaaaaa', { folder: 'Work' }));
    await storage.writeMap(makeMap('bbbbbb'));
    await storage.writeFolders(['Work']);
    const { maps, warnings } = await storage.listMaps();
    expect(warnings).toEqual([]);
    expect(maps.map((m) => m.id).sort()).toEqual(['aaaaaa', 'bbbbbb']);
    expect(maps.find((m) => m.id === 'aaaaaa')?.folder).toBe('Work');
    expect(maps.find((m) => m.id === 'bbbbbb')?.folder).toBeUndefined();
  });
});

describe('listFolders', () => {
  it('merges manifest order with map counts and auto-surfaces orphans', async () => {
    const storage = await freshStorage();
    await storage.writeFolders(['Work', 'Empty']);
    await storage.writeMap(makeMap('aaaaaa', { folder: 'Work' }));
    await storage.writeMap(makeMap('bbbbbb', { folder: 'Orphan' })); // folder not in manifest
    const folders = await storage.listFolders();
    expect(folders).toEqual([
      { name: 'Work', mapCount: 1 },
      { name: 'Empty', mapCount: 0 },
      { name: 'Orphan', mapCount: 1 },
    ]);
  });
});

describe('setMapFolder', () => {
  it('sets and clears the folder while preserving updatedAt', async () => {
    const storage = await freshStorage();
    await storage.writeMap(makeMap('aaaaaa'));
    await storage.setMapFolder('aaaaaa', 'Work');
    let map = await storage.readMap('aaaaaa');
    expect(map?.folder).toBe('Work');
    expect(map?.updatedAt).toBe('2026-06-01T00:00:00.000Z'); // unchanged — curation

    await storage.setMapFolder('aaaaaa', undefined);
    map = await storage.readMap('aaaaaa');
    expect(map?.folder).toBeUndefined();
    expect(map?.updatedAt).toBe('2026-06-01T00:00:00.000Z');
  });

  it('returns false for an unknown map', async () => {
    const storage = await freshStorage();
    expect(await storage.setMapFolder('zzzzzz', 'Work')).toBe(false);
  });
});
