import { describe, expect, it } from 'vitest';
import { segmentsToBranches } from './segments';

const seg = (text: string) => ({ text, start: 0, end: 1 });

describe('segmentsToBranches', () => {
  it('makes one sibling node per segment', () => {
    const out = segmentsToBranches([seg('First full idea about the project'), seg('Second idea, also long enough')]);
    expect(out.map((n) => n.text)).toEqual(['First full idea about the project', 'Second idea, also long enough']);
    expect(out.every((n) => n.children.length === 0)).toBe(true);
  });

  it('merges tiny fragments into the previous segment', () => {
    const out = segmentsToBranches([seg('A complete thought about logistics'), seg('yes.'), seg('Another standalone complete thought')]);
    expect(out.map((n) => n.text)).toEqual([
      'A complete thought about logistics yes.',
      'Another standalone complete thought',
    ]);
  });

  it('keeps a tiny first segment as its own node (nothing to merge into)', () => {
    const out = segmentsToBranches([seg('Hola.'), seg('Una idea més llarga que continua')]);
    expect(out).toHaveLength(2);
  });

  it('skips empty/whitespace segments and handles empty input', () => {
    expect(segmentsToBranches([seg('   '), seg('')])).toEqual([]);
    expect(segmentsToBranches([])).toEqual([]);
  });
});
