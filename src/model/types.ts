export const SCHEMA_VERSION = 1;

/** How the tree is arranged on the canvas. */
export type LayoutStyle = 'right' | 'balanced' | 'down' | 'timeline';

export const LAYOUT_STYLES: LayoutStyle[] = ['right', 'balanced', 'down', 'timeline'];

export const LAYOUT_LABELS: Record<LayoutStyle, string> = {
  right: 'right',
  balanced: 'balanced',
  down: 'org chart',
  timeline: 'roadmap',
};

/** A node as stored on disk: nested, human-readable, git-diffable. */
export interface FileNode {
  id: string;
  text: string;
  collapsed?: boolean;
  /** segon-cervell todo id once this node has been pushed. */
  todoId?: string;
  children: FileNode[];
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
  root: FileNode;
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

/** Persists empty folders and the folder display order. Lives at maps/folders.json. */
export interface FoldersManifest {
  schemaVersion: typeof SCHEMA_VERSION;
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

/** One turn in a "chat with this map" conversation. Never persisted — see ChatPanel. */
export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/** A node in the in-memory normalized document. */
export interface DocNode {
  id: string;
  text: string;
  collapsed: boolean;
  todoId?: string;
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
}
