import { describe, expect, it } from 'vitest';
import {
  branchStyleOf,
  buildParentMap,
  denormalize,
  effectiveStyleAt,
  floatingEntry,
  isRootId,
  normalize,
  serializeFloating,
  subtreeIds,
  visibleIds,
} from './doc';
import type { FileNode } from './types';

const tree: FileNode = {
  id: 'root',
  text: 'Root',
  children: [
    {
      id: 'a',
      text: 'Alpha',
      collapsed: true,
      note: 'a note',
      children: [
        { id: 'a1', text: 'Alpha one', children: [] },
        { id: 'a2', text: 'Alpha two', children: [] },
      ],
    },
    { id: 'b', text: 'Beta', style: 'down', children: [{ id: 'b1', text: 'Beta one', children: [] }] },
  ],
};

describe('normalize/denormalize', () => {
  it('round-trips a tree exactly, including collapsed and metadata', () => {
    expect(denormalize(normalize(tree))).toEqual(tree);
  });

  it('defaults layout to right and honors an explicit style', () => {
    expect(normalize(tree).layout).toBe('right');
    expect(normalize(tree, 'balanced').layout).toBe('balanced');
  });

  it('builds a correct parent map', () => {
    const parents = buildParentMap(normalize(tree));
    expect(parents).toEqual({ a: 'root', b: 'root', a1: 'a', a2: 'a', b1: 'b' });
  });

  it('subtreeIds is inclusive and depth-first', () => {
    expect(subtreeIds(normalize(tree), 'a')).toEqual(['a', 'a1', 'a2']);
  });

  it('visibleIds skips children of collapsed nodes', () => {
    expect(visibleIds(normalize(tree))).toEqual(['root', 'a', 'b', 'b1']);
  });

  it('defaults relationships to an empty array', () => {
    expect(normalize(tree).relationships).toEqual([]);
  });

  it('keeps valid relationships and drops self-links and dangling endpoints', () => {
    const rels = [
      { id: 'r1', from: 'a', to: 'b' }, // valid
      { id: 'r2', from: 'a', to: 'a' }, // self-link
      { id: 'r3', from: 'a', to: 'ghost' }, // missing target
      { id: 'r4', from: 'nope', to: 'b' }, // missing source
    ];
    expect(normalize(tree, 'right', rels).relationships).toEqual([{ id: 'r1', from: 'a', to: 'b' }]);
  });
});

describe('floating trees', () => {
  const floating = [
    {
      pos: { x: 500, y: 100 },
      root: {
        id: 'f',
        text: 'Float',
        color: 'sage',
        tags: ['idea'],
        children: [{ id: 'f1', text: 'Child', children: [] }],
      },
    },
  ];

  it('normalize merges floating nodes and builds doc.floating', () => {
    const doc = normalize(tree, 'right', [], floating);
    expect(doc.nodes.f.text).toBe('Float');
    expect(doc.nodes.f.color).toBe('sage');
    expect(doc.nodes.f1.text).toBe('Child');
    expect(doc.floating).toEqual([{ rootId: 'f', pos: { x: 500, y: 100 } }]);
  });

  it('normalize skips a floating tree whose root id collides', () => {
    const doc = normalize(tree, 'right', [], [{ pos: { x: 0, y: 0 }, root: { id: 'a', text: 'dup', children: [] } }]);
    expect(doc.nodes.a.text).toBe('Alpha'); // main tree wins
    expect(doc.floating).toEqual([]);
  });

  it('serializeFloating round-trips pos and metadata; undefined when empty', () => {
    const doc = normalize(tree, 'right', [], floating);
    expect(serializeFloating(doc)).toEqual(floating);
    expect(serializeFloating(normalize(tree))).toBeUndefined();
  });

  it('visibleIds covers floating trees after the main tree', () => {
    const doc = normalize(tree, 'right', [], floating);
    const ids = visibleIds(doc);
    expect(ids).toContain('f');
    expect(ids).toContain('f1');
    expect(ids.indexOf('f')).toBeGreaterThan(ids.indexOf('root'));
  });

  it('isRootId and floatingEntry distinguish roots', () => {
    const doc = normalize(tree, 'right', [], floating);
    expect(isRootId(doc, 'root')).toBe(true);
    expect(isRootId(doc, 'f')).toBe(true);
    expect(isRootId(doc, 'a')).toBe(false);
    expect(floatingEntry(doc, 'f')?.pos).toEqual({ x: 500, y: 100 });
    expect(floatingEntry(doc, 'root')).toBeUndefined();
  });

  it('cross-tree relationships survive normalization', () => {
    const doc = normalize(tree, 'right', [{ id: 'r1', from: 'b', to: 'f1' }], floating);
    expect(doc.relationships).toEqual([{ id: 'r1', from: 'b', to: 'f1' }]);
  });
});

describe('branch styles', () => {
  const styledTree: FileNode = {
    id: 'root',
    text: 'Root',
    style: 'down', // ignored: doc.layout governs the map root
    children: [
      {
        id: 'org',
        text: 'Org',
        style: 'down',
        children: [{ id: 'o1', text: 'One', children: [{ id: 'o1x', text: 'Deep', children: [] }] }],
      },
      { id: 'plain', text: 'Plain', children: [] },
      { id: 'junk', text: 'Junk', style: 'zigzag', children: [] },
    ],
  };
  const floatTree = [{ pos: { x: 0, y: 0 }, root: { id: 'f', text: 'F', children: [{ id: 'f1', text: 'F1', children: [] }] } }];
  const doc = normalize(styledTree, 'balanced', [], floatTree);

  it('branchStyleOf returns valid overrides only and ignores the map root', () => {
    expect(branchStyleOf(doc, 'org')).toBe('down');
    expect(branchStyleOf(doc, 'plain')).toBeUndefined();
    expect(branchStyleOf(doc, 'junk')).toBeUndefined();
    expect(branchStyleOf(doc, 'root')).toBeUndefined();
  });

  it('effectiveStyleAt: nearest ancestor override wins, else doc.layout', () => {
    expect(effectiveStyleAt(doc, 'root')).toBe('balanced');
    expect(effectiveStyleAt(doc, 'org')).toBe('down');
    expect(effectiveStyleAt(doc, 'o1')).toBe('down');
    expect(effectiveStyleAt(doc, 'o1x')).toBe('down');
    expect(effectiveStyleAt(doc, 'plain')).toBe('balanced');
    expect(effectiveStyleAt(doc, 'junk')).toBe('balanced');
  });

  it('effectiveStyleAt: floating trees fall back to right', () => {
    expect(effectiveStyleAt(doc, 'f')).toBe('right');
    expect(effectiveStyleAt(doc, 'f1')).toBe('right');
  });

  it('style round-trips through normalize/denormalize', () => {
    expect(denormalize(normalize(styledTree))).toEqual(styledTree);
  });
});
