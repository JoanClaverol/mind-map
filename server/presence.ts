/**
 * What the user is looking at right now, as reported by the browser tab
 * (POST /api/view). In-memory only — it's ephemeral view state, like hoist —
 * and per-process, so a stdio MCP server never sees it. The last tab to report
 * wins: this is a single-user local tool.
 */
export type ActiveView = {
  /** Open map, or null while the gallery is showing. */
  mapId: string | null;
  selectedId: string | null;
  hoistId: string | null;
  at: number;
};

let current: ActiveView | null = null;

export function setActiveView(v: Omit<ActiveView, 'at'>): void {
  current = { ...v, at: Date.now() };
}

export function getActiveView(): ActiveView | null {
  return current;
}
