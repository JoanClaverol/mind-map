import type { Rect } from '../layout/layout';

export interface RelationshipPath {
  /** SVG path data for a quadratic Bézier bowed between the two node borders. */
  d: string;
  /** Point on the curve at t=0.5 — where the label chip and editor sit. */
  mid: { x: number; y: number };
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
export function relationshipGeometry(from: Rect, to: Rect): RelationshipPath {
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
  const mid = {
    x: 0.25 * a.x + 0.5 * cpx + 0.25 * b.x,
    y: 0.25 * a.y + 0.5 * cpy + 0.25 * b.y,
  };
  return { d: `M ${a.x},${a.y} Q ${cpx},${cpy} ${b.x},${b.y}`, mid };
}
