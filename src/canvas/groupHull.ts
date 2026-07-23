import type { Rect } from '../layout/layout';

export interface Pt {
  x: number;
  y: number;
}

/** Padding between a member node and the boundary, and the corner rounding radius. */
export const GROUP_PAD = 14;
export const GROUP_CORNER = 12;

function cross(o: Pt, a: Pt, b: Pt): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/**
 * Convex hull (Andrew's monotone chain). Strict turns, so collinear points are
 * dropped — every returned vertex is a real corner. Returns fewer than 3
 * points only for degenerate input (all points collinear).
 */
export function convexHull(points: Pt[]): Pt[] {
  const sorted = [...new Map(points.map((p) => [`${p.x},${p.y}`, p])).values()].sort(
    (a, b) => a.x - b.x || a.y - b.y,
  );
  if (sorted.length <= 2) return sorted;
  const lower: Pt[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

export interface GroupHull {
  /** Closed SVG path around the members, corners rounded. */
  d: string;
  /** Topmost hull vertex — where the label chip sits on the boundary. */
  anchor: Pt;
}

/**
 * The boundary around a set of member rects: the convex hull of the rects
 * inflated by pad, drawn with rounded corners (quadratic cuts). Works for a
 * single rect too (a plain rounded rect). Rects come from the layout, so the
 * hull recomputes for free whenever the map moves.
 */
export function groupHull(rects: Rect[]): GroupHull | null {
  if (rects.length === 0) return null;
  const points: Pt[] = rects.flatMap((r) => [
    { x: r.x - GROUP_PAD, y: r.y - GROUP_PAD },
    { x: r.x + r.w + GROUP_PAD, y: r.y - GROUP_PAD },
    { x: r.x + r.w + GROUP_PAD, y: r.y + r.h + GROUP_PAD },
    { x: r.x - GROUP_PAD, y: r.y + r.h + GROUP_PAD },
  ]);
  const hull = convexHull(points);
  if (hull.length < 3) return null; // rects always yield 4+ corners; defensive
  const anchor = hull.reduce((top, p) => (p.y < top.y || (p.y === top.y && p.x < top.x) ? p : top));
  // Each vertex is entered rIn before it and exited rOut after it; the cut is
  // clamped to half the edge so adjacent rounded corners never overlap.
  const corners = hull.map((b, i) => {
    const prev = hull[(i + hull.length - 1) % hull.length];
    const next = hull[(i + 1) % hull.length];
    const inLen = Math.hypot(prev.x - b.x, prev.y - b.y);
    const outLen = Math.hypot(next.x - b.x, next.y - b.y);
    const rIn = Math.min(GROUP_CORNER, inLen / 2);
    const rOut = Math.min(GROUP_CORNER, outLen / 2);
    return {
      b,
      entry: { x: b.x + ((prev.x - b.x) / inLen) * rIn, y: b.y + ((prev.y - b.y) / inLen) * rIn },
      exit: { x: b.x + ((next.x - b.x) / outLen) * rOut, y: b.y + ((next.y - b.y) / outLen) * rOut },
    };
  });
  const arc = ({ b, entry, exit }: (typeof corners)[number]) =>
    `L ${entry.x},${entry.y} Q ${b.x},${b.y} ${exit.x},${exit.y}`;
  const [first, ...rest] = corners;
  const d = [`M ${first.exit.x},${first.exit.y}`, ...rest.map(arc), arc(first), 'Z'].join(' ');
  return { d, anchor };
}
