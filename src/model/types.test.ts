import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION } from './types';
import { migrateMapFile, MigrationError } from './migrate';

describe('migrateMapFile', () => {
  it('accepts a current-version map', () => {
    const map = {
      schemaVersion: SCHEMA_VERSION,
      id: 'abc123',
      title: 't',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      root: { id: 'r', text: 't', children: [] },
    };
    expect(migrateMapFile(map)).toEqual(map);
  });

  it('rejects files without a schemaVersion', () => {
    expect(() => migrateMapFile({ id: 'x' })).toThrow(MigrationError);
  });

  it('rejects newer schema versions', () => {
    expect(() => migrateMapFile({ schemaVersion: SCHEMA_VERSION + 1 })).toThrow(MigrationError);
  });

  it('keeps a boolean pinned flag and strips non-boolean ones', () => {
    const base = {
      schemaVersion: SCHEMA_VERSION,
      id: 'abc123',
      title: 't',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      root: { id: 'r', text: 't', children: [] },
    };
    expect(migrateMapFile({ ...base, pinned: true }).pinned).toBe(true);
    expect(migrateMapFile({ ...base, pinned: 'yes' }).pinned).toBeUndefined();
    expect(migrateMapFile(base).pinned).toBeUndefined();
  });

  it('accepts a known layout style and strips unknown ones', () => {
    const base = {
      schemaVersion: SCHEMA_VERSION,
      id: 'abc123',
      title: 't',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      root: { id: 'r', text: 't', children: [] },
    };
    expect(migrateMapFile({ ...base, layout: 'balanced' }).layout).toBe('balanced');
    expect(migrateMapFile({ ...base, layout: 'timeline' }).layout).toBe('timeline');
    expect(migrateMapFile({ ...base, layout: 'spiral' }).layout).toBeUndefined();
  });

  it('keeps well-formed relationships and strips malformed ones', () => {
    const base = {
      schemaVersion: SCHEMA_VERSION,
      id: 'abc123',
      title: 't',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      root: { id: 'r', text: 't', children: [] },
    };
    const out = migrateMapFile({
      ...base,
      relationships: [
        { id: 'r1', from: 'a', to: 'b' }, // valid
        { id: 'r2', from: 'a' }, // missing to
        { from: 'a', to: 'b' }, // missing id
        'nope', // not an object
      ],
    });
    expect(out.relationships).toEqual([{ id: 'r1', from: 'a', to: 'b' }]);
    expect(migrateMapFile({ ...base, relationships: 'x' }).relationships).toBeUndefined();
    expect(migrateMapFile(base).relationships).toBeUndefined();
  });
});
