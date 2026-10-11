import { promises as fs } from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { migrateMapFile } from '../src/model/migrate';
import { FOLDERS_SCHEMA_VERSION, normalizeFolderName } from '../src/model/types';
import type { FileNode, FolderInfo, FoldersManifest, MapFile, MapMeta } from '../src/model/types';

const MAPS_DIR = process.env.MAPS_DIR ?? path.resolve(process.cwd(), 'maps');
const FOLDERS_PATH = path.join(MAPS_DIR, 'folders.json');
const ID_RE = /^[A-Za-z0-9_-]{6,30}$/;

export function mapsDir(): string {
  return MAPS_DIR;
}

export function isValidId(id: string): boolean {
  return ID_RE.test(id);
}

function mapPath(id: string): string {
  if (!isValidId(id)) throw new Error(`invalid map id: ${id}`);
  return path.join(MAPS_DIR, `${id}.json`);
}

export async function ensureMapsDir(): Promise<void> {
  await fs.mkdir(MAPS_DIR, { recursive: true });
}

function countNodes(node: FileNode): number {
  return 1 + node.children.reduce((sum, child) => sum + countNodes(child), 0);
}

/** Total nodes across the main tree and all floating trees. */
function countMapNodes(map: MapFile): number {
  return countNodes(map.root) + (map.floating ?? []).reduce((sum, f) => sum + countNodes(f.root), 0);
}

/** List map metadata. Unparseable files are skipped with a warning, never a 500. */
export async function listMaps(): Promise<{ maps: MapMeta[]; warnings: string[] }> {
  await ensureMapsDir();
  const entries = await fs.readdir(MAPS_DIR);
  const maps: MapMeta[] = [];
  const warnings: string[] = [];
  for (const entry of entries) {
    // Dotfiles are in-flight/abandoned atomic-write temps, never maps.
    if (!entry.endsWith('.json') || entry === 'folders.json' || entry.startsWith('.')) continue;
    try {
      const raw = JSON.parse(await fs.readFile(path.join(MAPS_DIR, entry), 'utf8'));
      const map = migrateMapFile(raw);
      maps.push({
        id: map.id,
        title: map.title,
        updatedAt: map.updatedAt,
        nodeCount: countMapNodes(map),
        pinned: map.pinned ?? false,
        folder: map.folder,
      });
    } catch (err) {
      warnings.push(`${entry}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  maps.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { maps, warnings };
}

/** The folder manifest: empty folders + display order. Malformed/missing → []. */
export async function readFolders(): Promise<string[]> {
  try {
    const raw = JSON.parse(await fs.readFile(FOLDERS_PATH, 'utf8')) as unknown;
    const list = (raw as { folders?: unknown }).folders;
    if (!Array.isArray(list)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const entry of list) {
      const name = normalizeFolderName(entry);
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
    return out;
  } catch {
    return [];
  }
}

/** Atomic write of the folder manifest, mirroring writeMap. */
export async function writeFolders(folders: string[]): Promise<void> {
  await ensureMapsDir();
  const manifest: FoldersManifest = { schemaVersion: FOLDERS_SCHEMA_VERSION, folders };
  const tmp = path.join(MAPS_DIR, `.tmp-folders-${nanoid(6)}.json`);
  await fs.writeFile(tmp, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  await fs.rename(tmp, FOLDERS_PATH);
}

/**
 * Folders for the gallery: manifest order first (empty folders included), then
 * any folder a map references but the manifest lacks (self-healing orphans).
 */
export async function listFolders(): Promise<FolderInfo[]> {
  const manifest = await readFolders();
  const { maps } = await listMaps();
  const index = new Map<string, number>(); // lowercase name → position in result
  const result: FolderInfo[] = [];
  for (const name of manifest) {
    index.set(name.toLowerCase(), result.length);
    result.push({ name, mapCount: 0 });
  }
  for (const m of maps) {
    if (!m.folder) continue;
    const key = m.folder.toLowerCase();
    const pos = index.get(key);
    if (pos === undefined) {
      index.set(key, result.length);
      result.push({ name: m.folder, mapCount: 1 });
    } else {
      result[pos].mapCount++;
    }
  }
  return result;
}

/** Set or clear a map's folder, preserving updatedAt (curation, not editing). */
export async function setMapFolder(id: string, folder: string | undefined): Promise<boolean> {
  const r = await updateMap(id, (map) => {
    if (folder) map.folder = folder;
    else delete map.folder;
    return map;
  });
  return r !== null;
}

// Per-map async mutex: MCP clients fire tool calls in parallel, and the browser
// autosaves concurrently — every read-modify-write of one map is serialized here.
const locks = new Map<string, Promise<unknown>>();

export function withMapLock<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(id) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => {});
  locks.set(id, tail);
  void tail.then(() => {
    if (locks.get(id) === tail) locks.delete(id);
  });
  return run;
}

/**
 * Locked read-modify-write. `fn` returns the map to write, or a non-map value
 * (e.g. an error object) to abort without writing. Returns null if not found.
 */
export async function updateMap<R extends MapFile | { error: string }>(
  id: string,
  fn: (map: MapFile) => R | Promise<R>,
): Promise<R | null> {
  return withMapLock(id, async () => {
    const map = await readMap(id);
    if (!map) return null;
    const next = await fn(map);
    if (!('error' in next)) await writeMapUnlocked(next as MapFile);
    return next;
  });
}

export async function readMap(id: string): Promise<MapFile | null> {
  try {
    const raw = JSON.parse(await fs.readFile(mapPath(id), 'utf8'));
    return migrateMapFile(raw);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/** Atomic write (locked): tmp file in the same directory, then rename. */
export function writeMap(map: MapFile): Promise<void> {
  return withMapLock(map.id, () => writeMapUnlocked(map));
}

async function writeMapUnlocked(map: MapFile): Promise<void> {
  await ensureMapsDir();
  const target = mapPath(map.id);
  // Unique tmp name: concurrent writers must never share (and steal) one temp file.
  const tmp = path.join(MAPS_DIR, `.tmp-${map.id}-${nanoid(6)}.json`);
  await fs.writeFile(tmp, JSON.stringify(map, null, 2) + '\n', 'utf8');
  await fs.rename(tmp, target);
}

export async function deleteMap(id: string): Promise<boolean> {
  try {
    await fs.unlink(mapPath(id));
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}
