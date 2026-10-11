import type { Rect } from '../layout/layout';
import { NODE_COLORS, type NodeColor } from '../model/types';
import { useStore } from '../state/store';
import { groupHull } from './groupHull';
import { roughStroke } from './sketch';

interface GroupViewProps {
  /** Rects of the members visible in the current layout. */
  rects: Rect[];
  label?: string;
  color?: string;
  selected?: boolean;
  /** Live preview while picking members — non-interactive. */
  pending?: boolean;
  onSelect?(e: React.MouseEvent): void;
  onEdit?(): void;
}

/**
 * A group boundary: a dashed rounded hull hugging the member nodes, with the
 * label chip sitting on the topmost point. Members hidden by collapse/hoist
 * simply drop out of the hull (the caller filters rects).
 */
export function GroupView({ rects, label, color, selected, pending, onSelect, onEdit }: GroupViewProps) {
  const sketch = useStore((s) => s.sketch);
  const hull = groupHull(rects);
  if (!hull) return null;
  const colorClass = color && NODE_COLORS.includes(color as NodeColor) ? ` color-${color}` : '';
  const stateClass = `${selected ? ' selected' : ''}${pending ? ' pending' : ''}`;
  const labelWidth = label ? 14 + 7 * label.length : 0;
  const press = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect?.(e);
  };
  const dbl = (e: React.MouseEvent) => {
    e.stopPropagation();
    onEdit?.();
  };
  return (
    <g className={`group${stateClass}`}>
      <path
        className={`group-hull${colorClass}${stateClass}`}
        d={sketch ? roughStroke(hull.d, 0.6) : hull.d}
        onMouseDown={pending ? undefined : press}
        onDoubleClick={pending ? undefined : dbl}
      />
      {label && (
        <g
          className={`group-label${stateClass}`}
          transform={`translate(${hull.anchor.x - labelWidth / 2},${hull.anchor.y - 9})`}
          onMouseDown={press}
          onDoubleClick={dbl}
        >
          <rect width={labelWidth} height={18} rx={5} />
          <text x={labelWidth / 2} y={13} textAnchor="middle">
            {label}
          </text>
        </g>
      )}
    </g>
  );
}
