import { BRANCH_STYLES, type BranchStyle, type Doc } from '../model/types';

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
   * x for down and timeline phases, y-extent for timeline column rows. Where a
   * branch overrides its style, the interval runs along the PARENT structure's
   * sibling axis and spans the whole override block. Useful for tests and
   * debugging.
   */
  bands: Map<string, { start: number; size: number }>;
  bounds: Rect;
  dirs: Map<string, NodeDir>;
  /** One horizontal axis per timeline structure (map-level or branch override). */
  axes: Array<{ y: number; x1: number; x2: number }>;
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
 *
 * A node whose `style` differs from the structure it sits in starts an
 * override block: its subtree is laid out in that style as a self-contained
 * block whose bounding box the parent treats as one leaf-sized child. The
 * override root's dir is the one its parent structure would assign (the
 * incoming edge); its descendants get the sub-style's dirs.
 *
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
  const axes: LayoutResult['axes'] = [];

  // The style governing id's subtree. The map root's own style is ignored —
  // doc.layout governs there (a stray root override must not fight it).
  const styleOf = (id: string, inherited: BranchStyle): BranchStyle => {
    if (id === doc.rootId) return inherited;
    const s = doc.nodes[id].style;
    return s && BRANCH_STYLES.includes(s as BranchStyle) ? (s as BranchStyle) : inherited;
  };

  // Block extents: the bounding box of id's subtree laid out in `style`.
  // Memoized by id — each node has exactly one effective style per pass.
  const blockHs = new Map<string, number>();
  const blockWs = new Map<string, number>();

  const blockH = (id: string, style: BranchStyle): number => {
    const cached = blockHs.get(id);
    if (cached !== undefined) return cached;
    let h: number;
    if (style === 'timeline') {
      h = tlMetrics(id).blockH;
    } else {
      const kids = childrenOf(id);
      const kidHs = kids.map((c) => blockH(c, styleOf(c, style)));
      if (style === 'right') {
        h = sizeOf(id).h;
        if (kids.length > 0) {
          const block = kidHs.reduce((a, b) => a + b, 0) + opts.gapY * (kids.length - 1);
          h = Math.max(h, block);
        }
      } else {
        h = sizeOf(id).h + (kids.length > 0 ? opts.gapX + Math.max(...kidHs) : 0);
      }
    }
    blockHs.set(id, h);
    return h;
  };

  const blockW = (id: string, style: BranchStyle): number => {
    const cached = blockWs.get(id);
    if (cached !== undefined) return cached;
    let w: number;
    if (style === 'timeline') {
      w = tlMetrics(id).blockW;
    } else {
      const kids = childrenOf(id);
      const kidWs = kids.map((c) => blockW(c, styleOf(c, style)));
      if (style === 'down') {
        w = sizeOf(id).w;
        if (kids.length > 0) {
          const block = kidWs.reduce((a, b) => a + b, 0) + opts.gapY * (kids.length - 1);
          w = Math.max(w, block);
        }
      } else {
        w = sizeOf(id).w + (kids.length > 0 ? opts.gapX + Math.max(...kidWs) : 0);
      }
    }
    blockWs.set(id, w);
    return w;
  };

  /** Measured geometry of a timeline structure rooted at id, in block-local terms. */
  interface TlMetrics {
    colWidths: number[];
    /** Width of the phase columns block (0 when there are no phases). */
    phasesW: number;
    /** x of the block's left edge relative to the phases-block origin (≤ 0 when the root node is wider). */
    offsetX: number;
    /** y of the axis relative to the block top. */
    axisY: number;
    blockW: number;
    blockH: number;
  }

  const tlMetricsMemo = new Map<string, TlMetrics>();

  const tlMetrics = (id: string): TlMetrics => {
    const cached = tlMetricsMemo.get(id);
    if (cached !== undefined) return cached;
    const rs = sizeOf(id);
    const phases = childrenOf(id);
    let m: TlMetrics;
    if (phases.length === 0) {
      m = { colWidths: [], phasesW: 0, offsetX: 0, axisY: 0, blockW: rs.w, blockH: rs.h };
    } else {
      // A column is as wide as its deepest-indented visible member.
      const colWidth = (cid: string, depth: number): number => {
        let w = depth * LIST_INDENT + sizeOf(cid).w;
        for (const c of childrenOf(cid)) {
          const cs = styleOf(c, 'timeline');
          if (cs !== 'timeline') w = Math.max(w, (depth + 1) * LIST_INDENT + blockW(c, cs));
          else w = Math.max(w, colWidth(c, depth + 1));
        }
        return w;
      };
      // The outline rows' total extent below the phase node (gap + row each).
      const listExtent = (cid: string): number => {
        let ext = 0;
        for (const c of childrenOf(cid)) {
          const cs = styleOf(c, 'timeline');
          ext += opts.gapY + (cs !== 'timeline' ? blockH(c, cs) : sizeOf(c).h + listExtent(c));
        }
        return ext;
      };
      const colWidths: number[] = [];
      let maxAbove = 0;
      let maxBelow = 0;
      for (const p of phases) {
        const ps = styleOf(p, 'timeline');
        const ph = sizeOf(p).h;
        if (ps === 'right') {
          // Block centered on the axis (the phase node sits mid-block).
          colWidths.push(blockW(p, ps));
          maxAbove = Math.max(maxAbove, blockH(p, ps) / 2);
          maxBelow = Math.max(maxBelow, blockH(p, ps) / 2);
        } else if (ps !== 'timeline') {
          // 'down': the phase node tops the block, centered on the axis.
          colWidths.push(blockW(p, ps));
          maxAbove = Math.max(maxAbove, ph / 2);
          maxBelow = Math.max(maxBelow, blockH(p, ps) - ph / 2);
        } else {
          colWidths.push(colWidth(p, 0));
          maxAbove = Math.max(maxAbove, ph / 2);
          maxBelow = Math.max(maxBelow, ph / 2 + listExtent(p));
        }
      }
      const phasesW = colWidths.reduce((a, b) => a + b, 0) + opts.gapX * (phases.length - 1);
      const axisY = rs.h + opts.gapX + maxAbove;
      m = {
        colWidths,
        phasesW,
        offsetX: Math.min(0, (phasesW - rs.w) / 2),
        axisY,
        blockW: Math.max(phasesW, rs.w),
        blockH: axisY + maxBelow,
      };
    }
    tlMetricsMemo.set(id, m);
    return m;
  };

  /** Place an override block with its bounding box's top-left at (bx, by). */
  const placeBlock = (id: string, style: BranchStyle, bx: number, by: number): void => {
    if (style === 'right') placeH(id, bx, by, 1);
    else if (style === 'down') placeV(id, by, bx);
    else placeTimelineAt(id, bx - tlMetrics(id).offsetX, by);
  };

  /**
   * Place one child of a rightward/leftward row: recurse for same-style kids,
   * embed a block otherwise (dir/band then reflect the parent structure).
   * Returns the child's band extent along y.
   */
  const placeHChild = (c: string, anchorX: number, cy: number, dir: 1 | -1): number => {
    const cs = styleOf(c, 'right');
    const ch = blockH(c, cs);
    if (cs === 'right') {
      placeH(c, anchorX, cy, dir);
    } else {
      placeBlock(c, cs, dir === 1 ? anchorX : anchorX - blockW(c, cs), cy);
      dirs.set(c, dir === 1 ? 'right' : 'left');
      bands.set(c, { start: cy, size: ch });
    }
    return ch;
  };

  // dir = +1 grows rightward (anchorX is the node's left edge); -1 mirrors
  // (anchorX is the node's right edge, children recurse leftward).
  const placeH = (id: string, anchorX: number, top: number, dir: 1 | -1): void => {
    const { w, h } = sizeOf(id);
    const band = blockH(id, 'right');
    const x = dir === 1 ? anchorX : anchorX - w;
    bands.set(id, { start: top, size: band });
    rects.set(id, { x, y: top + (band - h) / 2, w, h });
    dirs.set(id, dir === 1 ? 'right' : 'left');
    const kids = childrenOf(id);
    if (kids.length === 0) return;
    const block =
      kids.reduce((sum, c) => sum + blockH(c, styleOf(c, 'right')), 0) + opts.gapY * (kids.length - 1);
    let cy = top + (band - block) / 2;
    for (const c of kids) {
      cy += placeHChild(c, dir === 1 ? x + w + opts.gapX : x - opts.gapX, cy, dir) + opts.gapY;
    }
  };

  const placeV = (id: string, y: number, left: number): void => {
    const { w, h } = sizeOf(id);
    const band = blockW(id, 'down');
    bands.set(id, { start: left, size: band });
    rects.set(id, { x: left + (band - w) / 2, y, w, h });
    dirs.set(id, 'down');
    const kids = childrenOf(id);
    if (kids.length === 0) return;
    const block =
      kids.reduce((sum, c) => sum + blockW(c, styleOf(c, 'down')), 0) + opts.gapY * (kids.length - 1);
    let cx = left + (band - block) / 2;
    for (const c of kids) {
      const cs = styleOf(c, 'down');
      const cw = blockW(c, cs);
      if (cs === 'down') {
        placeV(c, y + h + opts.gapX, cx);
      } else {
        placeBlock(c, cs, cx, y + h + opts.gapX);
        dirs.set(c, 'down');
        bands.set(c, { start: cx, size: cw });
      }
      cx += cw + opts.gapY;
    }
  };

  // (ox, oy) = the phases block's x origin and the root node's top y — the
  // same frame the map-level timeline has always used at (0, 0).
  const placeTimelineAt = (id: string, ox: number, oy: number): void => {
    const rs = sizeOf(id);
    const phases = childrenOf(id);
    dirs.set(id, 'down');
    if (phases.length === 0) {
      rects.set(id, { x: ox, y: oy, w: rs.w, h: rs.h });
      bands.set(id, { start: ox, size: rs.w });
      return;
    }
    const m = tlMetrics(id);
    const axisY = oy + m.axisY;
    rects.set(id, { x: ox + (m.phasesW - rs.w) / 2, y: oy, w: rs.w, h: rs.h });
    bands.set(id, { start: ox, size: m.phasesW });

    let bx = ox;
    for (let i = 0; i < phases.length; i++) {
      const p = phases[i];
      const ps = sizeOf(p);
      const pStyle = styleOf(p, 'timeline');
      if (pStyle !== 'timeline') {
        // Override phase: the phase node sits on the axis, the block hangs off it.
        const top = pStyle === 'right' ? axisY - blockH(p, pStyle) / 2 : axisY - ps.h / 2;
        placeBlock(p, pStyle, bx, top);
        dirs.set(p, 'down');
        bands.set(p, { start: bx, size: m.colWidths[i] });
        bx += m.colWidths[i] + opts.gapX;
        continue;
      }
      bands.set(p, { start: bx, size: m.colWidths[i] });
      rects.set(p, { x: bx, y: axisY - ps.h / 2, w: ps.w, h: ps.h });
      dirs.set(p, 'down');
      let yCursor = axisY + ps.h / 2;
      // DFS outline: every row starts gapY below the previous visible row.
      const placeList = (lid: string, x: number): void => {
        for (const c of childrenOf(lid)) {
          const cs = styleOf(c, 'timeline');
          const cy = yCursor + opts.gapY;
          if (cs !== 'timeline') {
            placeBlock(c, cs, x + LIST_INDENT, cy);
            dirs.set(c, 'list');
            yCursor = cy + blockH(c, cs);
            bands.set(c, { start: cy, size: yCursor - cy });
          } else {
            const csz = sizeOf(c);
            rects.set(c, { x: x + LIST_INDENT, y: cy, w: csz.w, h: csz.h });
            dirs.set(c, 'list');
            yCursor = cy + csz.h;
            placeList(c, x + LIST_INDENT);
            bands.set(c, { start: cy, size: yCursor - cy });
          }
        }
      };
      placeList(p, bx);
      bx += m.colWidths[i] + opts.gapX;
    }
    axes.push({ y: axisY, x1: ox, x2: ox + m.phasesW });
  };

  if (doc.layout === 'timeline') {
    placeTimelineAt(doc.rootId, 0, 0);
  } else if (doc.layout === 'down') {
    placeV(doc.rootId, 0, 0);
  } else if (doc.layout === 'balanced') {
    const kids = childrenOf(doc.rootId);
    const { right, left } = splitBalanced(kids);
    const blockOf = (side: string[]) =>
      side.reduce((sum, c) => sum + blockH(c, styleOf(c, 'right')), 0) +
      opts.gapY * Math.max(0, side.length - 1);
    const blockR = blockOf(right);
    const blockL = blockOf(left);
    const rs = sizeOf(doc.rootId);
    rects.set(doc.rootId, { x: 0, y: -rs.h / 2, w: rs.w, h: rs.h });
    dirs.set(doc.rootId, 'right');
    const bandSize = Math.max(rs.h, blockR, blockL);
    bands.set(doc.rootId, { start: -bandSize / 2, size: bandSize });
    let cy = -blockR / 2;
    for (const c of right) cy += placeHChild(c, rs.w + opts.gapX, cy, 1) + opts.gapY;
    cy = -blockL / 2;
    for (const c of left) cy += placeHChild(c, -opts.gapX, cy, -1) + opts.gapY;
  } else {
    placeH(doc.rootId, 0, 0, 1);
  }

  // Floating trees: placed directly so the ROOT NODE's top-left lands exactly
  // on the stored pos (XMind behavior — the floating topic stays where you put
  // it; children fan out). Effective style = the root's override, else right.
  for (const f of doc.floating) {
    const fs = styleOf(f.rootId, 'right');
    const { w, h } = sizeOf(f.rootId);
    if (fs === 'right') {
      placeH(f.rootId, f.pos.x, f.pos.y - (blockH(f.rootId, fs) - h) / 2, 1);
    } else if (fs === 'down') {
      placeV(f.rootId, f.pos.y, f.pos.x - (blockW(f.rootId, fs) - w) / 2);
    } else {
      const m = tlMetrics(f.rootId);
      placeTimelineAt(f.rootId, f.pos.x - (m.phasesW > 0 ? (m.phasesW - w) / 2 : 0), f.pos.y);
    }
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
  return { rects, bands, dirs, axes, bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY } };
}
