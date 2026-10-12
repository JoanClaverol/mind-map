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
/** Breathing room a label needs for a ROUTE to count as clear (wider than for placement). */
const ROUTE_LABEL_CLEARANCE = 8;

function hits(r: Rect, cx: number, cy: number, w: number, h: number, m = LABEL_CLEARANCE): boolean {
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

/** How far the line stays from what it avoids. */
const LINE_CLEARANCE = 6;
/** Curve samples checked against obstacles (the ends sit on the endpoint borders). */
const LINE_TS = Array.from({ length: 23 }, (_, i) => 0.06 + i * 0.04);

function hitsPoint(r: Rect, x: number, y: number): boolean {
  const m = LINE_CLEARANCE;
  return x > r.x - m && x < r.x + r.w + m && y > r.y - m && y < r.y + r.h + m;
}

const sameRect = (a: Rect, b: Rect) => a === b || (a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);

/**
 * A bowed connector from the border of `from` to the border of `to`, arcing
 * to one side (XMind-style). The arrowhead lands at the `to` border.
 *
 * `avoid`: things the line must not cross (other nodes, flow-arrow labels).
 * When the usual gentle bow runs into one, wider bows on either side are
 * tried and the first clear one wins — so a loop back between neighbouring
 * workflow steps arcs over them instead of striking through the label
 * between them. When nothing is clear, the bow crossing the fewest wins
 * (the gentle default on ties). Arrows that were already clear never move.
 */
export function relationshipGeometry(
  from: Rect,
  to: Rect,
  label?: { width: number; obstacles: Iterable<Rect> },
  avoid?: Iterable<Rect>,
): RelationshipPath {
  const fc = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
  const tc = { x: to.x + to.w / 2, y: to.y + to.h / 2 };
  const a0 = borderPoint(from, tc.x, tc.y);
  const b0 = borderPoint(to, fc.x, fc.y);
  const len = Math.hypot(b0.x - a0.x, b0.y - a0.y) || 1;
  // Perpendicular to the chord: the side the line bows toward.
  const nx = -(b0.y - a0.y) / len;
  const ny = (b0.x - a0.x) / len;
  const bow0 = Math.min(len * 0.18, 80);

  // One candidate curve for a signed bow: control point off the chord's
  // midpoint, ends re-aimed at it so a wide arc leaves its node toward the arc.
  const curve = (bow: number) => {
    const mx = (fc.x + tc.x) / 2 + nx * bow;
    const my = (fc.y + tc.y) / 2 + ny * bow;
    const a = bow === bow0 ? a0 : borderPoint(from, mx, my);
    const b = bow === bow0 ? b0 : borderPoint(to, mx, my);
    const cpx = bow === bow0 ? (a.x + b.x) / 2 + nx * bow : mx;
    const cpy = bow === bow0 ? (a.y + b.y) / 2 + ny * bow : my;
    const at = (t: number) => ({
      x: (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * cpx + t * t * b.x,
      y: (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * cpy + t * t * b.y,
    });
    return { a, b, cpx, cpy, at };
  };

  let best = curve(bow0);
  const blockers = avoid ? [...avoid].filter((r) => !sameRect(r, from) && !sameRect(r, to)) : [];
  if (blockers.length) {
    // Line samples that cross something, plus a penalty when the arrow's label
    // would have nowhere roomy to sit along this route (squeezed between rows).
    const lineHitCount = (c: ReturnType<typeof curve>) =>
      LINE_TS.reduce((n, t) => {
        const p = c.at(t);
        return n + (blockers.some((r) => hitsPoint(r, p.x, p.y)) ? 1 : 0);
      }, 0);
    const hitCount = (c: ReturnType<typeof curve>) => {
      const lineHits = lineHitCount(c);
      if (!label) return lineHits;
      const roomy = LABEL_TS.map(c.at).some(
        (p) => !blockers.some((r) => hits(r, p.x, p.y, label.width, REL_LABEL_H, ROUTE_LABEL_CLEARANCE)),
      );
      return lineHits + (roomy ? 0 : 4);
    };
    // Only a blocked LINE triggers rerouting — an arrow whose line is clear stays put.
    let bestHits = lineHitCount(best) > 0 ? hitCount(best) : 0;
    if (bestHits > 0) {
      // A quadratic curve peaks at half its control offset — these clear rows of nodes.
      const mags = [Math.max(bow0 * 2, 60), Math.max(bow0 * 3, 110), Math.max(bow0 * 4.5, 170), 240, 320];
      outer: for (const m of mags) {
        for (const bow of [m, -m]) {
          const c = curve(bow);
          const h = hitCount(c);
          if (h < bestHits) {
            best = c;
            bestHits = h;
            if (h === 0) break outer;
          }
        }
      }
    }
  }

  const { a, b, cpx, cpy, at } = best;
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
