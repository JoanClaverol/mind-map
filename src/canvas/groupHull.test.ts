import { describe, expect, it } from 'vitest';
import { convexHull, groupHull, GROUP_PAD } from './groupHull';

describe('convexHull', () => {
  it('returns the corners of a square, dropping interior and collinear points', () => {
    const hull = convexHull([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 5, y: 5 }, // interior
      { x: 5, y: 0 }, // collinear on an edge
      { x: 0, y: 0 }, // duplicate
    ]);
    expect(hull).toHaveLength(4);
    for (const p of [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]) {
      expect(hull).toContainEqual(p);
    }
  });

  it('handles degenerate input', () => {
    expect(convexHull([])).toEqual([]);
    expect(convexHull([{ x: 1, y: 1 }])).toEqual([{ x: 1, y: 1 }]);
  });
});

describe('groupHull', () => {
  it('returns null for no rects and a closed path for one rect', () => {
    expect(groupHull([])).toBeNull();
    const hull = groupHull([{ x: 0, y: 0, w: 100, h: 30 }]);
    expect(hull).not.toBeNull();
    expect(hull!.d.startsWith('M ')).toBe(true);
    expect(hull!.d.endsWith('Z')).toBe(true);
    // The anchor sits on the inflated top edge.
    expect(hull!.anchor.y).toBe(-GROUP_PAD);
  });

  it('encloses all member rects with padding', () => {
    const rects = [
      { x: 0, y: 0, w: 100, h: 30 },
      { x: 300, y: 200, w: 80, h: 30 },
    ];
    const hull = groupHull(rects)!;
    // Every inflated corner is inside or on the hull; spot-check path extremes.
    const nums = hull.d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    const xs = nums.filter((_, i) => i % 2 === 0);
    const ys = nums.filter((_, i) => i % 2 === 1);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(-GROUP_PAD);
    expect(Math.max(...xs)).toBeLessThanOrEqual(380 + GROUP_PAD);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(-GROUP_PAD);
    expect(Math.max(...ys)).toBeLessThanOrEqual(230 + GROUP_PAD);
    // The anchor is the topmost hull vertex — from the first rect's top edge.
    expect(hull.anchor.y).toBe(-GROUP_PAD);
  });

  it('is stable for overlapping rects (duplicate corner points)', () => {
    const r = { x: 0, y: 0, w: 50, h: 20 };
    const hull = groupHull([r, r, { x: 10, y: 5, w: 50, h: 20 }]);
    expect(hull).not.toBeNull();
    expect(hull!.d).toContain('Z');
  });
});
