import { branchStyleOf, buildParentMap } from '../model/doc';
import { LAYOUT_LABELS } from '../model/types';
import { canvasMode, useStore } from '../state/store';

const SAVE_LABELS = {
  idle: '',
  dirty: '●',
  saving: 'saving…',
  saved: 'saved',
  error: 'save failed!',
} as const;

const HINTS = 'Tab child · Enter sibling · Space edit · hjkl move · ⇧A arrow · ⇧G group · ⇧N tree · ⇧I inspect · ⌘F search · ⌘. hoist · ⇧S structure · ⇧B branch · / fold · ⌘Z undo · ⌘0 fit · Esc gallery · ? help';
// Contextual hints that teach each canvas mode while it's active (see canvasMode).
const MODE_HINTS = {
  link: 'Drawing arrow — hjkl / click to a target · Enter connect · Esc cancel',
  group: 'Grouping — hjkl to a node · Space add/remove · Enter create · Esc cancel',
  relsel: 'Arrow selected — Enter label · Delete remove · Esc deselect',
  groupsel: 'Group selected — Enter label · C color · ⇧G members · Delete remove · Esc deselect',
  elemsel: 'Element selected — Enter text · C color · hjkl nudge (⇧ far) · drag corner to resize · Delete remove · Esc deselect',
} as const;

function trunc(text: string, max = 18): string {
  const t = text.trim() || '(empty)';
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** Breadcrumb of the hoisted branch: Root › … › Parent › Hoisted. */
function hoistPath(): string | null {
  const s = useStore.getState();
  if (!s.doc || !s.hoistId || !s.doc.nodes[s.hoistId]) return null;
  const parents = buildParentMap(s.doc);
  const chain: string[] = [];
  for (let id: string | undefined = s.hoistId; id; id = parents[id]) chain.unshift(trunc(s.doc.nodes[id].text));
  return chain.join(' › ');
}

export function StatusBar() {
  const title = useStore((s) => s.title);
  const saveState = useStore((s) => s.saveState);
  const layout = useStore((s) => s.doc?.layout ?? 'right');
  // The selected node's branch structure override, if any.
  const branch = useStore((s) =>
    s.doc && s.selectedId && s.doc.nodes[s.selectedId] ? branchStyleOf(s.doc, s.selectedId) : undefined,
  );
  const zoom = useStore((s) => s.viewport.zoom);
  const interaction = useStore(canvasMode);
  const hoistId = useStore((s) => s.hoistId);
  const filterQuery = useStore((s) => s.filterQuery);
  useStore((s) => s.doc); // re-render the breadcrumb when the doc changes
  const mode = interaction ?? (filterQuery ? 'filter' : hoistId ? 'hoist' : null);
  const hints = interaction
    ? MODE_HINTS[interaction]
    : mode === 'filter'
      ? `Filter “${trunc(filterQuery!, 32)}” — non-matches dimmed · ⌘F edit · Esc clear`
      : mode === 'hoist'
        ? `Hoisted: ${hoistPath() ?? ''} · ⌘. on root up one · Esc exit`
        : HINTS;
  return (
    <div className="status-bar">
      <span className="status-title">{title}</span>
      <span className={`status-save ${saveState}`}>{SAVE_LABELS[saveState]}</span>
      <span className={`status-hints${mode ? ' active' : ''}`}>{hints}</span>
      <span className="status-layout">
        {LAYOUT_LABELS[layout]}
        {branch ? ` › ${LAYOUT_LABELS[branch]}` : ''}
      </span>
      <span className="status-zoom">{Math.round(zoom * 100)}%</span>
    </div>
  );
}
