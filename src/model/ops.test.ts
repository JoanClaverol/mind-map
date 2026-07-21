import { describe, expect, it } from 'vitest';
import { denormalize, normalize } from './doc';
import { applyDocOp, assignIds } from './ops';
import type { Doc, FileNode } from './types';

function makeDoc(): Doc {
  return normalize(
    {
      id: 'root',
      text: 'r',
      children: [
        {
          id: 'a',
          text: 'a',
          collapsed: true,
          children: [{ id: 'a1', text: 'a1', note: 'nine', children: [] }],
        },
        { id: 'b', text: 'b', children: [] },
        { id: 'c', text: 'c', children: [] },
      ],
    },
    'right',
    [
      { id: 'r1', from: 'a1', to: 'b' },
      { id: 'r2', from: 'b', to: 'c' },
    ],
  );
}

const branch = (id: string, text: string, children: FileNode[] = []): FileNode => ({ id, text, children });

describe('applyDocOp add_nodes', () => {
  it('inserts preserving the provided ids and nesting, and un-collapses the parent', () => {
    const doc = makeDoc();
    const r = applyDocOp(doc, {
      type: 'add_nodes',
      parentId: 'a',
      branches: [branch('x', 'X', [branch('x1', 'X1')]), branch('y', 'Y')],
    });
    expect(r).toEqual({ ok: true, select: 'x' });
    expect(doc.nodes.a.children).toEqual(['a1', 'x', 'y']);
    expect(doc.nodes.x.children).toEqual(['x1']);
    expect(doc.nodes.x1.text).toBe('X1');
    expect(doc.nodes.a.collapsed).toBe(false);
  });

  it('fails on an unknown parent', () => {
    const doc = makeDoc();
    const r = applyDocOp(doc, { type: 'add_nodes', parentId: 'nope', branches: [branch('x', 'X')] });
    expect(r.ok).toBe(false);
  });

  it('fails on an id collision without touching the doc', () => {
    const doc = makeDoc();
    const before = JSON.stringify(doc);
    const r = applyDocOp(doc, {
      type: 'add_nodes',
      parentId: 'b',
      branches: [branch('x', 'X', [branch('a1', 'clash')])],
    });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(doc)).toBe(before);
  });

  it('fails on duplicate ids among the inserted nodes without touching the doc', () => {
    const doc = makeDoc();
    const before = JSON.stringify(doc);
    const r = applyDocOp(doc, { type: 'add_nodes', parentId: 'b', branches: [branch('x', 'X'), branch('x', 'X2')] });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(doc)).toBe(before);
  });

  it('fails on an empty branch list', () => {
    const doc = makeDoc();
    expect(applyDocOp(doc, { type: 'add_nodes', parentId: 'b', branches: [] }).ok).toBe(false);
  });
});

describe('applyDocOp edit_node', () => {
  it('replaces the node text', () => {
    const doc = makeDoc();
    const r = applyDocOp(doc, { type: 'edit_node', nodeId: 'b', text: 'renamed' });
    expect(r).toEqual({ ok: true, select: 'b' });
    expect(doc.nodes.b.text).toBe('renamed');
  });

  it('allows editing the root label', () => {
    const doc = makeDoc();
    expect(applyDocOp(doc, { type: 'edit_node', nodeId: 'root', text: 'new root' }).ok).toBe(true);
    expect(doc.nodes.root.text).toBe('new root');
  });

  it('fails on an unknown node', () => {
    const doc = makeDoc();
    expect(applyDocOp(doc, { type: 'edit_node', nodeId: 'nope', text: 'x' }).ok).toBe(false);
  });
});

describe('applyDocOp move_node', () => {
  it('reparents, appending when no anchor is given', () => {
    const doc = makeDoc();
    const r = applyDocOp(doc, { type: 'move_node', nodeId: 'a1', newParentId: 'b', beforeSiblingId: null });
    expect(r).toEqual({ ok: true, select: 'a1' });
    expect(doc.nodes.a.children).toEqual([]);
    expect(doc.nodes.b.children).toEqual(['a1']);
  });

  it('reorders before the anchor, including same-parent moves', () => {
    const doc = makeDoc();
    const r = applyDocOp(doc, { type: 'move_node', nodeId: 'c', newParentId: 'root', beforeSiblingId: 'a' });
    expect(r.ok).toBe(true);
    expect(doc.nodes.root.children).toEqual(['c', 'a', 'b']);
  });

  it('rejects the root, cycles, unknown anchors, and exact-position no-ops', () => {
    const doc = makeDoc();
    const before = JSON.stringify(doc);
    const cases = [
      { type: 'move_node', nodeId: 'root', newParentId: 'a', beforeSiblingId: null },
      { type: 'move_node', nodeId: 'a', newParentId: 'a1', beforeSiblingId: null }, // into own subtree
      { type: 'move_node', nodeId: 'a', newParentId: 'a', beforeSiblingId: null }, // into itself
      { type: 'move_node', nodeId: 'b', newParentId: 'root', beforeSiblingId: 'zz' }, // anchor not a child
      { type: 'move_node', nodeId: 'b', newParentId: 'root', beforeSiblingId: 'c' }, // already exactly there
      { type: 'move_node', nodeId: 'c', newParentId: 'root', beforeSiblingId: null }, // append-when-already-last
      { type: 'move_node', nodeId: 'nope', newParentId: 'root', beforeSiblingId: null },
    ] as const;
    for (const op of cases) {
      expect(applyDocOp(doc, op).ok, JSON.stringify(op)).toBe(false);
    }
    expect(JSON.stringify(doc)).toBe(before);
  });
});

describe('applyDocOp delete_node', () => {
  it('deletes the subtree, prunes only relationships touching it, selects a neighbor', () => {
    const doc = makeDoc();
    const r = applyDocOp(doc, { type: 'delete_node', nodeId: 'a' });
    expect(r).toEqual({ ok: true, select: 'b' });
    expect(doc.nodes.a).toBeUndefined();
    expect(doc.nodes.a1).toBeUndefined();
    expect(doc.relationships).toEqual([{ id: 'r2', from: 'b', to: 'c' }]);
  });

  it('selects the parent when deleting the last child', () => {
    const doc = makeDoc();
    const r = applyDocOp(doc, { type: 'delete_node', nodeId: 'a1' });
    expect(r).toEqual({ ok: true, select: 'a' });
  });

  it('rejects the root and unknown nodes', () => {
    const doc = makeDoc();
    expect(applyDocOp(doc, { type: 'delete_node', nodeId: 'root' }).ok).toBe(false);
    expect(applyDocOp(doc, { type: 'delete_node', nodeId: 'nope' }).ok).toBe(false);
  });
});

describe('applyDocOp add_relationship', () => {
  it('adds an arrow, trimming the label', () => {
    const doc = makeDoc();
    const r = applyDocOp(doc, { type: 'add_relationship', relId: 'r9', fromId: 'a', toId: 'c', label: '  links  ' });
    expect(r).toEqual({ ok: true });
    expect(doc.relationships).toContainEqual({ id: 'r9', from: 'a', to: 'c', label: 'links' });
  });

  it('omits an empty label entirely', () => {
    const doc = makeDoc();
    applyDocOp(doc, { type: 'add_relationship', relId: 'r9', fromId: 'a', toId: 'c', label: '   ' });
    expect(doc.relationships.find((r) => r.id === 'r9')).toEqual({ id: 'r9', from: 'a', to: 'c' });
  });

  it('rejects self-links, missing endpoints, duplicate arrows, and duplicate ids without touching the doc', () => {
    const doc = makeDoc();
    const before = JSON.stringify(doc);
    const cases = [
      { type: 'add_relationship', relId: 'x1', fromId: 'a', toId: 'a' }, // self
      { type: 'add_relationship', relId: 'x2', fromId: 'nope', toId: 'a' }, // missing source
      { type: 'add_relationship', relId: 'x3', fromId: 'a', toId: 'nope' }, // missing target
      { type: 'add_relationship', relId: 'x4', fromId: 'a1', toId: 'b' }, // duplicate from→to (r1 exists)
      { type: 'add_relationship', relId: 'r2', fromId: 'a', toId: 'c' }, // duplicate rel id
    ] as const;
    for (const op of cases) {
      expect(applyDocOp(doc, op).ok, JSON.stringify(op)).toBe(false);
    }
    expect(JSON.stringify(doc)).toBe(before);
  });
});

describe('applyDocOp edit_relationship', () => {
  it('sets a trimmed label and removes it when empty', () => {
    const doc = makeDoc();
    expect(applyDocOp(doc, { type: 'edit_relationship', relId: 'r1', label: ' causes ' }).ok).toBe(true);
    expect(doc.relationships[0].label).toBe('causes');
    expect(applyDocOp(doc, { type: 'edit_relationship', relId: 'r1', label: '  ' }).ok).toBe(true);
    expect(doc.relationships[0].label).toBeUndefined();
  });

  it('fails on an unknown relationship', () => {
    const doc = makeDoc();
    expect(applyDocOp(doc, { type: 'edit_relationship', relId: 'nope', label: 'x' }).ok).toBe(false);
  });
});

describe('applyDocOp delete_relationship', () => {
  it('removes only the targeted arrow', () => {
    const doc = makeDoc();
    expect(applyDocOp(doc, { type: 'delete_relationship', relId: 'r1' }).ok).toBe(true);
    expect(doc.relationships).toEqual([{ id: 'r2', from: 'b', to: 'c' }]);
  });

  it('fails on an unknown relationship', () => {
    const doc = makeDoc();
    expect(applyDocOp(doc, { type: 'delete_relationship', relId: 'nope' }).ok).toBe(false);
    expect(doc.relationships).toHaveLength(2);
  });
});

describe('normalize → applyDocOp → denormalize round-trip', () => {
  it('leaves untouched subtrees byte-identical (ids, metadata, collapsed preserved)', () => {
    const doc = makeDoc();
    applyDocOp(doc, { type: 'add_nodes', parentId: 'b', branches: [branch('x', 'X')] });
    const root = denormalize(doc);
    const a = root.children.find((n) => n.id === 'a')!;
    expect(a).toEqual({
      id: 'a',
      text: 'a',
      collapsed: true,
      children: [{ id: 'a1', text: 'a1', note: 'nine', children: [] }],
    });
  });
});

describe('assignIds', () => {
  it('replaces every id in the tree with fresh 12-char ids', () => {
    const tree = branch('x', 'X', [branch('x1', 'X1', [branch('x2', 'X2')])]);
    assignIds(tree);
    const ids = [tree.id, tree.children[0].id, tree.children[0].children[0].id];
    for (const id of ids) {
      expect(id).toMatch(/^[A-Za-z0-9_-]{12}$/);
    }
    expect(new Set(ids).size).toBe(3);
  });
});

describe('floating tree ops', () => {
  const withFloating = () => {
    const doc = makeDoc();
    applyDocOp(doc, {
      type: 'create_tree',
      root: branch('f', 'Float', [branch('f1', 'F-child')]),
      pos: { x: 500, y: 100 },
    });
    return doc;
  };

  it('create_tree inserts the subtree and registers the floating entry', () => {
    const doc = withFloating();
    expect(doc.nodes.f.text).toBe('Float');
    expect(doc.nodes.f.children).toEqual(['f1']);
    expect(doc.floating).toEqual([{ rootId: 'f', pos: { x: 500, y: 100 } }]);
  });

  it('create_tree rejects id collisions without touching the doc', () => {
    const doc = makeDoc();
    const before = JSON.stringify(doc);
    const r = applyDocOp(doc, { type: 'create_tree', root: branch('a', 'dup'), pos: { x: 0, y: 0 } });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(doc)).toBe(before);
  });

  it('move_node on a floating root ATTACHES the tree and clears the floating entry', () => {
    const doc = withFloating();
    const r = applyDocOp(doc, { type: 'move_node', nodeId: 'f', newParentId: 'b', beforeSiblingId: null });
    expect(r.ok).toBe(true);
    expect(doc.nodes.b.children).toEqual(['f']);
    expect(doc.floating).toEqual([]);
    expect(doc.nodes.f.children).toEqual(['f1']); // subtree rides along
  });

  it('attach into the tree own subtree is rejected', () => {
    const doc = withFloating();
    const r = applyDocOp(doc, { type: 'move_node', nodeId: 'f', newParentId: 'f1', beforeSiblingId: null });
    expect(r.ok).toBe(false);
    expect(doc.floating).toHaveLength(1); // entry untouched
  });

  it('delete_node on a floating root deletes the whole tree and prunes its arrows', () => {
    const doc = withFloating();
    applyDocOp(doc, { type: 'add_relationship', relId: 'x1', fromId: 'f1', toId: 'b' });
    const r = applyDocOp(doc, { type: 'delete_node', nodeId: 'f' });
    expect(r).toEqual({ ok: true, select: 'root' });
    expect(doc.nodes.f).toBeUndefined();
    expect(doc.nodes.f1).toBeUndefined();
    expect(doc.floating).toEqual([]);
    expect(doc.relationships.find((rel) => rel.id === 'x1')).toBeUndefined();
  });

  it('detach_node splices a branch out into a floating tree', () => {
    const doc = makeDoc();
    const r = applyDocOp(doc, { type: 'detach_node', nodeId: 'a', pos: { x: 300, y: 300 } });
    expect(r).toEqual({ ok: true, select: 'a' });
    expect(doc.nodes.root.children).toEqual(['b', 'c']);
    expect(doc.floating).toEqual([{ rootId: 'a', pos: { x: 300, y: 300 } }]);
    expect(doc.nodes.a.children).toEqual(['a1']); // subtree intact
  });

  it('detach_node rejects the main root and already-floating roots', () => {
    const doc = withFloating();
    expect(applyDocOp(doc, { type: 'detach_node', nodeId: 'root', pos: { x: 0, y: 0 } }).ok).toBe(false);
    expect(applyDocOp(doc, { type: 'detach_node', nodeId: 'f', pos: { x: 0, y: 0 } }).ok).toBe(false);
  });

  it('move_tree repositions; same pos and non-floating targets are rejected', () => {
    const doc = withFloating();
    expect(applyDocOp(doc, { type: 'move_tree', rootId: 'f', pos: { x: 600, y: 50 } }).ok).toBe(true);
    expect(doc.floating[0].pos).toEqual({ x: 600, y: 50 });
    expect(applyDocOp(doc, { type: 'move_tree', rootId: 'f', pos: { x: 600, y: 50 } }).ok).toBe(false);
    expect(applyDocOp(doc, { type: 'move_tree', rootId: 'b', pos: { x: 0, y: 0 } }).ok).toBe(false);
    expect(applyDocOp(doc, { type: 'move_tree', rootId: 'root', pos: { x: 0, y: 0 } }).ok).toBe(false);
  });

  it('main-root guards use the main-root wording, floating roots pass', () => {
    const doc = withFloating();
    const move = applyDocOp(doc, { type: 'move_node', nodeId: 'root', newParentId: 'b', beforeSiblingId: null });
    expect(move).toEqual({ ok: false, reason: 'the main root cannot be moved' });
    const del = applyDocOp(doc, { type: 'delete_node', nodeId: 'root' });
    expect(del).toEqual({ ok: false, reason: 'the main root cannot be deleted' });
  });
});

describe('applyDocOp set_node_meta', () => {
  it('sets fields partially, leaving absent ones untouched', () => {
    const doc = makeDoc();
    const r = applyDocOp(doc, { type: 'set_node_meta', nodeId: 'b', color: 'sage', icon: '💡' });
    expect(r).toEqual({ ok: true, select: 'b' });
    expect(doc.nodes.b.color).toBe('sage');
    expect(doc.nodes.b.icon).toBe('💡');
    applyDocOp(doc, { type: 'set_node_meta', nodeId: 'b', note: 'a note', tags: ['One', 'two'] });
    expect(doc.nodes.b.color).toBe('sage'); // untouched by the second op
    expect(doc.nodes.b.note).toBe('a note');
    expect(doc.nodes.b.tags).toEqual(['One', 'two']);
  });

  it('null clears a field; whitespace-only icon/note clear too', () => {
    const doc = makeDoc();
    applyDocOp(doc, { type: 'set_node_meta', nodeId: 'b', color: 'mist', icon: '⚡', note: 'x', tags: ['t'] });
    applyDocOp(doc, { type: 'set_node_meta', nodeId: 'b', color: null, icon: '  ', note: null, tags: [] });
    expect(doc.nodes.b.color).toBeUndefined();
    expect(doc.nodes.b.icon).toBeUndefined();
    expect(doc.nodes.b.note).toBeUndefined();
    expect(doc.nodes.b.tags).toBeUndefined();
  });

  it('trims and case-insensitively dedupes tags, first spelling wins', () => {
    const doc = makeDoc();
    applyDocOp(doc, { type: 'set_node_meta', nodeId: 'b', tags: [' Ops ', 'ops', 'OPS', 'q3', ''] });
    expect(doc.nodes.b.tags).toEqual(['Ops', 'q3']);
  });

  it('rejects invalid input loudly without mutating', () => {
    const doc = makeDoc();
    const before = JSON.stringify(doc);
    const badColor = applyDocOp(doc, { type: 'set_node_meta', nodeId: 'b', color: 'crimson' as never });
    expect(badColor.ok).toBe(false);
    expect(!badColor.ok && badColor.reason).toContain('sage, mist, clay, sand, rose');
    expect(applyDocOp(doc, { type: 'set_node_meta', nodeId: 'b', icon: 'x'.repeat(17) }).ok).toBe(false);
    expect(applyDocOp(doc, { type: 'set_node_meta', nodeId: 'b', note: 'x'.repeat(2001) }).ok).toBe(false);
    expect(applyDocOp(doc, { type: 'set_node_meta', nodeId: 'b', tags: ['x'.repeat(25)] }).ok).toBe(false);
    expect(
      applyDocOp(doc, { type: 'set_node_meta', nodeId: 'b', tags: Array.from({ length: 9 }, (_, i) => `t${i}`) }).ok,
    ).toBe(false);
    expect(applyDocOp(doc, { type: 'set_node_meta', nodeId: 'b' }).ok).toBe(false); // no fields
    expect(applyDocOp(doc, { type: 'set_node_meta', nodeId: 'nope', color: 'sage' }).ok).toBe(false);
    expect(JSON.stringify(doc)).toBe(before);
  });

  it('allows the root', () => {
    const doc = makeDoc();
    expect(applyDocOp(doc, { type: 'set_node_meta', nodeId: 'root', color: 'clay' }).ok).toBe(true);
    expect(doc.nodes.root.color).toBe('clay');
  });
});
