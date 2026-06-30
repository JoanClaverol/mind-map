import type { Draft } from 'immer';
import { newId, subtreeIds } from '../model/doc';
import type { Doc, DocNode, FileNode, LayoutStyle } from '../model/types';

/**
 * Doc commands: pure mutations over an Immer draft. The store's executor wraps
 * them with produceWithPatches, so every command gets correct undo for free.
 * `select` is the node that should be selected after the command runs.
 */
export interface CommandResult {
  select?: string | null;
}

function findParentInDraft(doc: Draft<Doc> | Doc, id: string): string | null {
  for (const node of Object.values(doc.nodes)) {
    if (node.children.includes(id)) return node.id;
  }
  return null;
}

function blankNode(id: string): DocNode {
  return { id, text: '', collapsed: false, children: [] };
}

export function addChild(draft: Draft<Doc>, parentId: string): CommandResult {
  const parent = draft.nodes[parentId];
  if (!parent) return {};
  const id = newId();
  draft.nodes[id] = blankNode(id);
  parent.children.push(id);
  parent.collapsed = false;
  return { select: id };
}

/** offset 0 = above the reference node, 1 = below. No-op on the root. */
export function addSibling(draft: Draft<Doc>, nodeId: string, offset: 0 | 1): CommandResult {
  if (nodeId === draft.rootId) return {};
  const parentId = findParentInDraft(draft, nodeId);
  if (!parentId) return {};
  const parent = draft.nodes[parentId];
  const idx = parent.children.indexOf(nodeId);
  const id = newId();
  draft.nodes[id] = blankNode(id);
  parent.children.splice(idx + offset, 0, id);
  return { select: id };
}

export function editText(draft: Draft<Doc>, nodeId: string, text: string): CommandResult {
  const node = draft.nodes[nodeId];
  if (!node) return {};
  node.text = text;
  return { select: nodeId };
}

/** The root is undeletable — deleting it only clears its text. */
export function deleteSubtree(draft: Draft<Doc>, nodeId: string): CommandResult {
  if (nodeId === draft.rootId) {
    draft.nodes[nodeId].text = '';
    return { select: nodeId };
  }
  const parentId = findParentInDraft(draft, nodeId);
  if (!parentId) return {};
  const parent = draft.nodes[parentId];
  const idx = parent.children.indexOf(nodeId);
  parent.children.splice(idx, 1);
  const removed = new Set<string>();
  const stack = [nodeId];
  while (stack.length) {
    const id = stack.pop()!;
    removed.add(id);
    stack.push(...draft.nodes[id].children);
    delete draft.nodes[id];
  }
  // Drop arrows touching any deleted node; undo restores them with the nodes.
  if (draft.relationships.some((r) => removed.has(r.from) || removed.has(r.to))) {
    draft.relationships = draft.relationships.filter((r) => !removed.has(r.from) && !removed.has(r.to));
  }
  const next = parent.children[Math.min(idx, parent.children.length - 1)] ?? parentId;
  return { select: next };
}

export function toggleCollapse(draft: Draft<Doc>, nodeId: string): CommandResult {
  const node = draft.nodes[nodeId];
  if (!node || node.children.length === 0) return {};
  node.collapsed = !node.collapsed;
  return { select: nodeId };
}

export function expandNode(draft: Draft<Doc>, nodeId: string): CommandResult {
  const node = draft.nodes[nodeId];
  if (!node || !node.collapsed) return {};
  node.collapsed = false;
  return { select: nodeId };
}

/** Paste branches (e.g. parsed from markdown) under a parent, with fresh ids. */
export function pasteBranches(draft: Draft<Doc>, parentId: string, branches: FileNode[]): CommandResult {
  const parent = draft.nodes[parentId];
  if (!parent || branches.length === 0) return {};
  let firstId: string | null = null;
  const insert = (branch: FileNode, intoId: string): void => {
    const id = newId();
    if (!firstId) firstId = id;
    draft.nodes[id] = { id, text: branch.text, collapsed: branch.collapsed ?? false, children: [] };
    draft.nodes[intoId].children.push(id);
    for (const child of branch.children) insert(child, id);
  };
  for (const branch of branches) insert(branch, parentId);
  parent.collapsed = false;
  return { select: firstId };
}

/**
 * Move a node (with its subtree) under newParentId, inserted before
 * beforeSiblingId (null = append at end). Anchor-based so same-parent moves
 * have no index-shift bugs: the insertion index is computed after removal.
 * Every invalid/unchanged case returns before mutating, keeping history clean.
 */
export function moveNode(
  draft: Draft<Doc>,
  nodeId: string,
  newParentId: string,
  beforeSiblingId: string | null,
): CommandResult {
  if (nodeId === draft.rootId) return {};
  if (!draft.nodes[nodeId] || !draft.nodes[newParentId]) return {};
  if (subtreeIds(draft, nodeId).includes(newParentId)) return {}; // cycle (incl. self)
  if (beforeSiblingId === nodeId) return {}; // insert before self = unchanged
  const newParent = draft.nodes[newParentId];
  if (beforeSiblingId !== null && !newParent.children.includes(beforeSiblingId)) return {};
  const oldParentId = findParentInDraft(draft, nodeId);
  if (!oldParentId) return {};
  const oldParent = draft.nodes[oldParentId];
  const oldIdx = oldParent.children.indexOf(nodeId);
  if (oldParentId === newParentId && beforeSiblingId === (oldParent.children[oldIdx + 1] ?? null)) {
    return {}; // already exactly there (also covers append-when-already-last)
  }
  oldParent.children.splice(oldIdx, 1);
  const idx = beforeSiblingId === null ? newParent.children.length : newParent.children.indexOf(beforeSiblingId);
  newParent.children.splice(idx, 0, nodeId);
  newParent.collapsed = false;
  return { select: nodeId };
}

export function setLayoutStyle(draft: Draft<Doc>, style: LayoutStyle): CommandResult {
  if (draft.layout === style) return {}; // zero patches → no history entry
  draft.layout = style;
  return {};
}

export function setTodoId(draft: Draft<Doc>, nodeId: string, todoId: string): CommandResult {
  const node = draft.nodes[nodeId];
  if (!node) return {};
  node.todoId = todoId;
  return { select: nodeId };
}

/**
 * Add a free arrow from→to. The id is supplied so the caller can immediately
 * target the new arrow (e.g. open its label editor). No-ops on self-links,
 * missing endpoints, or a duplicate of an existing from→to arrow.
 */
export function addRelationship(
  draft: Draft<Doc>,
  fromId: string,
  toId: string,
  id: string,
): CommandResult {
  if (fromId === toId) return {};
  if (!draft.nodes[fromId] || !draft.nodes[toId]) return {};
  if (draft.relationships.some((r) => r.from === fromId && r.to === toId)) return {};
  draft.relationships.push({ id, from: fromId, to: toId });
  return {};
}

export function setRelationshipLabel(draft: Draft<Doc>, relId: string, label: string): CommandResult {
  const rel = draft.relationships.find((r) => r.id === relId);
  if (!rel) return {};
  const trimmed = label.trim();
  if (trimmed) rel.label = trimmed;
  else delete rel.label;
  return {};
}

export function deleteRelationship(draft: Draft<Doc>, relId: string): CommandResult {
  const idx = draft.relationships.findIndex((r) => r.id === relId);
  if (idx === -1) return {};
  draft.relationships.splice(idx, 1);
  return {};
}
