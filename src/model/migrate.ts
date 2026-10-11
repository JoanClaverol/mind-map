import {
  BRANCH_STYLES,
  ELEMENT_DEFAULT_SIZE,
  ELEMENT_KINDS,
  ELEMENT_SIDES,
  LAYOUT_STYLES,
  MAX_ELEMENT_SIZE,
  MAX_ELEMENT_TEXT_LEN,
  MIN_ELEMENT_SIZE,
  MAX_ICON_LEN,
  MAX_NOTE_LEN,
  MAX_TAGS,
  MAX_TAG_LEN,
  NODE_COLORS,
  SCHEMA_VERSION,
  normalizeFolderName,
  type BranchStyle,
  type CanvasElement,
  type ElementKind,
  type ElementSide,
  type FileNode,
  type FloatingTree,
  type Group,
  type LayoutStyle,
  type MapFile,
  type NodeColor,
} from './types';

export class MigrationError extends Error {}

/**
 * Salvage node metadata from hand-edited files: keep what fits the contract,
 * trim/truncate what nearly does, drop the rest. (Ops, by contrast, REJECT
 * invalid metadata loudly — LLMs need actionable errors, files need tolerance.)
 */
function sanitizeNodeMeta(node: FileNode): void {
  // todoId belonged to a removed integration — strip it from old files.
  delete (node as FileNode & { todoId?: string }).todoId;
  if (node.color !== undefined && !NODE_COLORS.includes(node.color as NodeColor)) delete node.color;
  // Branch styles: 'balanced' is map-level only, so it is invalid here too.
  if (node.style !== undefined && !BRANCH_STYLES.includes(node.style as BranchStyle)) delete node.style;
  if (node.icon !== undefined) {
    const icon = typeof node.icon === 'string' ? node.icon.trim() : '';
    if (icon && icon.length <= MAX_ICON_LEN) node.icon = icon;
    else delete node.icon;
  }
  if (node.note !== undefined) {
    const note = typeof node.note === 'string' ? node.note.trim().slice(0, MAX_NOTE_LEN) : '';
    if (note) node.note = note;
    else delete node.note;
  }
  if (node.tags !== undefined) {
    if (Array.isArray(node.tags)) {
      const seen = new Set<string>();
      node.tags = node.tags
        .filter((t): t is string => typeof t === 'string')
        .map((t) => t.trim())
        .filter((t) => {
          if (!t || t.length > MAX_TAG_LEN) return false;
          const key = t.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, MAX_TAGS);
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
  // Tolerate hand-edited groups: keep well-formed entries whose members exist,
  // dedupe members, drop groups left with fewer than 2 (matching normalize).
  if (Array.isArray(map.groups)) {
    const allIds = new Set<string>();
    collectIds(map.root, allIds);
    for (const f of map.floating ?? []) collectIds(f.root, allIds);
    const seenGroupIds = new Set<string>();
    map.groups = map.groups.flatMap((g) => {
      if (!g || typeof g !== 'object' || typeof g.id !== 'string' || !Array.isArray(g.members)) return [];
      if (seenGroupIds.has(g.id)) return [];
      seenGroupIds.add(g.id);
      const members = [
        ...new Set(g.members.filter((m): m is string => typeof m === 'string' && allIds.has(m))),
      ];
      if (members.length < 2) return [];
      const out: Group = { id: g.id, members };
      const label = typeof g.label === 'string' ? g.label.trim() : '';
      if (label) out.label = label;
      if (typeof g.color === 'string' && NODE_COLORS.includes(g.color as NodeColor)) out.color = g.color;
      return [out];
    });
    if (map.groups.length === 0) delete map.groups;
  } else if (map.groups !== undefined) {
    delete map.groups;
  }
  // Tolerate hand-edited elements: keep well-formed, id-unique entries; clamp sizes.
  if (Array.isArray(map.elements)) {
    const nodeIds = new Set<string>();
    collectIds(map.root, nodeIds);
    for (const f of map.floating ?? []) collectIds(f.root, nodeIds);
    const seen = new Set<string>();
    map.elements = map.elements.flatMap((raw): CanvasElement[] => {
      const e = raw as Partial<CanvasElement> | null;
      if (!e || typeof e !== 'object' || typeof e.id !== 'string' || seen.has(e.id) || nodeIds.has(e.id)) return [];
      if (!ELEMENT_KINDS.includes(e.kind as ElementKind)) return [];
      seen.add(e.id);
      const kind = e.kind as ElementKind;
      const size = (v: unknown, fallback: number) =>
        Number.isFinite(v) ? Math.min(MAX_ELEMENT_SIZE, Math.max(MIN_ELEMENT_SIZE, v as number)) : fallback;
      const out: CanvasElement = {
        id: e.id,
        kind,
        text: typeof e.text === 'string' ? e.text.slice(0, MAX_ELEMENT_TEXT_LEN) : '',
        w: size(e.w, ELEMENT_DEFAULT_SIZE[kind].w),
        h: size(e.h, ELEMENT_DEFAULT_SIZE[kind].h),
        x: Number.isFinite(e.x) ? (e.x as number) : 0,
        y: Number.isFinite(e.y) ? (e.y as number) : 0,
      };
      const a = e.anchor;
      if (a && typeof a === 'object') {
        if (!nodeIds.has(a.nodeId) || !ELEMENT_SIDES.includes(a.side as ElementSide)) return [];
        out.anchor = { nodeId: a.nodeId, side: a.side };
      }
      if (typeof e.color === 'string' && NODE_COLORS.includes(e.color as NodeColor)) out.color = e.color;
      return [out];
    });
    if (map.elements.length === 0) delete map.elements;
  } else if (map.elements !== undefined) {
    delete map.elements;
  }
  sanitizeNodeMeta(map.root);
  for (const f of map.floating ?? []) sanitizeNodeMeta(f.root);
  return map;
}
