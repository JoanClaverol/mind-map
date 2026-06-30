import type { Viewport } from '../model/types';
import type { Rect } from '../layout/layout';

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 2.5;

function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/** Zoom by factor, keeping the screen point (cx, cy) fixed. */
export function zoomAt(vp: Viewport, factor: number, cx: number, cy: number): Viewport {
  const zoom = clampZoom(vp.zoom * factor);
  if (zoom === vp.zoom) return vp;
  const k = zoom / vp.zoom;
  return { zoom, x: cx - (cx - vp.x) * k, y: cy - (cy - vp.y) * k };
}

export function fitToContent(bounds: Rect, hostW: number, hostH: number, padding = 60): Viewport {
  const w = Math.max(bounds.w, 1);
  const h = Math.max(bounds.h, 1);
  const zoom = clampZoom(Math.min((hostW - 2 * padding) / w, (hostH - 2 * padding) / h, 1.25));
  return {
    zoom,
    x: (hostW - w * zoom) / 2 - bounds.x * zoom,
    y: (hostH - h * zoom) / 2 - bounds.y * zoom,
  };
}

/** Pan minimally so the (world-space) rect is visible within the host. */
export function revealRect(vp: Viewport, rect: Rect, hostW: number, hostH: number, margin = 40): Viewport {
  const sx = rect.x * vp.zoom + vp.x;
  const sy = rect.y * vp.zoom + vp.y;
  const sx2 = sx + rect.w * vp.zoom;
  const sy2 = sy + rect.h * vp.zoom;
  let dx = 0;
  let dy = 0;
  if (sx2 > hostW - margin) dx = hostW - margin - sx2;
  if (sx < margin) dx = margin - sx; // left edge wins if the node is wider than the view
  if (sy2 > hostH - margin) dy = hostH - margin - sy2;
  if (sy < margin) dy = margin - sy;
  if (dx === 0 && dy === 0) return vp;
  return { ...vp, x: vp.x + dx, y: vp.y + dy };
}
