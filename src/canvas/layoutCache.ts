import type { LayoutResult } from '../layout/layout';

/**
 * The canvas publishes its latest layout + host element here so navigation
 * and view commands (which live outside React) can use real positions.
 */
let lastLayout: LayoutResult | null = null;
let canvasHost: HTMLElement | null = null;

export function setLastLayout(layout: LayoutResult): void {
  lastLayout = layout;
}

export function getLastLayout(): LayoutResult | null {
  return lastLayout;
}

export function setCanvasHost(el: HTMLElement | null): void {
  canvasHost = el;
}

export function getCanvasHost(): HTMLElement | null {
  return canvasHost;
}
