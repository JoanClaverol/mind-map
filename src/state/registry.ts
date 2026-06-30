import { api } from '../api/client';
import { transcribeBlob } from '../audio/flow';
import { startRecording, stopRecording } from '../audio/recorder';
import { getGalleryDom } from '../gallery/galleryDom';
import { refreshGallery } from '../gallery/galleryData';
import { getLastOpened } from '../gallery/recents';
import { buildSections, visibleOrder } from '../gallery/sections';
import { splitBalanced } from '../layout/layout';
import { buildParentMap, newId } from '../model/doc';
import { branchToMarkdown, markdownToBranches } from '../model/markdown';
import { LAYOUT_LABELS, LAYOUT_STYLES, type MapMeta } from '../model/types';
import { getCanvasHost, getLastLayout } from '../canvas/layoutCache';
import { fitToContent, zoomAt } from '../canvas/viewport';
import * as cmd from './commands';
import { useStore } from './store';

/**
 * Every user-invokable action, addressable by id. Hotkeys resolve to these ids,
 * which is what makes user-defined keymaps possible: bindings are plain data.
 */
export interface AppCommand {
  description: string;
  run(arg?: unknown): void;
}

function state() {
  return useStore.getState();
}

function withSelection(fn: (selectedId: string) => void): void {
  const s = state();
  if (s.doc && s.selectedId && s.doc.nodes[s.selectedId]) fn(s.selectedId);
}

function navSibling(dir: 1 | -1, axis: 'y' | 'x' = 'y'): void {
  const s = state();
  if (!s.doc || !s.selectedId) return;
  const parents = buildParentMap(s.doc);
  const parentId = parents[s.selectedId];
  if (parentId) {
    const siblings = s.doc.nodes[parentId].children;
    const next = siblings[siblings.indexOf(s.selectedId) + dir];
    if (next) {
      s.select(next);
      return;
    }
  }
  // Spatial fallback: nearest visible node strictly beyond on the sibling axis.
  const layout = getLastLayout();
  const current = layout?.rects.get(s.selectedId);
  if (!layout || !current) return;
  const cx = current.x + current.w / 2;
  const cy = current.y + current.h / 2;
  let best: string | null = null;
  let bestScore = Infinity;
  for (const [id, r] of layout.rects) {
    if (id === s.selectedId) continue;
    const main = axis === 'y' ? r.y + r.h / 2 - cy : r.x + r.w / 2 - cx;
    const cross = axis === 'y' ? r.x + r.w / 2 - cx : r.y + r.h / 2 - cy;
    if (dir === 1 ? main <= 1 : main >= -1) continue;
    const score = Math.abs(main) + 0.5 * Math.abs(cross);
    if (score < bestScore) {
      bestScore = score;
      best = id;
    }
  }
  if (best) s.select(best);
}

type ScreenDir = 'left' | 'right' | 'up' | 'down';

function selectParent(id: string): void {
  const s = state();
  const parentId = buildParentMap(s.doc!)[id];
  if (parentId) s.select(parentId);
}

function selectFirstChild(id: string): void {
  const s = state();
  const node = s.doc!.nodes[id];
  if (node.children.length === 0) return;
  if (node.collapsed) s.runCommand('expand', (d) => cmd.expandNode(d, id));
  s.select(node.children[0]);
}

/** Balanced root: jump into the chosen half of its children. */
function selectBalancedHalf(id: string, side: 'left' | 'right'): void {
  const s = state();
  const node = s.doc!.nodes[id];
  const half = splitBalanced(node.children)[side];
  if (half.length === 0) return;
  if (node.collapsed) s.runCommand('expand', (d) => cmd.expandNode(d, id));
  s.select(half[0]);
}

/**
 * hjkl/arrows mean screen direction; the tree operation they map to depends on
 * the layout style and, in balanced, on which side of the root the node sits
 * (left-side branches mirror: deeper is always away from the root on screen).
 */
function navScreen(dirKey: ScreenDir): void {
  withSelection((id) => {
    const s = state();
    const style = s.doc!.layout;
    if (style === 'timeline') {
      // Root and phases sit on the horizontal axis; column rows are an outline.
      const phaseRow = id === s.doc!.rootId || buildParentMap(s.doc!)[id] === s.doc!.rootId;
      if (phaseRow) {
        if (dirKey === 'up') return selectParent(id);
        if (dirKey === 'down') return selectFirstChild(id);
        return navSibling(dirKey === 'right' ? 1 : -1, 'x');
      }
      if (dirKey === 'up' || dirKey === 'down') return navSibling(dirKey === 'down' ? 1 : -1);
      return dirKey === 'left' ? selectParent(id) : selectFirstChild(id);
    }
    if (style === 'down') {
      if (dirKey === 'up') return selectParent(id);
      if (dirKey === 'down') return selectFirstChild(id);
      return navSibling(dirKey === 'right' ? 1 : -1, 'x');
    }
    if (dirKey === 'up' || dirKey === 'down') return navSibling(dirKey === 'down' ? 1 : -1);
    if (style === 'balanced') {
      if (id === s.doc!.rootId) return selectBalancedHalf(id, dirKey);
      if ((getLastLayout()?.dirs.get(id) ?? 'right') === 'left') {
        return dirKey === 'left' ? selectFirstChild(id) : selectParent(id);
      }
    }
    return dirKey === 'left' ? selectParent(id) : selectFirstChild(id);
  });
}

function reorderSibling(id: string, dir: 1 | -1): void {
  const s = state();
  const parentId = buildParentMap(s.doc!)[id];
  if (!parentId) return;
  const siblings = s.doc!.nodes[parentId].children;
  const idx = siblings.indexOf(id);
  if (dir === 1) {
    if (idx >= siblings.length - 1) return;
    const anchor = siblings[idx + 2] ?? null;
    s.runCommand('moveDown', (d) => cmd.moveNode(d, id, parentId, anchor));
  } else {
    if (idx === 0) return; // a null anchor would append — keep top-boundary a no-op
    s.runCommand('moveUp', (d) => cmd.moveNode(d, id, parentId, siblings[idx - 1]));
  }
}

function indentNode(id: string): void {
  const s = state();
  const parentId = buildParentMap(s.doc!)[id];
  if (!parentId) return;
  const siblings = s.doc!.nodes[parentId].children;
  const idx = siblings.indexOf(id);
  if (idx === 0) return;
  s.runCommand('indent', (d) => cmd.moveNode(d, id, siblings[idx - 1], null));
}

function outdentNode(id: string): void {
  const s = state();
  const parents = buildParentMap(s.doc!);
  const parentId = parents[id];
  if (!parentId) return;
  const grandParentId = parents[parentId];
  if (!grandParentId) return; // parent is the root
  const parentSiblings = s.doc!.nodes[grandParentId].children;
  const anchor = parentSiblings[parentSiblings.indexOf(parentId) + 1] ?? null;
  s.runCommand('outdent', (d) => cmd.moveNode(d, id, grandParentId, anchor));
}

/** Same screen-direction translation as navScreen, for ⇧HJKL moves. */
function moveScreen(dirKey: ScreenDir): void {
  withSelection((id) => {
    const s = state();
    if (id === s.doc!.rootId) return;
    const style = s.doc!.layout;
    if (style === 'timeline') {
      if (buildParentMap(s.doc!)[id] === s.doc!.rootId) {
        // Phase: reorder along the axis; ⇧J demotes it into the previous column.
        if (dirKey === 'up') return outdentNode(id); // parent is root → no-op
        if (dirKey === 'down') return indentNode(id);
        return reorderSibling(id, dirKey === 'right' ? 1 : -1);
      }
      if (dirKey === 'up' || dirKey === 'down') return reorderSibling(id, dirKey === 'down' ? 1 : -1);
      return dirKey === 'right' ? indentNode(id) : outdentNode(id);
    }
    if (style === 'down') {
      if (dirKey === 'up') return outdentNode(id);
      if (dirKey === 'down') return indentNode(id);
      return reorderSibling(id, dirKey === 'right' ? 1 : -1);
    }
    if (dirKey === 'up' || dirKey === 'down') return reorderSibling(id, dirKey === 'down' ? 1 : -1);
    const mirrored = style === 'balanced' && (getLastLayout()?.dirs.get(id) ?? 'right') === 'left';
    const deeper = mirrored ? 'left' : 'right';
    return dirKey === deeper ? indentNode(id) : outdentNode(id);
  });
}

function hostSize(): { w: number; h: number } {
  const host = getCanvasHost();
  if (!host) return { w: window.innerWidth, h: window.innerHeight };
  const rect = host.getBoundingClientRect();
  return { w: rect.width, h: rect.height };
}

/** The gallery's current j/k traversal order (sections or search results). */
function galleryOrder(): MapMeta[] {
  const s = state();
  if (!s.galleryMaps) return [];
  return visibleOrder(s.galleryMaps, s.gallerySearch, getLastOpened(), s.galleryFolders ?? [], s.galleryCollapsed);
}

/** The collapse key of the collapsible section a map sits in, or null. */
function sectionKeyOf(mapId: string): string | null {
  const s = state();
  if (!s.galleryMaps) return null;
  const section = buildSections(s.galleryMaps, getLastOpened(), s.galleryFolders ?? []).find((sec) =>
    sec.items.some((m) => m.id === mapId),
  );
  return section && section.collapsible ? section.key : null;
}

function moveGallerySelection(dir: 1 | -1): void {
  const s = state();
  const order = galleryOrder();
  if (order.length === 0) return;
  const idx = order.findIndex((m) => m.id === s.gallerySelectedId);
  const next = idx === -1 ? (dir === 1 ? 0 : order.length - 1) : Math.min(Math.max(idx + dir, 0), order.length - 1);
  s.selectGalleryMap(order[next].id);
}

function withGallerySelection(fn: (m: MapMeta) => void): void {
  const s = state();
  const selected = s.galleryMaps?.find((m) => m.id === s.gallerySelectedId);
  if (selected) fn(selected);
}

export const registry: Record<string, AppCommand> = {
  'node.addChild': {
    description: 'Add a child node and edit it',
    run: () =>
      withSelection((id) => {
        state().runCommand('addChild', (d) => cmd.addChild(d, id));
        state().startEdit('replace');
      }),
  },
  'node.addSiblingBelow': {
    description: 'Add a sibling below and edit it',
    run: () =>
      withSelection((id) => {
        const s = state();
        if (id === s.doc!.rootId) return;
        s.runCommand('addSiblingBelow', (d) => cmd.addSibling(d, id, 1));
        state().startEdit('replace');
      }),
  },
  'node.addSiblingAbove': {
    description: 'Add a sibling above and edit it',
    run: () =>
      withSelection((id) => {
        const s = state();
        if (id === s.doc!.rootId) return;
        s.runCommand('addSiblingAbove', (d) => cmd.addSibling(d, id, 0));
        state().startEdit('replace');
      }),
  },
  'node.editAppend': {
    description: 'Edit the selected node (cursor at end)',
    run: () => state().startEdit('append'),
  },
  'node.editReplace': {
    description: 'Edit the selected node, replacing its text',
    run: (arg) => state().startEdit('replace', typeof arg === 'string' ? arg : undefined),
  },
  'node.deleteSubtree': {
    description: 'Delete the selected node and its subtree',
    run: () => withSelection((id) => state().runCommand('deleteSubtree', (d) => cmd.deleteSubtree(d, id))),
  },
  'node.toggleCollapse': {
    description: 'Collapse or expand the selected branch',
    run: () => withSelection((id) => state().runCommand('toggleCollapse', (d) => cmd.toggleCollapse(d, id))),
  },
  'node.moveDown': {
    description: 'Move the node downward on screen (reorder, or nest in org chart)',
    run: () => moveScreen('down'),
  },
  'node.moveUp': {
    description: 'Move the node upward on screen (reorder, or un-nest in org chart)',
    run: () => moveScreen('up'),
  },
  'node.moveLeft': {
    description: 'Move the node leftward on screen (un-nest, nest, or reorder by style)',
    run: () => moveScreen('left'),
  },
  'node.moveRight': {
    description: 'Move the node rightward on screen (nest, un-nest, or reorder by style)',
    run: () => moveScreen('right'),
  },
  'node.indent': {
    description: 'Nest the node under its previous sibling',
    run: () => withSelection(indentNode),
  },
  'node.outdent': {
    description: 'Move the node out, next to its parent',
    run: () => withSelection(outdentNode),
  },
  'nav.parent': {
    description: 'Select the parent node',
    run: () => withSelection(selectParent),
  },
  'nav.firstChild': {
    description: 'Select the first child (expands a collapsed branch)',
    run: () => withSelection(selectFirstChild),
  },
  'nav.left': { description: 'Select leftward on screen', run: () => navScreen('left') },
  'nav.right': { description: 'Select rightward on screen', run: () => navScreen('right') },
  'nav.down': { description: 'Select downward on screen', run: () => navScreen('down') },
  'nav.up': { description: 'Select upward on screen', run: () => navScreen('up') },
  'link.start': {
    description: 'Draw an arrow from the selected node — then move to a target and Enter',
    run: () => state().startLinking(),
  },
  'link.confirm': {
    description: 'Create the arrow to the highlighted node and edit its label',
    run: () => {
      const s = state();
      if (!s.linking || !s.doc) return;
      const sourceId = s.linking.sourceId;
      const target = s.selectedId;
      if (!target || target === sourceId) {
        s.cancelLinking();
        return;
      }
      const existing = s.doc.relationships.find((r) => r.from === sourceId && r.to === target);
      const id = existing ? existing.id : newId();
      if (!existing) {
        s.runCommand('addRelationship', (d) => cmd.addRelationship(d, sourceId, target, id));
      }
      state().cancelLinking();
      state().startEditRel(id);
    },
  },
  'link.cancel': {
    description: 'Cancel drawing the arrow',
    run: () => state().cancelLinking(),
  },
  'link.editLabel': {
    description: 'Edit the selected arrow’s label',
    run: () => {
      const s = state();
      if (s.selectedRelId) s.startEditRel(s.selectedRelId);
    },
  },
  'link.delete': {
    description: 'Delete the selected arrow',
    run: () => {
      const s = state();
      const relId = s.selectedRelId;
      if (!relId) return;
      s.runCommand('deleteRelationship', (d) => cmd.deleteRelationship(d, relId));
      state().selectRelationship(null);
    },
  },
  'link.deselect': {
    description: 'Deselect the arrow',
    run: () => state().selectRelationship(null),
  },
  'clipboard.copyBranch': {
    description: 'Copy the selected branch as a markdown outline',
    run: () =>
      withSelection((id) => {
        const s = state();
        const markdown = branchToMarkdown(s.doc!, id);
        navigator.clipboard.writeText(markdown).then(
          () => state().addToast('success', 'Branch copied as markdown'),
          () => state().addToast('error', 'Clipboard write failed'),
        );
      }),
  },
  'clipboard.cutBranch': {
    description: 'Cut the selected branch (copy as markdown, then delete)',
    run: () =>
      withSelection((id) => {
        const s = state();
        const markdown = branchToMarkdown(s.doc!, id);
        navigator.clipboard.writeText(markdown).then(
          () => {
            const now = state();
            if (id === now.doc!.rootId) {
              now.addToast('info', 'Root copied — it cannot be cut');
              return;
            }
            now.runCommand('cutBranch', (d) => cmd.deleteSubtree(d, id));
          },
          () => state().addToast('error', 'Clipboard write failed'),
        );
      }),
  },
  'clipboard.paste': {
    description: 'Paste a markdown outline (or plain text) as children',
    run: () =>
      withSelection((id) => {
        navigator.clipboard.readText().then(
          (text) => {
            const branches = markdownToBranches(text);
            if (branches.length === 0) {
              state().addToast('info', 'Clipboard is empty');
              return;
            }
            state().runCommand('pasteBranches', (d) => cmd.pasteBranches(d, id, branches));
          },
          () => state().addToast('error', 'Clipboard read failed — allow clipboard access for this site'),
        );
      }),
  },
  'history.undo': { description: 'Undo', run: () => state().undo() },
  'history.redo': { description: 'Redo', run: () => state().redo() },
  'audio.toggleRecord': {
    description: 'Start/stop voice recording (transcript becomes nodes)',
    run: () => {
      const s = state();
      if (!s.doc || s.editing) return;
      if (s.audio?.phase === 'recording') {
        stopRecording().then((rec) => {
          if (!rec) {
            state().setAudio(null);
            state().addToast('info', 'Nothing recorded');
            return;
          }
          void transcribeBlob(rec.blob, rec.filename);
        });
        return;
      }
      if (s.audio) return; // panel open or transcribing — no-op
      startRecording().then(
        () => state().setAudio({ phase: 'recording', startedAt: Date.now() }),
        (err: Error) => state().addToast('error', `Microphone unavailable: ${err.message}`),
      );
    },
  },
  'todo.push': {
    description: 'Push the selected node as a todo into segon-cervell',
    run: () =>
      withSelection((id) => {
        const s = state();
        const node = s.doc!.nodes[id];
        if (node.todoId) {
          s.addToast('info', 'Already pushed — todo exists in segon-cervell');
          return;
        }
        if (s.pendingTodo.includes(id)) return;
        const text = node.text.trim();
        if (!text) {
          s.addToast('info', 'Node is empty — nothing to push');
          return;
        }
        s.setTodoPending(id, true);
        api.pushTodo(text).then(
          ({ todoId }) => {
            const now = state();
            now.setTodoPending(id, false);
            if (now.doc?.nodes[id]) {
              now.runCommand('setTodoId', (d) => cmd.setTodoId(d, id, todoId));
            }
            now.addToast('success', `Todo created: ${text}`);
          },
          (err: Error) => {
            state().setTodoPending(id, false);
            state().addToast('error', `Todo push failed: ${err.message}`);
          },
        );
      }),
  },
  'note.push': {
    description: 'Save the selected branch as a note in segon-cervell',
    run: () =>
      withSelection((id) => {
        const s = state();
        if (s.pendingNote.includes(id)) return;
        const title = s.doc!.nodes[id].text.replace(/\s+/g, ' ').trim();
        if (!title) {
          s.addToast('info', 'Node is empty — nothing to save');
          return;
        }
        s.setNotePending(id, true);
        s.addToast('info', 'Saving branch to segon-cervell…');
        api.saveNote(title, branchToMarkdown(s.doc!, id)).then(
          () => {
            state().setNotePending(id, false);
            state().addToast('success', `Note saved: ${title}`);
          },
          (err: Error) => {
            state().setNotePending(id, false);
            state().addToast('error', `Note save failed: ${err.message}`);
          },
        );
      }),
  },
  'map.cycleLayout': {
    description: 'Cycle layout structure (right → balanced → org chart → roadmap)',
    run: () => {
      const s = state();
      if (!s.doc) return;
      const next = LAYOUT_STYLES[(LAYOUT_STYLES.indexOf(s.doc.layout) + 1) % LAYOUT_STYLES.length];
      s.runCommand('setLayout', (d) => cmd.setLayoutStyle(d, next));
      s.requestFit(); // fires after the new layout is computed — view.fit here would read the stale one
      s.addToast('info', `Structure: ${LAYOUT_LABELS[next]}`);
    },
  },
  'view.zoomIn': {
    description: 'Zoom in',
    run: () => {
      const { w, h } = hostSize();
      state().setViewport(zoomAt(state().viewport, 1.2, w / 2, h / 2));
    },
  },
  'view.zoomOut': {
    description: 'Zoom out',
    run: () => {
      const { w, h } = hostSize();
      state().setViewport(zoomAt(state().viewport, 1 / 1.2, w / 2, h / 2));
    },
  },
  'view.fit': {
    description: 'Fit the whole map in view',
    run: () => {
      const layout = getLastLayout();
      if (!layout) return;
      const { w, h } = hostSize();
      state().setViewport(fitToContent(layout.bounds, w, h));
    },
  },
  'view.backToGallery': {
    description: 'Back to the map gallery',
    run: () => {
      window.location.hash = '#/';
    },
  },
  'view.toggleHelp': {
    description: 'Show or hide the keyboard cheatsheet',
    run: () => state().toggleHelp(),
  },
  'chat.toggle': {
    description: 'Ask questions about this map',
    run: () => {
      const s = state();
      s.setChatOpen(!s.chatOpen);
    },
  },
  'gallery.down': {
    description: 'Select the next map',
    run: () => moveGallerySelection(1),
  },
  'gallery.up': {
    description: 'Select the previous map',
    run: () => moveGallerySelection(-1),
  },
  'gallery.open': {
    description: 'Open the selected map',
    run: () =>
      withGallerySelection((m) => {
        window.location.hash = `#/map/${m.id}`;
      }),
  },
  'gallery.new': {
    description: 'Start a new map (focus the title input)',
    run: () => getGalleryDom()?.newTitle.focus(),
  },
  'gallery.rename': {
    description: 'Rename the selected map',
    run: () => withGallerySelection((m) => state().setGalleryRenaming(m.id)),
  },
  'gallery.delete': {
    description: 'Delete the selected map (asks to confirm)',
    run: () =>
      withGallerySelection((m) => {
        if (!window.confirm(`Delete "${m.title}" (${m.nodeCount} nodes)? This cannot be undone.`)) return;
        const order = galleryOrder();
        const idx = order.findIndex((o) => o.id === m.id);
        const neighbor = order[idx + 1] ?? order[idx - 1] ?? null;
        api.deleteMap(m.id).then(
          () => {
            state().selectGalleryMap(neighbor?.id ?? null);
            void refreshGallery();
            getGalleryDom()?.root.focus();
          },
          (err: Error) => state().addToast('error', `Delete failed: ${err.message}`),
        );
      }),
  },
  'gallery.togglePin': {
    description: 'Pin or unpin the selected map',
    run: () =>
      withGallerySelection((m) => {
        api.setPinned(m.id, !m.pinned).then(
          () => void refreshGallery(),
          (err: Error) => state().addToast('error', `Pin failed: ${err.message}`),
        );
      }),
  },
  'gallery.search': {
    description: 'Search maps by title',
    run: () => getGalleryDom()?.search.focus(),
  },
  'gallery.dismiss': {
    description: 'Clear the search filter',
    run: () => {
      if (state().gallerySearch) state().setGallerySearch('');
    },
  },
  'gallery.move': {
    description: 'Move the selected map to a folder',
    run: () => withGallerySelection((m) => state().openFolderPicker(m.id)),
  },
  'gallery.newFolder': {
    description: 'Create a new folder (focus the folder input)',
    run: () => getGalleryDom()?.newFolder.focus(),
  },
  'gallery.renameFolder': {
    description: 'Rename the selected map’s folder',
    run: () =>
      withGallerySelection((m) => {
        if (!m.folder) {
          state().addToast('info', 'Map has no folder — move it into one first');
          return;
        }
        const next = window.prompt(`Rename folder “${m.folder}” to:`, m.folder);
        if (next === null) return;
        const name = next.trim();
        if (!name || name === m.folder) return;
        api.renameFolder(m.folder, name).then(
          () => void refreshGallery(),
          (err: Error) => state().addToast('error', `Rename folder failed: ${err.message}`),
        );
      }),
  },
  'gallery.deleteFolder': {
    description: 'Delete the selected map’s folder (its maps move to Uncategorized)',
    run: () =>
      withGallerySelection((m) => {
        if (!m.folder) {
          state().addToast('info', 'Map has no folder');
          return;
        }
        if (!window.confirm(`Delete folder “${m.folder}”? Its maps move to Uncategorized.`)) return;
        api.deleteFolder(m.folder).then(
          () => void refreshGallery(),
          (err: Error) => state().addToast('error', `Delete folder failed: ${err.message}`),
        );
      }),
  },
  'gallery.collapseFolder': {
    description: 'Collapse the selected map’s folder',
    run: () =>
      withGallerySelection((m) => {
        const key = sectionKeyOf(m.id);
        if (key && !state().galleryCollapsed.has(key)) state().toggleGalleryCollapsed(key);
      }),
  },
  'gallery.expandFolder': {
    description: 'Expand the selected map’s folder',
    run: () =>
      withGallerySelection((m) => {
        const key = sectionKeyOf(m.id);
        if (key && state().galleryCollapsed.has(key)) state().toggleGalleryCollapsed(key);
      }),
  },
};

export function runCommandById(id: string, arg?: unknown): boolean {
  const command = registry[id];
  if (!command) return false;
  command.run(arg);
  return true;
}
