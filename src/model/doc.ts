import { nanoid } from 'nanoid';
import type { Doc, DocNode, FileNode, LayoutStyle, Relationship } from './types';

export function newId(): string {
  return nanoid(12);
}

/** Nested file tree → flat normalized doc. */
export function normalize(
  root: FileNode,
  layout: LayoutStyle = 'right',
  relationships: Relationship[] = [],
): Doc {
  const nodes: Record<string, DocNode> = {};
  const walk = (n: FileNode) => {
    const node: DocNode = {
      id: n.id,
      text: n.text,
      collapsed: n.collapsed ?? false,
      children: n.children.map((c) => c.id),
    };
    if (n.todoId) node.todoId = n.todoId;
    nodes[n.id] = node;
    n.children.forEach(walk);
  };
  walk(root);
  // Drop dangling/self relationships so render and commands can trust the list.
  const rels = relationships.filter((r) => r.from !== r.to && nodes[r.from] && nodes[r.to]);
  return { rootId: root.id, layout, nodes, relationships: rels };
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
  if (n.todoId) out.todoId = n.todoId;
  return out;
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
  return out;
}

export function countDescendants(doc: Doc, id: string): number {
  return subtreeIds(doc, id).length - 1;
}
