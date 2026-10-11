import type { Rect } from '../layout/layout';
import { measureElementText, measureElementTextWidth } from '../layout/measure';
import type { CanvasElement, Doc, ElementSide } from '../model/types';

/** Gap between an anchored element and its node. */
export const ELEMENT_GAP = 28;
/** Gap between elements stacked on the same side of one node. */
const STACK_GAP = 14;
/** Collision avoidance: step outward this far, at most this many times. */
const PUSH_STEP = 24;
const MAX_PUSHES = 40;
const CLEARANCE = 8;

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.w + CLEARANCE && a.x + a.w + CLEARANCE > b.x && a.y < b.y + b.h + CLEARANCE && a.y + a.h + CLEARANCE > b.y
  );
}

const OUTWARD: Record<ElementSide, { dx: number; dy: number }> = {
  right: { dx: 1, dy: 0 },
  left: { dx: -1, dy: 0 },
  above: { dx: 0, dy: -1 },
  below: { dx: 0, dy: 1 },
};
/** Text inset inside an ellipse: the largest centered box that stays inside it is ~71% (1/√2). */
const ELLIPSE_TEXT_RATIO = 0.72;

/** Where the element's top-left sits beside its anchor node, before the x/y nudge. */
function besideNode(node: Rect, side: ElementSide, w: number, h: number, gap: number): { x: number; y: number } {
  switch (side) {
    case 'right':
      return { x: node.x + node.w + gap, y: node.y + node.h / 2 - h / 2 };
    case 'left':
      return { x: node.x - gap - w, y: node.y + node.h / 2 - h / 2 };
    case 'above':
      return { x: node.x + node.w / 2 - w / 2, y: node.y - gap - h };
    case 'below':
      return { x: node.x + node.w / 2 - w / 2, y: node.y + node.h + gap };
  }
}

/** Drawings annotate what they touch (an underline, a circle): hug the node. */
const DRAW_GAP = 2;

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
  // Several elements on one side of one node stack (in list order) instead of
  // piling up: left/right/below grow downward, above grows upward.
  const stackOffset = new Map<string, number>();
  const nodes = [...nodeRects.values()];
  const placed: Rect[] = [];
  for (const el of doc.elements) {
    const h = elementHeight(el);
    if (el.anchor) {
      const node = nodeRects.get(el.anchor.nodeId);
      if (!node) continue;
      if (el.kind === 'draw') {
        // Drawings neither stack nor get pushed away — touching the node is the point.
        const at = besideNode(node, el.anchor.side, el.w, h, DRAW_GAP);
        out.set(el.id, { x: at.x + el.x, y: at.y + el.y, w: el.w, h });
        continue;
      }
      const key = `${el.anchor.nodeId}|${el.anchor.side}`;
      const offset = stackOffset.get(key) ?? 0;
      stackOffset.set(key, offset + h + STACK_GAP);
      const at = besideNode(node, el.anchor.side, el.w, h, ELEMENT_GAP);
      const base: Rect = { x: at.x, y: at.y + (el.anchor.side === 'above' ? -offset : offset), w: el.w, h };
      // "Beside" must not mean "on top of": step outward until clear of every node
      // and earlier element (e.g. past the children of a node anchored on its right).
      const dir = OUTWARD[el.anchor.side];
      for (let i = 0; i < MAX_PUSHES && (nodes.some((r) => overlaps(base, r)) || placed.some((r) => overlaps(base, r))); i++) {
        base.x += dir.dx * PUSH_STEP;
        base.y += dir.dy * PUSH_STEP;
      }
      // A text element's box is often far wider than its words (left-aligned):
      // only the inked part should push later elements away.
      placed.push(el.kind === 'text' && el.text ? { ...base, w: measureElementTextWidth(el.text, el.kind, el.w) } : base);
      // The user's/AI's nudge applies after avoidance — a deliberate placement wins.
      out.set(el.id, { x: base.x + el.x, y: base.y + el.y, w: el.w, h });
    } else if (!hoisted) {
      out.set(el.id, { x: el.x, y: el.y, w: el.w, h });
    }
  }
  return out;
}
