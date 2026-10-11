import type { Viewport } from '../model/types';

/**
 * Where each map was last panned/zoomed lives in localStorage, like recents —
 * not in the map file. Panning used to mark the doc dirty and PUT the whole
 * map on every gesture, churning git-diffable files (and committed
 * mindmaps/ folders) with view state. A file's own `viewport` is still read
 * as a fallback for maps this browser hasn't opened.
 */
const STORAGE_KEY = 'mindmap.viewports';
const MAX_ENTRIES = 200;
const SAVE_DEBOUNCE_MS = 400;

type Entry = Viewport & { at: number };

function readAll(): Record<string, Entry> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, Entry>)
      : {};
  } catch {
    return {};
  }
}

export function loadViewport(mapId: string): Viewport | null {
  const v = readAll()[mapId];
  if (!v || ![v.x, v.y, v.zoom].every(Number.isFinite) || v.zoom <= 0) return null;
  return { x: v.x, y: v.y, zoom: v.zoom };
}

let timer: ReturnType<typeof setTimeout> | null = null;
let pending: { mapId: string; viewport: Viewport } | null = null;

function flush(): void {
  timer = null;
  if (!pending) return;
  const { mapId, viewport } = pending;
  pending = null;
  try {
    const all = readAll();
    all[mapId] = { ...viewport, at: Date.now() };
    const ids = Object.keys(all);
    if (ids.length > MAX_ENTRIES) {
      ids.sort((a, b) => all[a].at - all[b].at);
      for (const id of ids.slice(0, ids.length - MAX_ENTRIES)) delete all[id];
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // quota/private mode — the view just won't be remembered
  }
}

export function saveViewport(mapId: string, viewport: Viewport): void {
  if (pending && pending.mapId !== mapId) flush(); // switching maps — keep the old one's view
  pending = { mapId, viewport };
  if (timer) clearTimeout(timer);
  timer = setTimeout(flush, SAVE_DEBOUNCE_MS);
}
