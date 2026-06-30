import { applyPatches, enablePatches, produceWithPatches, type Draft, type Patch } from 'immer';
import { describe, expect, it } from 'vitest';
import { normalize } from '../model/doc';
import { LAYOUT_STYLES, type Doc } from '../model/types';
import * as cmd from './commands';
import type { CommandResult } from './commands';

enablePatches();

/** Minimal replica of the store's executor: command in, patch pair out. */
function execute(doc: Doc, fn: (draft: Draft<Doc>) => CommandResult) {
  let result: CommandResult = {};
  const [next, patches, inversePatches] = produceWithPatches(doc, (draft: Draft<Doc>) => {
    result = fn(draft) ?? {};
  });
  return { next, patches, inversePatches, result };
}

/** Deterministic LCG so failures reproduce. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function randomNodeId(doc: Doc, rand: () => number): string {
  const ids = Object.keys(doc.nodes);
  return ids[Math.floor(rand() * ids.length)];
}

describe('commands', () => {
  it('deleteSubtree removes the whole subtree and selects a sensible neighbor', () => {
    let doc = normalize({
      id: 'root',
      text: 'r',
      children: [
        { id: 'a', text: 'a', children: [{ id: 'a1', text: 'a1', children: [] }] },
        { id: 'b', text: 'b', children: [] },
      ],
    });
    const { next, result } = execute(doc, (d) => cmd.deleteSubtree(d, 'a'));
    doc = next;
    expect(Object.keys(doc.nodes).sort()).toEqual(['b', 'root']);
    expect(doc.nodes.root.children).toEqual(['b']);
    expect(result.select).toBe('b');
  });

  it('deleting the root only clears its text', () => {
    const doc = normalize({ id: 'root', text: 'keep me', children: [] });
    const { next } = execute(doc, (d) => cmd.deleteSubtree(d, 'root'));
    expect(next.nodes.root).toBeDefined();
    expect(next.nodes.root.text).toBe('');
  });

  it('addSibling is a no-op on the root', () => {
    const doc = normalize({ id: 'root', text: 'r', children: [] });
    const { patches } = execute(doc, (d) => cmd.addSibling(d, 'root', 1));
    expect(patches).toHaveLength(0);
  });

  it('pasteBranches regenerates ids and selects the first pasted node', () => {
    const doc = normalize({ id: 'root', text: 'r', children: [] });
    const { next, result } = execute(doc, (d) =>
      cmd.pasteBranches(d, 'root', [
        { id: 'x', text: 'one', children: [{ id: 'y', text: 'two', children: [] }] },
      ]),
    );
    expect(next.nodes.x).toBeUndefined();
    expect(next.nodes.root.children).toHaveLength(1);
    const pastedId = next.nodes.root.children[0];
    expect(result.select).toBe(pastedId);
    expect(next.nodes[pastedId].text).toBe('one');
    expect(next.nodes[next.nodes[pastedId].children[0]].text).toBe('two');
  });

  describe('moveNode', () => {
    const tree = () =>
      normalize({
        id: 'root',
        text: 'r',
        children: [
          { id: 'a', text: 'a', children: [{ id: 'a1', text: 'a1', children: [] }] },
          { id: 'b', text: 'b', children: [] },
          { id: 'c', text: 'c', children: [] },
        ],
      });

    it('moves down within the same parent (anchor = sibling after next)', () => {
      const { next } = execute(tree(), (d) => cmd.moveNode(d, 'a', 'root', 'c'));
      expect(next.nodes.root.children).toEqual(['b', 'a', 'c']);
    });

    it('moves up within the same parent (anchor = previous sibling)', () => {
      const { next } = execute(tree(), (d) => cmd.moveNode(d, 'c', 'root', 'b'));
      expect(next.nodes.root.children).toEqual(['a', 'c', 'b']);
    });

    it('moves to the end with a null anchor', () => {
      const { next } = execute(tree(), (d) => cmd.moveNode(d, 'a', 'root', null));
      expect(next.nodes.root.children).toEqual(['b', 'c', 'a']);
    });

    it('reparents a subtree and selects the moved node', () => {
      const { next, result } = execute(tree(), (d) => cmd.moveNode(d, 'b', 'a', 'a1'));
      expect(next.nodes.root.children).toEqual(['a', 'c']);
      expect(next.nodes.a.children).toEqual(['b', 'a1']);
      expect(result.select).toBe('b');
    });

    it('expands a collapsed target in the same command', () => {
      const doc = tree();
      doc.nodes.a.collapsed = true;
      const { next, patches } = execute(doc, (d) => cmd.moveNode(d, 'b', 'a', null));
      expect(next.nodes.a.collapsed).toBe(false);
      expect(next.nodes.a.children).toEqual(['a1', 'b']);
      expect(patches.length).toBeGreaterThan(0); // one command, one history entry
    });

    it.each([
      ['root is unmovable', (d: Draft<Doc>) => cmd.moveNode(d, 'root', 'a', null)],
      ['cycle: into own subtree', (d: Draft<Doc>) => cmd.moveNode(d, 'a', 'a1', null)],
      ['cycle: into itself', (d: Draft<Doc>) => cmd.moveNode(d, 'a', 'a', null)],
      ['anchor is the node itself', (d: Draft<Doc>) => cmd.moveNode(d, 'b', 'root', 'b')],
      ['anchor not in new parent', (d: Draft<Doc>) => cmd.moveNode(d, 'b', 'a', 'c')],
      ['unchanged position (anchor = next sibling)', (d: Draft<Doc>) => cmd.moveNode(d, 'a', 'root', 'b')],
      ['unchanged position (last child, null anchor)', (d: Draft<Doc>) => cmd.moveNode(d, 'c', 'root', null)],
      ['missing node', (d: Draft<Doc>) => cmd.moveNode(d, 'nope', 'root', null)],
    ])('produces zero patches: %s', (_label, op) => {
      const { patches } = execute(tree(), op);
      expect(patches).toHaveLength(0);
    });
  });

  describe('setLayoutStyle', () => {
    it('produces a patch pair whose inverse restores the old style', () => {
      const doc = normalize({ id: 'root', text: 'r', children: [] });
      const { next, patches, inversePatches } = execute(doc, (d) => cmd.setLayoutStyle(d, 'balanced'));
      expect(next.layout).toBe('balanced');
      expect(patches.length).toBeGreaterThan(0);
      expect(applyPatches(next, inversePatches).layout).toBe('right');
    });

    it('same value → zero patches (no history entry)', () => {
      const doc = normalize({ id: 'root', text: 'r', children: [] });
      const { patches } = execute(doc, (d) => cmd.setLayoutStyle(d, 'right'));
      expect(patches).toHaveLength(0);
    });
  });

  describe('relationships', () => {
    const tree = () =>
      normalize({
        id: 'root',
        text: 'r',
        children: [
          { id: 'a', text: 'a', children: [{ id: 'a1', text: 'a1', children: [] }] },
          { id: 'b', text: 'b', children: [] },
        ],
      });

    it('addRelationship creates a from→to arrow', () => {
      const { next } = execute(tree(), (d) => cmd.addRelationship(d, 'a', 'b', 'r1'));
      expect(next.relationships).toEqual([{ id: 'r1', from: 'a', to: 'b' }]);
    });

    it.each([
      ['self-link', (d: Draft<Doc>) => cmd.addRelationship(d, 'a', 'a', 'r1')],
      ['missing source', (d: Draft<Doc>) => cmd.addRelationship(d, 'nope', 'b', 'r1')],
      ['missing target', (d: Draft<Doc>) => cmd.addRelationship(d, 'a', 'nope', 'r1')],
    ])('addRelationship is a no-op: %s', (_label, op) => {
      const { patches } = execute(tree(), op);
      expect(patches).toHaveLength(0);
    });

    it('addRelationship dedupes an existing from→to', () => {
      const doc = execute(tree(), (d) => cmd.addRelationship(d, 'a', 'b', 'r1')).next;
      const { patches } = execute(doc, (d) => cmd.addRelationship(d, 'a', 'b', 'r2'));
      expect(patches).toHaveLength(0);
    });

    it('setRelationshipLabel sets a trimmed label and clears it when blank', () => {
      let doc = execute(tree(), (d) => cmd.addRelationship(d, 'a', 'b', 'r1')).next;
      doc = execute(doc, (d) => cmd.setRelationshipLabel(d, 'r1', '  causes  ')).next;
      expect(doc.relationships[0].label).toBe('causes');
      doc = execute(doc, (d) => cmd.setRelationshipLabel(d, 'r1', '   ')).next;
      expect(doc.relationships[0].label).toBeUndefined();
    });

    it('deleteRelationship removes the arrow', () => {
      let doc = execute(tree(), (d) => cmd.addRelationship(d, 'a', 'b', 'r1')).next;
      doc = execute(doc, (d) => cmd.deleteRelationship(d, 'r1')).next;
      expect(doc.relationships).toEqual([]);
    });

    it('deleteSubtree prunes arrows touching any removed node', () => {
      let doc = execute(tree(), (d) => cmd.addRelationship(d, 'a1', 'b', 'r1')).next; // a1 inside subtree a
      doc = execute(doc, (d) => cmd.addRelationship(d, 'b', 'root', 'r2')).next; // unrelated, survives
      const { next } = execute(doc, (d) => cmd.deleteSubtree(d, 'a'));
      expect(next.relationships.map((r) => r.id)).toEqual(['r2']);
    });

    it('deleteSubtree is reversible: its inverse restores nodes and arrows together', () => {
      const doc = execute(tree(), (d) => cmd.addRelationship(d, 'a1', 'b', 'r1')).next;
      const { next, inversePatches } = execute(doc, (d) => cmd.deleteSubtree(d, 'a'));
      expect(applyPatches(next, inversePatches)).toEqual(doc);
    });
  });

  it('property: any random command sequence fully unwinds and replays via patches', () => {
    const rand = lcg(20260611);
    const initial = normalize({
      id: 'root',
      text: 'root',
      children: [
        { id: 's1', text: 'seed one', children: [] },
        { id: 's2', text: 'seed two', children: [] },
      ],
    });

    let doc = initial;
    const journal: { patches: Patch[]; inversePatches: Patch[] }[] = [];
    const ops = [
      (d: Draft<Doc>, id: string) => cmd.addChild(d, id),
      (d: Draft<Doc>, id: string) => cmd.addSibling(d, id, rand() < 0.5 ? 0 : 1),
      (d: Draft<Doc>, id: string) => cmd.editText(d, id, `text-${Math.floor(rand() * 1e6)}`),
      (d: Draft<Doc>, id: string) => cmd.deleteSubtree(d, id),
      (d: Draft<Doc>, id: string) => cmd.toggleCollapse(d, id),
      (d: Draft<Doc>, id: string) => {
        // hammer moveNode's guard ladder with arbitrary parents/anchors
        const ids = Object.keys(d.nodes);
        const parent = ids[Math.floor(rand() * ids.length)];
        const anchorPool = d.nodes[parent]?.children ?? [];
        const anchor = rand() < 0.34 ? null : (anchorPool[Math.floor(rand() * anchorPool.length)] ?? null);
        return cmd.moveNode(d, id, parent, anchor);
      },
      (d: Draft<Doc>) => cmd.setLayoutStyle(d, LAYOUT_STYLES[Math.floor(rand() * LAYOUT_STYLES.length)]),
      (d: Draft<Doc>, id: string) => {
        const ids = Object.keys(d.nodes);
        const to = ids[Math.floor(rand() * ids.length)];
        return cmd.addRelationship(d, id, to, `rel-${Math.floor(rand() * 1e9)}`);
      },
      (d: Draft<Doc>) => {
        const rel = d.relationships[Math.floor(rand() * d.relationships.length)];
        return rel ? cmd.setRelationshipLabel(d, rel.id, `label-${Math.floor(rand() * 1e6)}`) : {};
      },
      (d: Draft<Doc>) => {
        const rel = d.relationships[Math.floor(rand() * d.relationships.length)];
        return rel ? cmd.deleteRelationship(d, rel.id) : {};
      },
    ];

    for (let i = 0; i < 200; i++) {
      const id = randomNodeId(doc, rand);
      const op = ops[Math.floor(rand() * ops.length)];
      const { next, patches, inversePatches } = execute(doc, (d) => op(d, id));
      if (patches.length === 0) continue;
      journal.push({ patches, inversePatches });
      doc = next;
    }
    expect(journal.length).toBeGreaterThan(100);
    const final = doc;

    for (let i = journal.length - 1; i >= 0; i--) doc = applyPatches(doc, journal[i].inversePatches);
    expect(doc).toEqual(initial);

    for (const entry of journal) doc = applyPatches(doc, entry.patches);
    expect(doc).toEqual(final);
  });
});
