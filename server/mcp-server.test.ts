import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { MapFile } from '../src/model/types';
import { subscribe, type ServerEvent } from './events';

let mapsDir: string;

beforeAll(() => {
  mapsDir = mkdtempSync(path.join(tmpdir(), 'mind-map-mcp-'));
  process.env.MAPS_DIR = mapsDir;
});

afterAll(() => {
  rmSync(mapsDir, { recursive: true, force: true });
});

async function createClient() {
  const { createMcpServer } = await import('./mcp-server.js');
  const server = createMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.1.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function textContent(result: unknown): string {
  const r = result as { content?: Array<{ type?: string; text?: string }> };
  return (r.content ?? []).map((c) => (c.type === 'text' ? c.text ?? '' : '')).join('');
}

describe('mcp-server tools', () => {
  it('get_project_context returns the MCP guide and schema', async () => {
    const client = await createClient();
    const result = await client.callTool({ name: 'get_project_context', arguments: {} });
    const text = textContent(result);
    expect(text).toContain('# Mind Map MCP Guide');
    expect(text).toContain('MapFile schema version');
    expect(text).toContain('apply_ops');
  });

  it('exposes the MCP guide as a resource', async () => {
    const client = await createClient();
    const resources = await client.listResources();
    const uris = resources.resources.map((r) => r.uri);
    expect(uris).toContain('docs://mcp');

    const resource = await client.readResource({ uri: 'docs://mcp' });
    const first = (resource as { contents?: Array<{ text?: string }> }).contents?.[0];
    expect(first?.text).toContain('# Mind Map MCP Guide');
  });

  it('create_map_from_outline creates a map and list_maps finds it', async () => {
    const client = await createClient();

    const createResult = await client.callTool({
      name: 'create_map_from_outline',
      arguments: {
        title: 'My test map',
        markdown: '- First\n  - Child A\n  - Child B\n- Second',
      },
    });
    expect(createResult.isError).toBeFalsy();
    const createText = textContent(createResult);
    expect(createText).toMatch(/Created map "My test map" \(id: [A-Za-z0-9_-]+\)/);
    const mapId = createText.match(/id: ([A-Za-z0-9_-]+)/)?.[1];
    expect(mapId).toBeDefined();

    const listResult = await client.callTool({ name: 'list_maps', arguments: {} });
    expect(textContent(listResult)).toContain('My test map');

    const readResult = await client.callTool({ name: 'read_map', arguments: { map_id: mapId } });
    const map = JSON.parse(textContent(readResult)) as MapFile;
    expect(map.title).toBe('My test map');
    expect(map.root.children).toHaveLength(2);
    expect(map.root.children[0].children).toHaveLength(2);
    expect(map.root.children[0].id).not.toBe('paste');
  });

  it('read_map_markdown returns a nested outline', async () => {
    const client = await createClient();
    const createResult = await client.callTool({
      name: 'create_map_from_outline',
      arguments: {
        title: 'Markdown round-trip',
        markdown: '- Alpha\n  - Beta',
      },
    });
    const mapId = textContent(createResult).match(/id: ([A-Za-z0-9_-]+)/)?.[1]!;

    const readResult = await client.callTool({ name: 'read_map_markdown', arguments: { map_id: mapId } });
    const text = textContent(readResult);
    expect(text).toContain('# Markdown round-trip');
    expect(text).toContain('- Alpha');
    expect(text).toContain('- Beta');
  });

  it('returns an error for invalid map ids', async () => {
    const client = await createClient();
    const result = await client.callTool({ name: 'read_map', arguments: { map_id: 'bad id!' } });
    expect(result.isError).toBe(true);
    expect(textContent(result)).toContain('invalid map id');
  });

  it('add_nodes inserts under a parent, returns ids, and publishes one map-op', async () => {
    const client = await createClient();
    const createText = textContent(
      await client.callTool({
        name: 'create_map_from_outline',
        arguments: { title: 'Edit target', markdown: '- Alpha' },
      }),
    );
    const mapId = createText.match(/id: ([A-Za-z0-9_-]+)/)?.[1]!;
    const before = JSON.parse(
      textContent(await client.callTool({ name: 'read_map', arguments: { map_id: mapId } })),
    ) as MapFile;
    const alphaId = before.root.children[0].id;

    const events: ServerEvent[] = [];
    const unsub = subscribe((e) => events.push(e));
    const result = await client.callTool({
      name: 'add_nodes',
      arguments: { map_id: mapId, parent_id: alphaId, markdown: '- New\n  - Nested' },
    });
    unsub();

    expect(result.isError).toBeFalsy();
    const text = textContent(result);
    expect(text).toMatch(/- New \(id: [A-Za-z0-9_-]{12}\)/);
    expect(text).toMatch(/ {2}- Nested \(id: [A-Za-z0-9_-]{12}\)/);
    const newId = text.match(/- New \(id: ([A-Za-z0-9_-]{12})\)/)?.[1];

    const after = JSON.parse(
      textContent(await client.callTool({ name: 'read_map', arguments: { map_id: mapId } })),
    ) as MapFile;
    expect(after.root.children[0].children.map((n) => n.id)).toContain(newId);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: 'map-ops', mapId, ops: [{ type: 'add_nodes', parentId: alphaId }] });
  });

  it('edit_node changes only the target and preserves sibling ids and metadata', async () => {
    const client = await createClient();
    const createText = textContent(
      await client.callTool({
        name: 'create_map_from_outline',
        arguments: { title: 'Preserve test', markdown: '- One\n- Two' },
      }),
    );
    const mapId = createText.match(/id: ([A-Za-z0-9_-]+)/)?.[1]!;
    // Pre-set metadata on "Two" by editing the file directly.
    const file = path.join(mapsDir, `${mapId}.json`);
    const raw = JSON.parse(readFileSync(file, 'utf8')) as MapFile;
    raw.root.children[1].note = 'keep me';
    writeFileSync(file, JSON.stringify(raw, null, 2));
    const oneId = raw.root.children[0].id;

    const result = await client.callTool({
      name: 'edit_node',
      arguments: { map_id: mapId, node_id: oneId, text: 'One **renamed**' },
    });
    expect(result.isError).toBeFalsy();

    const after = JSON.parse(readFileSync(file, 'utf8')) as MapFile;
    expect(after.root.children[0]).toMatchObject({ id: oneId, text: 'One **renamed**' });
    expect(after.root.children[1]).toMatchObject({ id: raw.root.children[1].id, note: 'keep me' });
  });

  it('move_node rejects cycles and delete_node prunes relationships', async () => {
    const client = await createClient();
    const createText = textContent(
      await client.callTool({
        name: 'create_map_from_outline',
        arguments: { title: 'Move/delete test', markdown: '- A\n  - A1\n- B' },
      }),
    );
    const mapId = createText.match(/id: ([A-Za-z0-9_-]+)/)?.[1]!;
    const file = path.join(mapsDir, `${mapId}.json`);
    const raw = JSON.parse(readFileSync(file, 'utf8')) as MapFile;
    const [a, b] = raw.root.children;
    const a1 = a.children[0];
    raw.relationships = [
      { id: 'rel-1', from: a1.id, to: b.id },
      { id: 'rel-2', from: b.id, to: raw.root.id },
    ];
    writeFileSync(file, JSON.stringify(raw, null, 2));

    const cycle = await client.callTool({
      name: 'move_node',
      arguments: { map_id: mapId, node_id: a.id, new_parent_id: a1.id },
    });
    expect(cycle.isError).toBe(true);
    expect(textContent(cycle)).toContain('own subtree');

    const moved = await client.callTool({
      name: 'move_node',
      arguments: { map_id: mapId, node_id: a1.id, new_parent_id: b.id },
    });
    expect(moved.isError).toBeFalsy();

    const deleted = await client.callTool({ name: 'delete_node', arguments: { map_id: mapId, node_id: b.id } });
    expect(deleted.isError).toBeFalsy();

    const after = JSON.parse(readFileSync(file, 'utf8')) as MapFile;
    expect(after.root.children.map((n) => n.id)).toEqual([a.id]);
    expect(after.relationships).toBeUndefined(); // both arrows touched deleted nodes

    const root = await client.callTool({ name: 'delete_node', arguments: { map_id: mapId, node_id: after.root.id } });
    expect(root.isError).toBe(true);
    expect(textContent(root)).toContain('root');
  });

  it('generate_map is gone — the connected LLM generates outlines itself', async () => {
    const client = await createClient();
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).not.toContain('generate_map');
    expect(names).toContain('create_map_from_outline');
  });

  it('relationship tools round-trip: add returns an id, edit relabels, delete removes', async () => {
    const client = await createClient();
    const createText = textContent(
      await client.callTool({
        name: 'create_map_from_outline',
        arguments: { title: 'Arrows', markdown: '- One\n- Two' },
      }),
    );
    const mapId = createText.match(/id: ([A-Za-z0-9_-]+)/)?.[1]!;
    const file = path.join(mapsDir, `${mapId}.json`);
    const raw = JSON.parse(readFileSync(file, 'utf8')) as MapFile;
    const [one, two] = raw.root.children;

    const added = await client.callTool({
      name: 'add_relationship',
      arguments: { map_id: mapId, from_id: one.id, to_id: two.id, label: 'depends on' },
    });
    expect(added.isError).toBeFalsy();
    const relId = textContent(added).match(/relationship ([A-Za-z0-9_-]{12})/)?.[1]!;
    expect(relId).toBeDefined();
    let saved = JSON.parse(readFileSync(file, 'utf8')) as MapFile;
    expect(saved.relationships).toEqual([{ id: relId, from: one.id, to: two.id, label: 'depends on' }]);

    // duplicate from→to rejected
    const dup = await client.callTool({
      name: 'add_relationship',
      arguments: { map_id: mapId, from_id: one.id, to_id: two.id },
    });
    expect(dup.isError).toBe(true);
    expect(textContent(dup)).toContain('already exists');

    const edited = await client.callTool({
      name: 'edit_relationship',
      arguments: { map_id: mapId, relationship_id: relId, label: '' },
    });
    expect(edited.isError).toBeFalsy();
    saved = JSON.parse(readFileSync(file, 'utf8')) as MapFile;
    expect(saved.relationships![0].label).toBeUndefined();

    const deleted = await client.callTool({
      name: 'delete_relationship',
      arguments: { map_id: mapId, relationship_id: relId },
    });
    expect(deleted.isError).toBeFalsy();
    saved = JSON.parse(readFileSync(file, 'utf8')) as MapFile;
    expect(saved.relationships).toBeUndefined();
  });

  it('apply_ops applies a mixed batch atomically and publishes one map-ops event', async () => {
    const client = await createClient();
    const createText = textContent(
      await client.callTool({
        name: 'create_map_from_outline',
        arguments: { title: 'Batch', markdown: '- A\n- B' },
      }),
    );
    const mapId = createText.match(/id: ([A-Za-z0-9_-]+)/)?.[1]!;
    const file = path.join(mapsDir, `${mapId}.json`);
    const raw = JSON.parse(readFileSync(file, 'utf8')) as MapFile;
    const [a, b] = raw.root.children;

    const events: ServerEvent[] = [];
    const unsub = subscribe((e) => events.push(e));
    const result = await client.callTool({
      name: 'apply_ops',
      arguments: {
        map_id: mapId,
        ops: [
          { op: 'add_nodes', parent_id: a.id, markdown: '- A1' },
          { op: 'edit_node', node_id: b.id, text: 'B renamed' },
          { op: 'add_relationship', from_id: a.id, to_id: b.id, label: 'sees' },
        ],
      },
    });
    unsub();

    expect(result.isError).toBeFalsy();
    const text = textContent(result);
    expect(text).toContain('Applied 3 ops');
    const a1Id = text.match(/- A1 \(id: ([A-Za-z0-9_-]{12})\)/)?.[1];
    expect(a1Id).toBeDefined();

    const saved = JSON.parse(readFileSync(file, 'utf8')) as MapFile;
    expect(saved.root.children[0].children.map((n) => n.id)).toContain(a1Id);
    expect(saved.root.children[1].text).toBe('B renamed');
    expect(saved.relationships).toHaveLength(1);
    expect(events.filter((e) => e.kind === 'map-ops')).toHaveLength(1);
  });

  it('apply_ops is all-or-nothing: a mid-batch failure leaves the file untouched', async () => {
    const client = await createClient();
    const createText = textContent(
      await client.callTool({
        name: 'create_map_from_outline',
        arguments: { title: 'Atomic', markdown: '- A' },
      }),
    );
    const mapId = createText.match(/id: ([A-Za-z0-9_-]+)/)?.[1]!;
    const file = path.join(mapsDir, `${mapId}.json`);
    const before = readFileSync(file, 'utf8');
    const aId = (JSON.parse(before) as MapFile).root.children[0].id;

    const events: ServerEvent[] = [];
    const unsub = subscribe((e) => events.push(e));
    const result = await client.callTool({
      name: 'apply_ops',
      arguments: {
        map_id: mapId,
        ops: [
          { op: 'edit_node', node_id: aId, text: 'changed' },
          { op: 'delete_node', node_id: 'missing00000' }, // fails
        ],
      },
    });
    unsub();

    expect(result.isError).toBe(true);
    expect(textContent(result)).toContain('op 1 (delete_node)');
    expect(textContent(result)).toContain('no changes were applied');
    expect(readFileSync(file, 'utf8')).toBe(before);
    expect(events).toHaveLength(0);
  });

  it('read_map_markdown is id-annotated and lists relationships', async () => {
    const client = await createClient();
    const createText = textContent(
      await client.callTool({
        name: 'create_map_from_outline',
        arguments: { title: 'Annotated', markdown: '- First\n- Second' },
      }),
    );
    const mapId = createText.match(/id: ([A-Za-z0-9_-]+)/)?.[1]!;
    const raw = JSON.parse(readFileSync(path.join(mapsDir, `${mapId}.json`), 'utf8')) as MapFile;
    const [first, second] = raw.root.children;
    await client.callTool({
      name: 'add_relationship',
      arguments: { map_id: mapId, from_id: first.id, to_id: second.id, label: 'then' },
    });

    const text = textContent(await client.callTool({ name: 'read_map_markdown', arguments: { map_id: mapId } }));
    expect(text).toContain(`- First (id: ${first.id})`);
    expect(text).toContain('## Relationships');
    expect(text).toContain(`${first.id} ("First") -> ${second.id} ("Second") — "then"`);
  });

  it('get_subtree respects depth and scopes relationships to the branch', async () => {
    const client = await createClient();
    const createText = textContent(
      await client.callTool({
        name: 'create_map_from_outline',
        arguments: { title: 'Subtree', markdown: '- A\n  - A1\n    - A1a\n- B' },
      }),
    );
    const mapId = createText.match(/id: ([A-Za-z0-9_-]+)/)?.[1]!;
    const raw = JSON.parse(readFileSync(path.join(mapsDir, `${mapId}.json`), 'utf8')) as MapFile;
    const [a, b] = raw.root.children;
    const a1 = a.children[0];
    await client.callTool({
      name: 'add_relationship',
      arguments: { map_id: mapId, from_id: a1.id, to_id: b.id },
    });

    const shallow = textContent(
      await client.callTool({ name: 'get_subtree', arguments: { map_id: mapId, node_id: a.id, depth: 1 } }),
    );
    expect(shallow).toContain(`- A (id: ${a.id})`);
    expect(shallow).toContain(`- A1 (id: ${a1.id}) … (+1 children hidden)`);
    expect(shallow).not.toContain('A1a');
    expect(shallow).toContain('## Relationships'); // a1 -> b touches the branch

    const bBranch = textContent(
      await client.callTool({ name: 'get_subtree', arguments: { map_id: mapId, node_id: b.id } }),
    );
    expect(bBranch).toContain('## Relationships'); // arrow touches b too
  });

  it('create_tree makes a floating tree, enforces one top-level bullet, auto-places', async () => {
    const client = await createClient();
    const createText = textContent(
      await client.callTool({ name: 'create_map_from_outline', arguments: { title: 'Floaty', markdown: '- Main' } }),
    );
    const mapId = createText.match(/id: ([A-Za-z0-9_-]+)/)?.[1]!;

    const multi = await client.callTool({
      name: 'create_tree',
      arguments: { map_id: mapId, markdown: '- One\n- Two' },
    });
    expect(multi.isError).toBe(true);
    expect(textContent(multi)).toContain('multiple top-level bullets');

    const made = await client.callTool({
      name: 'create_tree',
      arguments: { map_id: mapId, markdown: '- Idea cloud\n  - Spark', x: 500, y: 120 },
    });
    expect(made.isError).toBeFalsy();
    expect(textContent(made)).toContain('at (500, 120)');
    const treeRootId = textContent(made).match(/- Idea cloud \(id: ([A-Za-z0-9_-]{12})\)/)?.[1]!;

    // auto-placement lands below the existing floating tree
    const auto = await client.callTool({ name: 'create_tree', arguments: { map_id: mapId, markdown: '- Second' } });
    expect(auto.isError).toBeFalsy();
    expect(textContent(auto)).toContain('at (0, 320)'); // 120 + 200

    const file = path.join(mapsDir, `${mapId}.json`);
    const saved = JSON.parse(readFileSync(file, 'utf8')) as MapFile;
    expect(saved.floating).toHaveLength(2);
    expect(saved.floating![0].root.id).toBe(treeRootId);

    // reads: floating section + find_nodes reach into floating trees
    const md = textContent(await client.callTool({ name: 'read_map_markdown', arguments: { map_id: mapId } }));
    expect(md).toContain('## Floating trees');
    expect(md).toContain(`- Idea cloud (id: ${treeRootId})`);
    const found = textContent(await client.callTool({ name: 'find_nodes', arguments: { query: 'spark', map_id: mapId } }));
    expect(found).toContain('path: Idea cloud');

    // attach via move_node, then delete the other tree via delete_node
    const mainRootId = saved.root.id;
    const attach = await client.callTool({
      name: 'move_node',
      arguments: { map_id: mapId, node_id: treeRootId, new_parent_id: mainRootId },
    });
    expect(attach.isError).toBeFalsy();
    const afterAttach = JSON.parse(readFileSync(file, 'utf8')) as MapFile;
    expect(afterAttach.floating).toHaveLength(1);
    expect(afterAttach.root.children.map((n) => n.id)).toContain(treeRootId);

    const del = await client.callTool({
      name: 'delete_node',
      arguments: { map_id: mapId, node_id: afterAttach.floating![0].root.id },
    });
    expect(del.isError).toBeFalsy();
    const afterDelete = JSON.parse(readFileSync(file, 'utf8')) as MapFile;
    expect(afterDelete.floating).toBeUndefined();
  });

  it('detach_node splits a branch out; apply_ops mixes tree ops atomically', async () => {
    const client = await createClient();
    const createText = textContent(
      await client.callTool({
        name: 'create_map_from_outline',
        arguments: { title: 'Detach', markdown: '- Keep\n- Split\n  - Child' },
      }),
    );
    const mapId = createText.match(/id: ([A-Za-z0-9_-]+)/)?.[1]!;
    const file = path.join(mapsDir, `${mapId}.json`);
    const raw = JSON.parse(readFileSync(file, 'utf8')) as MapFile;
    const splitId = raw.root.children[1].id;

    const detached = await client.callTool({
      name: 'detach_node',
      arguments: { map_id: mapId, node_id: splitId, x: 700, y: 10 },
    });
    expect(detached.isError).toBeFalsy();
    let saved = JSON.parse(readFileSync(file, 'utf8')) as MapFile;
    expect(saved.root.children).toHaveLength(1);
    expect(saved.floating![0]).toMatchObject({ pos: { x: 700, y: 10 }, root: { id: splitId } });
    expect(saved.floating![0].root.children).toHaveLength(1); // subtree intact

    const batch = await client.callTool({
      name: 'apply_ops',
      arguments: {
        map_id: mapId,
        ops: [
          { op: 'create_tree', markdown: '- Batch tree', x: 900, y: 0 },
          { op: 'move_node', node_id: splitId, new_parent_id: raw.root.id }, // attach back
        ],
      },
    });
    expect(batch.isError).toBeFalsy();
    saved = JSON.parse(readFileSync(file, 'utf8')) as MapFile;
    expect(saved.floating).toHaveLength(1);
    expect(saved.floating![0].root.text).toBe('Batch tree');
    expect(saved.root.children.map((n) => n.id)).toContain(splitId);

    // all-or-nothing still holds with tree ops in the batch
    const before = readFileSync(file, 'utf8');
    const failing = await client.callTool({
      name: 'apply_ops',
      arguments: {
        map_id: mapId,
        ops: [
          { op: 'create_tree', markdown: '- Doomed', x: 0, y: 900 },
          { op: 'detach_node', node_id: 'missing00000', x: 0, y: 0 },
        ],
      },
    });
    expect(failing.isError).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('set_node_meta sets, clears via sentinels, rejects bad colors; reads show annotations', async () => {
    const client = await createClient();
    const createText = textContent(
      await client.callTool({
        name: 'create_map_from_outline',
        arguments: { title: 'Meta', markdown: '- Pricing model\n- Other' },
      }),
    );
    const mapId = createText.match(/id: ([A-Za-z0-9_-]+)/)?.[1]!;
    const file = path.join(mapsDir, `${mapId}.json`);
    const nodeId = (JSON.parse(readFileSync(file, 'utf8')) as MapFile).root.children[0].id;

    const set = await client.callTool({
      name: 'set_node_meta',
      arguments: { map_id: mapId, node_id: nodeId, color: 'sage', icon: '❓', note: 'open question', tags: ['pricing', 'v2'] },
    });
    expect(set.isError).toBeFalsy();
    let saved = JSON.parse(readFileSync(file, 'utf8')) as MapFile;
    expect(saved.root.children[0]).toMatchObject({
      color: 'sage',
      icon: '❓',
      note: 'open question',
      tags: ['pricing', 'v2'],
    });

    const md = textContent(await client.callTool({ name: 'read_map_markdown', arguments: { map_id: mapId } }));
    expect(md).toContain(`- ❓ Pricing model (id: ${nodeId}) [sage] #pricing #v2`);
    expect(md).toContain('  > open question');

    const bad = await client.callTool({
      name: 'set_node_meta',
      arguments: { map_id: mapId, node_id: nodeId, color: 'crimson' },
    });
    expect(bad.isError).toBe(true); // zod enum rejects before the op even runs

    const cleared = await client.callTool({
      name: 'set_node_meta',
      arguments: { map_id: mapId, node_id: nodeId, color: 'none', icon: '', note: '', tags: [] },
    });
    expect(cleared.isError).toBeFalsy();
    saved = JSON.parse(readFileSync(file, 'utf8')) as MapFile;
    expect(saved.root.children[0].color).toBeUndefined();
    expect(saved.root.children[0].icon).toBeUndefined();
    expect(saved.root.children[0].note).toBeUndefined();
    expect(saved.root.children[0].tags).toBeUndefined();
  });

  it('apply_ops with a bad set_node_meta aborts atomically; find_nodes filters by tags', async () => {
    const client = await createClient();
    const createText = textContent(
      await client.callTool({
        name: 'create_map_from_outline',
        arguments: { title: 'TagSearch', markdown: '- Alpha\n- Beta' },
      }),
    );
    const mapId = createText.match(/id: ([A-Za-z0-9_-]+)/)?.[1]!;
    const file = path.join(mapsDir, `${mapId}.json`);
    const raw = JSON.parse(readFileSync(file, 'utf8')) as MapFile;
    const [alpha, beta] = raw.root.children;

    await client.callTool({
      name: 'apply_ops',
      arguments: {
        map_id: mapId,
        ops: [
          { op: 'set_node_meta', node_id: alpha.id, tags: ['urgent', 'ops'] },
          { op: 'set_node_meta', node_id: beta.id, tags: ['ops'] },
        ],
      },
    });

    // atomic abort: valid eop then an op with a too-long tag
    const before = readFileSync(file, 'utf8');
    const failing = await client.callTool({
      name: 'apply_ops',
      arguments: {
        map_id: mapId,
        ops: [
          { op: 'edit_node', node_id: alpha.id, text: 'changed' },
          { op: 'set_node_meta', node_id: beta.id, tags: ['x'.repeat(25)] },
        ],
      },
    });
    expect(failing.isError).toBe(true);
    expect(textContent(failing)).toContain('op 1 (set_node_meta)');
    expect(readFileSync(file, 'utf8')).toBe(before);

    // tags-only search, AND semantics
    const both = textContent(
      await client.callTool({ name: 'find_nodes', arguments: { map_id: mapId, tags: ['ops', 'urgent'] } }),
    );
    expect(both).toContain(alpha.id);
    expect(both).not.toContain(beta.id);
    expect(both).toContain('#urgent #ops');

    // query + tags combined
    const combined = textContent(
      await client.callTool({ name: 'find_nodes', arguments: { map_id: mapId, query: 'beta', tags: ['ops'] } }),
    );
    expect(combined).toContain(beta.id);
    expect(combined).not.toContain(alpha.id);

    // neither → schema-level error
    const neither = await client.callTool({ name: 'find_nodes', arguments: { map_id: mapId } });
    expect(neither.isError).toBe(true);
  });

  it('find_nodes searches one map or all maps with paths', async () => {
    const client = await createClient();
    const mk = async (title: string, markdown: string) => {
      const text = textContent(
        await client.callTool({ name: 'create_map_from_outline', arguments: { title, markdown } }),
      );
      return text.match(/id: ([A-Za-z0-9_-]+)/)?.[1]!;
    };
    const m1 = await mk('Search one', '- Alpha\n  - needle here');
    const m2 = await mk('Search two', '- needle top\n- other');

    const scoped = textContent(
      await client.callTool({ name: 'find_nodes', arguments: { query: 'NEEDLE', map_id: m1 } }),
    );
    expect(scoped).toContain('needle here');
    expect(scoped).not.toContain('needle top');
    expect(scoped).toContain('path: Search one > Alpha');

    const global = textContent(await client.callTool({ name: 'find_nodes', arguments: { query: 'needle' } }));
    expect(global).toContain(`map ${m1}`);
    expect(global).toContain(`map ${m2}`);

    const none = textContent(await client.callTool({ name: 'find_nodes', arguments: { query: 'zzzznope' } }));
    expect(none).toBe('No matches.');
  });
  it('group tools: add, read back, edit, prune on delete, delete', async () => {
    const client = await createClient();
    const created = textContent(
      await client.callTool({
        name: 'create_map_from_outline',
        arguments: { title: 'Grouped', markdown: '- Alpha\n  - A1\n- Beta\n- Gamma' },
      }),
    );
    const mapId = created.match(/id: ([A-Za-z0-9_-]+)/)?.[1]!;
    const read = async () =>
      JSON.parse(textContent(await client.callTool({ name: 'read_map', arguments: { map_id: mapId } }))) as MapFile;
    let map = await read();
    const [alpha, beta, gamma] = map.root.children;
    const a1 = alpha.children[0];

    // add_group across different parents (A1 under Alpha, Beta under root)
    const added = await client.callTool({
      name: 'add_group',
      arguments: { map_id: mapId, member_ids: [a1.id, beta.id, gamma.id], label: 'theme', color: 'sage' },
    });
    expect(added.isError).toBeFalsy();
    const groupId = textContent(added).match(/group ([A-Za-z0-9_-]+)/)?.[1]!;
    map = await read();
    expect(map.groups).toEqual([{ id: groupId, members: [a1.id, beta.id, gamma.id], label: 'theme', color: 'sage' }]);

    // the markdown read surfaces the group
    const md = textContent(await client.callTool({ name: 'read_map_markdown', arguments: { map_id: mapId } }));
    expect(md).toContain('## Groups');
    expect(md).toContain(`[${groupId}] "theme"`);

    // and get_subtree scopes to groups touching the branch
    const sub = textContent(
      await client.callTool({ name: 'get_subtree', arguments: { map_id: mapId, node_id: alpha.id } }),
    );
    expect(sub).toContain('## Groups');

    // edit: replace members, clear label and color
    const edited = await client.callTool({
      name: 'edit_group',
      arguments: { map_id: mapId, group_id: groupId, member_ids: [beta.id, gamma.id], label: '', color: 'none' },
    });
    expect(edited.isError).toBeFalsy();
    map = await read();
    expect(map.groups).toEqual([{ id: groupId, members: [beta.id, gamma.id] }]);

    // deleting a member prunes it; below 2 the group dissolves and the key drops from the file
    await client.callTool({ name: 'delete_node', arguments: { map_id: mapId, node_id: beta.id } });
    map = await read();
    expect(map.groups).toBeUndefined();

    // validation errors surface loudly
    const tooFew = await client.callTool({
      name: 'add_group',
      arguments: { map_id: mapId, member_ids: [gamma.id, gamma.id] },
    });
    expect(tooFew.isError).toBe(true);
    expect(textContent(tooFew)).toContain('at least 2');
    const missing = await client.callTool({
      name: 'delete_group',
      arguments: { map_id: mapId, group_id: 'nope' },
    });
    expect(missing.isError).toBe(true);
  });

  it('apply_ops creates groups atomically alongside other edits', async () => {
    const client = await createClient();
    const created = textContent(
      await client.callTool({
        name: 'create_map_from_outline',
        arguments: { title: 'Batch groups', markdown: '- One\n- Two' },
      }),
    );
    const mapId = created.match(/id: ([A-Za-z0-9_-]+)/)?.[1]!;
    const map = JSON.parse(
      textContent(await client.callTool({ name: 'read_map', arguments: { map_id: mapId } })),
    ) as MapFile;
    const [one, two] = map.root.children;
    const result = await client.callTool({
      name: 'apply_ops',
      arguments: {
        map_id: mapId,
        ops: [
          { op: 'add_group', member_ids: [one.id, two.id], label: 'pair' },
          { op: 'edit_node', node_id: one.id, text: 'One!' },
        ],
      },
    });
    expect(result.isError).toBeFalsy();
    expect(textContent(result)).toContain('add_group');
    const after = JSON.parse(
      textContent(await client.callTool({ name: 'read_map', arguments: { map_id: mapId } })),
    ) as MapFile;
    expect(after.groups).toHaveLength(1);
    expect(after.groups![0].label).toBe('pair');
    expect(after.root.children[0].text).toBe('One!');

    // a failing group op aborts the whole batch
    const failing = await client.callTool({
      name: 'apply_ops',
      arguments: {
        map_id: mapId,
        ops: [
          { op: 'edit_node', node_id: one.id, text: 'clobbered' },
          { op: 'add_group', member_ids: [one.id, 'ghost'] },
        ],
      },
    });
    expect(failing.isError).toBe(true);
    const unchanged = JSON.parse(
      textContent(await client.callTool({ name: 'read_map', arguments: { map_id: mapId } })),
    ) as MapFile;
    expect(unchanged.root.children[0].text).toBe('One!');
  });
});
