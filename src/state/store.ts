import { applyPatches, enablePatches, produceWithPatches, type Draft, type Patch } from 'immer';
import { create } from 'zustand';
import { docFromMap } from '../model/doc';
import { loadViewport, saveViewport } from './viewportMemory';
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
  /**
   * Group mode: picking boundary members with the cursor (Space toggles the
   * selected node). editingGroupId set = re-editing an existing group's members.
   */
  grouping: { members: string[]; editingGroupId: string | null } | null;
  /** An existing group is selected (for delete / edit-label / recolor). Cleared whenever a node is selected. */
  selectedGroupId: string | null;
  /** A freeform canvas element (sticky/text/shape) is selected — mutually exclusive with arrow/group. */
  selectedElementId: string | null;
  /** Inline text editor open on an element. */
  editingElement: { elementId: string } | null;
  /** Freehand pen (⇧F): drags on the canvas draw strokes instead of panning. */
  penMode: boolean;
  /** The group whose label is being edited. */
  editingGroup: { groupId: string } | null;
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
  /**
   * Gallery UI state. Plain `set` only — never touches rev or
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
  /** Node inspector panel (⇧I) — plain set, never touches rev/saveState. */
  inspectorOpen: boolean;
  /**
   * View state (⌘. hoist, ⌘F search, pinned filter) — ephemeral like selection:
   * plain set, never persisted, never in undo history.
   */
  hoistId: string | null;
  searchOpen: boolean;
  searchQuery: string;
  /** A search query pinned as a canvas filter (⇧Enter) — non-matches dim until Esc. */
  filterQuery: string | null;
  /** Hand-drawn theme (per-viewer preference in localStorage, not map data). */
  sketch: boolean;
  /** Bumped when node measurements are invalidated (font change) — layout re-runs. */
  measureEpoch: number;

  loadMap(map: MapFile): void;
  closeMap(): void;
  setTitle(title: string): void;
  /**
   * opts.coalesce: fold into the previous history entry when it has the same
   * label (and nothing was undone since) — the chat uses it so one ⌘Z undoes a
   * whole AI reply, however many tool calls it made.
   */
  runCommand(label: string, fn: (draft: Draft<Doc>) => CommandResult, opts?: { coalesce?: boolean }): void;
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
  /** Begin picking group members, seeded with the selected node. */
  startGrouping(): void;
  /** Re-open group mode on an existing group to edit its members; seedId = where the cursor starts. */
  startEditGroupMembers(groupId: string, seedId?: string): void;
  /** Toggle the selected node in the in-progress member list. */
  toggleGroupingMember(): void;
  cancelGrouping(): void;
  selectGroup(id: string | null): void;
  selectElement(id: string | null): void;
  startEditElement(elementId: string): void;
  setEditingElement(v: { elementId: string } | null): void;
  setPenMode(on: boolean): void;
  startEditGroup(groupId: string): void;
  setEditingGroup(v: { groupId: string } | null): void;
  setViewport(viewport: Viewport): void;
  /** Fit the view once the next layout has been computed. */
  requestFit(): void;
  clearNeedsFit(): void;
  markSaving(rev: number): void;
  markSaved(rev: number): void;
  markSaveError(): void;
  /**
   * Force a re-save of the current doc. Live-sync calls this after applying an
   * external (MCP) edit so the browser re-asserts its full doc — the union of
   * both sides — to disk, even when the op itself produced no patches.
   */
  markDirty(): void;
  /** Close the node editor without committing (the edited node vanished under us). */
  abortEdit(): void;
  addToast(kind: Toast['kind'], message: string): void;
  dismissToast(id: number): void;
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
  setInspectorOpen(open: boolean): void;
  toggleInspector(): void;
  setHoist(id: string | null): void;
  setSketch(on: boolean): void;
  bumpMeasureEpoch(): void;
  /** Open the search panel, seeding the input from a pinned filter if one is active. */
  openSearch(): void;
  closeSearch(): void;
  setSearchQuery(query: string): void;
  setFilterQuery(query: string | null): void;
}

function clampSelection(doc: Doc, id: string | null): string {
  return id && doc.nodes[id] ? id : doc.rootId;
}

/**
 * The active canvas interaction mode — the ONE precedence ladder shared by the
 * keymap context (MindMapCanvas) and the status-bar hints, so they never drift.
 */
export function canvasMode(
  s: Pick<StoreState, 'linking' | 'grouping' | 'selectedRelId' | 'selectedGroupId' | 'selectedElementId' | 'penMode'>,
): 'pen' | 'link' | 'group' | 'relsel' | 'groupsel' | 'elemsel' | null {
  if (s.penMode) return 'pen';
  if (s.linking) return 'link';
  if (s.grouping) return 'group';
  if (s.selectedRelId) return 'relsel';
  if (s.selectedGroupId) return 'groupsel';
  if (s.selectedElementId) return 'elemsel';
  return null;
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
  grouping: null,
  selectedGroupId: null,
  editingGroup: null,
  selectedElementId: null,
  editingElement: null,
  penMode: false,
  viewport: { x: 60, y: 60, zoom: 1 },
  rev: 0,
  savedRev: 0,
  saveState: 'idle',
  needsFit: false,
  undoStack: [],
  redoStack: [],
  toasts: [],
  galleryMaps: null,
  galleryFolders: null,
  gallerySearch: '',
  gallerySelectedId: null,
  galleryRenamingId: null,
  galleryCollapsed: new Set(),
  galleryFolderPicker: null,
  helpOpen: false,
  inspectorOpen: false,
  hoistId: null,
  searchOpen: false,
  searchQuery: '',
  filterQuery: null,
  sketch: false,
  measureEpoch: 0,

  loadMap(map) {
    const doc = docFromMap(map);
    const remembered = loadViewport(map.id) ?? map.viewport ?? null;
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
      grouping: null,
      selectedGroupId: null,
      editingGroup: null,
      selectedElementId: null,
      editingElement: null,
      penMode: false,
      needsFit: !remembered,
      viewport: remembered ?? { x: 60, y: 60, zoom: 1 },
      rev: 0,
      savedRev: 0,
      saveState: 'saved',
      undoStack: [],
      redoStack: [],
      inspectorOpen: false,
      hoistId: null,
      searchOpen: false,
      searchQuery: '',
      filterQuery: null,
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
      grouping: null,
      selectedGroupId: null,
      editingGroup: null,
      selectedElementId: null,
      editingElement: null,
      penMode: false,
      rev: 0,
      savedRev: 0,
      saveState: 'idle',
      undoStack: [],
      redoStack: [],
      inspectorOpen: false,
      hoistId: null,
      searchOpen: false,
      searchQuery: '',
      filterQuery: null,
    });
  },

  setTitle(title) {
    set((s) => ({ title, rev: s.rev + 1, saveState: 'dirty' }));
  },

  runCommand(label, fn, opts) {
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
    set((s) => {
      const top = s.undoStack[s.undoStack.length - 1];
      const merge = opts?.coalesce && top?.label === label && s.redoStack.length === 0;
      const undoStack = merge
        ? [
            ...s.undoStack.slice(0, -1),
            {
              ...entry,
              // Replay in order going forward; undo the newest change first.
              patches: [...top.patches, ...patches],
              inversePatches: [...inversePatches, ...top.inversePatches],
              selectionBefore: top.selectionBefore,
            },
          ]
        : [...s.undoStack.slice(-(HISTORY_CAP - 1)), entry];
      return {
        doc: next,
        selectedId: clampSelection(next, selectionAfter),
        undoStack,
        redoStack: [],
        rev: s.rev + 1,
        saveState: 'dirty',
      };
    });
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
    set({ selectedId: id, selectedRelId: null, selectedGroupId: null, selectedElementId: null });
  },

  startLinking() {
    const { doc, selectedId } = get();
    if (!doc || !selectedId || !doc.nodes[selectedId]) return;
    set({ linking: { sourceId: selectedId }, selectedRelId: null, selectedGroupId: null });
  },

  cancelLinking() {
    const { linking } = get();
    if (!linking) return;
    set({ linking: null, selectedId: linking.sourceId });
  },

  selectRelationship(id) {
    set(id === null ? { selectedRelId: null } : { selectedRelId: id, selectedGroupId: null, selectedElementId: null });
  },

  startEditRel(relId) {
    const { doc } = get();
    if (!doc || !doc.relationships.some((r) => r.id === relId)) return;
    set({ editingRel: { relId }, selectedRelId: relId });
  },

  setEditingRel(v) {
    set({ editingRel: v });
  },

  startGrouping() {
    const { doc, selectedId } = get();
    if (!doc || !selectedId || !doc.nodes[selectedId]) return;
    set({ grouping: { members: [selectedId], editingGroupId: null }, selectedRelId: null, selectedGroupId: null });
  },

  startEditGroupMembers(groupId, seedId) {
    const { doc } = get();
    const group = doc?.groups.find((g) => g.id === groupId);
    if (!doc || !group) return;
    set({
      grouping: { members: [...group.members], editingGroupId: groupId },
      selectedId: seedId && group.members.includes(seedId) ? seedId : group.members[0],
      selectedRelId: null,
      selectedGroupId: null,
    });
  },

  toggleGroupingMember() {
    const { doc, grouping, selectedId } = get();
    if (!doc || !grouping || !selectedId || !doc.nodes[selectedId]) return;
    const members = grouping.members.includes(selectedId)
      ? grouping.members.filter((m) => m !== selectedId)
      : [...grouping.members, selectedId];
    set({ grouping: { ...grouping, members } });
  },

  cancelGrouping() {
    set({ grouping: null });
  },

  selectGroup(id) {
    set(id === null ? { selectedGroupId: null } : { selectedGroupId: id, selectedRelId: null, selectedElementId: null });
  },

  selectElement(id) {
    set(
      id === null
        ? { selectedElementId: null }
        : { selectedElementId: id, selectedRelId: null, selectedGroupId: null, linking: null, grouping: null },
    );
  },

  startEditElement(elementId) {
    const { doc } = get();
    if (!doc || !doc.elements.some((e) => e.id === elementId && e.kind !== 'draw')) return; // drawings have no text
    set({ editingElement: { elementId }, selectedElementId: elementId, selectedRelId: null, selectedGroupId: null });
  },

  setEditingElement(v) {
    set({ editingElement: v });
  },

  setPenMode(on) {
    set(on ? { penMode: true, linking: null, grouping: null, selectedRelId: null, selectedGroupId: null } : { penMode: false });
  },

  startEditGroup(groupId) {
    const { doc } = get();
    if (!doc || !doc.groups.some((g) => g.id === groupId)) return;
    set({ editingGroup: { groupId }, selectedGroupId: groupId, selectedRelId: null });
  },

  setEditingGroup(v) {
    set({ editingGroup: v });
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
    // View state, not doc state: remembered per browser, never dirties the map file.
    set({ viewport });
    const { mapId } = get();
    if (mapId) saveViewport(mapId, viewport);
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

  markDirty() {
    set((s) => ({ rev: s.rev + 1, saveState: 'dirty' }));
  },

  abortEdit() {
    set({ editing: null });
  },

  addToast(kind, message) {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }));
    setTimeout(() => get().dismissToast(id), 3500);
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
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

  setInspectorOpen(open) {
    set({ inspectorOpen: open });
  },

  toggleInspector() {
    set((s) => ({ inspectorOpen: !s.inspectorOpen }));
  },

  setHoist(id) {
    set({ hoistId: id });
  },

  setSketch(on) {
    set({ sketch: on });
  },

  bumpMeasureEpoch() {
    set((s) => ({ measureEpoch: s.measureEpoch + 1 }));
  },

  openSearch() {
    set((s) => ({ searchOpen: true, searchQuery: s.filterQuery ?? '' }));
  },

  closeSearch() {
    set({ searchOpen: false, searchQuery: '' });
  },

  setSearchQuery(query) {
    set({ searchQuery: query });
  },

  setFilterQuery(query) {
    set({ filterQuery: query });
  },





}));
