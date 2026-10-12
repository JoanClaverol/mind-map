import { memo } from 'react';
import { LIST_INDENT, edgeLabelWidth, type NodeDir, type Rect } from '../layout/layout';
import { useStore } from '../state/store';
import { roughStroke } from './sketch';

function Edge({ d, arrow }: { d: string; arrow?: boolean }) {
  const sketch = useStore((s) => s.sketch);
  return (
    <path
      className={arrow ? 'edge flow' : 'edge'}
      d={sketch ? roughStroke(d) : d}
      markerEnd={arrow ? 'url(#flow-arrow)' : undefined}
    />
  );
}

/** Where a flow connector turns from the parent's exit toward the child row. */
const FLOW_TURN = 16;
const FLOW_RADIUS = 6;
const LABEL_H = 18;

/** Re-renders only when its endpoints move (layout), not on pan/selection. */
export const EdgeView = memo(EdgeViewImpl);

/** dir is the child's entering direction — it picks the anchor sides. */
function EdgeViewImpl({
  from,
  to,
  dir,
  flow,
  label,
}: {
  from: Rect;
  to: Rect;
  dir: NodeDir;
  /** Workflow connector: a straight elbow ending in an arrowhead, carrying `label`. */
  flow?: boolean;
  label?: string;
}) {
  if (flow && dir === 'right') {
    // Out of the parent's right side, a short run, one rounded elbow, then a
    // long straight run into the child — the label sits on that run.
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
    if (!label) return <Edge d={d} arrow />;
    const w = edgeLabelWidth(label);
    const cx = (kx + tx) / 2;
    return (
      <g>
        <Edge d={d} arrow />
        <g className="flow-label" transform={`translate(${cx - w / 2},${ty - LABEL_H / 2})`}>
          <rect width={w} height={LABEL_H} rx={9} />
          <text x={w / 2} y={12.5} textAnchor="middle">
            {label}
          </text>
        </g>
      </g>
    );
  }
  if (dir === 'list') {
    // Outline elbow: rail down from the parent at half-indent, rounded turn
    // into the child's left edge. Runs always exceed the radius (gapY ≥ 14).
    const sx = from.x + LIST_INDENT / 2;
    const sy = from.y + from.h;
    const tx = to.x;
    const ty = to.y + to.h / 2;
    const r = 6;
    return <Edge d={`M ${sx},${sy} L ${sx},${ty - r} Q ${sx},${ty} ${sx + r},${ty} L ${tx},${ty}`} />;
  }
  if (dir === 'down') {
    const sx = from.x + from.w / 2;
    const sy = from.y + from.h;
    const tx = to.x + to.w / 2;
    const ty = to.y;
    const my = sy + (ty - sy) / 2;
    return <Edge d={`M ${sx},${sy} C ${sx},${my} ${tx},${my} ${tx},${ty}`} />;
  }
  const sx = dir === 'left' ? from.x : from.x + from.w;
  const sy = from.y + from.h / 2;
  const tx = dir === 'left' ? to.x + to.w : to.x;
  const ty = to.y + to.h / 2;
  const mx = sx + (tx - sx) / 2;
  return <Edge d={`M ${sx},${sy} C ${mx},${sy} ${mx},${ty} ${tx},${ty}`} />;
}
