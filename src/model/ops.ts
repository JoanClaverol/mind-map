import { findParent, floatingEntry, newId, subtreeIds } from './doc';
import { isValidStroke } from './strokes';
import {
  BRANCH_STYLES,
  ELEMENT_KINDS,
  ELEMENT_SIDES,
  MAX_ELEMENT_SIZE,
  MAX_ELEMENT_TEXT_LEN,
  MIN_DRAW_SIZE,
  MIN_ELEMENT_SIZE,
  MAX_ICON_LEN,
  MAX_NOTE_LEN,
  MAX_TAGS,
  MAX_TAG_LEN,
  MAX_EDGE_LABEL_LEN,
  STEP_KINDS,
  type StepKind,
  LAYOUT_STYLES,
  NODE_COLORS,
  type BranchStyle,
  type LayoutStyle,
  type CanvasElement,
  type Doc,
  type DocNode,
  type FileNode,
  type Group,
  type NodeColor,
  type Position,
} from './types';

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
  | { type: 'delete_relationship'; relId: string }
  | { type: 'add_group'; groupId: string; members: string[]; label?: string; color?: NodeColor }
  | {
      // Partial group update: undefined = leave untouched; members replaces the
      // whole list; label ''/null clears; color null clears.
      type: 'edit_group';
      groupId: string;
      members?: string[];
      label?: string | null;
      color?: NodeColor | null;
    }
  | { type: 'delete_group'; groupId: string }
  | { type: 'create_tree'; root: FileNode; pos: Position } // root carries FINAL ids
  | { type: 'move_tree'; rootId: string; pos: Position }
  | { type: 'set_layout'; layout: LayoutStyle } // the map-level structure (⇧S)
  | { type: 'add_element'; element: CanvasElement } // carries its FINAL id
  | {
      // Partial element update: undefined = leave untouched; color/anchor null clears.
      type: 'edit_element';
      elementId: string;
      text?: string;
      x?: number;
      y?: number;
      w?: number;
      h?: number;
      color?: NodeColor | null;
      anchor?: CanvasElement['anchor'] | null;
    }
  | { type: 'delete_element'; elementId: string }
  | { type: 'detach_node'; nodeId: string; pos: Position }
  | {
      // Partial-field metadata update: undefined = leave untouched, null = clear.
      type: 'set_node_meta';
      nodeId: string;
      color?: NodeColor | null;
      icon?: string | null;
      note?: string | null;
      tags?: string[] | null;
      style?: BranchStyle | null;
      step?: StepKind | null;
      edgeLabel?: string | null;
    };

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
    case 'add_group':
      return addGroup(doc, op.groupId, op.members, op.label, op.color);
    case 'edit_group':
      return editGroup(doc, op);
    case 'delete_group':
      return deleteGroup(doc, op.groupId);
    case 'create_tree':
      return createTree(doc, op.root, op.pos);
    case 'move_tree':
      return moveTree(doc, op.rootId, op.pos);
    case 'detach_node':
      return detachNode(doc, op.nodeId, op.pos);
    case 'set_node_meta':
      return setNodeMeta(doc, op);
    case 'add_element':
      return addElement(doc, op.element);
    case 'edit_element':
      return editElement(doc, op);
    case 'delete_element':
      return deleteElement(doc, op.elementId);
    case 'set_layout':
      if (!LAYOUT_STYLES.includes(op.layout)) {
        return { ok: false, reason: `unknown layout "${op.layout}" — valid: ${LAYOUT_STYLES.join(', ')}` };
      }
      doc.layout = op.layout;
      return { ok: true };
  }
}

/**
 * Update node metadata. Ops REJECT invalid input loudly (the LLM needs an
 * actionable error and batch atomicity); migrate, by contrast, salvages
 * whatever it can from hand-edited files.
 */
function setNodeMeta(doc: Doc, op: Extract<MapOp, { type: 'set_node_meta' }>): OpResult {
  const node = doc.nodes[op.nodeId];
  if (!node) return { ok: false, reason: `node ${op.nodeId} not found` };
  if (
    op.color === undefined &&
    op.icon === undefined &&
    op.note === undefined &&
    op.tags === undefined &&
    op.style === undefined &&
    op.step === undefined &&
    op.edgeLabel === undefined
  ) {
    return { ok: false, reason: 'set_node_meta requires at least one of color/icon/note/tags/style/step/edgeLabel' };
  }
  if (op.step != null && !STEP_KINDS.includes(op.step)) {
    return { ok: false, reason: `unknown step type "${op.step}" — valid types: ${STEP_KINDS.join(', ')}` };
  }
  const edgeLabel = op.edgeLabel == null ? op.edgeLabel : op.edgeLabel.replace(/\s+/g, ' ').trim();
  if (edgeLabel != null && edgeLabel.length > MAX_EDGE_LABEL_LEN) {
    return { ok: false, reason: `edge label is longer than ${MAX_EDGE_LABEL_LEN} characters` };
  }
  // Validate everything before mutating anything.
  if (op.color != null && !NODE_COLORS.includes(op.color)) {
    return { ok: false, reason: `unknown color "${op.color}" — valid colors: ${NODE_COLORS.join(', ')}` };
  }
  if (op.style != null && !BRANCH_STYLES.includes(op.style)) {
    return {
      ok: false,
      reason: `unknown branch style "${op.style}" — valid styles: ${BRANCH_STYLES.join(', ')} (balanced is map-level only)`,
    };
  }
  const icon = op.icon == null ? op.icon : op.icon.trim();
  if (icon != null && icon.length > MAX_ICON_LEN) {
    return { ok: false, reason: `icon is longer than ${MAX_ICON_LEN} characters` };
  }
  const note = op.note == null ? op.note : op.note.trim();
  if (note != null && note.length > MAX_NOTE_LEN) {
    return { ok: false, reason: `note is longer than ${MAX_NOTE_LEN} characters` };
  }
  let tags: string[] | null | undefined = op.tags;
  if (Array.isArray(op.tags)) {
    const seen = new Set<string>();
    tags = op.tags
      .map((t) => t.trim())
      .filter((t) => {
        if (!t) return false;
        const key = t.toLowerCase();
        if (seen.has(key)) return false; // case-insensitive dedupe, first spelling wins
        seen.add(key);
        return true;
      });
    const long = tags.find((t) => t.length > MAX_TAG_LEN);
    if (long) return { ok: false, reason: `tag "${long}" is longer than ${MAX_TAG_LEN} characters` };
    if (tags.length > MAX_TAGS) return { ok: false, reason: `more than ${MAX_TAGS} tags` };
  }
  // Apply: null (or an emptied value) clears; undefined leaves the field alone.
  // Immer skips same-value writes, so unchanged fields produce zero patches.
  if (op.color !== undefined) {
    if (op.color === null) delete node.color;
    else node.color = op.color;
  }
  if (icon !== undefined) {
    if (icon === null || icon === '') delete node.icon;
    else node.icon = icon;
  }
  if (note !== undefined) {
    if (note === null || note === '') delete node.note;
    else node.note = note;
  }
  if (tags !== undefined) {
    if (tags === null || tags.length === 0) delete node.tags;
    else node.tags = tags;
  }
  if (op.style !== undefined) {
    if (op.style === null) delete node.style;
    else node.style = op.style;
  }
  if (op.step !== undefined) {
    if (op.step === null) delete node.step;
    else node.step = op.step;
  }
  if (edgeLabel !== undefined) {
    if (edgeLabel === null || edgeLabel === '') delete node.edgeLabel;
    else node.edgeLabel = edgeLabel;
  }
  return { ok: true, select: op.nodeId };
}

/** Reject any incoming id that collides with the doc or repeats within the branches. */
function checkNewIds(doc: Doc, branches: FileNode[]): string | null {
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
    if (err) return err;
  }
  return null;
}

/** Insert a FileNode subtree into doc.nodes under intoId (or as a detached root when intoId is null). */
function insertBranch(doc: Doc, branch: FileNode, intoId: string | null): void {
  const node: DocNode = {
    id: branch.id,
    text: branch.text,
    collapsed: branch.collapsed ?? false,
    children: [],
  };
  if (branch.color) node.color = branch.color;
  if (branch.icon) node.icon = branch.icon;
  if (branch.note) node.note = branch.note;
  if (branch.tags?.length) node.tags = [...branch.tags];
  if (branch.style) node.style = branch.style;
  if (branch.step) node.step = branch.step;
  if (branch.edgeLabel) node.edgeLabel = branch.edgeLabel;
  doc.nodes[branch.id] = node;
  if (intoId !== null) doc.nodes[intoId].children.push(branch.id);
  for (const child of branch.children) insertBranch(doc, child, branch.id);
}

/** Remove a subtree from doc.nodes and prune relationships touching it. */
function removeSubtree(doc: Doc, rootId: string): void {
  const removed = new Set<string>();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    removed.add(id);
    stack.push(...doc.nodes[id].children);
    delete doc.nodes[id];
  }
  // Elements anchored to a deleted node go with it (undo restores them together).
  if (doc.elements.some((e) => e.anchor && removed.has(e.anchor.nodeId))) {
    for (const e of doc.elements) if (e.anchor && removed.has(e.anchor.nodeId)) removed.add(e.id);
    doc.elements = doc.elements.filter((e) => !removed.has(e.id));
  }
  // Drop arrows touching any deleted node; undo restores them with the nodes.
  if (doc.relationships.some((r) => removed.has(r.from) || removed.has(r.to))) {
    doc.relationships = doc.relationships.filter((r) => !removed.has(r.from) && !removed.has(r.to));
  }
  // Prune deleted members from groups; a group shrunk below 2 members dissolves.
  // Undo restores members and groups together with the nodes (Immer patches).
  for (const g of doc.groups) {
    if (g.members.some((m) => removed.has(m))) g.members = g.members.filter((m) => !removed.has(m));
  }
  for (let i = doc.groups.length - 1; i >= 0; i--) {
    if (doc.groups[i].members.length < 2) doc.groups.splice(i, 1);
  }
}

function addNodes(doc: Doc, parentId: string, branches: FileNode[]): OpResult {
  const parent = doc.nodes[parentId];
  if (!parent) return { ok: false, reason: `parent node ${parentId} not found` };
  if (branches.length === 0) return { ok: false, reason: 'no nodes to add' };
  const err = checkNewIds(doc, branches);
  if (err) return { ok: false, reason: err };
  for (const branch of branches) insertBranch(doc, branch, parentId);
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
 * Moving a floating tree's root ATTACHES the whole tree under the new parent.
 */
function moveNode(doc: Doc, nodeId: string, newParentId: string, beforeSiblingId: string | null): OpResult {
  if (nodeId === doc.rootId) return { ok: false, reason: 'the main root cannot be moved' };
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
  const floating = floatingEntry(doc, nodeId);
  if (floating) {
    // Attach: the tree stops floating and nests under the new parent.
    doc.floating.splice(doc.floating.indexOf(floating), 1);
  } else {
    const oldParentId = findParent(doc, nodeId);
    if (!oldParentId) return { ok: false, reason: `node ${nodeId} has no parent` };
    const oldParent = doc.nodes[oldParentId];
    const oldIdx = oldParent.children.indexOf(nodeId);
    if (oldParentId === newParentId && beforeSiblingId === (oldParent.children[oldIdx + 1] ?? null)) {
      return { ok: false, reason: 'node is already in that position' }; // also covers append-when-already-last
    }
    oldParent.children.splice(oldIdx, 1);
  }
  const idx = beforeSiblingId === null ? newParent.children.length : newParent.children.indexOf(beforeSiblingId);
  newParent.children.splice(idx, 0, nodeId);
  newParent.collapsed = false;
  return { ok: true, select: nodeId };
}

/** Delete a subtree. On a floating tree's root, deletes that whole tree. */
function deleteNode(doc: Doc, nodeId: string): OpResult {
  if (nodeId === doc.rootId) return { ok: false, reason: 'the main root cannot be deleted' };
  if (!doc.nodes[nodeId]) return { ok: false, reason: `node ${nodeId} not found` };
  const floating = floatingEntry(doc, nodeId);
  if (floating) {
    doc.floating.splice(doc.floating.indexOf(floating), 1);
    removeSubtree(doc, nodeId);
    return { ok: true, select: doc.rootId };
  }
  const parentId = findParent(doc, nodeId);
  if (!parentId) return { ok: false, reason: `node ${nodeId} has no parent` };
  const parent = doc.nodes[parentId];
  const idx = parent.children.indexOf(nodeId);
  parent.children.splice(idx, 1);
  removeSubtree(doc, nodeId);
  const next = parent.children[Math.min(idx, parent.children.length - 1)] ?? parentId;
  return { ok: true, select: next };
}

function createTree(doc: Doc, root: FileNode, pos: Position): OpResult {
  const err = checkNewIds(doc, [root]);
  if (err) return { ok: false, reason: err };
  insertBranch(doc, root, null);
  doc.floating.push({ rootId: root.id, pos: { x: pos.x, y: pos.y } });
  return { ok: true, select: root.id };
}

function moveTree(doc: Doc, rootId: string, pos: Position): OpResult {
  if (rootId === doc.rootId) return { ok: false, reason: 'the main root cannot be repositioned' };
  const entry = floatingEntry(doc, rootId);
  if (!entry) return { ok: false, reason: `node ${rootId} is not a floating tree root` };
  if (entry.pos.x === pos.x && entry.pos.y === pos.y) {
    return { ok: false, reason: 'tree is already at that position' }; // keeps history clean
  }
  entry.pos = { x: pos.x, y: pos.y };
  return { ok: true, select: rootId };
}

/** Splice a branch out of its parent and let it float at pos. */
function detachNode(doc: Doc, nodeId: string, pos: Position): OpResult {
  if (nodeId === doc.rootId) return { ok: false, reason: 'the main root cannot be detached' };
  if (!doc.nodes[nodeId]) return { ok: false, reason: `node ${nodeId} not found` };
  if (floatingEntry(doc, nodeId)) return { ok: false, reason: `node ${nodeId} is already a floating tree` };
  const parentId = findParent(doc, nodeId);
  if (!parentId) return { ok: false, reason: `node ${nodeId} has no parent` };
  const parent = doc.nodes[parentId];
  parent.children.splice(parent.children.indexOf(nodeId), 1);
  doc.floating.push({ rootId: nodeId, pos: { x: pos.x, y: pos.y } });
  return { ok: true, select: nodeId };
}

/**
 * Add a free arrow from→to. The id is supplied so the producer can immediately
 * target the new arrow (the server returns it; the browser opens its label editor).
 */
function addRelationship(doc: Doc, relId: string, fromId: string, toId: string, label?: string): OpResult {
  if (fromId === toId) return { ok: false, reason: 'a relationship cannot link a node to itself' };
  // Endpoints may be nodes or canvas elements.
  const linkable = (id: string) => !!doc.nodes[id] || doc.elements.some((e) => e.id === id);
  if (!linkable(fromId)) return { ok: false, reason: `source node/element ${fromId} not found` };
  if (!linkable(toId)) return { ok: false, reason: `target node/element ${toId} not found` };
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

/** Validate a group member list: distinct, existing, ≥ 2. Returns members or an error string. */
function checkMembers(doc: Doc, members: string[]): { members: string[] } | { error: string } {
  const distinct = [...new Set(members)];
  const missing = distinct.find((m) => !doc.nodes[m]);
  if (missing) return { error: `member node ${missing} not found` };
  if (distinct.length < 2) return { error: 'a group needs at least 2 distinct member nodes' };
  return { members: distinct };
}

/**
 * Add a boundary around a set of nodes. The id is supplied so the producer can
 * immediately target the new group (the server returns it; the browser opens
 * its label editor). Members may span different parents; overlap between
 * groups is allowed, an identical member set is not.
 */
function addGroup(doc: Doc, groupId: string, members: string[], label?: string, color?: NodeColor): OpResult {
  if (doc.groups.some((g) => g.id === groupId)) {
    return { ok: false, reason: `group id ${groupId} already exists` };
  }
  const checked = checkMembers(doc, members);
  if ('error' in checked) return { ok: false, reason: checked.error };
  const sameSet = (g: Group) =>
    g.members.length === checked.members.length && checked.members.every((m) => g.members.includes(m));
  if (doc.groups.some(sameSet)) {
    return { ok: false, reason: 'a group with exactly these members already exists' };
  }
  if (color != null && !NODE_COLORS.includes(color)) {
    return { ok: false, reason: `unknown color "${color}" — valid colors: ${NODE_COLORS.join(', ')}` };
  }
  const trimmed = label?.trim();
  const group: Group = { id: groupId, members: checked.members };
  if (trimmed) group.label = trimmed;
  if (color) group.color = color;
  doc.groups.push(group);
  return { ok: true };
}

function editGroup(doc: Doc, op: Extract<MapOp, { type: 'edit_group' }>): OpResult {
  const group = doc.groups.find((g) => g.id === op.groupId);
  if (!group) return { ok: false, reason: `group ${op.groupId} not found` };
  if (op.members === undefined && op.label === undefined && op.color === undefined) {
    return { ok: false, reason: 'edit_group requires at least one of members/label/color' };
  }
  // Validate everything before mutating anything.
  let members: string[] | undefined;
  if (op.members !== undefined) {
    const checked = checkMembers(doc, op.members);
    if ('error' in checked) return { ok: false, reason: checked.error };
    members = checked.members;
    const sameSet = (g: Group) =>
      g.id !== op.groupId && g.members.length === members!.length && members!.every((m) => g.members.includes(m));
    if (doc.groups.some(sameSet)) {
      return { ok: false, reason: 'a group with exactly these members already exists' };
    }
  }
  if (op.color != null && !NODE_COLORS.includes(op.color)) {
    return { ok: false, reason: `unknown color "${op.color}" — valid colors: ${NODE_COLORS.join(', ')}` };
  }
  if (members !== undefined) group.members = members;
  if (op.label !== undefined) {
    const trimmed = op.label?.trim();
    if (trimmed) group.label = trimmed;
    else delete group.label;
  }
  if (op.color !== undefined) {
    if (op.color === null) delete group.color;
    else group.color = op.color;
  }
  return { ok: true };
}

function deleteGroup(doc: Doc, groupId: string): OpResult {
  const idx = doc.groups.findIndex((g) => g.id === groupId);
  if (idx === -1) return { ok: false, reason: `group ${groupId} not found` };
  doc.groups.splice(idx, 1);
  return { ok: true };
}

function checkElementGeometry(
  e: { x?: number; y?: number; w?: number; h?: number },
  kind?: CanvasElement['kind'],
): string | null {
  for (const k of ['x', 'y'] as const) {
    if (e[k] !== undefined && !Number.isFinite(e[k])) return `${k} must be a finite number`;
  }
  const min = kind === 'draw' ? MIN_DRAW_SIZE : MIN_ELEMENT_SIZE;
  for (const k of ['w', 'h'] as const) {
    const v = e[k];
    if (v !== undefined && (!Number.isFinite(v) || v < min || v > MAX_ELEMENT_SIZE)) {
      return `${k} must be between ${min} and ${MAX_ELEMENT_SIZE}`;
    }
  }
  return null;
}

function checkAnchor(doc: Doc, anchor: CanvasElement['anchor']): string | null {
  if (!anchor) return null;
  if (!doc.nodes[anchor.nodeId]) return `anchor node ${anchor.nodeId} not found`;
  if (!ELEMENT_SIDES.includes(anchor.side)) return `unknown side "${anchor.side}" — valid: ${ELEMENT_SIDES.join(', ')}`;
  return null;
}

function checkColor(color: string | null | undefined): string | null {
  if (color == null || NODE_COLORS.includes(color as NodeColor)) return null;
  return `unknown color "${color}" — valid colors: ${NODE_COLORS.join(', ')}`;
}

function addElement(doc: Doc, element: CanvasElement): OpResult {
  if (doc.nodes[element.id] || doc.elements.some((e) => e.id === element.id)) {
    return { ok: false, reason: `id ${element.id} already exists` };
  }
  if (!ELEMENT_KINDS.includes(element.kind)) {
    return { ok: false, reason: `unknown element kind "${element.kind}" — valid: ${ELEMENT_KINDS.join(', ')}` };
  }
  if (element.text.length > MAX_ELEMENT_TEXT_LEN) return { ok: false, reason: `text exceeds ${MAX_ELEMENT_TEXT_LEN} chars` };
  if (element.kind === 'draw' && !isValidStroke(element.points)) {
    return { ok: false, reason: 'a draw element needs points: ≥ 2 normalized [x, y] pairs in 0…1' };
  }
  if (element.kind !== 'draw' && element.points !== undefined) {
    return { ok: false, reason: 'only draw elements carry points' };
  }
  const err = checkElementGeometry(element, element.kind) ?? checkAnchor(doc, element.anchor) ?? checkColor(element.color);
  if (err) return { ok: false, reason: err };
  const out: CanvasElement = { ...element };
  if (out.anchor) out.anchor = { nodeId: out.anchor.nodeId, side: out.anchor.side };
  else delete out.anchor;
  if (!out.color) delete out.color;
  if (out.points) out.points = [...out.points];
  doc.elements.push(out);
  return { ok: true };
}

function editElement(doc: Doc, op: Extract<MapOp, { type: 'edit_element' }>): OpResult {
  const el = doc.elements.find((e) => e.id === op.elementId);
  if (!el) return { ok: false, reason: `element ${op.elementId} not found` };
  if (op.text !== undefined && op.text.length > MAX_ELEMENT_TEXT_LEN) {
    return { ok: false, reason: `text exceeds ${MAX_ELEMENT_TEXT_LEN} chars` };
  }
  const err = checkElementGeometry(op, el.kind) ?? (op.anchor ? checkAnchor(doc, op.anchor) : null) ?? checkColor(op.color);
  if (err) return { ok: false, reason: err };
  // Only assign what changes: a no-op edit must produce zero patches (clean history).
  if (op.text !== undefined && op.text !== el.text) el.text = op.text;
  for (const k of ['x', 'y', 'w', 'h'] as const) {
    const v = op[k];
    if (v !== undefined && v !== el[k]) el[k] = v;
  }
  if (op.color === null && el.color !== undefined) delete el.color;
  else if (op.color && op.color !== el.color) el.color = op.color;
  if (op.anchor === null && el.anchor) delete el.anchor;
  else if (op.anchor && (op.anchor.nodeId !== el.anchor?.nodeId || op.anchor.side !== el.anchor?.side)) {
    el.anchor = { nodeId: op.anchor.nodeId, side: op.anchor.side };
  }
  return { ok: true };
}

function deleteElement(doc: Doc, elementId: string): OpResult {
  const idx = doc.elements.findIndex((e) => e.id === elementId);
  if (idx === -1) return { ok: false, reason: `element ${elementId} not found` };
  doc.elements.splice(idx, 1);
  if (doc.relationships.some((r) => r.from === elementId || r.to === elementId)) {
    doc.relationships = doc.relationships.filter((r) => r.from !== elementId && r.to !== elementId);
  }
  return { ok: true, select: null };
}
