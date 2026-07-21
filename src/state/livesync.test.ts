import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MapFile } from '../model/types';
import { initLiveSync } from './livesync';
import { useStore } from './store';

/** Captures listeners so tests can push SSE events by hand. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  listeners = new Map<string, Array<(ev: MessageEvent) => void>>();
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, fn: (ev: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  emit(type: string, data: unknown) {
    for (const fn of this.listeners.get(type) ?? []) fn({ data: JSON.stringify(data) } as MessageEvent);
  }
  close() {
    this.closed = true;
  }
}

const mapFile: MapFile = {
  schemaVersion: 2,
  id: 'map000000001',
  title: 'Live test',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  root: {
    id: 'root00000001',
    text: 'Root',
    children: [{ id: 'aaaaaaaaaaaa', text: 'A', children: [] }],
  },
};

function emitOps(ops: unknown[], mapId = 'map000000001') {
  FakeEventSource.instances[0].emit('map-ops', { kind: 'map-ops', mapId, ops });
}

function emitOp(op: unknown, mapId = 'map000000001') {
  emitOps([op], mapId);
}

describe('livesync', () => {
  let cleanup: () => void;

  beforeEach(() => {
    vi.stubGlobal('EventSource', FakeEventSource);
    FakeEventSource.instances = [];
    useStore.getState().loadMap(structuredClone(mapFile));
    cleanup = initLiveSync('map000000001');
  });

  afterEach(() => {
    cleanup();
    useStore.getState().closeMap();
    vi.unstubAllGlobals();
  });

  it('applies an op through runCommand: undoable, marks dirty, keeps selection', () => {
    useStore.getState().select('aaaaaaaaaaaa');
    emitOp({ type: 'add_nodes', parentId: 'root00000001', branches: [{ id: 'bbbbbbbbbbbb', text: 'B', children: [] }] });

    const s = useStore.getState();
    expect(s.doc!.nodes.bbbbbbbbbbbb.text).toBe('B');
    expect(s.selectedId).toBe('aaaaaaaaaaaa'); // selection untouched
    expect(s.undoStack).toHaveLength(1);
    expect(s.undoStack[0].label).toBe('mcp.add_nodes');
    expect(s.saveState).toBe('dirty');

    s.undo();
    expect(useStore.getState().doc!.nodes.bbbbbbbbbbbb).toBeUndefined();
    useStore.getState().redo();
    expect(useStore.getState().doc!.nodes.bbbbbbbbbbbb.text).toBe('B');
  });

  it('a stale op is a clean no-op but still marks dirty (reconvergence)', () => {
    emitOp({ type: 'edit_node', nodeId: 'gone00000000', text: 'x' });
    const s = useStore.getState();
    expect(s.undoStack).toHaveLength(0); // zero patches → no history entry
    expect(s.saveState).toBe('dirty'); // the browser re-asserts its doc anyway
  });

  it('ignores ops for other maps', () => {
    emitOp({ type: 'edit_node', nodeId: 'aaaaaaaaaaaa', text: 'x' }, 'othermap0001');
    const s = useStore.getState();
    expect(s.doc!.nodes.aaaaaaaaaaaa.text).toBe('A');
    expect(s.saveState).toBe('saved');
  });

  it('closes the node editor when the edited node is deleted externally', () => {
    useStore.getState().select('aaaaaaaaaaaa');
    useStore.getState().startEdit('append');
    expect(useStore.getState().editing?.nodeId).toBe('aaaaaaaaaaaa');
    emitOp({ type: 'delete_node', nodeId: 'aaaaaaaaaaaa' });
    const s = useStore.getState();
    expect(s.doc!.nodes.aaaaaaaaaaaa).toBeUndefined();
    expect(s.editing).toBeNull();
    expect(s.selectedId).toBe('root00000001'); // clamped
  });

  it('a batch is one undo entry: undo reverts all its ops together', () => {
    emitOps([
      { type: 'add_nodes', parentId: 'root00000001', branches: [{ id: 'bbbbbbbbbbbb', text: 'B', children: [] }] },
      { type: 'edit_node', nodeId: 'aaaaaaaaaaaa', text: 'A edited' },
      { type: 'add_relationship', relId: 'rel000000001', fromId: 'aaaaaaaaaaaa', toId: 'bbbbbbbbbbbb', label: 'links' },
    ]);
    const s = useStore.getState();
    expect(s.doc!.nodes.bbbbbbbbbbbb.text).toBe('B');
    expect(s.doc!.nodes.aaaaaaaaaaaa.text).toBe('A edited');
    expect(s.doc!.relationships).toEqual([{ id: 'rel000000001', from: 'aaaaaaaaaaaa', to: 'bbbbbbbbbbbb', label: 'links' }]);
    expect(s.undoStack).toHaveLength(1);
    expect(s.undoStack[0].label).toBe('mcp.batch');

    s.undo();
    const after = useStore.getState();
    expect(after.doc!.nodes.bbbbbbbbbbbb).toBeUndefined();
    expect(after.doc!.nodes.aaaaaaaaaaaa.text).toBe('A');
    expect(after.doc!.relationships).toEqual([]);
  });

  it('a partially stale batch applies the valid ops and still marks dirty', () => {
    emitOps([
      { type: 'edit_node', nodeId: 'gone00000000', text: 'x' }, // stale — silent no-op
      { type: 'edit_node', nodeId: 'aaaaaaaaaaaa', text: 'still applied' },
    ]);
    const s = useStore.getState();
    expect(s.doc!.nodes.aaaaaaaaaaaa.text).toBe('still applied');
    expect(s.undoStack).toHaveLength(1);
    expect(s.saveState).toBe('dirty');
  });

  it('a create_tree op in a batch replays live and undoes as one step', () => {
    emitOps([
      { type: 'create_tree', root: { id: 'tree00000001', text: 'Floating', children: [] }, pos: { x: 400, y: 50 } },
      { type: 'add_relationship', relId: 'rel000000009', fromId: 'aaaaaaaaaaaa', toId: 'tree00000001' },
    ]);
    const s = useStore.getState();
    expect(s.doc!.nodes.tree00000001.text).toBe('Floating');
    expect(s.doc!.floating).toEqual([{ rootId: 'tree00000001', pos: { x: 400, y: 50 } }]);
    expect(s.doc!.relationships).toHaveLength(1);
    expect(s.undoStack).toHaveLength(1);
    s.undo();
    const after = useStore.getState();
    expect(after.doc!.nodes.tree00000001).toBeUndefined();
    expect(after.doc!.floating).toEqual([]);
    expect(after.doc!.relationships).toEqual([]);
  });

  it('set_node_meta replays live and undo restores the prior metadata', () => {
    emitOp({ type: 'set_node_meta', nodeId: 'aaaaaaaaaaaa', color: 'sage', icon: '💡', tags: ['idea'] });
    let s = useStore.getState();
    expect(s.doc!.nodes.aaaaaaaaaaaa).toMatchObject({ color: 'sage', icon: '💡', tags: ['idea'] });
    expect(s.undoStack).toHaveLength(1);
    expect(s.undoStack[0].label).toBe('mcp.set_node_meta');

    emitOp({ type: 'set_node_meta', nodeId: 'aaaaaaaaaaaa', color: 'rose', icon: null });
    s = useStore.getState();
    expect(s.doc!.nodes.aaaaaaaaaaaa.color).toBe('rose');
    expect(s.doc!.nodes.aaaaaaaaaaaa.icon).toBeUndefined();
    expect(s.doc!.nodes.aaaaaaaaaaaa.tags).toEqual(['idea']); // untouched

    s.undo();
    expect(useStore.getState().doc!.nodes.aaaaaaaaaaaa).toMatchObject({ color: 'sage', icon: '💡' });
  });

  it('close() detaches the stream', () => {
    cleanup();
    expect(FakeEventSource.instances[0].closed).toBe(true);
  });
});
