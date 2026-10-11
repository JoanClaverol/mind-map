import { MAX_DRAW_POINTS, MIN_DRAW_SIZE } from './types';

/**
 * Freehand strokes. Stored as flat [x0, y0, x1, y1, …] normalized to 0…1
 * inside the element's w×h box, so moving and resizing a drawing are plain
 * x/y/w/h edits like every other element.
 */

/** Is this a well-formed normalized stroke? */
export function isValidStroke(points: unknown): points is number[] {
  return (
    Array.isArray(points) &&
    points.length >= 4 &&
    points.length % 2 === 0 &&
    points.length <= MAX_DRAW_POINTS * 2 &&
    points.every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1)
  );
}

/** Drop points closer than `minDist` to the previous kept one; cap the count. */
export function simplify(world: Array<{ x: number; y: number }>, minDist = 2): Array<{ x: number; y: number }> {
  const out: Array<{ x: number; y: number }> = [];
  for (const p of world) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= minDist) out.push(p);
  }
  const lastIn = world[world.length - 1];
  if (lastIn && out[out.length - 1] !== lastIn && out.length > 0) out.push(lastIn); // keep the end
  if (out.length <= MAX_DRAW_POINTS) return out;
  const step = out.length / MAX_DRAW_POINTS;
  return Array.from({ length: MAX_DRAW_POINTS }, (_, i) => out[Math.floor(i * step)]);
}

/**
 * World-space points → element box + normalized stroke. A thin dimension
 * (a straight line) is padded to the minimum drawing size and centered.
 */
export function normalizeStroke(world: Array<{ x: number; y: number }>): {
  x: number;
  y: number;
  w: number;
  h: number;
  points: number[];
} | null {
  const pts = simplify(world);
  if (pts.length < 2) return null;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const bw = Math.max(...xs) - minX;
  const bh = Math.max(...ys) - minY;
  if (bw < 3 && bh < 3) return null; // a click, not a stroke
  const w = Math.max(MIN_DRAW_SIZE, Math.ceil(bw));
  const h = Math.max(MIN_DRAW_SIZE, Math.ceil(bh));
  const ox = minX - (w - bw) / 2;
  const oy = minY - (h - bh) / 2;
  const round = (v: number) => Math.round(v * 10000) / 10000;
  return {
    x: Math.round(ox),
    y: Math.round(oy),
    w,
    h,
    points: pts.flatMap((p) => [round((p.x - ox) / w), round((p.y - oy) / h)]).map((v) => Math.min(1, Math.max(0, v))),
  };
}

/** Smooth SVG path through a normalized stroke scaled to w×h (midpoint quadratics). */
export function strokePath(points: number[], w: number, h: number): string {
  const n = points.length / 2;
  const px = (i: number) => points[2 * i] * w;
  const py = (i: number) => points[2 * i + 1] * h;
  if (n < 2) return '';
  if (n === 2) return `M ${px(0)},${py(0)} L ${px(1)},${py(1)}`;
  let d = `M ${px(0)},${py(0)}`;
  for (let i = 1; i < n - 1; i++) {
    const mx = (px(i) + px(i + 1)) / 2;
    const my = (py(i) + py(i + 1)) / 2;
    d += ` Q ${px(i)},${py(i)} ${mx},${my}`;
  }
  return `${d} L ${px(n - 1)},${py(n - 1)}`;
}
