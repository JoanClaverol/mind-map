import { api } from '../api/client';
import { getGalleryDom } from '../gallery/galleryDom';
import { refreshGallery } from '../gallery/galleryData';
import { getLastOpened } from '../gallery/recents';
import { buildSections, visibleOrder } from '../gallery/sections';
import { splitBalanced } from '../layout/layout';
import { branchStyleOf, buildParentMap, effectiveStyleAt, newId } from '../model/doc';
import { branchToMarkdown, markdownToBranches } from '../model/markdown';
import { viewScope } from '../model/search';
import { BRANCH_STYLES, LAYOUT_LABELS, LAYOUT_STYLES, type BranchStyle, type MapMeta } from '../model/types';
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
  // The hoisted node acts as the root: its real siblings are off-canvas.
  const parentId = s.selectedId === s.hoistId ? undefined : parents[s.selectedId];
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
  if (id === s.hoistId) return; // the hoisted node's parent is off-canvas
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
 * The structure that arranges `id` among its siblings, as rendered: the
 * effective style of its parent (branch overrides included), hoist-aware.
 * With no overrides this is exactly doc.layout — behavior is unchanged.
 */
function structureAt(id: string): { style: string; rootId: string; parents: Record<string, string> } {
  const s = state();
  const viewDoc = viewScope(s.doc!, s.hoistId);
  const parents = buildParentMap(viewDoc);
  const parentId = id === viewDoc.rootId ? undefined : parents[id];
  return { style: effectiveStyleAt(viewDoc, parentId ?? id, parents), rootId: viewDoc.rootId, parents };
}

/** Root of the timeline structure `id` sits in: the override node that introduced it, else the view root. */
function timelineRootOf(id: string, rootId: string, parents: Record<string, string>): string {
  const s = state();
  const viewDoc = viewScope(s.doc!, s.hoistId);
  let cur = id;
  while (cur !== rootId) {
    const p: string | undefined = parents[cur];
    if (p === undefined) break; // floating root
    if (branchStyleOf(viewDoc, cur) === 'timeline' && effectiveStyleAt(viewDoc, p, parents) !== 'timeline') break;
    cur = p;
  }
  return cur;
}

/**
 * hjkl/arrows mean screen direction; the tree operation they map to depends on
 * the structure the node sits in (map layout or a branch override) and, in
 * balanced, on which side of the root the node sits (left-side branches
 * mirror: deeper is always away from the root on screen).
 */
function navScreen(dirKey: ScreenDir): void {
  withSelection((id) => {
    const { style, rootId, parents } = structureAt(id);
    if (style === 'timeline') {
      // The structure root and its phases sit on the horizontal axis; column
      // rows are an outline. Generalized to branch timelines via their root.
      const tlRoot = timelineRootOf(id, rootId, parents);
      const phaseRow = id === tlRoot || parents[id] === tlRoot;
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
      if (id === rootId) return selectBalancedHalf(id, dirKey);
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
    if (id === s.doc!.rootId || id === s.hoistId) return;
    const { style, rootId, parents } = structureAt(id);
    if (style === 'timeline') {
      if (parents[id] === timelineRootOf(id, rootId, parents)) {
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

/**
 * Pick a spot for a new floating tree: the view center, nudged below the
 * content bounds when the center would land on (or too near) existing nodes.
 */
function floatingTreeSpot(): { x: number; y: number } {
  const s = state();
  const { w, h } = hostSize();
  const center = {
    x: (w / 2 - s.viewport.x) / s.viewport.zoom - 30,
    y: (h / 2 - s.viewport.y) / s.viewport.zoom - 14,
  };
  const layout = getLastLayout();
  if (!layout) return center;
  const CLEAR = 40;
  for (const r of layout.rects.values()) {
    if (
      center.x > r.x - CLEAR &&
      center.x < r.x + r.w + CLEAR &&
      center.y > r.y - CLEAR &&
      center.y < r.y + r.h + CLEAR
    ) {
      return { x: layout.bounds.x, y: layout.bounds.y + layout.bounds.h + 80 };
    }
  }
  return center;
}

export const registry: Record<string, AppCommand> = {
  'tree.addFloating': {
    description: 'Add a floating tree at the view center and edit it',
    run: () => {
      const s = state();
      if (!s.doc) return;
      if (s.hoistId) {
        s.addToast('info', 'Floating trees are hidden while hoisted — Esc to exit first');
        return;
      }
      s.runCommand('addFloatingTree', (d) => cmd.addFloatingTree(d, floatingTreeSpot()));
      state().startEdit('replace');
    },
  },
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
        if (id === s.doc!.rootId || id === s.hoistId) return;
        s.runCommand('addSiblingBelow', (d) => cmd.addSibling(d, id, 1));
        state().startEdit('replace');
      }),
  },
  'node.addSiblingAbove': {
    description: 'Add a sibling above and edit it',
    run: () =>
      withSelection((id) => {
        const s = state();
        if (id === s.doc!.rootId || id === s.hoistId) return;
        s.runCommand('addSiblingAbove', (d) => cmd.addSibling(d, id, 0));
        state().startEdit('replace');
      }),
  },
  'node.toggleInspector': {
    description: 'Inspect the selected node (color, icon, note, tags)',
    run: () => state().toggleInspector(),
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
  'node.cycleStyle': {
    description: 'Cycle branch structure (inherit → right → org chart → roadmap)',
    run: () =>
      withSelection((id) => {
        const s = state();
        if (id === s.doc!.rootId) {
          // On the map root a branch override is meaningless — cycle the map.
          registry['map.cycleLayout'].run();
          return;
        }
        const cur = branchStyleOf(s.doc!, id);
        const next: BranchStyle | undefined =
          cur === undefined ? BRANCH_STYLES[0] : BRANCH_STYLES[BRANCH_STYLES.indexOf(cur) + 1];
        s.runCommand('setNodeStyle', (d) => cmd.setNodeMeta(d, id, { style: next ?? null }));
        s.addToast('info', next ? `Branch: ${LAYOUT_LABELS[next]}` : 'Branch: inherit');
      }),
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
  'view.search': {
    description: 'Search nodes — dims non-matches; Enter jumps, ⇧Enter pins the filter',
    run: () => {
      if (state().doc) state().openSearch();
    },
  },
  'view.hoist': {
    description: 'Hoist the selected branch (on the hoisted root: back up one level)',
    run: () =>
      withSelection((id) => {
        const s = state();
        if (id === s.hoistId) {
          runCommandById('view.unhoist');
          return;
        }
        if (id === s.doc!.rootId) return;
        s.setHoist(id);
        s.requestFit();
      }),
  },
  'view.unhoist': {
    description: 'Unhoist one level (back toward the full map)',
    run: () => {
      const s = state();
      if (!s.doc || !s.hoistId) return;
      const parentId = buildParentMap(s.doc)[s.hoistId];
      s.setHoist(parentId && parentId !== s.doc.rootId ? parentId : null);
      s.requestFit();
    },
  },
  'view.backToGallery': {
    description: 'Back out one layer: clear the filter, exit hoist, then the gallery',
    run: () => {
      const s = state();
      if (s.filterQuery) {
        s.setFilterQuery(null);
        return;
      }
      if (s.hoistId) {
        s.setHoist(null);
        s.requestFit();
        return;
      }
      window.location.hash = '#/';
    },
  },
  'view.toggleHelp': {
    description: 'Show or hide the keyboard cheatsheet',
    run: () => state().toggleHelp(),
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
