import type { FolderInfo, MapFile, MapMeta } from '../model/types';
import type { ChatSnapshot } from '../model/chat';

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

  chatState: () => fetch('/api/chat').then((r) => asJson<ChatSnapshot>(r)),

  /** Starts a reply; it streams back as `chat` events on /api/events. */
  chatSend: (text: string, mapId: string | null, selectedId: string | null) =>
    fetch('/api/chat', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ text, mapId, selectedId }),
    }).then((r) => asJson<{ ok: boolean }>(r)),

  chatCancel: () => fetch('/api/chat/cancel', { method: 'POST', headers: JSON_HEADERS, body: '{}' }).then((r) => asJson<{ ok: boolean }>(r)),

  chatReset: () => fetch('/api/chat/reset', { method: 'POST', headers: JSON_HEADERS, body: '{}' }).then((r) => asJson<{ ok: boolean }>(r)),

  chatPermission: (id: string, allow: boolean) =>
    fetch('/api/chat/permission', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ id, allow }) }).then(
      (r) => asJson<{ ok: boolean }>(r),
    ),

  deleteFolder: (name: string) =>
    fetch(`/api/folders/${encodeURIComponent(name)}`, { method: 'DELETE' }).then((r) =>
      asJson<{ folders: FolderInfo[] }>(r),
    ),
};
