import { describe, expect, it } from 'vitest';
import { produceWithPatches, applyPatches, enablePatches } from 'immer';
import { docFromMap, normalize, serializeElements } from './doc';
import { migrateMapFile } from './migrate';
import { applyDocOp } from './ops';
import { SCHEMA_VERSION, type CanvasElement, type Doc } from './types';

enablePatches();

function makeDoc(elements: CanvasElement[] = []): Doc {
  return normalize(
    { id: 'root', text: 'r', children: [{ id: 'a', text: 'a', children: [{ id: 'a1', text: 'a1', children: [] }] }] },
    'right',
    [],
    [],
    [],
    elements,
  );
}

const sticky = (over: Partial<CanvasElement> = {}): CanvasElement => ({
  id: 'e1',
  kind: 'sticky',
  text: 'note',
  w: 180,
  h: 120,
  x: 0,
  y: 0,
  ...over,
});

describe('canvas element ops', () => {
  it('adds, edits, and deletes an element', () => {
    const doc = makeDoc();
    expect(applyDocOp(doc, { type: 'add_element', element: sticky({ anchor: { nodeId: 'a', side: 'right' } }) })).toEqual({
      ok: true,
    });
    expect(applyDocOp(doc, { type: 'edit_element', elementId: 'e1', text: 'changed', color: 'sage', x: 10 }).ok).toBe(true);
    expect(doc.elements[0]).toMatchObject({ text: 'changed', color: 'sage', x: 10, anchor: { nodeId: 'a', side: 'right' } });
    expect(applyDocOp(doc, { type: 'edit_element', elementId: 'e1', anchor: null, color: null }).ok).toBe(true);
    expect(doc.elements[0].anchor).toBeUndefined();
    expect(doc.elements[0].color).toBeUndefined();
    expect(applyDocOp(doc, { type: 'delete_element', elementId: 'e1' }).ok).toBe(true);
    expect(doc.elements).toEqual([]);
  });

  it('rejects bad input loudly', () => {
    const doc = makeDoc([sticky()]);
    expect(applyDocOp(doc, { type: 'add_element', element: sticky() }).ok).toBe(false); // duplicate id
    expect(applyDocOp(doc, { type: 'add_element', element: sticky({ id: 'a' }) }).ok).toBe(false); // collides with a node
    expect(applyDocOp(doc, { type: 'add_element', element: sticky({ id: 'e2', w: 5 }) }).ok).toBe(false);
    expect(
      applyDocOp(doc, { type: 'add_element', element: sticky({ id: 'e2', anchor: { nodeId: 'nope', side: 'right' } }) }).ok,
    ).toBe(false);
    expect(applyDocOp(doc, { type: 'add_element', element: sticky({ id: 'e2', kind: 'blob' as 'text' }) }).ok).toBe(false);
    expect(applyDocOp(doc, { type: 'edit_element', elementId: 'nope', text: 'x' }).ok).toBe(false);
  });

  it('a no-op edit produces no patches (clean undo history)', () => {
    const doc = makeDoc([sticky()]);
    const [, patches] = produceWithPatches(doc, (d) => {
      applyDocOp(d, { type: 'edit_element', elementId: 'e1', text: 'note', x: 0 });
    });
    expect(patches).toEqual([]);
  });

  it('arrows can link nodes and elements; deleting the element drops them', () => {
    const doc = makeDoc([sticky()]);
    expect(applyDocOp(doc, { type: 'add_relationship', relId: 'r1', fromId: 'e1', toId: 'a1' }).ok).toBe(true);
    applyDocOp(doc, { type: 'delete_element', elementId: 'e1' });
    expect(doc.relationships).toEqual([]);
  });

  it('anchored elements (and their arrows) are deleted with their node — and undo restores both', () => {
    const doc = makeDoc([sticky({ anchor: { nodeId: 'a1', side: 'below' } }), sticky({ id: 'free' })]);
    applyDocOp(doc, { type: 'add_relationship', relId: 'r1', fromId: 'e1', toId: 'root' });
    const [next, , inverse] = produceWithPatches(doc, (d) => {
      applyDocOp(d, { type: 'delete_node', nodeId: 'a' });
    });
    expect(next.elements.map((e) => e.id)).toEqual(['free']);
    expect(next.relationships).toEqual([]);
    const restored = applyPatches(next, inverse);
    expect(restored.elements.map((e) => e.id)).toEqual(['e1', 'free']);
    expect(restored.relationships).toHaveLength(1);
  });
});

describe('element persistence', () => {
  it('round-trips through the map file and drops malformed entries', () => {
    const map = migrateMapFile({
      schemaVersion: SCHEMA_VERSION,
      id: 'mapmap',
      title: 't',
      createdAt: '',
      updatedAt: '',
      root: { id: 'root', text: 'r', children: [{ id: 'a', text: 'a', children: [] }] },
      relationships: [{ id: 'r1', from: 'e1', to: 'a' }],
      elements: [
        sticky({ anchor: { nodeId: 'a', side: 'left' }, color: 'rose' }),
        { id: 'bad', kind: 'blob' },
        sticky({ id: 'orphan', anchor: { nodeId: 'gone', side: 'right' } }),
        sticky({ id: 'big', kind: 'rect', w: 99999, h: Number.NaN, color: 'neon' }),
      ],
    });
    expect(map.elements?.map((e) => e.id)).toEqual(['e1', 'big']);
    expect(map.elements?.[1]).toMatchObject({ w: 4000, h: 120 });
    expect(map.elements?.[1].color).toBeUndefined();
    const doc = docFromMap(map);
    expect(doc.relationships).toHaveLength(1); // element endpoint survives normalize
    expect(serializeElements(doc)).toEqual(map.elements);
  });
});
