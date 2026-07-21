import { useEffect, useMemo, useRef, useState } from 'react';
import { buildIndex, comboFromEvent, isPrintable, resolveCommand } from '../hotkeys/dispatcher';
import { DEFAULT_KEYMAP, loadKeymapOverrides, resolveKeymap } from '../hotkeys/keymap';
import { layoutTree } from '../layout/layout';
import { measureText } from '../layout/measure';
import { floatingEntry, subtreeIds, visibleIds } from '../model/doc';
import { searchMatches, viewScope } from '../model/search';
import type { Position } from '../model/types';
import { addFloatingTree, detachNode, moveNode, moveTree } from '../state/commands';
import { runCommandById } from '../state/registry';
import { useStore } from '../state/store';
import { distanceToNearestRect, dropTargetsEqual, resolveDropTarget, type DropTarget } from './dnd';
import { EdgeView } from './EdgeView';
import { getLastLayout, setCanvasHost, setLastLayout } from './layoutCache';
import { NodeEditor } from './NodeEditor';
import { NodeView } from './NodeView';
import { RelationshipLabelEditor } from './RelationshipLabelEditor';
import { RelationshipView } from './RelationshipView';
import { relationshipGeometry } from './relationshipPath';
import { fitToContent, revealRect, screenToWorld, zoomAt } from './viewport';

const DRAG_THRESHOLD_PX = 5;
/** A drop farther than this from every node (world px) detaches the branch into a floating tree. */
const DETACH_MARGIN = 48;

interface DragRef {
  nodeId: string;
  startX: number;
  startY: number;
  /** Cursor offset inside the dragged rect at press time, so drops preserve the grab point. */
  grabDX: number;
  grabDY: number;
  started: boolean;
  /** Drag state pushed to React at least once (drives dim/cursor even with no target). */
  published: boolean;
  target: DropTarget | null;
  /** Where the dragged rect's top-left would land if released in the detach zone. */
  detachAt: Position | null;
  onMove(ev: MouseEvent): void;
  onUp(): void;
}

export function MindMapCanvas() {
  const doc = useStore((s) => s.doc);
  const selectedId = useStore((s) => s.selectedId);
  const editing = useStore((s) => s.editing);
  const linking = useStore((s) => s.linking);
  const selectedRelId = useStore((s) => s.selectedRelId);
  const editingRel = useStore((s) => s.editingRel);
  const viewport = useStore((s) => s.viewport);
  const hoistId = useStore((s) => s.hoistId);
  const searchOpen = useStore((s) => s.searchOpen);
  const searchQuery = useStore((s) => s.searchQuery);
  const filterQuery = useStore((s) => s.filterQuery);
  const hostRef = useRef<HTMLDivElement>(null);

  const dragRef = useRef<DragRef | null>(null);
  const [drag, setDrag] = useState<{ nodeId: string; target: DropTarget | null; detachAt: Position | null } | null>(
    null,
  );

  const keymapIndex = useMemo(() => buildIndex(resolveKeymap(DEFAULT_KEYMAP, loadKeymapOverrides())), []);

  // The hoisted node vanished (delete, undo, AI edit) — fall back to the full map.
  useEffect(() => {
    if (hoistId && doc && !doc.nodes[hoistId]) useStore.getState().setHoist(null);
  }, [hoistId, doc]);

  // What the canvas shows: the full doc, or just the hoisted branch (⌘.).
  const viewDoc = useMemo(() => (doc ? viewScope(doc, hoistId) : null), [doc, hoistId]);

  const layout = useMemo(() => {
    if (!viewDoc) return null;
    const ids = visibleIds(viewDoc);
    const sizes = new Map(ids.map((id) => [id, measureText(viewDoc.nodes[id].text, viewDoc.nodes[id].icon)]));
    const result = layoutTree(viewDoc, (id) => sizes.get(id)!);
    setLastLayout(result);
    return result;
  }, [viewDoc]);

  // Live search (panel open) or a pinned filter dims every non-matching node.
  const activeQuery = searchOpen ? searchQuery : (filterQuery ?? '');
  const matchSet = useMemo(
    () => (viewDoc && activeQuery.trim() ? new Set(searchMatches(viewDoc, activeQuery)) : null),
    [viewDoc, activeQuery],
  );

  const draggedId = drag?.nodeId ?? null;
  const draggedSubtree = useMemo(
    () => (draggedId && doc ? new Set(subtreeIds(doc, draggedId)) : null),
    [draggedId, doc],
  );
  const floatingRoots = useMemo(() => new Set(viewDoc?.floating.map((f) => f.rootId)), [viewDoc]);

  useEffect(() => {
    setCanvasHost(hostRef.current);
    hostRef.current?.focus();
    return () => setCanvasHost(null);
  }, []);

  const cancelDrag = () => {
    const d = dragRef.current;
    if (d) {
      window.removeEventListener('mousemove', d.onMove);
      window.removeEventListener('mouseup', d.onUp);
    }
    dragRef.current = null;
    setDrag(null);
  };

  // Window listeners must not outlive the canvas (e.g. navigation mid-drag).
  useEffect(() => cancelDrag, []);

  const handleNodePress = (nodeId: string, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    useStore.getState().select(nodeId);
    hostRef.current?.focus();
    cancelDrag(); // stale listeners from an interrupted gesture
    const pressState = useStore.getState();
    const pressRect = getLastLayout()?.rects.get(nodeId);
    const pressWorld = hostRef.current
      ? screenToWorld(pressState.viewport, hostRef.current.getBoundingClientRect(), e.clientX, e.clientY)
      : null;
    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current;
      const host = hostRef.current;
      if (!d || !host) return;
      if (!d.started) {
        if (Math.hypot(ev.clientX - d.startX, ev.clientY - d.startY) < DRAG_THRESHOLD_PX) return;
        if (useStore.getState().editing) return;
        d.started = true;
      }
      // Live reads: selection-reveal pans at press time, edit-commit on
      // mousedown can replace doc and layout — closures would be stale.
      const s = useStore.getState();
      const currentLayout = getLastLayout();
      if (!s.doc || !currentLayout) return;
      const { x: wx, y: wy } = screenToWorld(s.viewport, host.getBoundingClientRect(), ev.clientX, ev.clientY);
      let target = resolveDropTarget(s.doc, currentLayout, d.nodeId, wx, wy);
      // Hoisted view: the hoisted root's real parent is off-canvas — a sibling
      // drop beside it would land the branch somewhere invisible. Reject it.
      if (target && !currentLayout.rects.has(target.parentId)) target = null;
      // Far from every node = the detach zone (drop becomes a floating tree there).
      // The main root never detaches; the margin keeps sloppy drops harmless.
      // Hoisted views hide floating trees, so detaching there is disabled too.
      let detachAt: Position | null = null;
      if (!target && d.nodeId !== s.doc.rootId && !s.hoistId && distanceToNearestRect(currentLayout, wx, wy) >= DETACH_MARGIN) {
        detachAt = { x: wx - d.grabDX, y: wy - d.grabDY };
      }
      const changed =
        !dropTargetsEqual(target, d.target) ||
        detachAt?.x !== d.detachAt?.x ||
        detachAt?.y !== d.detachAt?.y;
      d.target = target;
      d.detachAt = detachAt;
      if (!d.published || changed) {
        d.published = true;
        setDrag({ nodeId: d.nodeId, target, detachAt });
      }
    };
    const onUp = () => {
      const d = dragRef.current;
      cancelDrag();
      if (!d?.started) return;
      const s = useStore.getState();
      if (!s.doc) return;
      if (d.target) {
        // Onto a node: reparent — or, for a floating root, attach the whole tree.
        const { parentId, beforeSiblingId } = d.target;
        s.runCommand('moveNode', (draft) => moveNode(draft, d.nodeId, parentId, beforeSiblingId));
      } else if (d.detachAt) {
        const at = d.detachAt;
        if (floatingEntry(s.doc, d.nodeId)) {
          s.runCommand('moveTree', (draft) => moveTree(draft, d.nodeId, at));
        } else {
          s.runCommand('detachNode', (draft) => detachNode(draft, d.nodeId, at));
        }
      }
    };
    dragRef.current = {
      nodeId,
      startX: e.clientX,
      startY: e.clientY,
      grabDX: pressWorld && pressRect ? pressWorld.x - pressRect.x : 0,
      grabDY: pressWorld && pressRect ? pressWorld.y - pressRect.y : 0,
      started: false,
      published: false,
      target: null,
      detachAt: null,
      onMove,
      onUp,
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Wheel needs a native non-passive listener so preventDefault works.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const s = useStore.getState();
      const rect = host.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * 0.01);
        s.setViewport(zoomAt(s.viewport, factor, e.clientX - rect.left, e.clientY - rect.top));
      } else {
        s.setViewport({ ...s.viewport, x: s.viewport.x - e.deltaX, y: s.viewport.y - e.deltaY });
      }
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => host.removeEventListener('wheel', onWheel);
  }, []);

  // First open without a stored viewport → frame the whole tree.
  const needsFit = useStore((s) => s.needsFit);
  useEffect(() => {
    if (!needsFit || !layout) return;
    const host = hostRef.current;
    if (!host) return;
    const { width, height } = host.getBoundingClientRect();
    const s = useStore.getState();
    s.setViewport(fitToContent(layout.bounds, width, height));
    s.clearNeedsFit();
  }, [needsFit, layout]);

  // Pan the minimum needed to keep the selected node in view.
  useEffect(() => {
    if (!selectedId || !layout) return;
    const rect = layout.rects.get(selectedId);
    const host = hostRef.current;
    if (!rect || !host) return;
    const { width, height } = host.getBoundingClientRect();
    const s = useStore.getState();
    const next = revealRect(s.viewport, rect, width, height);
    if (next !== s.viewport) s.setViewport(next);
  }, [selectedId, layout]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (dragRef.current?.started) {
      e.preventDefault();
      if (e.key === 'Escape') cancelDrag(); // never navigate away mid-drag
      return;
    }
    // Defensive: the overlay stops propagation itself, but if the canvas kept
    // focus, Esc must close the cheatsheet — never leave for the gallery.
    if (useStore.getState().helpOpen) {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault();
        useStore.getState().setHelpOpen(false);
      }
      return;
    }
    const st = useStore.getState();
    if (st.editing || st.editingRel) return; // an editor owns the keyboard
    const combo = comboFromEvent(e);
    // Drawing an arrow or with one selected swaps in a mode-specific keymap.
    const context = st.linking ? 'link' : st.selectedRelId ? 'relsel' : 'nav';
    const commandId = resolveCommand(keymapIndex, context, combo);
    if (commandId) {
      e.preventDefault();
      runCommandById(commandId);
      return;
    }
    // Type-to-edit is a navigation-only fallback; never while linking or with an arrow selected.
    if (context === 'nav' && isPrintable(e)) {
      e.preventDefault();
      runCommandById('node.editReplace', e.key);
    }
  };

  const panState = useRef<{ startX: number; startY: number; vpX: number; vpY: number } | null>(null);
  const onMouseDown = (e: React.MouseEvent) => {
    // Only drag-pan when the press starts on empty canvas (nodes/arrows stopPropagation).
    useStore.getState().selectRelationship(null); // clicking blank canvas deselects an arrow
    panState.current = { startX: e.clientX, startY: e.clientY, vpX: viewport.x, vpY: viewport.y };
    const onMove = (ev: MouseEvent) => {
      const d = panState.current;
      if (!d) return;
      useStore.getState().setViewport({
        ...useStore.getState().viewport,
        x: d.vpX + (ev.clientX - d.startX),
        y: d.vpY + (ev.clientY - d.startY),
      });
    };
    const onUp = () => {
      panState.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Double-click on empty canvas creates a floating tree right there.
  const onHostDoubleClick = (e: React.MouseEvent) => {
    const host = hostRef.current;
    if (!host) return;
    const s = useStore.getState();
    if (!s.doc || s.editing) return;
    if (s.hoistId) {
      s.addToast('info', 'Floating trees are hidden while hoisted — Esc to exit first');
      return;
    }
    const p = screenToWorld(s.viewport, host.getBoundingClientRect(), e.clientX, e.clientY);
    s.runCommand('addFloatingTree', (draft) => addFloatingTree(draft, p));
    useStore.getState().startEdit('replace');
  };

  if (!doc || !viewDoc || !layout) return <div className="canvas-host" ref={hostRef} />;

  const editingRect = editing ? layout.rects.get(editing.nodeId) : undefined;
  const indicator = drag?.target?.indicator ?? null;
  const intoRect = indicator?.kind === 'into' ? layout.rects.get(indicator.nodeId) : undefined;
  // Ghost of the dragged node at its would-be floating position.
  const detachRect = drag?.detachAt && draggedId ? layout.rects.get(draggedId) : undefined;

  // Live preview while drawing an arrow: source → the moving target cursor.
  const linkSourceId = linking?.sourceId ?? null;
  const linkFrom = linkSourceId ? layout.rects.get(linkSourceId) : undefined;
  const linkTo = selectedId && selectedId !== linkSourceId ? layout.rects.get(selectedId) : undefined;
  const pendingArrow = linkFrom && linkTo ? relationshipGeometry(linkFrom, linkTo).d : null;

  // Where the label editor floats, if open.
  const editingRelData = editingRel ? doc.relationships.find((r) => r.id === editingRel.relId) : undefined;
  const editFrom = editingRelData ? layout.rects.get(editingRelData.from) : undefined;
  const editTo = editingRelData ? layout.rects.get(editingRelData.to) : undefined;
  const editingRelMid = editFrom && editTo ? relationshipGeometry(editFrom, editTo).mid : undefined;

  return (
    <div
      className={`canvas-host${drag ? ' dragging' : ''}`}
      ref={hostRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onMouseDown={onMouseDown}
      onDoubleClick={onHostDoubleClick}
    >
      <svg width="100%" height="100%">
        <defs>
          <marker id="rel-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3.5" orient="auto">
            <path className="rel-arrow" d="M0,0 L7,3.5 L0,7 Z" />
          </marker>
          <marker id="rel-arrow-selected" markerWidth="8" markerHeight="8" refX="7" refY="3.5" orient="auto">
            <path className="rel-arrow-selected" d="M0,0 L7,3.5 L0,7 Z" />
          </marker>
        </defs>
        <g transform={`translate(${viewport.x},${viewport.y}) scale(${viewport.zoom})`}>
          {layout.axis && (
            <line
              className="timeline-axis"
              x1={layout.axis.x1}
              y1={layout.axis.y}
              x2={layout.axis.x2}
              y2={layout.axis.y}
            />
          )}
          <g className="edges">
            {[...layout.rects.keys()].flatMap((id) => {
              const node = doc.nodes[id];
              if (node.collapsed) return [];
              return node.children
                .filter((childId) => layout.rects.has(childId))
                .map((childId) => (
                  <EdgeView
                    key={`${id}-${childId}`}
                    from={layout.rects.get(id)!}
                    to={layout.rects.get(childId)!}
                    dir={layout.dirs.get(childId) ?? 'right'}
                  />
                ));
            })}
          </g>
          <g className="nodes">
            {[...layout.rects.entries()].map(([id, rect]) => (
              <NodeView
                key={id}
                node={doc.nodes[id]}
                rect={rect}
                dir={layout.dirs.get(id) ?? 'right'}
                selected={id === selectedId}
                isRoot={id === viewDoc.rootId || floatingRoots.has(id)}
                dimmed={(draggedSubtree?.has(id) ?? false) || (matchSet !== null && !matchSet.has(id))}
                linkSource={id === linkSourceId}
                onPressStart={(e) => handleNodePress(id, e)}
                onEdit={() => {
                  useStore.getState().select(id);
                  useStore.getState().startEdit('append');
                }}
                onToggleCollapse={() => runCommandById('node.toggleCollapse')}
              />
            ))}
          </g>
          <g className="relationships">
            {doc.relationships.map((rel) => {
              const from = layout.rects.get(rel.from);
              const to = layout.rects.get(rel.to);
              if (!from || !to) return null; // an endpoint is collapsed/hidden
              return (
                <RelationshipView
                  key={rel.id}
                  rel={rel}
                  from={from}
                  to={to}
                  selected={rel.id === selectedRelId}
                  onSelect={() => {
                    useStore.getState().selectRelationship(rel.id);
                    hostRef.current?.focus();
                  }}
                  onEdit={() => useStore.getState().startEditRel(rel.id)}
                />
              );
            })}
            {pendingArrow && (
              <path className="relationship pending" d={pendingArrow} markerEnd="url(#rel-arrow-selected)" />
            )}
          </g>
          {indicator?.kind === 'line' && (
            <line
              className="drop-line"
              x1={indicator.x1}
              y1={indicator.y1}
              x2={indicator.x2}
              y2={indicator.y2}
            />
          )}
          {intoRect && (
            <rect
              className="drop-into"
              x={intoRect.x - 3}
              y={intoRect.y - 3}
              width={intoRect.w + 6}
              height={intoRect.h + 6}
              rx={10}
            />
          )}
          {drag?.detachAt && detachRect && (
            <rect
              className="drop-detach"
              x={drag.detachAt.x}
              y={drag.detachAt.y}
              width={detachRect.w}
              height={detachRect.h}
              rx={8}
            />
          )}
        </g>
      </svg>
      {editing && editingRect && (
        <NodeEditor
          key={editing.nodeId}
          editing={editing}
          rect={editingRect}
          onDone={() => hostRef.current?.focus()}
        />
      )}
      {editingRel && editingRelMid && (
        <RelationshipLabelEditor
          key={editingRel.relId}
          relId={editingRel.relId}
          mid={editingRelMid}
          onDone={() => hostRef.current?.focus()}
        />
      )}
    </div>
  );
}
