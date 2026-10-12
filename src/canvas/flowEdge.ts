import { edgeLabelWidth, type Rect } from '../layout/layout';

/** Where a flow connector turns from the parent's exit toward the child row. */
const FLOW_TURN = 16;
const FLOW_RADIUS = 6;
export const FLOW_LABEL_H = 18;

/**
 * A workflow connector (flow layout): out of the parent's right side, a short
 * run, one rounded elbow, then a long straight run into the child — the edge
 * label sits centered on that run. Shared by EdgeView (drawing) and the
 * canvas (label rects that relationship arrows route around).
 */
export function flowEdgeGeometry(from: Rect, to: Rect, label?: string): { d: string; labelRect: Rect | null } {
  const sx = from.x + from.w;
  const sy = from.y + from.h / 2;
  const tx = to.x - 1; // arrow tip just touches the border
  const ty = to.y + to.h / 2;
  const kx = sx + FLOW_TURN;
  const dy = ty - sy;
  const r = Math.min(FLOW_RADIUS, Math.abs(dy) / 2);
  const s = Math.sign(dy);
  const d =
    Math.abs(dy) < 0.5
      ? `M ${sx},${sy} L ${tx},${ty}`
      : `M ${sx},${sy} L ${kx - r},${sy} Q ${kx},${sy} ${kx},${sy + s * r} L ${kx},${ty - s * r} Q ${kx},${ty} ${kx + r},${ty} L ${tx},${ty}`;
  if (!label) return { d, labelRect: null };
  const w = edgeLabelWidth(label);
  return { d, labelRect: { x: (kx + tx) / 2 - w / 2, y: ty - FLOW_LABEL_H / 2, w, h: FLOW_LABEL_H } };
}
