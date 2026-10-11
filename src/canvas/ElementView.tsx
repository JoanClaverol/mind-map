import { memo } from 'react';
import type { Rect } from '../layout/layout';
import { renderNodeContent } from '../model/inline-markdown';
import { NODE_COLORS, type CanvasElement, type NodeColor } from '../model/types';
import { useStore } from '../state/store';
import { elementTextBox } from './elements';
import { sameDataProps } from './memo';
import { roughBox, roughEllipse } from './sketch';

interface ElementViewProps {
  el: CanvasElement;
  rect: Rect;
  selected: boolean;
  /** Hide the text while the inline editor covers it. */
  editing: boolean;
  onPress(e: React.MouseEvent): void;
  onResizePress(e: React.MouseEvent): void;
  onEdit(): void;
}

/**
 * A freeform canvas element. Shape + text box share the classes the palette
 * CSS keys on (`.element.kind-*.color-*`), in both the clean and sketch looks.
 */
export const ElementView = memo(ElementViewImpl, sameDataProps);

function ElementViewImpl({ el, rect, selected, editing, onPress, onResizePress, onEdit }: ElementViewProps) {
  const sketch = useStore((s) => s.sketch);
  const { w, h } = rect;
  const colorClass = el.color && NODE_COLORS.includes(el.color as NodeColor) ? ` color-${el.color}` : '';
  const text = elementTextBox(el, w, h);

  let shape: React.ReactNode;
  if (sketch && el.kind !== 'text') {
    const rough = el.kind === 'ellipse' ? roughEllipse(el.id, w, h) : roughBox(el.id, w, h);
    shape = (
      <>
        <path className="element-shape sketch-fill" d={rough.fill} />
        <path className="element-shape sketch-outline" d={rough.outline} />
      </>
    );
  } else if (el.kind === 'ellipse') {
    shape = <ellipse className="element-shape" cx={w / 2} cy={h / 2} rx={w / 2} ry={h / 2} />;
  } else {
    shape = <rect className="element-shape" width={w} height={h} rx={el.kind === 'sticky' ? 3 : 10} />;
  }

  return (
    <g
      className={`element kind-${el.kind}${colorClass}${selected ? ' selected' : ''}`}
      transform={`translate(${rect.x},${rect.y})`}
      onMouseDown={(e) => {
        e.stopPropagation();
        onPress(e);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onEdit();
      }}
    >
      {shape}
      {selected && <rect className="element-selection" x={-4} y={-4} width={w + 8} height={h + 8} rx={6} />}
      {!editing && el.text && (
        <foreignObject x={text.x} y={text.y} width={text.w} height={text.h}>
          <div
            className={`element-text kind-${el.kind}`}
            style={{ width: text.w, height: text.h }}
            dangerouslySetInnerHTML={{ __html: renderNodeContent(el.text) }}
          />
        </foreignObject>
      )}
      {selected && (
        <rect
          className="element-resize"
          x={w - 5}
          y={h - 5}
          width={10}
          height={10}
          onMouseDown={(e) => {
            e.stopPropagation();
            onResizePress(e);
          }}
        />
      )}
    </g>
  );
}
