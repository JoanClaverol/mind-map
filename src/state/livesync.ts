import { api } from '../api/client';
import { denormalize, serializeFloating } from '../model/doc';
import { applyDocOp, type MapOp } from '../model/ops';
import { useStore } from './store';

/**
 * Live sync: applies edits made outside the browser (MCP tools in a terminal)
 * to the open map as they happen. Each op arrives over SSE and is replayed
 * through runCommand — the exact same applyDocOp the server ran — so an AI
 * edit is one history entry and Ctrl+Z undoes it like a local edit.
 *
 * Convergence: the op is applied on top of the browser's possibly-diverged
 * doc, and markDirty() forces the next autosave to PUT the union back to disk.
 * That makes browser-last-write-wins correct even when the MCP read-modify-
 * write briefly clobbered unsaved local keystrokes in the file.
 *
 * Known limit: if the SSE stream is down while MCP edits land AND the browser
 * autosaves during the gap, those MCP edits are overwritten (single-user
 * local tool — accepted).
 */
export function initLiveSync(mapId: string): () => void {
  const es = new EventSource('/api/events');
  let firstOpen = true;

  es.addEventListener('map-ops', (ev) => {
    let e: { mapId: string; ops: MapOp[] };
    try {
      e = JSON.parse((ev as MessageEvent).data);
    } catch {
      return;
    }
    const s = useStore.getState();
    if (e.mapId !== mapId || s.mapId !== mapId || !s.doc || e.ops.length === 0) return;
    // One runCommand for the whole batch = one undo entry. Best-effort per op:
    // a stale op fails inside applyDocOp → zero patches for it → clean no-op.
    const label = e.ops.length === 1 ? `mcp.${e.ops[0].type}` : 'mcp.batch';
    s.runCommand(label, (draft) => {
      for (const op of e.ops) applyDocOp(draft, op);
      return {}; // keep the user's selection; clampSelection covers a deleted one
    });
    const now = useStore.getState();
    if (now.editing && now.doc && !now.doc.nodes[now.editing.nodeId]) now.abortEdit();
    now.markDirty(); // ALWAYS — re-assert the union to disk (see doc comment)
  });

  es.addEventListener('open', () => {
    if (firstOpen) {
      firstOpen = false;
      return;
    }
    // Reconnected after a gap: ops may have been missed. If nothing is unsaved
    // locally, reload from disk when it differs.
    const s = useStore.getState();
    if (s.mapId !== mapId || !s.doc) return;
    if (s.saveState !== 'saved' && s.saveState !== 'idle') return;
    api
      .getMap(mapId)
      .then((map) => {
        const cur = useStore.getState();
        if (cur.mapId !== mapId || !cur.doc) return;
        if (cur.saveState !== 'saved' && cur.saveState !== 'idle') return;
        const unchanged =
          map.title === cur.title &&
          JSON.stringify(map.root) === JSON.stringify(denormalize(cur.doc)) &&
          JSON.stringify(map.relationships ?? []) === JSON.stringify(cur.doc.relationships) &&
          JSON.stringify(map.groups ?? []) === JSON.stringify(cur.doc.groups) &&
          JSON.stringify(map.floating ?? []) === JSON.stringify(serializeFloating(cur.doc) ?? []);
        if (unchanged) return;
        cur.loadMap(map);
        cur.addToast('info', 'Map changed outside the browser — reloaded');
      })
      .catch(() => {});
  });

  return () => es.close();
}
