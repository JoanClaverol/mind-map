import { describe, expect, it } from 'vitest';
import type { FolderInfo, MapMeta } from '../model/types';
import { buildSections, folderKey, fuzzyFilter, fuzzyMatchNames, visibleOrder } from './sections';

function meta(id: string, title: string, updatedAt: string, pinned = false, folder?: string): MapMeta {
  return { id, title, updatedAt, nodeCount: 1, pinned, folder };
}

/** Find a section's items by key (or [] when the section is absent). */
function itemsOf(sections: ReturnType<typeof buildSections>, key: string): string[] {
  return (sections.find((s) => s.key === key)?.items ?? []).map((m) => m.id);
}

const fi = (name: string, mapCount = 0): FolderInfo => ({ name, mapCount });

const A = meta('a', 'Alpha plan', '2026-06-01T00:00:00.000Z');
const B = meta('b', 'Brainstorm', '2026-06-05T00:00:00.000Z');
const C = meta('c', 'Roadmap Q3', '2026-06-03T00:00:00.000Z', true);
const D = meta('d', 'Daily log', '2026-06-04T00:00:00.000Z', true);
const E = meta('e', 'Side ideas', '2026-06-02T00:00:00.000Z');

describe('fuzzyFilter', () => {
  it('returns everything sorted by updatedAt when the query is empty', () => {
    expect(fuzzyFilter([A, B, E], '').map((m) => m.id)).toEqual(['b', 'e', 'a']);
  });

  it('matches case-insensitive substrings and subsequences', () => {
    const maps = [A, B, E];
    expect(fuzzyFilter(maps, 'brain').map((m) => m.id)).toEqual(['b']);
    expect(fuzzyFilter(maps, 'BRAIN').map((m) => m.id)).toEqual(['b']);
    // "apn" is a subsequence of "alpha plan" but a substring of nothing
    expect(fuzzyFilter(maps, 'apn').map((m) => m.id)).toEqual(['a']);
  });

  it('ranks substring hits before subsequence hits regardless of recency', () => {
    const substringHit = meta('x', 'la idea', '2026-01-01T00:00:00.000Z');
    const subsequenceHit = meta('y', 'in der e-mail', '2026-06-06T00:00:00.000Z');
    expect(fuzzyFilter([subsequenceHit, substringHit], 'ide').map((m) => m.id)).toEqual(['x', 'y']);
  });

  it('drops non-matches', () => {
    expect(fuzzyFilter([A, B], 'zzz')).toEqual([]);
  });
});

describe('buildSections', () => {
  const lastOpened = { a: '2026-06-10T00:00:00.000Z', e: '2026-06-09T00:00:00.000Z', c: '2026-06-08T00:00:00.000Z' };

  it('partitions pinned / recent / all without overlap', () => {
    const s = buildSections([A, B, C, D, E], lastOpened);
    expect(itemsOf(s, 'pinned')).toEqual(['d', 'c']); // title asc: Daily log, Roadmap Q3
    expect(itemsOf(s, 'recent')).toEqual(['a', 'e']); // pinned c excluded despite lastOpened
    expect(itemsOf(s, 'uncategorized')).toEqual(['b']);
  });

  it('caps recent and keeps the overflow in the catch-all', () => {
    const s = buildSections([A, B, E], { a: '3', b: '2', e: '1' }, [], 2);
    expect(itemsOf(s, 'recent')).toEqual(['a', 'b']);
    expect(itemsOf(s, 'uncategorized')).toEqual(['e']);
  });

  it('sorts the catch-all by updatedAt desc when nothing was opened', () => {
    const s = buildSections([A, B, E], {});
    expect(s.find((x) => x.key === 'recent')).toBeUndefined();
    expect(itemsOf(s, 'uncategorized')).toEqual(['b', 'e', 'a']);
  });

  it('labels the lone catch-all headerless, but "All" once pinned/recent exist', () => {
    expect(buildSections([A, B], {})[0].label).toBe(''); // simple gallery: no header
    const withPin = buildSections([A, B, C], {}); // C is pinned
    expect(withPin.find((x) => x.key === 'uncategorized')?.label).toBe('All');
  });
});

describe('buildSections with folders', () => {
  const W = meta('w', 'Work note', '2026-06-07T00:00:00.000Z', false, 'Work');
  const P = meta('p', 'Pet plan', '2026-06-06T00:00:00.000Z', false, 'Personal');

  it('groups maps under folders in manifest order and keeps the rest Uncategorized', () => {
    const s = buildSections([A, W, P], {}, [fi('Work'), fi('Personal')]);
    expect(s.map((x) => x.key)).toEqual([folderKey('Work'), folderKey('Personal'), 'uncategorized']);
    expect(itemsOf(s, folderKey('Work'))).toEqual(['w']);
    expect(itemsOf(s, folderKey('Personal'))).toEqual(['p']);
    expect(itemsOf(s, 'uncategorized')).toEqual(['a']);
  });

  it('keeps empty folders as zero-item, collapsible sections', () => {
    const s = buildSections([A], {}, [fi('Empty')]);
    const folder = s.find((x) => x.key === folderKey('Empty'));
    expect(folder?.items).toEqual([]);
    expect(folder?.collapsible).toBe(true);
  });

  it('matches folder names case-insensitively', () => {
    const lower = meta('x', 'x', '2026-06-01T00:00:00.000Z', false, 'work');
    const s = buildSections([lower], {}, [fi('Work')]);
    expect(itemsOf(s, folderKey('Work'))).toEqual(['x']);
  });

  it('keeps a pinned map in Pinned, not its folder (pinning is cross-cutting)', () => {
    const pinnedInFolder = meta('q', 'Quarterly', '2026-06-09T00:00:00.000Z', true, 'Work');
    const s = buildSections([pinnedInFolder, W], {}, [fi('Work')]);
    expect(itemsOf(s, 'pinned')).toEqual(['q']);
    expect(itemsOf(s, folderKey('Work'))).toEqual(['w']); // q not doubled here
  });

  it('shows a recently-opened foldered map in its folder, not Recent', () => {
    const s = buildSections([W], { w: '2026-06-20T00:00:00.000Z' }, [fi('Work')]);
    expect(s.find((x) => x.key === 'recent')).toBeUndefined(); // folder wins over recent
    expect(itemsOf(s, folderKey('Work'))).toEqual(['w']);
  });
});

describe('visibleOrder', () => {
  it('concatenates sections when not searching and filters when searching', () => {
    const lastOpened = { a: '2026-06-10T00:00:00.000Z' };
    expect(visibleOrder([A, B, C], '', lastOpened).map((m) => m.id)).toEqual(['c', 'a', 'b']);
    expect(visibleOrder([A, B, C], 'road', lastOpened).map((m) => m.id)).toEqual(['c']);
  });

  it('equals the flattened non-collapsed sections', () => {
    const W = meta('w', 'Work note', '2026-06-07T00:00:00.000Z', false, 'Work');
    const folders = [fi('Work')];
    expect(visibleOrder([A, W], '', {}, folders).map((m) => m.id)).toEqual(['w', 'a']);
  });

  it('drops a collapsed folder’s rows from traversal', () => {
    const W = meta('w', 'Work note', '2026-06-07T00:00:00.000Z', false, 'Work');
    const folders = [fi('Work')];
    const collapsed = new Set([folderKey('Work')]);
    expect(visibleOrder([A, W], '', {}, folders, collapsed).map((m) => m.id)).toEqual(['a']);
  });

  it('search ignores folders and collapse', () => {
    const W = meta('w', 'Work note', '2026-06-07T00:00:00.000Z', false, 'Work');
    const collapsed = new Set([folderKey('Work')]);
    expect(visibleOrder([A, W], 'work', {}, [fi('Work')], collapsed).map((m) => m.id)).toEqual(['w']);
  });
});

describe('fuzzyMatchNames', () => {
  it('returns all names for an empty query', () => {
    expect(fuzzyMatchNames(['Work', 'Personal'], '')).toEqual(['Work', 'Personal']);
  });

  it('ranks substring hits before subsequence hits, case-insensitive', () => {
    expect(fuzzyMatchNames(['Personal', 'Plans'], 'pl')).toEqual(['Plans', 'Personal']);
  });

  it('drops non-matches', () => {
    expect(fuzzyMatchNames(['Work', 'Personal'], 'zzz')).toEqual([]);
  });
});
