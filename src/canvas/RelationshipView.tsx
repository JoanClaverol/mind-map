import { memo } from 'react';
import type { Rect } from '../layout/layout';
import type { Relationship } from '../model/types';
import { useStore } from '../state/store';
import { sameDataProps } from './memo';
import { REL_LABEL_H, relationshipGeometry, relLabelWidth } from './relationshipPath';
import { roughStroke } from './sketch';

interface RelationshipViewProps {
  rel: Relationship;
  from: Rect;
  to: Rect;
  selected: boolean;
  /**
   * Arrows render in two passes: the line UNDER the nodes (node fills hide
   * it where it crosses them, instead of striking through their text) and
   * the label chip ON TOP, slid along the curve to a spot clear of `obstacles`.
   */
  part: 'line' | 'label';
  /** Node, element and flow-label rects the arrow and its label avoid (stable identity per layout). */
  obstacles: Rect[];
  onSelect(e: React.MouseEvent): void;
  onEdit(): void;
}

export const RelationshipView = memo(RelationshipViewImpl, sameDataProps);

function RelationshipViewImpl({ rel, from, to, selected, part, obstacles, onSelect, onEdit }: RelationshipViewProps) {
  const sketch = useStore((s) => s.sketch);
  const labelWidth = rel.label ? relLabelWidth(rel.label) : 0;
  // Both passes route the same way (the line steers around `obstacles` too),
  // so the label always sits on the drawn curve.
  const { d, mid } = relationshipGeometry(
    from,
    to,
    rel.label ? { width: labelWidth, obstacles } : undefined,
    obstacles,
  );
  const markerEnd = `url(#${selected ? 'rel-arrow-selected' : 'rel-arrow'})`;
  const press = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(e);
  };
  const dbl = (e: React.MouseEvent) => {
    e.stopPropagation();
    onEdit();
  };
  if (part === 'line') {
    return (
      <g>
        {/* Fat invisible path so the thin arrow is easy to click. */}
        <path className="rel-hit" d={d} onMouseDown={press} onDoubleClick={dbl} />
        <path
          className={`relationship${selected ? ' selected' : ''}`}
          d={sketch ? roughStroke(d, 0.7) : d}
          markerEnd={markerEnd}
        />
      </g>
    );
  }
  if (!rel.label) return null;
  return (
    <g
      className={`rel-label${selected ? ' selected' : ''}`}
      transform={`translate(${mid.x - labelWidth / 2},${mid.y - REL_LABEL_H / 2})`}
      onMouseDown={press}
      onDoubleClick={dbl}
    >
      <rect width={labelWidth} height={REL_LABEL_H} rx={5} />
      <text x={labelWidth / 2} y={13} textAnchor="middle">
        {rel.label}
      </text>
    </g>
  );
}
