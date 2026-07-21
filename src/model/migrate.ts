import {
  LAYOUT_STYLES,
  SCHEMA_VERSION,
  normalizeFolderName,
  type FileNode,
  type FloatingTree,
  type LayoutStyle,
  type MapFile,
} from './types';

export class MigrationError extends Error {}

/** Drop malformed phase-3 metadata fields wherever hand-edits put them. */
function sanitizeNodeMeta(node: FileNode): void {
  if (node.color !== undefined && typeof node.color !== 'string') delete node.color;
  if (node.icon !== undefined && typeof node.icon !== 'string') delete node.icon;
  if (node.note !== undefined && typeof node.note !== 'string') delete node.note;
  if (node.tags !== undefined) {
    if (Array.isArray(node.tags)) {
      node.tags = node.tags.filter((t): t is string => typeof t === 'string');
      if (node.tags.length === 0) delete node.tags;
    } else {
      delete node.tags;
    }
  }
  if (Array.isArray(node.children)) for (const child of node.children) sanitizeNodeMeta(child);
}

function isWellFormedTree(root: unknown): root is FileNode {
  if (typeof root !== 'object' || root === null) return false;
  const n = root as FileNode;
  return typeof n.id === 'string' && typeof n.text === 'string' && Array.isArray(n.children);
}

function collectIds(node: FileNode, into: Set<string>): void {
  into.add(node.id);
  for (const child of node.children) if (isWellFormedTree(child)) collectIds(child, into);
}

/**
 * Upgrade a raw parsed map file to the current schema, version by version.
 * Files without a recognizable schemaVersion are rejected rather than guessed at.
 */
export function migrateMapFile(raw: unknown): MapFile {
  if (typeof raw !== 'object' || raw === null) {
    throw new MigrationError('map file is not an object');
  }
  const version = (raw as { schemaVersion?: unknown }).schemaVersion;
  if (typeof version !== 'number') {
    throw new MigrationError('map file has no schemaVersion');
  }
  if (version > SCHEMA_VERSION) {
    throw new MigrationError(`map file schemaVersion ${version} is newer than supported ${SCHEMA_VERSION}`);
  }
  if (version === 1) {
    // v2 added floating trees + reserved node metadata — v1 files simply have neither.
    (raw as { schemaVersion: number }).schemaVersion = 2;
  }
  const map = raw as MapFile;
  if (typeof map.id !== 'string' || typeof map.title !== 'string' || typeof map.root !== 'object') {
    throw new MigrationError('map file is missing required fields');
  }
  // Tolerate hand-edited layout values: unknown ones fall back to the default.
  if (map.layout !== undefined && !LAYOUT_STYLES.includes(map.layout as LayoutStyle)) {
    delete map.layout;
  }
  if (map.pinned !== undefined && typeof map.pinned !== 'boolean') {
    delete map.pinned;
  }
  // Tolerate hand-edited folder names: normalize, drop empty/invalid ones.
  if (map.folder !== undefined) {
    const folder = normalizeFolderName(map.folder);
    if (folder) map.folder = folder;
    else delete map.folder;
  }
  // Tolerate hand-edited relationships: keep well-formed entries, drop the rest.
  if (Array.isArray(map.relationships)) {
    map.relationships = map.relationships.filter(
      (r) => r && typeof r.id === 'string' && typeof r.from === 'string' && typeof r.to === 'string',
    );
  } else if (map.relationships !== undefined) {
    delete map.relationships;
  }
  // Tolerate hand-edited floating trees: keep well-formed, id-unique entries.
  if (Array.isArray(map.floating)) {
    const seen = new Set<string>();
    collectIds(map.root, seen);
    map.floating = map.floating.filter((f): f is FloatingTree => {
      if (
        !f ||
        typeof f !== 'object' ||
        !f.pos ||
        !Number.isFinite(f.pos.x) ||
        !Number.isFinite(f.pos.y) ||
        !isWellFormedTree(f.root)
      ) {
        return false;
      }
      const ids = new Set<string>();
      collectIds(f.root, ids);
      for (const id of ids) if (seen.has(id)) return false; // collides with an earlier tree
      for (const id of ids) seen.add(id);
      return true;
    });
    if (map.floating.length === 0) delete map.floating;
  } else if (map.floating !== undefined) {
    delete map.floating;
  }
  sanitizeNodeMeta(map.root);
  for (const f of map.floating ?? []) sanitizeNodeMeta(f.root);
  return map;
}
