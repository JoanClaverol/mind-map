import type { LayoutResult, Rect } from '../layout/layout';

/**
 * The canvas publishes its latest layout + host element here so navigation
 * and view commands (which live outside React) can use real positions.
 */
let lastLayout: LayoutResult | null = null;
let canvasHost: HTMLElement | null = null;
let lastElementRects: Map<string, Rect> = new Map();

export function setLastLayout(layout: LayoutResult): void {
  lastLayout = layout;
}

export function getLastLayout(): LayoutResult | null {
  return lastLayout;
}

export function setLastElementRects(rects: Map<string, Rect>): void {
  lastElementRects = rects;
}

/** Layout bounds grown to include the visible canvas elements (fit, export). */
export function contentBounds(): Rect | null {
  if (!lastLayout) return null;
  let { x, y, w, h } = lastLayout.bounds;
  let x2 = x + w;
  let y2 = y + h;
  for (const r of lastElementRects.values()) {
    x = Math.min(x, r.x);
    y = Math.min(y, r.y);
    x2 = Math.max(x2, r.x + r.w);
    y2 = Math.max(y2, r.y + r.h);
  }
  return { x, y, w: x2 - x, h: y2 - y };
}

export function setCanvasHost(el: HTMLElement | null): void {
  canvasHost = el;
}

export function getCanvasHost(): HTMLElement | null {
  return canvasHost;
}
