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

/** Saves next to the maps: <maps dir>/exports/<name>.<ext>. Returns the absolute path. */
export async function saveExport(mapsDir: string, baseName: string, result: ExportResult): Promise<string> {
  const dir = path.join(mapsDir, 'exports');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${baseName}.${result.format}`);
  await fs.writeFile(file, result.format === 'png' ? Buffer.from(result.data, 'base64') : result.data);
  return file;
}
