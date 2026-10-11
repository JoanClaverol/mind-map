import type { MapOp } from '../src/model/ops';

/**
 * In-process pub/sub for map changes made outside the browser (MCP tools).
 * Fans out to every open SSE stream (/api/events in app.ts) so browser tabs
 * can apply external edits live. Browser autosave PUTs deliberately publish
 * nothing — the browser is the origin of those, so there is no echo loop.
 */
export type ServerEvent =
  | { kind: 'map-ops'; mapId: string; ops: MapOp[] }
  | { kind: 'map-created'; mapId: string; title: string }
  | { kind: 'map-deleted'; mapId: string }
  // An MCP client asks open tabs to show a map (and optionally select a node).
  | { kind: 'open-map'; mapId: string; nodeId?: string }
  // export_map: the tab renders the map and POSTs the image to /api/exports/:requestId.
  | { kind: 'export-request'; requestId: string; mapId: string; format: 'png' | 'svg' };

type Subscriber = (e: ServerEvent) => void;

const subscribers = new Set<Subscriber>();

export function subscribe(fn: Subscriber): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export function publish(e: ServerEvent): void {
  for (const fn of [...subscribers]) {
    try {
      fn(e);
    } catch (err) {
      console.error('[events] subscriber failed:', err instanceof Error ? err.message : err);
    }
  }
}
