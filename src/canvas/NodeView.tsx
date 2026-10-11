import { memo } from 'react';
import type { NodeDir, Rect } from '../layout/layout';
import { renderNodeContent } from '../model/inline-markdown';
import { NODE_COLORS, type DocNode, type NodeColor } from '../model/types';
import { useStore } from '../state/store';
import { sameDataProps } from './memo';
import { roughBox } from './sketch';

/** Links never navigate in place — plain click keeps node selection, Cmd/Ctrl+click opens a tab. */
function handleLinkClick(e: React.MouseEvent) {
  const anchor = (e.target as HTMLElement).closest('a');
  if (!anchor) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.type === 'click' && (e.metaKey || e.ctrlKey)) {
    window.open(anchor.href, '_blank', 'noopener,noreferrer');
  }
}

interface NodeViewProps {
  node: DocNode;
  rect: Rect;
  /** Direction the branch grows past this node — places the collapse badge. */
  dir: NodeDir;
  selected: boolean;
  isRoot: boolean;
  /** Part of the subtree being dragged. */
  dimmed: boolean;
  /** The source node while an arrow is being drawn from it. */
  linkSource: boolean;
  /** Picked as a member while a group boundary is being drawn. */
  groupMember: boolean;
  onPressStart(e: React.MouseEvent): void;
  onEdit(): void;
  onToggleCollapse(): void;
}

export const NodeView = memo(NodeViewImpl, sameDataProps);

function NodeViewImpl({ node, rect, dir, selected, isRoot, dimmed, linkSource, groupMember, onPressStart, onEdit, onToggleCollapse }: NodeViewProps) {
  const sketch = useStore((s) => s.sketch);
  const rectClass = `node-rect${selected ? ' selected' : ''}${isRoot ? ' root' : ''}${linkSource ? ' link-source' : ''}${groupMember ? ' group-member' : ''}${node.color && NODE_COLORS.includes(node.color as NodeColor) ? ` color-${node.color}` : ''}`;
  const box = sketch ? roughBox(node.id, rect.w, rect.h) : null;
  const badgeText = `+${node.children.length}`;
  const badgeWidth = 14 + 7 * badgeText.length;
  const badgePos =
    dir === 'down'
      ? { x: rect.w / 2 - badgeWidth / 2, y: rect.h + 6 }
      : dir === 'left'
        ? { x: -6 - badgeWidth, y: rect.h / 2 - 9 }
        : { x: rect.w + 6, y: rect.h / 2 - 9 };
  return (
    <g
      className={`node${dimmed ? ' dimmed' : ''}`}
      transform={`translate(${rect.x},${rect.y})`}
      onMouseDown={(e) => {
        e.stopPropagation();
        onPressStart(e);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onEdit();
      }}
    >
      {box ? (
        <>
          {/* Same classes on both paths so palette/selection CSS applies; the
              outline must stay last — `.node-rect.root + foreignObject` keys off it. */}
          <path className={`${rectClass} sketch-fill`} d={box.fill} />
          <path className={`${rectClass} sketch-outline`} d={box.outline} />
        </>
      ) : (
        <rect width={rect.w} height={rect.h} rx={8} className={rectClass} />
      )}
      <foreignObject width={rect.w} height={rect.h}>
        <div
          className="node-text"
          style={{ width: rect.w }}
          onClick={handleLinkClick}
          onAuxClick={handleLinkClick}
          dangerouslySetInnerHTML={{ __html: renderNodeContent(node.text, node.icon) }}
        />
      </foreignObject>
      {node.note && <circle className="note-dot" cx={rect.w - 8} cy={rect.h - 8} r={2.5} />}
      {node.collapsed && node.children.length > 0 && (
        <g
          className="collapse-badge"
          transform={`translate(${badgePos.x},${badgePos.y})`}
          onMouseDown={(e) => {
            e.stopPropagation();
            onToggleCollapse();
          }}
        >
          <rect width={badgeWidth} height={18} rx={9} />
          <text x={badgeWidth / 2} y={13} textAnchor="middle">
            {badgeText}
          </text>
        </g>
      )}
    </g>
  );
}
