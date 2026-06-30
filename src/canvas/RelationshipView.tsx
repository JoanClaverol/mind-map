import type { Rect } from '../layout/layout';
import type { Relationship } from '../model/types';
import { relationshipGeometry } from './relationshipPath';

interface RelationshipViewProps {
  rel: Relationship;
  from: Rect;
  to: Rect;
  selected: boolean;
  onSelect(e: React.MouseEvent): void;
  onEdit(): void;
}

export function RelationshipView({ rel, from, to, selected, onSelect, onEdit }: RelationshipViewProps) {
  const { d, mid } = relationshipGeometry(from, to);
  const markerEnd = `url(#${selected ? 'rel-arrow-selected' : 'rel-arrow'})`;
  const labelWidth = rel.label ? 14 + 7 * rel.label.length : 0;
  const press = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect(e);
  };
  const dbl = (e: React.MouseEvent) => {
    e.stopPropagation();
    onEdit();
  };
  return (
    <g>
      {/* Fat invisible path so the thin arrow is easy to click. */}
      <path className="rel-hit" d={d} onMouseDown={press} onDoubleClick={dbl} />
      <path className={`relationship${selected ? ' selected' : ''}`} d={d} markerEnd={markerEnd} />
      {rel.label && (
        <g
          className={`rel-label${selected ? ' selected' : ''}`}
          transform={`translate(${mid.x - labelWidth / 2},${mid.y - 9})`}
          onMouseDown={press}
          onDoubleClick={dbl}
        >
          <rect width={labelWidth} height={18} rx={5} />
          <text x={labelWidth / 2} y={13} textAnchor="middle">
            {rel.label}
          </text>
        </g>
      )}
    </g>
  );
}
