import type { Segment } from '../model/segments';
import type { ChatTurn, FolderInfo, MapFile, MapMeta } from '../model/types';

export interface TranscribeResponse {
  text: string;
  language: string;
  language_probability: number;
  duration: number;
  segments: Segment[];
}

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

export const api = {
  listMaps: () => fetch('/api/maps').then((r) => asJson<{ maps: MapMeta[]; warnings: string[] }>(r)),

  createMap: (title: string) =>
    fetch('/api/maps', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ title }) }).then((r) =>
      asJson<MapFile>(r),
    ),

  getMap: (id: string) => fetch(`/api/maps/${id}`).then((r) => asJson<MapFile>(r)),

  /** keepalive lets the final save survive tab close / navigation. */
  saveMap: (map: MapFile, keepalive = false) =>
    fetch(`/api/maps/${map.id}`, {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify(map),
      keepalive,
    }).then((r) => asJson<{ updatedAt: string }>(r)),

  renameMap: (id: string, title: string) =>
    fetch(`/api/maps/${id}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ title }) }).then((r) =>
      asJson<{ title: string; updatedAt: string }>(r),
    ),

  setPinned: (id: string, pinned: boolean) =>
    fetch(`/api/maps/${id}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ pinned }) }).then((r) =>
      asJson<{ pinned: boolean; updatedAt: string }>(r),
    ),

  deleteMap: (id: string) =>
    fetch(`/api/maps/${id}`, { method: 'DELETE' }).then((r) => asJson<{ ok: boolean }>(r)),

  /** folder=null moves the map to Uncategorized; a name assigns (and auto-creates) the folder. */
  setFolder: (id: string, folder: string | null) =>
    fetch(`/api/maps/${id}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ folder }) }).then((r) =>
      asJson<{ folder: string | null; updatedAt: string }>(r),
    ),

  listFolders: () => fetch('/api/folders').then((r) => asJson<{ folders: FolderInfo[] }>(r)),

  createFolder: (name: string) =>
    fetch('/api/folders', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ name }) }).then((r) =>
      asJson<{ folders: FolderInfo[] }>(r),
    ),

  renameFolder: (name: string, newName: string) =>
    fetch(`/api/folders/${encodeURIComponent(name)}`, {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: newName }),
    }).then((r) => asJson<{ folders: FolderInfo[] }>(r)),

  deleteFolder: (name: string) =>
    fetch(`/api/folders/${encodeURIComponent(name)}`, { method: 'DELETE' }).then((r) =>
      asJson<{ folders: FolderInfo[] }>(r),
    ),

  getConfig: () => fetch('/api/config').then((r) => asJson<{ refine: boolean; transcriber: boolean }>(r)),

  transcribe: (blob: Blob, filename: string) => {
    const fd = new FormData();
    fd.append('audio', blob, filename);
    return fetch('/api/transcribe', { method: 'POST', body: fd }).then((r) => asJson<TranscribeResponse>(r));
  },

  structure: (text: string) =>
    fetch('/api/structure', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ text }) }).then((r) =>
      asJson<{ markdown: string }>(r),
    ),

  refine: (text: string, instruction: string) =>
    fetch('/api/refine', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ text, instruction }),
    }).then((r) => asJson<{ text: string }>(r)),

  /** Streams an answer about the map; onToken fires for each text delta as it arrives. */
  chat: async (markdown: string, messages: ChatTurn[], onToken: (delta: string) => void): Promise<void> => {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ markdown, messages }),
    });
    if (!res.ok || !res.body) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? `${res.status} ${res.statusText}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      onToken(decoder.decode(value, { stream: true }));
    }
  },

  saveNote: (title: string, text: string) =>
    fetch('/api/note', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ title, text }) }).then((r) =>
      asJson<{ ok: boolean; message: string }>(r),
    ),

  /** planned_for is the user's local date so the todo lands in *their* today. */
  pushTodo: (text: string) => {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    return fetch('/api/todo', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ text, planned_for: today }),
    }).then((r) => asJson<{ todoId: string }>(r));
  },
};
