/**
 * Chat transcript shapes shared by the server (server/agent.ts) and the panel.
 * In src/model/ because that is the only place the server imports shared types from.
 */
export type ChatItem =
  | { kind: 'user'; id: string; text: string; context?: string }
  | { kind: 'text'; id: string; text: string }
  | { kind: 'tool'; id: string; title: string; status: string }
  | { kind: 'permission'; id: string; title: string; detail?: string; state: 'pending' | 'allowed' | 'rejected' }
  | { kind: 'error'; id: string; text: string };

export type ChatStatus = 'idle' | 'starting' | 'busy' | 'unavailable';

export interface ChatSnapshot {
  status: ChatStatus;
  model: string | null;
  /** Set while a reply is streaming — the browser groups its map edits into one undo step. */
  turnId: string | null;
  items: ChatItem[];
  error: string | null;
}

export type ChatEvent =
  | { op: 'item'; item: ChatItem }
  | { op: 'status'; status: ChatStatus; model: string | null; turnId: string | null; error: string | null }
  | { op: 'reset' };
