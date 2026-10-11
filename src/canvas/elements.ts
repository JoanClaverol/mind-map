import type { Rect } from '../layout/layout';
import { measureElementText } from '../layout/measure';
import type { CanvasElement, Doc, ElementSide } from '../model/types';

/** Gap between an anchored element and its node. */
export const ELEMENT_GAP = 28;
/** Text inset inside an ellipse: the largest centered box that stays inside it is ~71% (1/√2). */
const ELLIPSE_TEXT_RATIO = 0.72;

/** Where the element's top-left sits beside its anchor node, before the x/y nudge. */
function besideNode(node: Rect, side: ElementSide, w: number, h: number): { x: number; y: number } {
  switch (side) {
    case 'right':
      return { x: node.x + node.w + ELEMENT_GAP, y: node.y + node.h / 2 - h / 2 };
    case 'left':
      return { x: node.x - ELEMENT_GAP - w, y: node.y + node.h / 2 - h / 2 };
    case 'above':
      return { x: node.x + node.w / 2 - w / 2, y: node.y - ELEMENT_GAP - h };
    case 'below':
      return { x: node.x + node.w / 2 - w / 2, y: node.y + node.h + ELEMENT_GAP };
  }
}

/** Rendered height: the stored minimum, grown so the text always fits. */
export function elementHeight(el: CanvasElement): number {
  if (!el.text) return el.h;
  if (el.kind === 'ellipse') {
    const textH = measureElementText(el.text, el.kind, Math.round(el.w * ELLIPSE_TEXT_RATIO));
    return Math.max(el.h, Math.ceil(textH / ELLIPSE_TEXT_RATIO));
  }
  return Math.max(el.h, measureElementText(el.text, el.kind, el.w));
}

/** The text box inside an element of the given rendered size (ellipses inset it). */
export function elementTextBox(el: CanvasElement, w: number, h: number): Rect {
  if (el.kind !== 'ellipse') return { x: 0, y: 0, w, h };
  const tw = Math.round(w * ELLIPSE_TEXT_RATIO);
  const th = Math.round(h * ELLIPSE_TEXT_RATIO);
  return { x: (w - tw) / 2, y: (h - th) / 2, w: tw, h: th };
}

/**
 * World rects for every visible element. Anchored elements follow their
 * node's laid-out rect and disappear with it (collapsed or hoisted away);
 * free elements are hidden while hoisted, like floating trees.
 */
export function layoutElements(doc: Doc, nodeRects: Map<string, Rect>, hoisted: boolean): Map<string, Rect> {
  const out = new Map<string, Rect>();
  for (const el of doc.elements) {
    const h = elementHeight(el);
    if (el.anchor) {
      const node = nodeRects.get(el.anchor.nodeId);
      if (!node) continue;
      const at = besideNode(node, el.anchor.side, el.w, h);
      out.set(el.id, { x: at.x + el.x, y: at.y + el.y, w: el.w, h });
    } else if (!hoisted) {
      out.set(el.id, { x: el.x, y: el.y, w: el.w, h });
    }
  }
  return out;
}
