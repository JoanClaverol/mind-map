import { describe, expect, it } from 'vitest';
import { normalize, visibleIds } from '../model/doc';
import type { FileNode } from '../model/types';
import { DEFAULT_LAYOUT, LIST_INDENT, layoutTree, splitBalanced, type LayoutResult, type Size } from './layout';

function node(id: string, children: FileNode[] = [], collapsed = false): FileNode {
  return { id, text: id, children, ...(collapsed ? { collapsed } : {}) };
}

function expectNoOverlap(layout: LayoutResult): void {
  const rects = [...layout.rects.entries()];
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const [aId, a] = rects[i];
      const [bId, b] = rects[j];
      const separated = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
      expect(separated, `${aId} overlaps ${bId}`).toBe(true);
    }
  }
}

function expectBoundsContainAll(layout: LayoutResult): void {
  for (const r of layout.rects.values()) {
    expect(r.x).toBeGreaterThanOrEqual(layout.bounds.x);
    expect(r.y).toBeGreaterThanOrEqual(layout.bounds.y);
    expect(r.x + r.w).toBeLessThanOrEqual(layout.bounds.x + layout.bounds.w);
    expect(r.y + r.h).toBeLessThanOrEqual(layout.bounds.y + layout.bounds.h);
  }
}

// Deterministic pseudo-variable sizes derived from the id.
function sizeOf(id: string): Size {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
  return { w: 60 + (hash % 180), h: 24 + (hash % 40) };
}

const tree = node('root', [
  node('a', [node('a1'), node('a2', [node('a2x'), node('a2y'), node('a2z')]), node('a3')]),
  node('b', [node('b1', [node('b1x')])]),
  node('c'),
  node('collapsed-branch', [node('hidden1'), node('hidden2')], true),
]);

describe('layoutTree', () => {
  const doc = normalize(tree);
  const layout = layoutTree(doc, sizeOf);
  const { gapX } = DEFAULT_LAYOUT;

  it('places exactly the visible nodes', () => {
    expect([...layout.rects.keys()].sort()).toEqual([...visibleIds(doc)].sort());
    expect(layout.rects.has('hidden1')).toBe(false);
  });

  it('puts every child exactly gapX to the right of its parent', () => {
    for (const [id, rect] of layout.rects) {
      const n = doc.nodes[id];
      if (n.collapsed) continue;
      for (const childId of n.children) {
        const child = layout.rects.get(childId)!;
        expect(child.x).toBeCloseTo(rect.x + rect.w + gapX, 6);
      }
    }
  });

  it('never overlaps two visible nodes', () => {
    const rects = [...layout.rects.entries()];
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const [aId, a] = rects[i];
        const [bId, b] = rects[j];
        const separated = a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y;
        expect(separated, `${aId} overlaps ${bId}`).toBe(true);
      }
    }
  });

  it('vertically centers each parent on its children band block', () => {
    for (const [id, rect] of layout.rects) {
      const n = doc.nodes[id];
      if (n.collapsed || n.children.length === 0) continue;
      const childBands = n.children.map((c) => layout.bands.get(c)!);
      const blockTop = Math.min(...childBands.map((b) => b.start));
      const blockBottom = Math.max(...childBands.map((b) => b.start + b.size));
      const parentCenter = rect.y + rect.h / 2;
      const blockCenter = (blockTop + blockBottom) / 2;
      expect(Math.abs(parentCenter - blockCenter)).toBeLessThan(0.001);
    }
  });

  it('keeps siblings in document order, top to bottom', () => {
    for (const [id] of layout.rects) {
      const n = doc.nodes[id];
      if (n.collapsed) continue;
      const ys = n.children.map((c) => layout.rects.get(c)!.y);
      expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    }
  });

  it('reports bounds that contain every rect', () => {
    expectBoundsContainAll(layout);
  });

  it('marks every node rightward', () => {
    for (const id of layout.rects.keys()) expect(layout.dirs.get(id)).toBe('right');
  });
});

describe('layoutTree right — golden coordinates', () => {
  // Pixel-identity guard: these exact numbers are what the pre-styles layout
  // produced. If they move, existing maps render differently.
  it('pins exact rects for a fixed-size root with two children', () => {
    const doc = normalize(node('root', [node('a'), node('b')]));
    const layout = layoutTree(doc, () => ({ w: 100, h: 24 }));
    expect(layout.rects.get('root')).toEqual({ x: 0, y: 19, w: 100, h: 24 });
    expect(layout.rects.get('a')).toEqual({ x: 148, y: 0, w: 100, h: 24 });
    expect(layout.rects.get('b')).toEqual({ x: 148, y: 38, w: 100, h: 24 });
    expect(layout.bounds).toEqual({ x: 0, y: 0, w: 248, h: 62 });
  });
});

describe('layoutTree balanced', () => {
  const balancedTree = node('root', [
    node('a', [node('a1'), node('a2')]),
    node('b'),
    node('c', [node('c1')]),
    node('d'),
  ]);
  const doc = normalize(balancedTree, 'balanced');
  const layout = layoutTree(doc, sizeOf);
  const { gapX } = DEFAULT_LAYOUT;
  const root = layout.rects.get('root')!;
  const { right, left } = splitBalanced(doc.nodes.root.children);

  it('places exactly the visible nodes', () => {
    expect([...layout.rects.keys()].sort()).toEqual([...visibleIds(doc)].sort());
  });

  it('assigns sides matching splitBalanced, propagated to descendants', () => {
    expect(right).toEqual(['a', 'b']);
    expect(left).toEqual(['c', 'd']);
    expect(layout.dirs.get('root')).toBe('right');
    for (const id of ['a', 'b', 'a1', 'a2']) expect(layout.dirs.get(id)).toBe('right');
    for (const id of ['c', 'd', 'c1']) expect(layout.dirs.get(id)).toBe('left');
  });

  it('anchors right-side children gapX right of the root, left-side mirrored', () => {
    for (const id of right) expect(layout.rects.get(id)!.x).toBeCloseTo(root.x + root.w + gapX, 6);
    for (const id of left) {
      const r = layout.rects.get(id)!;
      expect(r.x + r.w).toBeCloseTo(root.x - gapX, 6);
    }
  });

  it('mirrors nesting on the left side (child right edge gapX left of parent)', () => {
    const c = layout.rects.get('c')!;
    const c1 = layout.rects.get('c1')!;
    expect(c1.x + c1.w).toBeCloseTo(c.x - gapX, 6);
  });

  it('centers each side block on the root vertical center', () => {
    const rootCenter = root.y + root.h / 2;
    for (const side of [right, left]) {
      const bands = side.map((id) => layout.bands.get(id)!);
      const top = Math.min(...bands.map((b) => b.start));
      const bottom = Math.max(...bands.map((b) => b.start + b.size));
      expect(Math.abs((top + bottom) / 2 - rootCenter)).toBeLessThan(0.001);
    }
  });

  it('keeps siblings in document order top to bottom on each side', () => {
    for (const side of [right, left]) {
      const ys = side.map((id) => layout.rects.get(id)!.y);
      expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    }
  });

  it('never overlaps and bounds contain every rect', () => {
    expectNoOverlap(layout);
    expectBoundsContainAll(layout);
  });
});

describe('layoutTree timeline', () => {
  const doc = normalize(tree, 'timeline');
  const layout = layoutTree(doc, sizeOf);
  const { gapX, gapY } = DEFAULT_LAYOUT;
  const phases = doc.nodes.root.children;

  it('places exactly the visible nodes; root and phases down, members list', () => {
    expect([...layout.rects.keys()].sort()).toEqual([...visibleIds(doc)].sort());
    expect(layout.dirs.get('root')).toBe('down');
    for (const p of phases) expect(layout.dirs.get(p)).toBe('down');
    for (const id of layout.rects.keys()) {
      if (id === 'root' || phases.includes(id)) continue;
      expect(layout.dirs.get(id), id).toBe('list');
    }
  });

  it('centers every phase on the axis, which spans the phase block', () => {
    expect(layout.axis).toBeDefined();
    for (const p of phases) {
      const r = layout.rects.get(p)!;
      expect(r.y + r.h / 2).toBeCloseTo(layout.axis!.y, 6);
    }
    const first = layout.bands.get(phases[0])!;
    const last = layout.bands.get(phases[phases.length - 1])!;
    expect(layout.axis!.x1).toBeCloseTo(first.start, 6);
    expect(layout.axis!.x2).toBeCloseTo(last.start + last.size, 6);
  });

  it('packs phase columns left to right in document order with a gapX gutter', () => {
    for (let i = 1; i < phases.length; i++) {
      const prev = layout.bands.get(phases[i - 1])!;
      expect(layout.bands.get(phases[i])!.start).toBeCloseTo(prev.start + prev.size + gapX, 6);
    }
  });

  it('stacks each column as a DFS outline: every row gapY below the previous', () => {
    for (const p of phases) {
      const rows: string[] = [];
      const walk = (id: string) => {
        rows.push(id);
        if (!doc.nodes[id].collapsed) for (const c of doc.nodes[id].children) walk(c);
      };
      walk(p);
      for (let i = 1; i < rows.length; i++) {
        const prev = layout.rects.get(rows[i - 1])!;
        expect(layout.rects.get(rows[i])!.y, rows[i]).toBeCloseTo(prev.y + prev.h + gapY, 6);
      }
    }
  });

  it('indents every column member LIST_INDENT right of its parent, inside its lane', () => {
    for (const [id, rect] of layout.rects) {
      const n = doc.nodes[id];
      if (n.collapsed) continue;
      if (id === 'root') continue;
      for (const childId of n.children) {
        expect(layout.rects.get(childId)!.x).toBeCloseTo(rect.x + LIST_INDENT, 6);
      }
    }
    for (const p of phases) {
      const band = layout.bands.get(p)!;
      const walk = (id: string) => {
        const r = layout.rects.get(id)!;
        expect(r.x + r.w, id).toBeLessThanOrEqual(band.start + band.size + 0.001);
        if (!doc.nodes[id].collapsed) for (const c of doc.nodes[id].children) walk(c);
      };
      walk(p);
    }
  });

  it('puts the root at y=0, centered on the phase block, gapX above the tallest phase', () => {
    const root = layout.rects.get('root')!;
    expect(root.y).toBe(0);
    const first = layout.bands.get(phases[0])!;
    const last = layout.bands.get(phases[phases.length - 1])!;
    expect(root.x + root.w / 2).toBeCloseTo((first.start + last.start + last.size) / 2, 6);
    const minPhaseTop = Math.min(...phases.map((p) => layout.rects.get(p)!.y));
    expect(minPhaseTop).toBeCloseTo(root.h + gapX, 6);
  });

  it('gives column members y-extent bands that nest and stay disjoint', () => {
    for (const [id, rect] of layout.rects) {
      if (id === 'root' || phases.includes(id)) continue;
      const band = layout.bands.get(id)!;
      expect(band.start).toBeCloseTo(rect.y, 6);
      const n = doc.nodes[id];
      if (!n.collapsed && n.children.length > 0) {
        for (const c of n.children) {
          const cb = layout.bands.get(c)!;
          expect(cb.start).toBeGreaterThan(band.start);
          expect(cb.start + cb.size).toBeLessThanOrEqual(band.start + band.size + 0.001);
        }
        const kids = n.children.map((c) => layout.bands.get(c)!);
        for (let i = 1; i < kids.length; i++) {
          expect(kids[i].start).toBeGreaterThanOrEqual(kids[i - 1].start + kids[i - 1].size - 0.001);
        }
      }
    }
  });

  it('never overlaps and bounds contain every rect', () => {
    expectNoOverlap(layout);
    expectBoundsContainAll(layout);
  });

  it('childless root: single rect, no axis', () => {
    const solo = normalize(node('root'), 'timeline');
    const l = layoutTree(solo, () => ({ w: 100, h: 24 }));
    expect(l.axis).toBeUndefined();
    expect(l.rects.get('root')).toEqual({ x: 0, y: 0, w: 100, h: 24 });
  });

  it('pins exact golden coordinates for fixed sizes', () => {
    const g = normalize(node('root', [node('a', [node('a1')]), node('b')]), 'timeline');
    const l = layoutTree(g, () => ({ w: 100, h: 24 }));
    expect(l.rects.get('root')).toEqual({ x: 84, y: 0, w: 100, h: 24 });
    expect(l.rects.get('a')).toEqual({ x: 0, y: 72, w: 100, h: 24 });
    expect(l.rects.get('a1')).toEqual({ x: 20, y: 110, w: 100, h: 24 });
    expect(l.rects.get('b')).toEqual({ x: 168, y: 72, w: 100, h: 24 });
    expect(l.axis).toEqual({ y: 84, x1: 0, x2: 268 });
    expect(l.bounds).toEqual({ x: 0, y: 0, w: 268, h: 134 });
  });
});

describe('layoutTree down', () => {
  const doc = normalize(tree, 'down');
  const layout = layoutTree(doc, sizeOf);
  const { gapX } = DEFAULT_LAYOUT;

  it('places exactly the visible nodes, all marked down', () => {
    expect([...layout.rects.keys()].sort()).toEqual([...visibleIds(doc)].sort());
    for (const id of layout.rects.keys()) expect(layout.dirs.get(id)).toBe('down');
  });

  it('puts every child exactly gapX below its parent', () => {
    for (const [id, rect] of layout.rects) {
      const n = doc.nodes[id];
      if (n.collapsed) continue;
      for (const childId of n.children) {
        expect(layout.rects.get(childId)!.y).toBeCloseTo(rect.y + rect.h + gapX, 6);
      }
    }
  });

  it('keeps siblings in document order, left to right', () => {
    for (const [id] of layout.rects) {
      const n = doc.nodes[id];
      if (n.collapsed) continue;
      const xs = n.children.map((c) => layout.rects.get(c)!.x);
      expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    }
  });

  it('horizontally centers each parent on its children band block', () => {
    for (const [id, rect] of layout.rects) {
      const n = doc.nodes[id];
      if (n.collapsed || n.children.length === 0) continue;
      const childBands = n.children.map((c) => layout.bands.get(c)!);
      const blockLeft = Math.min(...childBands.map((b) => b.start));
      const blockRight = Math.max(...childBands.map((b) => b.start + b.size));
      expect(Math.abs(rect.x + rect.w / 2 - (blockLeft + blockRight) / 2)).toBeLessThan(0.001);
    }
  });

  it('never overlaps and bounds contain every rect', () => {
    expectNoOverlap(layout);
    expectBoundsContainAll(layout);
  });
});
