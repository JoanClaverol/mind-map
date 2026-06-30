import { describe, expect, it } from 'vitest';
import { buildParentMap, denormalize, normalize, subtreeIds, visibleIds } from './doc';
import type { FileNode } from './types';

const tree: FileNode = {
  id: 'root',
  text: 'Root',
  children: [
    {
      id: 'a',
      text: 'Alpha',
      collapsed: true,
      todoId: 'todo-123',
      children: [
        { id: 'a1', text: 'Alpha one', children: [] },
        { id: 'a2', text: 'Alpha two', children: [] },
      ],
    },
    { id: 'b', text: 'Beta', children: [{ id: 'b1', text: 'Beta one', children: [] }] },
  ],
};

describe('normalize/denormalize', () => {
  it('round-trips a tree exactly, including collapsed and todoId', () => {
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
