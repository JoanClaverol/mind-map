import type { FolderInfo, MapMeta } from '../model/types';

export const RECENT_LIMIT = 5;

/**
 * One rendered group in the gallery. `key` is stable (used for collapse state);
 * `collapsible` is true only for folder/Uncategorized groups — Pinned and Recent
 * are cross-cutting and always expanded.
 */
export interface GallerySection {
  label: string;
  key: string;
  items: MapMeta[];
  collapsible: boolean;
}

export const UNCATEGORIZED_KEY = 'uncategorized';

/** Stable collapse key for a folder, case-insensitive so it survives re-casing. */
export function folderKey(name: string): string {
  return `folder:${name.toLowerCase()}`;
}

function byUpdatedDesc(a: MapMeta, b: MapMeta): number {
  return b.updatedAt.localeCompare(a.updatedAt);
}

/** Case-insensitive subsequence test: every query char appears in order. */
function isSubsequence(query: string, text: string): boolean {
  let i = 0;
  for (const ch of text) {
    if (ch === query[i]) i++;
    if (i === query.length) return true;
  }
  return query.length === 0;
}

/** Title filter: substring matches rank before looser subsequence matches. */
export function fuzzyFilter(maps: MapMeta[], query: string): MapMeta[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...maps].sort(byUpdatedDesc);
  const substring: MapMeta[] = [];
  const subsequence: MapMeta[] = [];
  for (const m of maps) {
    const title = m.title.toLowerCase();
    if (title.includes(q)) substring.push(m);
    else if (isSubsequence(q, title)) subsequence.push(m);
  }
  substring.sort(byUpdatedDesc);
  subsequence.sort(byUpdatedDesc);
  return [...substring, ...subsequence];
}

/** Name filter for the folder picker: substring hits before subsequence hits. */
export function fuzzyMatchNames(names: string[], query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...names];
  const substring: string[] = [];
  const subsequence: string[] = [];
  for (const n of names) {
    const low = n.toLowerCase();
    if (low.includes(q)) substring.push(n);
    else if (isSubsequence(q, low)) subsequence.push(n);
  }
  return [...substring, ...subsequence];
}

/**
 * Build the ordered, grouped gallery sections — the single source of truth that
 * both rendering and `visibleOrder` consume:
 *   Pinned (title order) → Recent (last opened) → folders (manifest order,
 *   orphans appended by the server) → Uncategorized.
 * Pinned/recent maps are deduped out of their folder so nothing shows twice.
 * Empty folders are kept as zero-item sections (visible & targetable).
 * When there are no folders at all, the catch-all degrades to the classic
 * headerless "All" list so a simple gallery looks unchanged.
 */
export function buildSections(
  maps: MapMeta[],
  lastOpened: Record<string, string>,
  folders: FolderInfo[] = [],
  recentLimit = RECENT_LIMIT,
): GallerySection[] {
  const pinned = maps.filter((m) => m.pinned).sort((a, b) => a.title.localeCompare(b.title));
  // Recent only surfaces loose maps: filing a map into a folder must win over its
  // recently-opened status, otherwise the map would never appear under the folder.
  const recent = maps
    .filter((m) => !m.pinned && !m.folder && lastOpened[m.id])
    .sort((a, b) => lastOpened[b.id].localeCompare(lastOpened[a.id]))
    .slice(0, recentLimit);
  const usedIds = new Set([...pinned, ...recent].map((m) => m.id));

  const sections: GallerySection[] = [];
  if (pinned.length) sections.push({ label: 'Pinned ★', key: 'pinned', items: pinned, collapsible: false });
  if (recent.length) sections.push({ label: 'Recent', key: 'recent', items: recent, collapsible: false });

  // Group the leftover maps by folder.
  const byFolder = new Map<string, MapMeta[]>();
  const uncategorized: MapMeta[] = [];
  for (const m of maps) {
    if (usedIds.has(m.id)) continue;
    if (m.folder) {
      const k = m.folder.toLowerCase();
      const list = byFolder.get(k);
      if (list) list.push(m);
      else byFolder.set(k, [m]);
    } else {
      uncategorized.push(m);
    }
  }

  for (const f of folders) {
    const items = (byFolder.get(f.name.toLowerCase()) ?? []).sort(byUpdatedDesc);
    sections.push({ label: f.name, key: folderKey(f.name), items, collapsible: true });
  }

  if (uncategorized.length) {
    const hasFolders = folders.length > 0;
    // With folders present it's a real bucket ("Uncategorized", collapsible).
    // Without folders, mimic the old gallery: a header only when pinned/recent
    // exist ("All"), otherwise a bare headerless list.
    const label = hasFolders ? 'Uncategorized' : pinned.length || recent.length ? 'All' : '';
    sections.push({
      label,
      key: UNCATEGORIZED_KEY,
      items: uncategorized.sort(byUpdatedDesc),
      collapsible: hasFolders,
    });
  }

  return sections;
}

/** The flat j/k traversal order — single source of truth for selection moves. */
export function visibleOrder(
  maps: MapMeta[],
  query: string,
  lastOpened: Record<string, string>,
  folders: FolderInfo[] = [],
  collapsed: ReadonlySet<string> = new Set(),
): MapMeta[] {
  if (query.trim()) return fuzzyFilter(maps, query);
  return buildSections(maps, lastOpened, folders)
    .filter((s) => !collapsed.has(s.key))
    .flatMap((s) => s.items);
}
