import type { Doc } from '../model/types';

export interface Size {
  w: number;
  h: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Direction of the edge entering a node (the root gets the style's primary
 * direction). 'list' = an indented outline row inside a timeline column.
 */
export type NodeDir = 'right' | 'left' | 'down' | 'list';

/** Per-depth x indent of outline rows inside a timeline column. */
export const LIST_INDENT = 20;

export interface LayoutResult {
  rects: Map<string, Rect>;
  /**
   * The cross-axis interval each visible subtree owns — y for right/balanced,
   * x for down and timeline phases, y-extent for timeline column rows.
   * Useful for tests and debugging.
   */
  bands: Map<string, { start: number; size: number }>;
  bounds: Rect;
  dirs: Map<string, NodeDir>;
  /** Timeline only: the horizontal axis through the phase row. */
  axis?: { y: number; x1: number; x2: number };
}

export interface LayoutOptions {
  /** Gap along the depth axis (parent → child); also the timeline column gutter. */
  gapX: number;
  /** Gap along the sibling axis. */
  gapY: number;
}

export const DEFAULT_LAYOUT: LayoutOptions = { gapX: 48, gapY: 14 };

/**
 * Split the root's children for the balanced style: first half right, second
 * half left. Deterministic, document order reads top-to-bottom on each side,
 * and mid-list insertions only move the single boundary child across sides.
 */
export function splitBalanced<T>(kids: T[]): { right: T[]; left: T[] } {
  const cut = Math.ceil(kids.length / 2);
  return { right: kids.slice(0, cut), left: kids.slice(cut) };
}

/**
 * Pure layout for all styles (doc.layout):
 * - right: root at the left, children stacked rightward (logic chart).
 * - balanced: root's children split onto both sides, mirrored on the left.
 * - down: org chart — children below, horizontally centered on the parent.
 * - timeline: roadmap — first-level children are phases on a horizontal axis,
 *   their descendants stack as indented outline columns below each phase.
 * Each subtree owns a band along the sibling axis equal to its total extent;
 * the parent is centered on its children block. Pure and deterministic.
 */
export function layoutTree(
  doc: Doc,
  sizeOf: (id: string) => Size,
  opts: LayoutOptions = DEFAULT_LAYOUT,
): LayoutResult {
  const childrenOf = (id: string) => (doc.nodes[id].collapsed ? [] : doc.nodes[id].children);

  const rects = new Map<string, Rect>();
  const bands = new Map<string, { start: number; size: number }>();
  const dirs = new Map<string, NodeDir>();

  const heights = new Map<string, number>();
  const bandHeight = (id: string): number => {
    const cached = heights.get(id);
    if (cached !== undefined) return cached;
    const kids = childrenOf(id);
    let h = sizeOf(id).h;
    if (kids.length > 0) {
      const block = kids.reduce((sum, c) => sum + bandHeight(c), 0) + opts.gapY * (kids.length - 1);
      h = Math.max(h, block);
    }
    heights.set(id, h);
    return h;
  };

  // dir = +1 grows rightward (anchorX is the node's left edge); -1 mirrors
  // (anchorX is the node's right edge, children recurse leftward).
  const placeH = (id: string, anchorX: number, top: number, dir: 1 | -1) => {
    const { w, h } = sizeOf(id);
    const band = heights.get(id)!;
    const x = dir === 1 ? anchorX : anchorX - w;
    bands.set(id, { start: top, size: band });
    rects.set(id, { x, y: top + (band - h) / 2, w, h });
    dirs.set(id, dir === 1 ? 'right' : 'left');
    const kids = childrenOf(id);
    if (kids.length === 0) return;
    const block = kids.reduce((sum, c) => sum + heights.get(c)!, 0) + opts.gapY * (kids.length - 1);
    let cy = top + (band - block) / 2;
    for (const c of kids) {
      placeH(c, dir === 1 ? x + w + opts.gapX : x - opts.gapX, cy, dir);
      cy += heights.get(c)! + opts.gapY;
    }
  };

  const widths = new Map<string, number>();
  const bandWidth = (id: string): number => {
    const cached = widths.get(id);
    if (cached !== undefined) return cached;
    const kids = childrenOf(id);
    let w = sizeOf(id).w;
    if (kids.length > 0) {
      const block = kids.reduce((sum, c) => sum + bandWidth(c), 0) + opts.gapY * (kids.length - 1);
      w = Math.max(w, block);
    }
    widths.set(id, w);
    return w;
  };

  const placeV = (id: string, y: number, left: number) => {
    const { w, h } = sizeOf(id);
    const band = widths.get(id)!;
    bands.set(id, { start: left, size: band });
    rects.set(id, { x: left + (band - w) / 2, y, w, h });
    dirs.set(id, 'down');
    const kids = childrenOf(id);
    if (kids.length === 0) return;
    const block = kids.reduce((sum, c) => sum + widths.get(c)!, 0) + opts.gapY * (kids.length - 1);
    let cx = left + (band - block) / 2;
    for (const c of kids) {
      placeV(c, y + h + opts.gapX, cx);
      cx += widths.get(c)! + opts.gapY;
    }
  };

  let axis: LayoutResult['axis'];

  const placeTimeline = (): void => {
    const rs = sizeOf(doc.rootId);
    const phases = childrenOf(doc.rootId);
    dirs.set(doc.rootId, 'down');
    if (phases.length === 0) {
      rects.set(doc.rootId, { x: 0, y: 0, w: rs.w, h: rs.h });
      bands.set(doc.rootId, { start: 0, size: rs.w });
      return;
    }
    // A column is as wide as its deepest-indented visible member.
    const colWidth = (id: string, depth: number): number => {
      let w = depth * LIST_INDENT + sizeOf(id).w;
      for (const c of childrenOf(id)) w = Math.max(w, colWidth(c, depth + 1));
      return w;
    };
    const colWidths = phases.map((p) => colWidth(p, 0));
    const blockW = colWidths.reduce((a, b) => a + b, 0) + opts.gapX * (phases.length - 1);
    const maxPhaseH = Math.max(...phases.map((p) => sizeOf(p).h));
    const axisY = rs.h + opts.gapX + maxPhaseH / 2;

    rects.set(doc.rootId, { x: (blockW - rs.w) / 2, y: 0, w: rs.w, h: rs.h });
    bands.set(doc.rootId, { start: 0, size: blockW });

    let bx = 0;
    for (let i = 0; i < phases.length; i++) {
      const p = phases[i];
      const ps = sizeOf(p);
      bands.set(p, { start: bx, size: colWidths[i] });
      rects.set(p, { x: bx, y: axisY - ps.h / 2, w: ps.w, h: ps.h });
      dirs.set(p, 'down');
      let yCursor = axisY + ps.h / 2;
      // DFS outline: every row starts gapY below the previous visible row.
      const placeList = (id: string, x: number): void => {
        for (const c of childrenOf(id)) {
          const cs = sizeOf(c);
          const cy = yCursor + opts.gapY;
          rects.set(c, { x: x + LIST_INDENT, y: cy, w: cs.w, h: cs.h });
          dirs.set(c, 'list');
          yCursor = cy + cs.h;
          placeList(c, x + LIST_INDENT);
          bands.set(c, { start: cy, size: yCursor - cy });
        }
      };
      placeList(p, bx);
      bx += colWidths[i] + opts.gapX;
    }
    axis = { y: axisY, x1: 0, x2: blockW };
  };

  if (doc.layout === 'timeline') {
    placeTimeline();
  } else if (doc.layout === 'down') {
    bandWidth(doc.rootId);
    placeV(doc.rootId, 0, 0);
  } else if (doc.layout === 'balanced') {
    const kids = childrenOf(doc.rootId);
    const { right, left } = splitBalanced(kids);
    for (const c of kids) bandHeight(c);
    const blockOf = (side: string[]) =>
      side.reduce((sum, c) => sum + heights.get(c)!, 0) + opts.gapY * Math.max(0, side.length - 1);
    const blockR = blockOf(right);
    const blockL = blockOf(left);
    const rs = sizeOf(doc.rootId);
    rects.set(doc.rootId, { x: 0, y: -rs.h / 2, w: rs.w, h: rs.h });
    dirs.set(doc.rootId, 'right');
    const bandSize = Math.max(rs.h, blockR, blockL);
    bands.set(doc.rootId, { start: -bandSize / 2, size: bandSize });
    let cy = -blockR / 2;
    for (const c of right) {
      placeH(c, rs.w + opts.gapX, cy, 1);
      cy += heights.get(c)! + opts.gapY;
    }
    cy = -blockL / 2;
    for (const c of left) {
      placeH(c, -opts.gapX, cy, -1);
      cy += heights.get(c)! + opts.gapY;
    }
  } else {
    bandHeight(doc.rootId);
    placeH(doc.rootId, 0, 0, 1);
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects.values()) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  return { rects, bands, dirs, axis, bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY } };
}
