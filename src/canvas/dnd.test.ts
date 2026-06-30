import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, layoutTree } from '../layout/layout';
import { normalize } from '../model/doc';
import { resolveDropTarget } from './dnd';

// Real layout, fixed sizes: geometry in these tests is the real geometry.
const SIZE = { w: 100, h: 24 };
const { gapY } = DEFAULT_LAYOUT;

const doc = normalize({
  id: 'root',
  text: 'r',
  children: [
    { id: 'a', text: 'a', children: [{ id: 'a1', text: 'a1', children: [] }] },
    { id: 'b', text: 'b', children: [] },
    { id: 'c', text: 'c', children: [] },
  ],
});
const layout = layoutTree(doc, () => SIZE);

function at(id: string, relX: number, relY: number): { wx: number; wy: number } {
  const r = layout.rects.get(id)!;
  return { wx: r.x + r.w * relX, wy: r.y + r.h * relY };
}

describe('resolveDropTarget', () => {
  it('middle of a node → drop into it, appended', () => {
    const { wx, wy } = at('a', 0.5, 0.5);
    const t = resolveDropTarget(doc, layout, 'c', wx, wy);
    expect(t).toMatchObject({ parentId: 'a', beforeSiblingId: null, indicator: { kind: 'into', nodeId: 'a' } });
  });

  it('top edge of a node → sibling above (anchor = hovered)', () => {
    const r = layout.rects.get('b')!;
    const t = resolveDropTarget(doc, layout, 'c', r.x + 10, r.y - 1);
    expect(t).toMatchObject({ parentId: 'root', beforeSiblingId: 'b', indicator: { kind: 'line' } });
  });

  it('bottom edge of a node → sibling below (anchor = next sibling)', () => {
    const r = layout.rects.get('a')!;
    const t = resolveDropTarget(doc, layout, 'c', r.x + 10, r.y + r.h + 1);
    expect(t).toMatchObject({ parentId: 'root', beforeSiblingId: 'b' });
  });

  it('bottom edge of the last child → null anchor (append)', () => {
    const r = layout.rects.get('c')!;
    const t = resolveDropTarget(doc, layout, 'a', r.x + 10, r.y + r.h + 1);
    expect(t).toMatchObject({ parentId: 'root', beforeSiblingId: null, indicator: { kind: 'line' } });
  });

  it('gap between siblings is droppable via expansion', () => {
    // point in the vertical gap just below b, still within b.x..b.x+w
    const b = layout.rects.get('b')!;
    const t = resolveDropTarget(doc, layout, 'a', b.x + 5, b.y + b.h + gapY / 2 - 0.01);
    expect(t).not.toBeNull();
  });

  it('hovering the dragged subtree → null', () => {
    const { wx, wy } = at('a1', 0.5, 0.5);
    expect(resolveDropTarget(doc, layout, 'a', wx, wy)).toBeNull();
    const self = at('a', 0.5, 0.5);
    expect(resolveDropTarget(doc, layout, 'a', self.wx, self.wy)).toBeNull();
  });

  it('the root is always an "into" target, even at its edges', () => {
    const r = layout.rects.get('root')!;
    const top = resolveDropTarget(doc, layout, 'c', r.x + 5, r.y + 1);
    expect(top).toMatchObject({ parentId: 'root', indicator: { kind: 'into', nodeId: 'root' } });
  });

  it('far from any node → null', () => {
    expect(resolveDropTarget(doc, layout, 'c', layout.bounds.x + layout.bounds.w + 500, 0)).toBeNull();
  });

  it('only visible nodes are targets (collapsed children excluded)', () => {
    const collapsedDoc = normalize({
      id: 'root',
      text: 'r',
      children: [
        { id: 'a', text: 'a', collapsed: true, children: [{ id: 'a1', text: 'a1', children: [] }] },
        { id: 'b', text: 'b', children: [] },
      ],
    });
    const collapsedLayout = layoutTree(collapsedDoc, () => SIZE);
    expect(collapsedLayout.rects.has('a1')).toBe(false);
    const r = collapsedLayout.rects.get('a')!;
    const t = resolveDropTarget(collapsedDoc, collapsedLayout, 'b', r.x + 50, r.y + r.h / 2);
    expect(t).toMatchObject({ parentId: 'a', indicator: { kind: 'into' } });
  });
});

describe('resolveDropTarget — down style (sibling axis is x)', () => {
  const downDoc = normalize(
    {
      id: 'root',
      text: 'r',
      children: [
        { id: 'a', text: 'a', children: [{ id: 'a1', text: 'a1', children: [] }] },
        { id: 'b', text: 'b', children: [] },
        { id: 'c', text: 'c', children: [] },
      ],
    },
    'down',
  );
  const downLayout = layoutTree(downDoc, () => SIZE);

  it('middle of a node → drop into it', () => {
    const r = downLayout.rects.get('a')!;
    const t = resolveDropTarget(downDoc, downLayout, 'c', r.x + r.w / 2, r.y + r.h / 2);
    expect(t).toMatchObject({ parentId: 'a', beforeSiblingId: null, indicator: { kind: 'into', nodeId: 'a' } });
  });

  it('left edge → sibling before, with a vertical indicator line', () => {
    const r = downLayout.rects.get('b')!;
    const t = resolveDropTarget(downDoc, downLayout, 'c', r.x - 1, r.y + 10);
    expect(t).toMatchObject({ parentId: 'root', beforeSiblingId: 'b', indicator: { kind: 'line' } });
    const line = t!.indicator as { x1: number; y1: number; x2: number; y2: number };
    expect(line.x1).toBe(line.x2);
    expect(line.y1).not.toBe(line.y2);
  });

  it('right edge of the last sibling → null anchor (append)', () => {
    const r = downLayout.rects.get('c')!;
    const t = resolveDropTarget(downDoc, downLayout, 'a', r.x + r.w + 1, r.y + 10);
    expect(t).toMatchObject({ parentId: 'root', beforeSiblingId: null, indicator: { kind: 'line' } });
  });

  it('horizontal gap between siblings is droppable via expansion', () => {
    const b = downLayout.rects.get('b')!;
    const t = resolveDropTarget(downDoc, downLayout, 'a', b.x + b.w + gapY / 2 - 0.01, b.y + 5);
    expect(t).not.toBeNull();
  });
});

describe('resolveDropTarget — timeline (phases on x, column rows on y)', () => {
  const tlDoc = normalize(
    {
      id: 'root',
      text: 'r',
      children: [
        { id: 'a', text: 'a', children: [{ id: 'a1', text: 'a1', children: [] }] },
        { id: 'b', text: 'b', children: [] },
        { id: 'c', text: 'c', children: [] },
      ],
    },
    'timeline',
  );
  const tlLayout = layoutTree(tlDoc, () => SIZE);

  it('phase left edge → sibling before, vertical line', () => {
    const r = tlLayout.rects.get('b')!;
    const t = resolveDropTarget(tlDoc, tlLayout, 'c', r.x - 1, r.y + 10);
    expect(t).toMatchObject({ parentId: 'root', beforeSiblingId: 'b', indicator: { kind: 'line' } });
    const line = t!.indicator as { x1: number; y1: number; x2: number; y2: number };
    expect(line.x1).toBe(line.x2);
  });

  it('right edge of the last phase → null anchor (append), middle → into', () => {
    const r = tlLayout.rects.get('c')!;
    const after = resolveDropTarget(tlDoc, tlLayout, 'a', r.x + r.w + 1, r.y + 10);
    expect(after).toMatchObject({ parentId: 'root', beforeSiblingId: null, indicator: { kind: 'line' } });
    const into = resolveDropTarget(tlDoc, tlLayout, 'a', r.x + r.w / 2, r.y + r.h / 2);
    expect(into).toMatchObject({ parentId: 'c', beforeSiblingId: null, indicator: { kind: 'into', nodeId: 'c' } });
  });

  it('column row edges → sibling before/after with horizontal lines', () => {
    const r = tlLayout.rects.get('a1')!;
    const before = resolveDropTarget(tlDoc, tlLayout, 'b', r.x + 10, r.y - 1);
    expect(before).toMatchObject({ parentId: 'a', beforeSiblingId: 'a1', indicator: { kind: 'line' } });
    const line = before!.indicator as { x1: number; y1: number; x2: number; y2: number };
    expect(line.y1).toBe(line.y2);
    const after = resolveDropTarget(tlDoc, tlLayout, 'b', r.x + 10, r.y + r.h + 1);
    expect(after).toMatchObject({ parentId: 'a', beforeSiblingId: null });
  });

  it('a point in the inter-column gutter → null', () => {
    const aBand = tlLayout.bands.get('a')!;
    const bBand = tlLayout.bands.get('b')!;
    const gutterX = (aBand.start + aBand.size + bBand.start) / 2;
    const rowY = tlLayout.rects.get('a1')!.y + 5;
    expect(resolveDropTarget(tlDoc, tlLayout, 'c', gutterX, rowY)).toBeNull();
  });

  it('the root is always an "into" target', () => {
    const r = tlLayout.rects.get('root')!;
    const t = resolveDropTarget(tlDoc, tlLayout, 'c', r.x + 2, r.y + r.h / 2);
    expect(t).toMatchObject({ parentId: 'root', indicator: { kind: 'into', nodeId: 'root' } });
  });
});

describe('resolveDropTarget — balanced left side', () => {
  // 3 root children → splitBalanced puts c alone on the left side.
  const balancedDoc = normalize(
    {
      id: 'root',
      text: 'r',
      children: [
        { id: 'a', text: 'a', children: [] },
        { id: 'b', text: 'b', children: [] },
        { id: 'c', text: 'c', children: [] },
      ],
    },
    'balanced',
  );
  const balancedLayout = layoutTree(balancedDoc, () => SIZE);

  it('top edge of a left-side node → sibling before, horizontal line', () => {
    const r = balancedLayout.rects.get('c')!;
    expect(r.x).toBeLessThan(balancedLayout.rects.get('root')!.x); // really on the left
    const t = resolveDropTarget(balancedDoc, balancedLayout, 'a', r.x + 10, r.y - 1);
    expect(t).toMatchObject({ parentId: 'root', beforeSiblingId: 'c', indicator: { kind: 'line' } });
    const line = t!.indicator as { x1: number; y1: number; x2: number; y2: number };
    expect(line.y1).toBe(line.y2);
  });
});
