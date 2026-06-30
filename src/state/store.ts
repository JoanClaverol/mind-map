import { applyPatches, enablePatches, produceWithPatches, type Draft, type Patch } from 'immer';
import { create } from 'zustand';
import { normalize } from '../model/doc';
import type { Doc, FolderInfo, MapFile, MapMeta, Viewport } from '../model/types';
import { setCollapsedFolders } from '../gallery/recents';
import type { CommandResult } from './commands';

enablePatches();

const HISTORY_CAP = 500;

export interface EditingState {
  nodeId: string;
  /** append = cursor at end of existing text; replace = start from seed (or empty). */
  mode: 'append' | 'replace';
  seed?: string;
}

interface HistoryEntry {
  label: string;
  patches: Patch[];
  inversePatches: Patch[];
  selectionBefore: string | null;
  selectionAfter: string | null;
}

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  message: string;
}

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

/**
 * Voice-capture UI state. Never enters history/autosave: it is set with plain
 * `set` and deliberately does not touch rev or saveState. The MediaRecorder
 * itself lives in src/audio/recorder.ts, not here.
 */
export interface AudioState {
  phase: 'recording' | 'transcribing' | 'ready' | 'busy';
  startedAt?: number;
  transcript?: string;
  language?: string;
  duration?: number;
  segments?: { text: string; start: number; end: number }[];
}

let toastSeq = 0;

interface StoreState {
  mapId: string | null;
  title: string;
  createdAt: string;
  /** Gallery pin — carried through the store so autosave round-trips it. */
  pinned: boolean;
  doc: Doc | null;
  selectedId: string | null;
  editing: EditingState | null;
  /** Drawing an arrow: the source node is fixed; selectedId is the moving target cursor. */
  linking: { sourceId: string } | null;
  /** An existing arrow is selected (for delete / edit-label). Cleared whenever a node is selected. */
  selectedRelId: string | null;
  /** The arrow whose label is being edited. */
  editingRel: { relId: string } | null;
  viewport: Viewport;
  /** Increments on every persistable change; autosave uses it to detect staleness. */
  rev: number;
  savedRev: number;
  saveState: SaveState;
  /** True when the map was opened without a stored viewport — fit on first layout. */
  needsFit: boolean;
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  toasts: Toast[];
  /** Nodes with an in-flight todo push. */
  pendingTodo: string[];
  /** Nodes with an in-flight note save. */
  pendingNote: string[];
  audio: AudioState | null;
  /**
   * Gallery UI state. Like audio, plain `set` only — never touches rev or
   * saveState. Lives here so gallery.* registry commands can drive it.
   */
  galleryMaps: MapMeta[] | null;
  galleryFolders: FolderInfo[] | null;
  gallerySearch: string;
  gallerySelectedId: string | null;
  galleryRenamingId: string | null;
  /** Collapsed section keys (folders + Uncategorized); hydrated from localStorage. */
  galleryCollapsed: Set<string>;
  /** When set, the inline folder picker is open for this map. */
  galleryFolderPicker: { mapId: string; query: string } | null;
  /** Keyboard cheatsheet overlay (toggled with ?). */
  helpOpen: boolean;
  /**
   * "Chat with this map" panel. Like audio/help, plain `set` only — never enters
   * history or autosave. Ephemeral: reset whenever a map is loaded or closed.
   */
  chatOpen: boolean;
  chatMessages: ChatMessage[];
  chatStreaming: boolean;

  loadMap(map: MapFile): void;
  closeMap(): void;
  setTitle(title: string): void;
  runCommand(label: string, fn: (draft: Draft<Doc>) => CommandResult): void;
  undo(): void;
  redo(): void;
  select(id: string | null): void;
  startEdit(mode: 'append' | 'replace', seed?: string): void;
  commitEdit(text: string): void;
  /** Begin drawing an arrow from the selected node. */
  startLinking(): void;
  /** Abandon arrow drawing and reselect the source node. */
  cancelLinking(): void;
  selectRelationship(id: string | null): void;
  startEditRel(relId: string): void;
  setEditingRel(v: { relId: string } | null): void;
  setViewport(viewport: Viewport): void;
  /** Fit the view once the next layout has been computed. */
  requestFit(): void;
  clearNeedsFit(): void;
  markSaving(rev: number): void;
  markSaved(rev: number): void;
  markSaveError(): void;
  addToast(kind: Toast['kind'], message: string): void;
  dismissToast(id: number): void;
  setTodoPending(nodeId: string, pending: boolean): void;
  setNotePending(nodeId: string, pending: boolean): void;
  setAudio(audio: AudioState | null): void;
  setGalleryMaps(maps: MapMeta[] | null): void;
  setGalleryFolders(folders: FolderInfo[] | null): void;
  setGallerySearch(search: string): void;
  selectGalleryMap(id: string | null): void;
  setGalleryRenaming(id: string | null): void;
  setGalleryCollapsed(keys: Set<string>): void;
  toggleGalleryCollapsed(key: string): void;
  openFolderPicker(mapId: string): void;
  setFolderPickerQuery(query: string): void;
  closeFolderPicker(): void;
  setHelpOpen(open: boolean): void;
  toggleHelp(): void;
  setChatOpen(open: boolean): void;
  addChatMessage(msg: ChatMessage): void;
  /** Append streamed text to the most recent message (the in-flight assistant turn). */
  appendToLastChatMessage(text: string): void;
  setChatStreaming(streaming: boolean): void;
  resetChat(): void;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

function clampSelection(doc: Doc, id: string | null): string {
  return id && doc.nodes[id] ? id : doc.rootId;
}

export const useStore = create<StoreState>((set, get) => ({
  mapId: null,
  title: '',
  createdAt: '',
  pinned: false,
  doc: null,
  selectedId: null,
  editing: null,
  linking: null,
  selectedRelId: null,
  editingRel: null,
  viewport: { x: 60, y: 60, zoom: 1 },
  rev: 0,
  savedRev: 0,
  saveState: 'idle',
  needsFit: false,
  undoStack: [],
  redoStack: [],
  toasts: [],
  pendingTodo: [],
  pendingNote: [],
  audio: null,
  galleryMaps: null,
  galleryFolders: null,
  gallerySearch: '',
  gallerySelectedId: null,
  galleryRenamingId: null,
  galleryCollapsed: new Set(),
  galleryFolderPicker: null,
  helpOpen: false,
  chatOpen: false,
  chatMessages: [],
  chatStreaming: false,

  loadMap(map) {
    const doc = normalize(map.root, map.layout ?? 'right', map.relationships ?? []);
    set({
      mapId: map.id,
      title: map.title,
      createdAt: map.createdAt,
      pinned: map.pinned ?? false,
      doc,
      selectedId: doc.rootId,
      editing: null,
      linking: null,
      selectedRelId: null,
      editingRel: null,
      needsFit: !map.viewport,
      viewport: map.viewport ?? { x: 60, y: 60, zoom: 1 },
      rev: 0,
      savedRev: 0,
      saveState: 'saved',
      undoStack: [],
      redoStack: [],
      pendingTodo: [],
      pendingNote: [],
      chatOpen: false,
      chatMessages: [],
      chatStreaming: false,
    });
  },

  closeMap() {
    set({
      mapId: null,
      title: '',
      createdAt: '',
      pinned: false,
      doc: null,
      selectedId: null,
      editing: null,
      linking: null,
      selectedRelId: null,
      editingRel: null,
      rev: 0,
      savedRev: 0,
      saveState: 'idle',
      undoStack: [],
      redoStack: [],
      pendingTodo: [],
      pendingNote: [],
      chatOpen: false,
      chatMessages: [],
      chatStreaming: false,
    });
  },

  setTitle(title) {
    set((s) => ({ title, rev: s.rev + 1, saveState: 'dirty' }));
  },

  runCommand(label, fn) {
    const { doc, selectedId } = get();
    if (!doc) return;
    let result: CommandResult = {};
    const [next, patches, inversePatches] = produceWithPatches(doc, (draft: Draft<Doc>) => {
      result = fn(draft) ?? {};
    });
    if (patches.length === 0) return;
    const selectionAfter =
      result.select !== undefined ? result.select : selectedId;
    const entry: HistoryEntry = {
      label,
      patches,
      inversePatches,
      selectionBefore: selectedId,
      selectionAfter,
    };
    set((s) => ({
      doc: next,
      selectedId: clampSelection(next, selectionAfter),
      undoStack: [...s.undoStack.slice(-(HISTORY_CAP - 1)), entry],
      redoStack: [],
      rev: s.rev + 1,
      saveState: 'dirty',
    }));
  },

  undo() {
    const { doc, undoStack } = get();
    const entry = undoStack[undoStack.length - 1];
    if (!doc || !entry) return;
    const prev = applyPatches(doc, entry.inversePatches);
    set((s) => ({
      doc: prev,
      selectedId: clampSelection(prev, entry.selectionBefore),
      editing: null,
      undoStack: s.undoStack.slice(0, -1),
      redoStack: [...s.redoStack, entry],
      rev: s.rev + 1,
      saveState: 'dirty',
    }));
  },

  redo() {
    const { doc, redoStack } = get();
    const entry = redoStack[redoStack.length - 1];
    if (!doc || !entry) return;
    const next = applyPatches(doc, entry.patches);
    set((s) => ({
      doc: next,
      selectedId: clampSelection(next, entry.selectionAfter),
      editing: null,
      undoStack: [...s.undoStack, entry],
      redoStack: s.redoStack.slice(0, -1),
      rev: s.rev + 1,
      saveState: 'dirty',
    }));
  },

  select(id) {
    set({ selectedId: id, selectedRelId: null });
  },

  startLinking() {
    const { doc, selectedId } = get();
    if (!doc || !selectedId || !doc.nodes[selectedId]) return;
    set({ linking: { sourceId: selectedId }, selectedRelId: null });
  },

  cancelLinking() {
    const { linking } = get();
    if (!linking) return;
    set({ linking: null, selectedId: linking.sourceId });
  },

  selectRelationship(id) {
    set({ selectedRelId: id });
  },

  startEditRel(relId) {
    const { doc } = get();
    if (!doc || !doc.relationships.some((r) => r.id === relId)) return;
    set({ editingRel: { relId }, selectedRelId: relId });
  },

  setEditingRel(v) {
    set({ editingRel: v });
  },

  startEdit(mode, seed) {
    const { doc, selectedId } = get();
    if (!doc || !selectedId || !doc.nodes[selectedId]) return;
    set({ editing: { nodeId: selectedId, mode, seed } });
  },

  commitEdit(text) {
    const { editing, doc } = get();
    if (!editing || !doc) return;
    set({ editing: null });
    const node = doc.nodes[editing.nodeId];
    if (!node || node.text === text) return;
    get().runCommand('editText', (draft) => {
      draft.nodes[editing.nodeId].text = text;
      return { select: editing.nodeId };
    });
  },

  setViewport(viewport) {
    set((s) => ({
      viewport,
      rev: s.rev + 1,
      saveState: s.saveState === 'saved' || s.saveState === 'idle' ? 'dirty' : s.saveState,
    }));
  },

  requestFit() {
    set({ needsFit: true });
  },

  clearNeedsFit() {
    set({ needsFit: false });
  },

  markSaving(rev) {
    set({ saveState: 'saving', savedRev: rev });
  },

  markSaved(rev) {
    set((s) => ({ saveState: s.rev === rev ? 'saved' : 'dirty', savedRev: rev }));
  },

  markSaveError() {
    set({ saveState: 'error' });
  },

  addToast(kind, message) {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }));
    setTimeout(() => get().dismissToast(id), 3500);
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  setTodoPending(nodeId, pending) {
    set((s) => ({
      pendingTodo: pending
        ? [...s.pendingTodo, nodeId]
        : s.pendingTodo.filter((id) => id !== nodeId),
    }));
  },

  setNotePending(nodeId, pending) {
    set((s) => ({
      pendingNote: pending
        ? [...s.pendingNote, nodeId]
        : s.pendingNote.filter((id) => id !== nodeId),
    }));
  },

  setAudio(audio) {
    set({ audio });
  },

  setGalleryMaps(maps) {
    set({ galleryMaps: maps });
  },

  setGalleryFolders(folders) {
    set({ galleryFolders: folders });
  },

  setGallerySearch(search) {
    set({ gallerySearch: search });
  },

  selectGalleryMap(id) {
    set({ gallerySelectedId: id });
  },

  setGalleryRenaming(id) {
    set({ galleryRenamingId: id });
  },

  setGalleryCollapsed(keys) {
    set({ galleryCollapsed: keys });
  },

  toggleGalleryCollapsed(key) {
    set((s) => {
      const next = new Set(s.galleryCollapsed);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      setCollapsedFolders([...next]);
      return { galleryCollapsed: next };
    });
  },

  openFolderPicker(mapId) {
    set({ galleryFolderPicker: { mapId, query: '' } });
  },

  setFolderPickerQuery(query) {
    set((s) => (s.galleryFolderPicker ? { galleryFolderPicker: { ...s.galleryFolderPicker, query } } : {}));
  },

  closeFolderPicker() {
    set({ galleryFolderPicker: null });
  },

  setHelpOpen(open) {
    set({ helpOpen: open });
  },

  toggleHelp() {
    set((s) => ({ helpOpen: !s.helpOpen }));
  },

  setChatOpen(open) {
    set({ chatOpen: open });
  },

  addChatMessage(msg) {
    set((s) => ({ chatMessages: [...s.chatMessages, msg] }));
  },

  appendToLastChatMessage(text) {
    set((s) => {
      if (s.chatMessages.length === 0) return {};
      const messages = s.chatMessages.slice();
      const last = messages[messages.length - 1];
      messages[messages.length - 1] = { ...last, content: last.content + text };
      return { chatMessages: messages };
    });
  },

  setChatStreaming(streaming) {
    set({ chatStreaming: streaming });
  },

  resetChat() {
    set({ chatOpen: false, chatMessages: [], chatStreaming: false });
  },
}));
