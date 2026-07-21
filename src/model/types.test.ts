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

describe('migrateMapFile v2 (floating trees + metadata)', () => {
  const base = {
    schemaVersion: SCHEMA_VERSION,
    id: 'abc123',
    title: 't',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    root: { id: 'r', text: 't', children: [] },
  };

  it('upgrades v1 files to v2 without inventing floating trees', () => {
    const migrated = migrateMapFile({ ...base, schemaVersion: 1 });
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.floating).toBeUndefined();
  });

  it('keeps well-formed floating trees and drops malformed or colliding ones', () => {
    const migrated = migrateMapFile({
      ...base,
      floating: [
        { pos: { x: 10, y: 20 }, root: { id: 'f1', text: 'ok', children: [] } },
        { pos: { x: 'bad', y: 0 }, root: { id: 'f2', text: 'bad pos', children: [] } },
        { pos: { x: 0, y: 0 }, root: { id: 'r', text: 'collides with main root', children: [] } },
        { pos: { x: 0, y: 0 } }, // no root
        'garbage',
      ],
    });
    expect(migrated.floating).toEqual([{ pos: { x: 10, y: 20 }, root: { id: 'f1', text: 'ok', children: [] } }]);
  });

  it('drops a non-array floating field and an emptied one', () => {
    expect(migrateMapFile({ ...base, floating: 'nope' }).floating).toBeUndefined();
    expect(migrateMapFile({ ...base, floating: ['bad'] }).floating).toBeUndefined();
  });

  it('sanitizes reserved metadata fields on main and floating nodes', () => {
    const migrated = migrateMapFile({
      ...base,
      root: {
        id: 'r',
        text: 't',
        color: 42,
        icon: '💡',
        note: null,
        tags: ['ok', 7, 'also'],
        children: [{ id: 'c', text: 'c', tags: 'not-an-array', children: [] }],
      },
      floating: [{ pos: { x: 0, y: 0 }, root: { id: 'f', text: 'f', color: 'sage', children: [] } }],
    });
    expect(migrated.root.color).toBeUndefined();
    expect(migrated.root.icon).toBe('💡');
    expect(migrated.root.note).toBeUndefined();
    expect(migrated.root.tags).toEqual(['ok', 'also']);
    expect(migrated.root.children[0].tags).toBeUndefined();
    expect(migrated.floating![0].root.color).toBe('sage');
  });
});
