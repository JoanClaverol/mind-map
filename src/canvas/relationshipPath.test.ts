import { describe, expect, it } from 'vitest';
import type { Rect } from '../layout/layout';
import { relationshipGeometry } from './relationshipPath';

/** Points along a quadratic path "M ax,ay Q cx,cy bx,by". */
function samples(d: string): Array<{ x: number; y: number }> {
  const [ax, ay, cx, cy, bx, by] = d.match(/-?[\d.]+/g)!.map(Number);
  return Array.from({ length: 21 }, (_, i) => {
    const t = 0.05 + i * 0.045;
    return {
      x: (1 - t) ** 2 * ax + 2 * (1 - t) * t * cx + t * t * bx,
      y: (1 - t) ** 2 * ay + 2 * (1 - t) * t * cy + t * t * by,
    };
  });
}
const inside = (r: Rect, p: { x: number; y: number }) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;

describe('relationship arrow routing', () => {
  const draft: Rect = { x: 0, y: 0, w: 100, h: 40 };
  const approve: Rect = { x: 200, y: 0, w: 100, h: 40 };
  // The flow label sitting on the connector between the two steps.
  const label: Rect = { x: 120, y: 11, w: 60, h: 18 };

  it('leaves a clear arrow exactly where it was', () => {
    const plain = relationshipGeometry(draft, { x: 300, y: 300, w: 100, h: 40 });
    const avoided = relationshipGeometry(draft, { x: 300, y: 300, w: 100, h: 40 }, undefined, [label, draft]);
    expect(avoided).toEqual(plain);
  });

  it('arcs a loop-back between neighbouring steps around the label between them', () => {
    const plain = relationshipGeometry(approve, draft);
    expect(samples(plain.d).some((p) => inside(label, p))).toBe(true); // the old behaviour crossed it
    const routed = relationshipGeometry(approve, draft, undefined, [label, approve, draft]);
    expect(samples(routed.d).some((p) => inside(label, p))).toBe(false);
  });

  it('steers around a node standing between the endpoints', () => {
    const a: Rect = { x: 0, y: 0, w: 80, h: 30 };
    const b: Rect = { x: 400, y: 0, w: 80, h: 30 };
    const middle: Rect = { x: 200, y: -20, w: 80, h: 70 };
    const routed = relationshipGeometry(a, b, undefined, [a, b, middle]);
    expect(samples(routed.d).some((p) => inside(middle, p))).toBe(false);
  });
});
