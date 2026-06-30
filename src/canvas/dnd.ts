import { DEFAULT_LAYOUT, type LayoutResult, type Rect } from '../layout/layout';
import { buildParentMap, subtreeIds } from '../model/doc';
import type { Doc } from '../model/types';

export type DropIndicator =
  | { kind: 'into'; nodeId: string }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number };

export interface DropTarget {
  parentId: string;
  beforeSiblingId: string | null;
  indicator: DropIndicator;
}

export function dropTargetsEqual(a: DropTarget | null, b: DropTarget | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.parentId !== b.parentId || a.beforeSiblingId !== b.beforeSiblingId) return false;
  if (a.indicator.kind !== b.indicator.kind) return false;
  if (a.indicator.kind === 'line' && b.indicator.kind === 'line') {
    return (
      a.indicator.x1 === b.indicator.x1 &&
      a.indicator.y1 === b.indicator.y1 &&
      a.indicator.x2 === b.indicator.x2 &&
      a.indicator.y2 === b.indicator.y2
    );
  }
  return true;
}

function lineBefore(rect: Rect, gap: number, vertical: boolean): DropIndicator {
  return vertical
    ? { kind: 'line', x1: rect.x - gap / 2, y1: rect.y, x2: rect.x - gap / 2, y2: rect.y + rect.h }
    : { kind: 'line', x1: rect.x, y1: rect.y - gap / 2, x2: rect.x + rect.w, y2: rect.y - gap / 2 };
}

function lineAfter(rect: Rect, gap: number, vertical: boolean): DropIndicator {
  return vertical
    ? {
        kind: 'line',
        x1: rect.x + rect.w + gap / 2,
        y1: rect.y,
        x2: rect.x + rect.w + gap / 2,
        y2: rect.y + rect.h,
      }
    : {
        kind: 'line',
        x1: rect.x,
        y1: rect.y + rect.h + gap / 2,
        x2: rect.x + rect.w,
        y2: rect.y + rect.h + gap / 2,
      };
}

/**
 * Resolve where a dragged node would land for a cursor at world (wx, wy).
 *
 * Rects are expanded by gapY/2 along the node's own sibling axis — x for
 * 'down' nodes (org-chart rows, timeline phases), y for everything else —
 * so the gaps between siblings are droppable (the layout guarantees ≥ gapY
 * separation, so expansion never overlaps; exact boundary ties go to the
 * nearest center). Zones over the expanded extent: first quarter → sibling
 * before, last quarter → sibling after, middle → child appended at end.
 * The root only accepts children.
 */
export function resolveDropTarget(
  doc: Doc,
  layout: LayoutResult,
  draggedId: string,
  wx: number,
  wy: number,
  gapY: number = DEFAULT_LAYOUT.gapY,
): DropTarget | null {
  const axisX = (id: string) => (layout.dirs.get(id) ?? 'right') === 'down';
  const excluded = new Set(subtreeIds(doc, draggedId));
  let hoveredId: string | null = null;
  let bestDist = Infinity;
  for (const [id, r] of layout.rects) {
    const siblingAxisX = axisX(id);
    const start = siblingAxisX ? r.x - gapY / 2 : r.x;
    const end = siblingAxisX ? r.x + r.w + gapY / 2 : r.x + r.w;
    const top = siblingAxisX ? r.y : r.y - gapY / 2;
    const bottom = siblingAxisX ? r.y + r.h : r.y + r.h + gapY / 2;
    if (wx < start || wx > end || wy < top || wy > bottom) continue;
    const dist = siblingAxisX ? Math.abs(wx - (r.x + r.w / 2)) : Math.abs(wy - (r.y + r.h / 2));
    if (dist < bestDist) {
      bestDist = dist;
      hoveredId = id;
    }
  }
  if (!hoveredId || excluded.has(hoveredId)) return null;

  const rect = layout.rects.get(hoveredId)!;
  const siblingAxisX = axisX(hoveredId);
  const zone = siblingAxisX
    ? (wx - (rect.x - gapY / 2)) / (rect.w + gapY)
    : (wy - (rect.y - gapY / 2)) / (rect.h + gapY);
  const parents = buildParentMap(doc);
  const parentId = parents[hoveredId];

  // The root (no parent) only takes children; otherwise the outer quarters
  // mean "as sibling" and the middle half means "as child".
  if (parentId && zone < 0.25) {
    return {
      parentId,
      beforeSiblingId: hoveredId,
      indicator: lineBefore(rect, gapY, siblingAxisX),
    };
  }
  if (parentId && zone > 0.75) {
    const siblings = doc.nodes[parentId].children;
    return {
      parentId,
      beforeSiblingId: siblings[siblings.indexOf(hoveredId) + 1] ?? null,
      indicator: lineAfter(rect, gapY, siblingAxisX),
    };
  }
  return { parentId: hoveredId, beforeSiblingId: null, indicator: { kind: 'into', nodeId: hoveredId } };
}
