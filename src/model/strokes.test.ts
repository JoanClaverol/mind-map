import { describe, expect, it } from 'vitest';
import { normalize } from './doc';
import { migrateMapFile } from './migrate';
import { applyDocOp } from './ops';
import { isValidStroke, normalizeStroke, simplify, strokePath } from './strokes';
import { SCHEMA_VERSION } from './types';

describe('strokes', () => {
  it('normalizes world points into a box with 0…1 coordinates', () => {
    const s = normalizeStroke([
      { x: 100, y: 200 },
      { x: 150, y: 260 },
      { x: 200, y: 200 },
    ])!;
    expect(s).toMatchObject({ x: 100, y: 200, w: 100, h: 60 });
    expect(s.points).toEqual([0, 0, 0.5, 1, 1, 0]);
    expect(isValidStroke(s.points)).toBe(true);
  });

  it('pads a straight line to the minimum size, centered', () => {
    const s = normalizeStroke([
      { x: 0, y: 50 },
      { x: 100, y: 50 },
    ])!;
    expect(s.h).toBe(4); // MIN_DRAW_SIZE — an underline stays thin
    expect(s.y).toBe(48);
    expect(s.points).toEqual([0, 0.5, 1, 0.5]);
  });

  it('treats a click as no stroke and drops jitter', () => {
    expect(normalizeStroke([{ x: 5, y: 5 }, { x: 6, y: 6 }])).toBeNull();
    expect(simplify([{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 1, y: 0 }, { x: 10, y: 0 }])).toHaveLength(2);
  });

  it('renders a smooth path scaled to the box', () => {
    expect(strokePath([0, 0, 1, 1], 100, 50)).toBe('M 0,0 L 100,50');
    expect(strokePath([0, 0, 0.5, 1, 1, 0], 100, 50)).toMatch(/^M 0,0 Q 50,50 75,25 L 100,0$/);
  });

  it('ops and migrate reject a draw element without a valid stroke', () => {
    const doc = normalize({ id: 'root', text: 'r', children: [] });
    const base = { id: 'd1', kind: 'draw' as const, text: '', w: 50, h: 50, x: 0, y: 0 };
    expect(applyDocOp(doc, { type: 'add_element', element: base }).ok).toBe(false);
    expect(applyDocOp(doc, { type: 'add_element', element: { ...base, points: [0, 0, 2, 1] } }).ok).toBe(false);
    expect(applyDocOp(doc, { type: 'add_element', element: { ...base, kind: 'rect', points: [0, 0, 1, 1] } }).ok).toBe(false);
    expect(applyDocOp(doc, { type: 'add_element', element: { ...base, points: [0, 0, 1, 1] } }).ok).toBe(true);
    const map = migrateMapFile({
      schemaVersion: SCHEMA_VERSION,
      id: 'mapmap',
      title: 't',
      createdAt: '',
      updatedAt: '',
      root: { id: 'root', text: 'r', children: [] },
      elements: [
        { ...base, points: [0, 0, 1, 1] },
        { ...base, id: 'bad', points: ['x'] },
      ],
    });
    expect(map.elements?.map((e) => e.id)).toEqual(['d1']);
  });
});
