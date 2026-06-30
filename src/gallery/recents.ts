/**
 * Last-opened timestamps live in localStorage, not in the map files: writing
 * them to disk would dirty the git-diffable JSONs on every open.
 */
const STORAGE_KEY = 'mindmap.lastOpened';

export function getLastOpened(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [id, iso] of Object.entries(parsed)) {
      if (typeof iso === 'string') out[id] = iso;
    }
    return out;
  } catch {
    return {};
  }
}

function write(entries: Record<string, string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // quota/private mode — recents just won't persist
  }
}

export function markOpened(id: string): void {
  write({ ...getLastOpened(), [id]: new Date().toISOString() });
}

/**
 * Collapsed gallery section keys (folders + Uncategorized) live in localStorage
 * too — like recents, this is per-device UI state, not part of the map files.
 */
const COLLAPSED_KEY = 'mindmap.collapsedFolders';

export function getCollapsedFolders(): string[] {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    return [];
  }
}

export function setCollapsedFolders(keys: string[]): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(keys));
  } catch {
    // quota/private mode — collapse state just won't persist
  }
}

/** Drop entries for maps that no longer exist. */
export function pruneOpened(validIds: string[]): void {
  const entries = getLastOpened();
  const valid = new Set(validIds);
  const kept = Object.fromEntries(Object.entries(entries).filter(([id]) => valid.has(id)));
  if (Object.keys(kept).length !== Object.keys(entries).length) write(kept);
}
