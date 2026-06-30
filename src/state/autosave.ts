import { api } from '../api/client';
import { denormalize } from '../model/doc';
import { SCHEMA_VERSION, type MapFile } from '../model/types';
import { useStore } from './store';

const DEBOUNCE_MS = 800;
const RETRY_MS = 5000;

let timer: ReturnType<typeof setTimeout> | null = null;

function buildMapFile(): MapFile | null {
  const s = useStore.getState();
  if (!s.mapId || !s.doc) return null;
  return {
    schemaVersion: SCHEMA_VERSION,
    id: s.mapId,
    title: s.title,
    createdAt: s.createdAt,
    updatedAt: new Date().toISOString(), // server re-stamps authoritatively
    viewport: s.viewport,
    layout: s.doc.layout,
    pinned: s.pinned ? true : undefined, // JSON.stringify drops undefined — files stay minimal
    relationships: s.doc.relationships.length ? s.doc.relationships : undefined,
    root: denormalize(s.doc),
  };
}

function schedule(delay = DEBOUNCE_MS): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flush(), delay);
}

async function flush(): Promise<void> {
  const s = useStore.getState();
  if (!s.mapId || s.saveState !== 'dirty') return;
  if (s.editing) {
    schedule(); // don't snapshot mid-edit; the commit will re-trigger
    return;
  }
  const rev = s.rev;
  const map = buildMapFile();
  if (!map) return;
  s.markSaving(rev);
  try {
    await api.saveMap(map);
    useStore.getState().markSaved(rev);
  } catch {
    const now = useStore.getState();
    now.markSaveError();
    now.addToast('error', 'Autosave failed — retrying');
    schedule(RETRY_MS);
  }
}

/** Best-effort synchronous-ish save for tab close / navigation away. */
export function flushNow(): void {
  const s = useStore.getState();
  if (!s.mapId || (s.saveState !== 'dirty' && s.saveState !== 'error')) return;
  const map = buildMapFile();
  if (!map) return;
  void api.saveMap(map, true).then(() => useStore.getState().markSaved(s.rev)).catch(() => {});
}

/** Subscribe autosave to the store; returns a cleanup function. */
export function initAutosave(): () => void {
  const unsubscribe = useStore.subscribe((state, prev) => {
    if (state.rev !== prev.rev && state.mapId && state.saveState === 'dirty') schedule();
  });
  const onHide = () => {
    if (document.visibilityState === 'hidden') flushNow();
  };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('beforeunload', flushNow);
  return () => {
    unsubscribe();
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('beforeunload', flushNow);
    if (timer) clearTimeout(timer);
    timer = null;
  };
}
