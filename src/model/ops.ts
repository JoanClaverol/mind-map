import { newId, subtreeIds } from './doc';
import type { Doc, FileNode } from './types';

/**
 * Map operations: the shared vocabulary for surgical edits, used by both the
 * MCP server (readMap → normalize → applyDocOp → denormalize → writeMap) and
 * the browser's live-sync (runCommand(draft => applyDocOp(draft, op))). One
 * implementation of the semantics on both sides is what makes an externally
 * applied op converge with the browser's in-memory doc.
 *
 * `add_nodes` branches carry FINAL ids (assigned by the producer) — unlike
 * clipboard paste, ids are preserved on insert so the two sides agree on them.
 */
export type MapOp =
  | { type: 'add_nodes'; parentId: string; branches: FileNode[] }
  | { type: 'edit_node'; nodeId: string; text: string }
  | { type: 'move_node'; nodeId: string; newParentId: string; beforeSiblingId: string | null }
  | { type: 'delete_node'; nodeId: string }
  | { type: 'add_relationship'; relId: string; fromId: string; toId: string; label?: string }
  | { type: 'edit_relationship'; relId: string; label: string }
  | { type: 'delete_relationship'; relId: string };

/**
 * `select` is a suggested selection (used by commands.ts; ignored by live-sync).
 * A failed op reports `reason` (surfaced by MCP tools; silent no-op in the
 * browser). Every failure path returns before mutating, keeping history clean.
 */
export type OpResult = { ok: true; select?: string | null } | { ok: false; reason: string };

/** Recursively replace every id in a FileNode tree with fresh nanoids. */
export function assignIds(node: FileNode): void {
  node.id = newId();
  for (const child of node.children) assignIds(child);
}

function findParent(doc: Doc, id: string): string | null {
  for (const node of Object.values(doc.nodes)) {
    if (node.children.includes(id)) return node.id;
  }
  return null;
}

export function applyDocOp(doc: Doc, op: MapOp): OpResult {
  switch (op.type) {
    case 'add_nodes':
      return addNodes(doc, op.parentId, op.branches);
    case 'edit_node':
      return editNode(doc, op.nodeId, op.text);
    case 'move_node':
      return moveNode(doc, op.nodeId, op.newParentId, op.beforeSiblingId);
    case 'delete_node':
      return deleteNode(doc, op.nodeId);
    case 'add_relationship':
      return addRelationship(doc, op.relId, op.fromId, op.toId, op.label);
    case 'edit_relationship':
      return editRelationship(doc, op.relId, op.label);
    case 'delete_relationship':
      return deleteRelationship(doc, op.relId);
  }
}

function addNodes(doc: Doc, parentId: string, branches: FileNode[]): OpResult {
  const parent = doc.nodes[parentId];
  if (!parent) return { ok: false, reason: `parent node ${parentId} not found` };
  if (branches.length === 0) return { ok: false, reason: 'no nodes to add' };
  // Validate every incoming id before touching the doc.
  const seen = new Set<string>();
  const check = (n: FileNode): string | null => {
    if (doc.nodes[n.id]) return `node id ${n.id} already exists in the map`;
    if (seen.has(n.id)) return `duplicate id ${n.id} among the inserted nodes`;
    seen.add(n.id);
    for (const child of n.children) {
      const err = check(child);
      if (err) return err;
    }
    return null;
  };
  for (const branch of branches) {
    const err = check(branch);
    if (err) return { ok: false, reason: err };
  }
  const insert = (branch: FileNode, intoId: string): void => {
    const node = { id: branch.id, text: branch.text, collapsed: branch.collapsed ?? false, children: [] as string[] };
    doc.nodes[branch.id] = branch.todoId ? { ...node, todoId: branch.todoId } : node;
    doc.nodes[intoId].children.push(branch.id);
    for (const child of branch.children) insert(child, branch.id);
  };
  for (const branch of branches) insert(branch, parentId);
  parent.collapsed = false;
  return { ok: true, select: branches[0].id };
}

function editNode(doc: Doc, nodeId: string, text: string): OpResult {
  const node = doc.nodes[nodeId];
  if (!node) return { ok: false, reason: `node ${nodeId} not found` };
  node.text = text;
  return { ok: true, select: nodeId };
}

/**
 * Move a node (with its subtree) under newParentId, inserted before
 * beforeSiblingId (null = append at end). Anchor-based so same-parent moves
 * have no index-shift bugs: the insertion index is computed after removal.
 */
function moveNode(doc: Doc, nodeId: string, newParentId: string, beforeSiblingId: string | null): OpResult {
  if (nodeId === doc.rootId) return { ok: false, reason: 'the root cannot be moved' };
  if (!doc.nodes[nodeId]) return { ok: false, reason: `node ${nodeId} not found` };
  if (!doc.nodes[newParentId]) return { ok: false, reason: `new parent ${newParentId} not found` };
  if (subtreeIds(doc, nodeId).includes(newParentId)) {
    return { ok: false, reason: 'cannot move a node into its own subtree' };
  }
  if (beforeSiblingId === nodeId) return { ok: false, reason: 'node is already in that position' };
  const newParent = doc.nodes[newParentId];
  if (beforeSiblingId !== null && !newParent.children.includes(beforeSiblingId)) {
    return { ok: false, reason: `before sibling ${beforeSiblingId} is not a child of the new parent` };
  }
  const oldParentId = findParent(doc, nodeId);
  if (!oldParentId) return { ok: false, reason: `node ${nodeId} has no parent` };
  const oldParent = doc.nodes[oldParentId];
  const oldIdx = oldParent.children.indexOf(nodeId);
  if (oldParentId === newParentId && beforeSiblingId === (oldParent.children[oldIdx + 1] ?? null)) {
    return { ok: false, reason: 'node is already in that position' }; // also covers append-when-already-last
  }
  oldParent.children.splice(oldIdx, 1);
  const idx = beforeSiblingId === null ? newParent.children.length : newParent.children.indexOf(beforeSiblingId);
  newParent.children.splice(idx, 0, nodeId);
  newParent.collapsed = false;
  return { ok: true, select: nodeId };
}

function deleteNode(doc: Doc, nodeId: string): OpResult {
  if (nodeId === doc.rootId) return { ok: false, reason: 'the root cannot be deleted' };
  if (!doc.nodes[nodeId]) return { ok: false, reason: `node ${nodeId} not found` };
  const parentId = findParent(doc, nodeId);
  if (!parentId) return { ok: false, reason: `node ${nodeId} has no parent` };
  const parent = doc.nodes[parentId];
  const idx = parent.children.indexOf(nodeId);
  parent.children.splice(idx, 1);
  const removed = new Set<string>();
  const stack = [nodeId];
  while (stack.length) {
    const id = stack.pop()!;
    removed.add(id);
    stack.push(...doc.nodes[id].children);
    delete doc.nodes[id];
  }
  // Drop arrows touching any deleted node; undo restores them with the nodes.
  if (doc.relationships.some((r) => removed.has(r.from) || removed.has(r.to))) {
    doc.relationships = doc.relationships.filter((r) => !removed.has(r.from) && !removed.has(r.to));
  }
  const next = parent.children[Math.min(idx, parent.children.length - 1)] ?? parentId;
  return { ok: true, select: next };
}

/**
 * Add a free arrow from→to. The id is supplied so the producer can immediately
 * target the new arrow (the server returns it; the browser opens its label editor).
 */
function addRelationship(doc: Doc, relId: string, fromId: string, toId: string, label?: string): OpResult {
  if (fromId === toId) return { ok: false, reason: 'a relationship cannot link a node to itself' };
  if (!doc.nodes[fromId]) return { ok: false, reason: `source node ${fromId} not found` };
  if (!doc.nodes[toId]) return { ok: false, reason: `target node ${toId} not found` };
  if (doc.relationships.some((r) => r.from === fromId && r.to === toId)) {
    return { ok: false, reason: `a relationship from ${fromId} to ${toId} already exists` };
  }
  if (doc.relationships.some((r) => r.id === relId)) {
    return { ok: false, reason: `relationship id ${relId} already exists` };
  }
  const trimmed = label?.trim();
  doc.relationships.push(trimmed ? { id: relId, from: fromId, to: toId, label: trimmed } : { id: relId, from: fromId, to: toId });
  return { ok: true };
}

function editRelationship(doc: Doc, relId: string, label: string): OpResult {
  const rel = doc.relationships.find((r) => r.id === relId);
  if (!rel) return { ok: false, reason: `relationship ${relId} not found` };
  const trimmed = label.trim();
  if (trimmed) rel.label = trimmed;
  else delete rel.label;
  return { ok: true };
}

function deleteRelationship(doc: Doc, relId: string): OpResult {
  const idx = doc.relationships.findIndex((r) => r.id === relId);
  if (idx === -1) return { ok: false, reason: `relationship ${relId} not found` };
  doc.relationships.splice(idx, 1);
  return { ok: true };
}
