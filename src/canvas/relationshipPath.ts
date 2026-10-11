import type { Rect } from '../layout/layout';

export interface RelationshipPath {
  /** SVG path data for a quadratic Bézier bowed between the two node borders. */
  d: string;
  /**
   * Where the label chip and editor sit: the curve's midpoint, or the nearest
   * point along it whose label box is clear of every obstacle.
   */
  mid: { x: number; y: number };
}

/** Label chip height (RelationshipView / LabelEditor). */
export const REL_LABEL_H = 18;
/** Width of a label chip for the given text (matches RelationshipView). */
export function relLabelWidth(label: string): number {
  return 14 + 7 * label.length;
}
/** Curve parameters tried for the label, nearest the middle first. */
const LABEL_TS = [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.18, 0.82];
const LABEL_CLEARANCE = 4;

function hits(r: Rect, cx: number, cy: number, w: number, h: number): boolean {
  const m = LABEL_CLEARANCE;
  return cx - w / 2 < r.x + r.w + m && cx + w / 2 > r.x - m && cy - h / 2 < r.y + r.h + m && cy + h / 2 > r.y - m;
}

/** The point where the line from a rect's center toward (tx,ty) crosses its border. */
function borderPoint(rect: Rect, tx: number, ty: number): { x: number; y: number } {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  // Scale the direction until it hits the nearer of the vertical/horizontal edges.
  const sx = dx === 0 ? Infinity : rect.w / 2 / Math.abs(dx);
  const sy = dy === 0 ? Infinity : rect.h / 2 / Math.abs(dy);
  const t = Math.min(sx, sy);
  return { x: cx + dx * t, y: cy + dy * t };
}

/**
 * A bowed connector from the border of `from` to the border of `to`, arcing
 * to one side (XMind-style). The arrowhead lands at the `to` border.
 */
export function relationshipGeometry(
  from: Rect,
  to: Rect,
  label?: { width: number; obstacles: Iterable<Rect> },
): RelationshipPath {
  const fc = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
  const tc = { x: to.x + to.w / 2, y: to.y + to.h / 2 };
  const a = borderPoint(from, tc.x, tc.y);
  const b = borderPoint(to, fc.x, fc.y);
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  // Control point: the chord midpoint pushed perpendicular so the line bows.
  const nx = -(b.y - a.y) / len;
  const ny = (b.x - a.x) / len;
  const bow = Math.min(len * 0.18, 80);
  const cpx = (a.x + b.x) / 2 + nx * bow;
  const cpy = (a.y + b.y) / 2 + ny * bow;
  const at = (t: number) => ({
    x: (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * cpx + t * t * b.x,
    y: (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * cpy + t * t * b.y,
  });
  let mid = at(0.5);
  if (label) {
    const obstacles = [...label.obstacles];
    const clear = LABEL_TS.map(at).find(
      (p) => !obstacles.some((r) => hits(r, p.x, p.y, label.width, REL_LABEL_H)),
    );
    if (clear) mid = clear; // nowhere clear → the midpoint, as before
  }
  return { d: `M ${a.x},${a.y} Q ${cpx},${cpy} ${b.x},${b.y}`, mid };
}
