import type { NodeDir, Rect } from '../layout/layout';
import { renderInlineMarkdown } from '../model/inline-markdown';
import type { DocNode } from '../model/types';

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
  todoPending: boolean;
  /** Part of the subtree being dragged. */
  dimmed: boolean;
  /** The source node while an arrow is being drawn from it. */
  linkSource: boolean;
  onPressStart(e: React.MouseEvent): void;
  onEdit(): void;
  onToggleCollapse(): void;
}

export function NodeView({ node, rect, dir, selected, isRoot, todoPending, dimmed, linkSource, onPressStart, onEdit, onToggleCollapse }: NodeViewProps) {
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
      <rect
        width={rect.w}
        height={rect.h}
        rx={8}
        className={`node-rect${selected ? ' selected' : ''}${isRoot ? ' root' : ''}${todoPending ? ' pending' : ''}${linkSource ? ' link-source' : ''}`}
      />
      <foreignObject width={rect.w} height={rect.h}>
        <div
          className="node-text"
          style={{ width: rect.w }}
          onClick={handleLinkClick}
          onAuxClick={handleLinkClick}
          dangerouslySetInnerHTML={{ __html: renderInlineMarkdown(node.text) }}
        />
      </foreignObject>
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
      {node.todoId && (
        <g className="sent-badge" transform={`translate(${rect.w - 8},-6)`}>
          <circle r={8} />
          <text y={3.5} textAnchor="middle">
            ✓
          </text>
        </g>
      )}
    </g>
  );
}
