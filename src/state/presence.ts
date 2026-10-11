import { blobToBase64, buildSvg, svgToPng } from '../canvas/exportImage';
import { useStore } from './store';

/**
 * The tab's half of "AI drives, you watch":
 *  - reports what the user is looking at (open map, selection, hoist) to the
 *    server, so an MCP client can resolve "this map" / "this node"
 *    (get_active_view);
 *  - follows `open-map` events, so an MCP client can put a map on screen.
 * App-wide (gallery included), unlike livesync which lives per open map.
 */
const REPORT_DEBOUNCE_MS = 250;

function currentView() {
  const s = useStore.getState();
  const onMap = /^#\/map\//.test(window.location.hash);
  return {
    mapId: onMap ? s.mapId : null,
    selectedId: onMap ? s.selectedId : null,
    hoistId: onMap ? s.hoistId : null,
  };
}

export function initPresence(): () => void {
  let last = '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  const report = (force = false) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      // Only the tab the user is looking at speaks for them.
      if (document.visibilityState !== 'visible') return;
      const body = JSON.stringify(currentView());
      if (!force && body === last) return;
      last = body;
      void fetch('/api/view', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }).catch(
        () => {},
      );
    }, REPORT_DEBOUNCE_MS);
  };

  const unsub = useStore.subscribe((s, prev) => {
    if (s.mapId !== prev.mapId || s.selectedId !== prev.selectedId || s.hoistId !== prev.hoistId) report();
  });
  const onHash = () => report();
  const onVisible = () => report(true);
  window.addEventListener('hashchange', onHash);
  document.addEventListener('visibilitychange', onVisible);

  // Pending node to select once the requested map has loaded.
  let pendingSelect: { mapId: string; nodeId: string } | null = null;
  const unsubSelect = useStore.subscribe((s) => {
    if (!pendingSelect || s.mapId !== pendingSelect.mapId || !s.doc) return;
    const { nodeId } = pendingSelect;
    pendingSelect = null;
    if (s.doc.nodes[nodeId]) s.select(nodeId);
  });

  const es = new EventSource('/api/events');
  es.addEventListener('open', () => report(true)); // (re)connected — server may have restarted
  es.addEventListener('open-map', (ev) => {
    let e: { mapId: string; nodeId?: string };
    try {
      e = JSON.parse((ev as MessageEvent).data);
    } catch {
      return;
    }
    if (!/^[A-Za-z0-9_-]+$/.test(e.mapId)) return;
    const s = useStore.getState();
    if (s.mapId === e.mapId && window.location.hash.startsWith(`#/map/${e.mapId}`)) {
      if (e.nodeId && s.doc?.nodes[e.nodeId]) s.select(e.nodeId);
      return;
    }
    pendingSelect = e.nodeId ? { mapId: e.mapId, nodeId: e.nodeId } : null;
    window.location.hash = `#/map/${e.mapId}`;
  });

  // export_map round trip: render the requested map, POST the image back.
  es.addEventListener('export-request', (ev) => {
    let e: { requestId: string; mapId: string; format: 'png' | 'svg' };
    try {
      e = JSON.parse((ev as MessageEvent).data);
    } catch {
      return;
    }
    if (!/^[A-Za-z0-9_-]+$/.test(e.mapId)) return;
    // Background tabs give the visible one a head start (first answer wins).
    const delay = document.visibilityState === 'visible' ? 0 : 1500;
    setTimeout(() => void answerExport(e), delay);
  });

  report(true);
  return () => {
    es.close();
    unsub();
    unsubSelect();
    if (timer) clearTimeout(timer);
    window.removeEventListener('hashchange', onHash);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

/** Resolves once `mapId` is open and its canvas has painted (or rejects after a timeout). */
function whenMapRendered(mapId: string, timeoutMs = 8000): Promise<void> {
  const ready = () =>
    useStore.getState().mapId === mapId &&
    window.location.hash.startsWith(`#/map/${mapId}`) &&
    !!document.querySelector('.canvas-host svg .node');
  if (!ready()) window.location.hash = `#/map/${mapId}`;
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (ready()) {
        // Two frames: layout effects + measurement settle before we clone the SVG.
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      } else if (Date.now() - start > timeoutMs) reject(new Error('map did not render'));
      else setTimeout(tick, 50);
    };
    tick();
  });
}

async function answerExport(e: { requestId: string; mapId: string; format: 'png' | 'svg' }): Promise<void> {
  try {
    await whenMapRendered(e.mapId);
    const out = await buildSvg();
    if (!out) return;
    const data = e.format === 'svg' ? out.svg : await blobToBase64(await svgToPng(out));
    await fetch(`/api/exports/${encodeURIComponent(e.requestId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format: e.format, data }),
    });
  } catch {
    // another tab may answer; otherwise the tool call times out with a clear message
  }
}
