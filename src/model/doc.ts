import { nanoid } from 'nanoid';
import {
  BRANCH_STYLES,
  type BranchStyle,
  type Doc,
  type DocNode,
  type FileNode,
  type FloatingTree,
  type LayoutStyle,
  type Position,
  type Relationship,
} from './types';

export function newId(): string {
  return nanoid(12);
}

/** Nested file tree → flat normalized doc. */
export function normalize(
  root: FileNode,
  layout: LayoutStyle = 'right',
  relationships: Relationship[] = [],
  floating: FloatingTree[] = [],
): Doc {
  const nodes: Record<string, DocNode> = {};
  const walk = (n: FileNode) => {
    const node: DocNode = {
      id: n.id,
      text: n.text,
      collapsed: n.collapsed ?? false,
      children: n.children.map((c) => c.id),
    };
    if (n.color) node.color = n.color;
    if (n.icon) node.icon = n.icon;
    if (n.note) node.note = n.note;
    if (n.tags?.length) node.tags = [...n.tags];
    if (n.style) node.style = n.style;
    nodes[n.id] = node;
    n.children.forEach(walk);
  };
  walk(root);
  const docFloating: Doc['floating'] = [];
  for (const f of floating) {
    if (nodes[f.root.id]) continue; // defensive: migrate already drops collisions
    walk(f.root);
    docFloating.push({ rootId: f.root.id, pos: { x: f.pos.x, y: f.pos.y } });
  }
  // Drop dangling/self relationships so render and commands can trust the list.
  const rels = relationships.filter((r) => r.from !== r.to && nodes[r.from] && nodes[r.to]);
  return { rootId: root.id, layout, nodes, relationships: rels, floating: docFloating };
}

/** Flat normalized doc → nested file tree. */
export function denormalize(doc: Doc, id: string = doc.rootId): FileNode {
  const n = doc.nodes[id];
  const out: FileNode = {
    id: n.id,
    text: n.text,
    children: n.children.map((c) => denormalize(doc, c)),
  };
  if (n.collapsed) out.collapsed = true;
  if (n.color) out.color = n.color;
  if (n.icon) out.icon = n.icon;
  if (n.note) out.note = n.note;
  if (n.tags?.length) out.tags = [...n.tags];
  if (n.style) out.style = n.style;
  return out;
}

/** id's valid branch-style override, or undefined. The map root's own style is ignored (doc.layout governs). */
export function branchStyleOf(doc: Doc, id: string): BranchStyle | undefined {
  if (id === doc.rootId) return undefined;
  const s = doc.nodes[id]?.style;
  return s && BRANCH_STYLES.includes(s as BranchStyle) ? (s as BranchStyle) : undefined;
}

/**
 * The layout structure governing id's subtree: nearest self-or-ancestor
 * override, else doc.layout (main tree) or 'right' (floating trees).
 */
export function effectiveStyleAt(doc: Doc, id: string, parents = buildParentMap(doc)): LayoutStyle {
  for (let cur: string | undefined = id; cur !== undefined; cur = parents[cur]) {
    const style = branchStyleOf(doc, cur);
    if (style) return style;
    if (cur === doc.rootId) return doc.layout;
  }
  return 'right'; // walked off the top of a floating tree
}

/** True for the main root or any floating tree root. */
export function isRootId(doc: Doc, id: string): boolean {
  return id === doc.rootId || doc.floating.some((f) => f.rootId === id);
}

/** The doc.floating entry for id, or undefined. */
export function floatingEntry(doc: Doc, id: string): { rootId: string; pos: Position } | undefined {
  return doc.floating.find((f) => f.rootId === id);
}

/** MapFile.floating from a doc, or undefined when there are none. */
export function serializeFloating(doc: Doc): FloatingTree[] | undefined {
  if (doc.floating.length === 0) return undefined;
  return doc.floating.map((f) => ({ pos: { x: f.pos.x, y: f.pos.y }, root: denormalize(doc, f.rootId) }));
}

/** childId → parentId for every non-root node. */
export function buildParentMap(doc: Doc): Record<string, string> {
  const parents: Record<string, string> = {};
  for (const node of Object.values(doc.nodes)) {
    for (const child of node.children) parents[child] = node.id;
  }
  return parents;
}

export function findParent(doc: Doc, id: string): string | null {
  for (const node of Object.values(doc.nodes)) {
    if (node.children.includes(id)) return node.id;
  }
  return null;
}

/** All ids in the subtree rooted at id (inclusive), depth-first. */
export function subtreeIds(doc: Doc, id: string): string[] {
  const out: string[] = [];
  const walk = (nid: string) => {
    out.push(nid);
    for (const c of doc.nodes[nid].children) walk(c);
  };
  walk(id);
  return out;
}

/** Ids visible on the canvas: depth-first, skipping children of collapsed nodes. */
export function visibleIds(doc: Doc): string[] {
  const out: string[] = [];
  const walk = (id: string) => {
    out.push(id);
    const n = doc.nodes[id];
    if (!n.collapsed) for (const c of n.children) walk(c);
  };
  walk(doc.rootId);
  for (const f of doc.floating) walk(f.rootId);
  return out;
}

export function countDescendants(doc: Doc, id: string): number {
  return subtreeIds(doc, id).length - 1;
}
