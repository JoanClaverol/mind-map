import rough from 'roughjs';
import { clearMeasureCache } from '../layout/measure';

/**
 * Sketch theme (Excalidraw-style): hand-drawn strokes via roughjs plus a
 * handwritten font. A per-viewer preference (localStorage), not map data —
 * the same map can be read clean or sketchy.
 *
 * Shapes are seeded from a stable key (node id, path data), so each one keeps
 * its wobble across re-renders instead of jittering on every frame.
 */
const STORAGE_KEY = 'theme';
export const SKETCH_FONT = 'Kalam';

const gen = rough.generator();
const cache = new Map<string, string[]>();
const CACHE_CAP = 5000;

function seedOf(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return (h >>> 0) % 2147483646 + 1;
}

function memo(key: string, make: () => string[]): string[] {
  const hit = cache.get(key);
  if (hit) return hit;
  if (cache.size > CACHE_CAP) cache.clear();
  const value = make();
  cache.set(key, value);
  return value;
}

function roundedRectPath(w: number, h: number, r: number): string {
  return `M ${r},0 H ${w - r} Q ${w},0 ${w},${r} V ${h - r} Q ${w},${h} ${w - r},${h} H ${r} Q 0,${h} 0,${h - r} V ${r} Q 0,0 ${r},0 Z`;
}

/** A node box: [fill outline-shaped area, sketchy double-stroke border]. */
export function roughBox(seedKey: string, w: number, h: number): { fill: string; outline: string } {
  const [fill, outline] = memo(`box|${seedKey}|${w}|${h}`, () =>
    gen
      .toPaths(
        gen.path(roundedRectPath(w, h, 8), {
          seed: seedOf(seedKey),
          roughness: 1.1,
          bowing: 1,
          fill: '#000',
          fillStyle: 'solid',
          stroke: '#000',
        }),
      )
      .map((p) => p.d),
  );
  return { fill, outline };
}

/** Any stroke path (edges, arrows, group hulls), seeded by its own geometry. */
export function roughStroke(d: string, roughness = 0.9): string {
  return memo(`path|${roughness}|${d}`, () =>
    gen
      .toPaths(gen.path(d, { seed: seedOf(d), roughness, bowing: 1.2, stroke: '#000' }))
      .map((p) => p.d),
  ).join(' ');
}

export function loadSketchPref(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'sketch';
  } catch {
    return false;
  }
}

export function saveSketchPref(on: boolean): void {
  try {
    if (on) localStorage.setItem(STORAGE_KEY, 'sketch');
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // private mode — the toggle still works for this session
  }
}

/**
 * Switch the document theme. Node sizes depend on the font, so measurements
 * are dropped now and again once the handwritten font has actually loaded
 * (until then the fallback font is what's on screen). `remeasured` tells the
 * caller to re-run layout.
 */
export function applySketchTheme(on: boolean, remeasured: () => void): void {
  document.documentElement.dataset.theme = on ? 'sketch' : '';
  if (!on) delete document.documentElement.dataset.theme;
  clearMeasureCache();
  remeasured();
  if (on) {
    void Promise.all([document.fonts.load(`14px ${SKETCH_FONT}`), document.fonts.load(`bold 14px ${SKETCH_FONT}`)])
      .then(() => {
        clearMeasureCache();
        remeasured();
      })
      .catch(() => {});
  }
}
