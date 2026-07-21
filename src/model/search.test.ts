import { describe, expect, it } from 'vitest';
import { normalize } from './doc';
import { isEmptyQuery, parseQuery, searchMatches, viewScope } from './search';
import type { FileNode } from './types';

const tree: FileNode = {
  id: 'root',
  text: 'Trip to Japan',
  children: [
    {
      id: 'a',
      text: 'Flights',
      collapsed: true,
      tags: ['booked', 'travel'],
      children: [
        { id: 'a1', text: 'Search Skyscanner', children: [] },
        { id: 'a2', text: 'Book by end of month', children: [] },
      ],
    },
    { id: 'b', text: 'Accommodation', tags: ['open'], children: [{ id: 'b1', text: 'Tokyo: Shibuya', children: [] }] },
  ],
};

const floating: FileNode = { id: 'f', text: 'Budget ideas', tags: ['open'], children: [] };

function doc() {
  return normalize(tree, 'right', [], [{ pos: { x: 0, y: 0 }, root: floating }]);
}

describe('parseQuery', () => {
  it('splits text tokens and #tag tokens, lowercased', () => {
    expect(parseQuery('  Tokyo #Open ')).toEqual({ textTokens: ['tokyo'], tagTokens: ['open'] });
  });

  it('ignores a bare # and treats blank input as empty', () => {
    expect(parseQuery('#')).toEqual({ textTokens: [], tagTokens: [] });
    expect(isEmptyQuery(parseQuery('   '))).toBe(true);
  });
});

describe('searchMatches', () => {
  it('matches case-insensitive substrings, including inside collapsed branches', () => {
    expect(searchMatches(doc(), 'book')).toEqual(['a2']);
    expect(searchMatches(doc(), 'FLIGHT')).toEqual(['a']);
  });

  it('requires every text token (AND)', () => {
    expect(searchMatches(doc(), 'book month')).toEqual(['a2']);
  });

  it('filters by tag prefix and combines tags with text', () => {
    expect(searchMatches(doc(), '#ope')).toEqual(['b', 'f']);
    expect(searchMatches(doc(), 'budget #open')).toEqual(['f']);
  });

  it('returns nothing for an empty query', () => {
    expect(searchMatches(doc(), '')).toEqual([]);
  });

  it('walks floating trees after the main tree', () => {
    expect(searchMatches(doc(), 'ideas')).toEqual(['f']);
  });
});

describe('viewScope', () => {
  it('re-roots the doc at the hoisted node and hides floating trees', () => {
    const scoped = viewScope(doc(), 'a');
    expect(scoped.rootId).toBe('a');
    expect(scoped.floating).toEqual([]);
    expect(searchMatches(scoped, 'book')).toEqual(['a2']);
    expect(searchMatches(scoped, '#open')).toEqual([]);
  });

  it('is the identity for no hoist, the main root, or a vanished node', () => {
    const d = doc();
    expect(viewScope(d, null)).toBe(d);
    expect(viewScope(d, 'root')).toBe(d);
    expect(viewScope(d, 'ghost')).toBe(d);
  });
});
