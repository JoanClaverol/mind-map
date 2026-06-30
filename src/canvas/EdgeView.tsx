import { LIST_INDENT, type NodeDir, type Rect } from '../layout/layout';

/** dir is the child's entering direction — it picks the anchor sides. */
export function EdgeView({ from, to, dir }: { from: Rect; to: Rect; dir: NodeDir }) {
  if (dir === 'list') {
    // Outline elbow: rail down from the parent at half-indent, rounded turn
    // into the child's left edge. Runs always exceed the radius (gapY ≥ 14).
    const sx = from.x + LIST_INDENT / 2;
    const sy = from.y + from.h;
    const tx = to.x;
    const ty = to.y + to.h / 2;
    const r = 6;
    return (
      <path className="edge" d={`M ${sx},${sy} L ${sx},${ty - r} Q ${sx},${ty} ${sx + r},${ty} L ${tx},${ty}`} />
    );
  }
  if (dir === 'down') {
    const sx = from.x + from.w / 2;
    const sy = from.y + from.h;
    const tx = to.x + to.w / 2;
    const ty = to.y;
    const my = sy + (ty - sy) / 2;
    return <path className="edge" d={`M ${sx},${sy} C ${sx},${my} ${tx},${my} ${tx},${ty}`} />;
  }
  const sx = dir === 'left' ? from.x : from.x + from.w;
  const sy = from.y + from.h / 2;
  const tx = dir === 'left' ? to.x + to.w : to.x;
  const ty = to.y + to.h / 2;
  const mx = sx + (tx - sx) / 2;
  return <path className="edge" d={`M ${sx},${sy} C ${mx},${sy} ${mx},${ty} ${tx},${ty}`} />;
}
