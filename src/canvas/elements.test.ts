import { describe, expect, it } from 'vitest';
import { normalize } from '../model/doc';
import type { CanvasElement } from '../model/types';
import { ELEMENT_GAP, layoutElements } from './elements';

// Empty text → no DOM measurement needed (height = stored h).
const el = (id: string, over: Partial<CanvasElement>): CanvasElement => ({
  id,
  kind: 'sticky',
  text: '',
  w: 100,
  h: 50,
  x: 0,
  y: 0,
  ...over,
});

describe('layoutElements', () => {
  const nodeRects = new Map([['root', { x: 0, y: 0, w: 80, h: 30 }]]);

  it('stacks elements on the same side of one node instead of piling them up', () => {
    const doc = normalize({ id: 'root', text: 'r', children: [] }, 'right', [], [], [], [
      el('a', { anchor: { nodeId: 'root', side: 'right' } }),
      el('b', { anchor: { nodeId: 'root', side: 'right' } }),
      el('c', { anchor: { nodeId: 'root', side: 'above' } }),
      el('d', { anchor: { nodeId: 'root', side: 'above' }, x: 5 }),
    ]);
    const r = layoutElements(doc, nodeRects, false);
    expect(r.get('a')).toEqual({ x: 80 + ELEMENT_GAP, y: -10, w: 100, h: 50 });
    expect(r.get('b')!.y).toBe(-10 + 50 + 14); // below a
    expect(r.get('c')!.y).toBe(-ELEMENT_GAP - 50);
    expect(r.get('d')).toMatchObject({ x: -10 + 5, y: -ELEMENT_GAP - 50 - 64 }); // above c, plus its nudge
  });

  it('pushes an anchored element outward past nodes it would cover', () => {
    const doc = normalize({ id: 'root', text: 'r', children: [] }, 'right', [], [], [], [
      el('a', { anchor: { nodeId: 'root', side: 'right' } }),
    ]);
    const child = { x: 140, y: -20, w: 120, h: 40 }; // sits exactly where the sticky would go
    const r = layoutElements(doc, new Map([...nodeRects, ['child', child]]), false).get('a')!;
    expect(r.x).toBeGreaterThanOrEqual(child.x + child.w); // cleared it horizontally…
    expect(r.y).toBe(-10); // …without moving off its row
  });

  it('hides anchored elements with their node and free ones while hoisted', () => {
    const doc = normalize({ id: 'root', text: 'r', children: [] }, 'right', [], [], [], [
      el('free', { x: 300, y: 300 }),
      el('anch', { anchor: { nodeId: 'root', side: 'below' } }),
    ]);
    expect([...layoutElements(doc, new Map(), false).keys()]).toEqual(['free']);
    expect([...layoutElements(doc, nodeRects, true).keys()]).toEqual(['anch']);
  });
});
