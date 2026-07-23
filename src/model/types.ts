export const SCHEMA_VERSION = 2;

/** A world-coordinate point on the canvas. */
export interface Position {
  x: number;
  y: number;
}

/**
 * Node color names — a small muted palette derived from the app's zen accents.
 * The single source of truth for ops validation, migrate sanitation, the
 * inspector swatches, the MCP enum, and the `.node-rect.color-*` CSS classes.
 */
export const NODE_COLORS = ['sage', 'mist', 'clay', 'sand', 'rose'] as const;
export type NodeColor = (typeof NODE_COLORS)[number];

// Caps for node metadata (enforced by ops; salvaged-to by migrate).
export const MAX_ICON_LEN = 16;
export const MAX_NOTE_LEN = 2000;
export const MAX_TAGS = 8;
export const MAX_TAG_LEN = 24;

/** How the tree is arranged on the canvas. */
export type LayoutStyle = 'right' | 'balanced' | 'down' | 'timeline';

export const LAYOUT_STYLES: LayoutStyle[] = ['right', 'balanced', 'down', 'timeline'];

export const LAYOUT_LABELS: Record<LayoutStyle, string> = {
  right: 'right',
  balanced: 'balanced',
  down: 'org chart',
  timeline: 'roadmap',
};

/**
 * Structures a single branch may override to ('balanced' splits around the map
 * root, so it stays map-level only). A node's `style` restyles its subtree.
 */
export type BranchStyle = Exclude<LayoutStyle, 'balanced'>;

export const BRANCH_STYLES: BranchStyle[] = ['right', 'down', 'timeline'];

/** A node as stored on disk: nested, human-readable, git-diffable. */
export interface FileNode {
  id: string;
  text: string;
  collapsed?: boolean;
  /** Node color name (see NODE_COLORS) — typed loosely because disk is untrusted; migrate narrows. */
  color?: string;
  /** Leading emoji/glyph rendered before the text (never part of `text`). */
  icon?: string;
  /** Longer hidden text behind the node; shown in the inspector, dot on canvas. */
  note?: string;
  /** Free labels, searchable via find_nodes. */
  tags?: string[];
  /** Subtree structure override (see BRANCH_STYLES) — typed loosely because disk is untrusted; migrate narrows. */
  style?: string;
  children: FileNode[];
}

/** A detached tree floating on the canvas, laid out as a right-tree at pos. */
export interface FloatingTree {
  /** World position of the tree root node's top-left corner. */
  pos: Position;
  root: FileNode;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

/** A free, directional arrow linking any two nodes — across trees, not parent/child. */
export interface Relationship {
  id: string;
  /** source node id */
  from: string;
  /** target node id */
  to: string;
  label?: string;
}

/**
 * A boundary grouping arbitrary nodes — possibly from different parents —
 * drawn as a dashed hull around exactly the member nodes (not their subtrees).
 * Needs ≥ 2 members; deleting nodes prunes members and drops shrunken groups.
 */
export interface Group {
  id: string;
  /** Member node ids (distinct, each an existing node). */
  members: string[];
  label?: string;
  /** Palette name (NODE_COLORS) — typed loosely because disk is untrusted; migrate narrows. */
  color?: string;
}

/** One map = one JSON file in maps/. */
export interface MapFile {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  viewport?: Viewport;
  /** Absent in older files — treated as 'right'. */
  layout?: LayoutStyle;
  /** Pinned in the gallery. Omitted when false so files stay minimal. */
  pinned?: boolean;
  /** Gallery folder this map belongs to. Omitted when uncategorized so files stay minimal. */
  folder?: string;
  /** Free arrows linking nodes across trees. Omitted when empty so files stay minimal. */
  relationships?: Relationship[];
  /** Boundaries around sets of nodes. Omitted when empty so files stay minimal. */
  groups?: Group[];
  root: FileNode;
  /** Floating trees (XMind floating topics). Omitted when empty so files stay minimal. */
  floating?: FloatingTree[];
}

export interface MapMeta {
  id: string;
  title: string;
  updatedAt: string;
  nodeCount: number;
  pinned: boolean;
  /** Gallery folder, or undefined when uncategorized. */
  folder?: string;
}

/**
 * Persists empty folders and the folder display order. Lives at maps/folders.json.
 * Versioned independently of the map schema so a map bump doesn't re-stamp it.
 */
export const FOLDERS_SCHEMA_VERSION = 1;

export interface FoldersManifest {
  schemaVersion: typeof FOLDERS_SCHEMA_VERSION;
  folders: string[];
}

/** A gallery folder plus how many maps it holds. */
export interface FolderInfo {
  name: string;
  mapCount: number;
}

/** No slashes (keeps names path-safe), 1–40 chars after trimming. */
export const FOLDER_NAME_RE = /^[^/\\]{1,40}$/;

/** Trim and validate a folder name; undefined means "uncategorized". */
export function normalizeFolderName(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed || !FOLDER_NAME_RE.test(trimmed)) return undefined;
  return trimmed;
}

/** A node in the in-memory normalized document. */
export interface DocNode {
  id: string;
  text: string;
  collapsed: boolean;
  // Node metadata — see FileNode.
  color?: string;
  icon?: string;
  note?: string;
  tags?: string[];
  style?: string;
  children: string[];
}

/** Normalized in-memory document — what commands mutate. */
export interface Doc {
  rootId: string;
  /** Always present so a style change is a clean Immer `replace` patch. */
  layout: LayoutStyle;
  nodes: Record<string, DocNode>;
  /** Always present (possibly empty) so relationship commands never null-check. */
  relationships: Relationship[];
  /** Always present (possibly empty) so group commands never null-check. */
  groups: Group[];
  /** Floating trees: root ids + world positions. Always present, like relationships. */
  floating: Array<{ rootId: string; pos: Position }>;
}
