import { create } from 'zustand';
import { api } from '../api/client';
import type { ChatEvent, ChatSnapshot } from '../model/chat';

const OPEN_KEY = 'chat.open';

function loadOpen(): boolean {
  try {
    const v = localStorage.getItem(OPEN_KEY);
    if (v !== null) return v === '1';
  } catch {
    // storage blocked — fall through to the default
  }
  return typeof window !== 'undefined' && window.innerWidth >= 900; // open by default where there's room
}

interface ChatStore extends ChatSnapshot {
  /** Side panel expanded (false = the slim collapsed bar). Per-browser preference. */
  open: boolean;
  /** Bumped to ask the composer to take focus (⌘J). */
  focusTick: number;
  setOpen(open: boolean, focus?: boolean): void;
  load(snapshot: ChatSnapshot): void;
  apply(e: ChatEvent): void;
}

/**
 * Client mirror of the server's chat transcript (server/agent.ts). The server
 * is the source of truth; this store only replays its `chat` events, so every
 * tab shows the same conversation and a reload loses nothing.
 */
export const useChat = create<ChatStore>((set) => ({
  status: 'idle',
  model: null,
  turnId: null,
  items: [],
  error: null,
  open: loadOpen(),
  focusTick: 0,

  setOpen(open, focus = false) {
    try {
      localStorage.setItem(OPEN_KEY, open ? '1' : '0');
    } catch {
      // per-viewer convenience only
    }
    set((s) => ({ open, focusTick: focus ? s.focusTick + 1 : s.focusTick }));
  },

  load(snapshot) {
    set({ ...snapshot });
  },

  apply(e) {
    if (e.op === 'reset') set({ items: [], turnId: null, error: null });
    else if (e.op === 'status') set({ status: e.status, model: e.model, turnId: e.turnId, error: e.error });
    else
      set((s) => {
        const i = s.items.findIndex((x) => x.id === e.item.id);
        if (i === -1) return { items: [...s.items, e.item] };
        const items = [...s.items];
        items[i] = e.item;
        return { items };
      });
  },
}));

/** Subscribe to chat events for the app's lifetime; resyncs on every (re)connect. */
export function initChat(): () => void {
  const es = new EventSource('/api/events');
  const sync = () => {
    api
      .chatState()
      .then((snap) => useChat.getState().load(snap))
      .catch(() => {});
  };
  es.addEventListener('open', sync);
  es.addEventListener('chat', (ev) => {
    try {
      useChat.getState().apply((JSON.parse((ev as MessageEvent).data) as { event: ChatEvent }).event);
    } catch {
      // malformed event — the next resync fixes it
    }
  });
  return () => es.close();
}
