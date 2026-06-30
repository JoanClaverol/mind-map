import { LAYOUT_LABELS } from '../model/types';
import { useStore } from '../state/store';

const SAVE_LABELS = {
  idle: '',
  dirty: '●',
  saving: 'saving…',
  saved: 'saved',
  error: 'save failed!',
} as const;

const HINTS = 'Tab child · Enter sibling · Space edit · hjkl move · ⇧A arrow · ⇧R record · ⇧S structure · / fold · t todo · ⌘Z undo · ⌘0 fit · Esc gallery · ? help';
// Contextual hints that teach the arrow flow while it's in progress.
const LINK_HINTS = 'Drawing arrow — hjkl / click to a target · Enter connect · Esc cancel';
const REL_HINTS = 'Arrow selected — Enter label · Delete remove · Esc deselect';

export function StatusBar() {
  const title = useStore((s) => s.title);
  const saveState = useStore((s) => s.saveState);
  const layout = useStore((s) => s.doc?.layout ?? 'right');
  const zoom = useStore((s) => s.viewport.zoom);
  const linking = useStore((s) => s.linking);
  const selectedRelId = useStore((s) => s.selectedRelId);
  const mode = linking ? 'link' : selectedRelId ? 'rel' : null;
  const hints = mode === 'link' ? LINK_HINTS : mode === 'rel' ? REL_HINTS : HINTS;
  return (
    <div className="status-bar">
      <span className="status-title">{title}</span>
      <span className={`status-save ${saveState}`}>{SAVE_LABELS[saveState]}</span>
      <span className={`status-hints${mode ? ' active' : ''}`}>{hints}</span>
      <span className="status-layout">{LAYOUT_LABELS[layout]}</span>
      <span className="status-zoom">{Math.round(zoom * 100)}%</span>
    </div>
  );
}
