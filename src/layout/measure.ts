import { renderInlineMarkdown } from '../model/inline-markdown';
import type { Size } from './layout';

export const MAX_NODE_WIDTH = 280;
export const MIN_NODE_WIDTH = 48;

let measurer: HTMLDivElement | null = null;
const cache = new Map<string, Size>();
const rawCache = new Map<string, Size>();

function getMeasurer(): HTMLDivElement {
  if (!measurer) {
    measurer = document.createElement('div');
    measurer.className = 'node-text';
    Object.assign(measurer.style, {
      position: 'absolute',
      visibility: 'hidden',
      left: '-9999px',
      top: '0',
      width: 'max-content',
      maxWidth: `${MAX_NODE_WIDTH}px`,
    });
    document.body.appendChild(measurer);
  }
  return measurer;
}

function clamp(rect: DOMRect): Size {
  return {
    w: Math.min(MAX_NODE_WIDTH, Math.max(MIN_NODE_WIDTH, Math.ceil(rect.width) + 2)),
    h: Math.max(24, Math.ceil(rect.height)),
  };
}

/**
 * Measures node text with the exact CSS used inside the foreignObject,
 * so layout sizes and rendered sizes can never drift: the measurer renders
 * the same inline-markdown HTML as NodeView. Cached by raw text.
 */
export function measureText(text: string): Size {
  const hit = cache.get(text);
  if (hit) return hit;
  const el = getMeasurer();
  el.innerHTML = renderInlineMarkdown(text || ' ');
  const size = clamp(el.getBoundingClientRect());
  cache.set(text, size);
  return size;
}

/** Measures the raw (unrendered) source — sizes the editor textarea, where markers are visible. */
export function measureRawText(text: string): Size {
  const hit = rawCache.get(text);
  if (hit) return hit;
  const el = getMeasurer();
  el.textContent = text || ' ';
  const size = clamp(el.getBoundingClientRect());
  rawCache.set(text, size);
  return size;
}
