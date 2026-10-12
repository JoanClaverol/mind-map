import { promises as fs } from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { publish } from './events';

/**
 * Image export for MCP clients. The server has no layout engine or renderer —
 * the browser tab does (src/canvas/exportImage.ts) — so export_map is a round
 * trip: publish an `export-request` over SSE, the tab renders and POSTs the
 * image back to /api/exports/:requestId, and the waiting tool call resolves.
 * The first tab to answer wins.
 */
export type ExportFormat = 'png' | 'svg';
export type ExportResult = { format: ExportFormat; data: string }; // png: base64, svg: markup

const TIMEOUT_MS = 15_000;
const pending = new Map<string, (r: ExportResult) => void>();

export function requestExport(mapId: string, format: ExportFormat): Promise<ExportResult> {
  const requestId = nanoid(12);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error('no browser tab answered — open the app in a browser (pnpm dev, or `mindmap omp`) and retry'));
    }, TIMEOUT_MS);
    pending.set(requestId, (r) => {
      clearTimeout(timer);
      pending.delete(requestId);
      resolve(r);
    });
    publish({ kind: 'export-request', requestId, mapId, format });
  });
}

/** Called by the route; false when nobody is waiting (late or duplicate answer). */
export function fulfillExport(requestId: string, result: ExportResult): boolean {
  const done = pending.get(requestId);
  if (!done) return false;
  done(result);
  return true;
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The image bytes of an answer, or null when it isn't a PNG / an SVG document. */
export function exportBytes(result: ExportResult): Buffer | null {
  if (result.format === 'png') {
    const buf = Buffer.from(result.data, 'base64');
    return buf.subarray(0, 8).equals(PNG_MAGIC) ? buf : null;
  }
  return /^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/.test(result.data) ? Buffer.from(result.data, 'utf8') : null;
}

/**
 * Saves next to the maps: <maps dir>/exports/<name>.<ext>. Returns the absolute path.
 *
 * Map folders live inside other people's repos, so exports/ (or a file in it)
 * may be a planted symlink aiming at ~/.zshrc. Refuse a symlinked directory,
 * and write a temp file then rename — rename replaces a link, never follows it.
 */
export async function saveExport(mapsDir: string, baseName: string, result: ExportResult): Promise<string> {
  const bytes = exportBytes(result);
  if (!bytes) throw new Error(`the tab answered with something that isn't a ${result.format.toUpperCase()} image`);
  const dir = path.join(mapsDir, 'exports');
  await fs.mkdir(dir, { recursive: true });
  if ((await fs.lstat(dir)).isSymbolicLink()) throw new Error(`refusing to write exports: ${dir} is a symlink`);
  const file = path.join(dir, `${baseName}.${result.format}`);
  const tmp = path.join(dir, `.tmp-${nanoid(8)}.${result.format}`);
  await fs.writeFile(tmp, bytes, { flag: 'wx' });
  await fs.rename(tmp, file);
  return file;
}
