import { promises as fs } from 'node:fs';
import path from 'node:path';
import { migrateMapFile } from '../src/model/migrate';
import { SCHEMA_VERSION, normalizeFolderName } from '../src/model/types';
import type { FileNode, FolderInfo, FoldersManifest, MapFile, MapMeta } from '../src/model/types';

const MAPS_DIR = process.env.MAPS_DIR ?? path.resolve(process.cwd(), 'maps');
const FOLDERS_PATH = path.join(MAPS_DIR, 'folders.json');
const ID_RE = /^[A-Za-z0-9_-]{6,30}$/;

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

/** List map metadata. Unparseable files are skipped with a warning, never a 500. */
export async function listMaps(): Promise<{ maps: MapMeta[]; warnings: string[] }> {
  await ensureMapsDir();
  const entries = await fs.readdir(MAPS_DIR);
  const maps: MapMeta[] = [];
  const warnings: string[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json') || entry === 'folders.json') continue;
    try {
      const raw = JSON.parse(await fs.readFile(path.join(MAPS_DIR, entry), 'utf8'));
      const map = migrateMapFile(raw);
      maps.push({
        id: map.id,
        title: map.title,
        updatedAt: map.updatedAt,
        nodeCount: countNodes(map.root),
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
  const manifest: FoldersManifest = { schemaVersion: SCHEMA_VERSION, folders };
  const tmp = path.join(MAPS_DIR, '.tmp-folders.json');
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
  const map = await readMap(id);
  if (!map) return false;
  if (folder) map.folder = folder;
  else delete map.folder;
  await writeMap(map);
  return true;
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

/** Atomic write: tmp file in the same directory, then rename. */
export async function writeMap(map: MapFile): Promise<void> {
  await ensureMapsDir();
  const target = mapPath(map.id);
  const tmp = path.join(MAPS_DIR, `.tmp-${map.id}.json`);
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
