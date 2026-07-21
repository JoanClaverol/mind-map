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
    expect(text).toContain('generate_map');
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

  it('edit_node changes only the target and preserves sibling ids and todoId', async () => {
    const client = await createClient();
    const createText = textContent(
      await client.callTool({
        name: 'create_map_from_outline',
        arguments: { title: 'Preserve test', markdown: '- One\n- Two' },
      }),
    );
    const mapId = createText.match(/id: ([A-Za-z0-9_-]+)/)?.[1]!;
    // Simulate a pushed todo on "Two" by editing the file directly.
    const file = path.join(mapsDir, `${mapId}.json`);
    const raw = JSON.parse(readFileSync(file, 'utf8')) as MapFile;
    raw.root.children[1].todoId = 'todo-42';
    writeFileSync(file, JSON.stringify(raw, null, 2));
    const oneId = raw.root.children[0].id;

    const result = await client.callTool({
      name: 'edit_node',
      arguments: { map_id: mapId, node_id: oneId, text: 'One **renamed**' },
    });
    expect(result.isError).toBeFalsy();

    const after = JSON.parse(readFileSync(file, 'utf8')) as MapFile;
    expect(after.root.children[0]).toMatchObject({ id: oneId, text: 'One **renamed**' });
    expect(after.root.children[1]).toMatchObject({ id: raw.root.children[1].id, todoId: 'todo-42' });
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

  it('generate_map only registers when OpenRouter is configured', async () => {
    const previous = process.env.OPENROUTER_API_KEY;

    delete process.env.OPENROUTER_API_KEY;
    const without = await createClient();
    const namesWithout = (await without.listTools()).tools.map((t) => t.name);
    expect(namesWithout).not.toContain('generate_map');

    process.env.OPENROUTER_API_KEY = 'sk-test-dummy';
    const withKey = await createClient();
    const namesWith = (await withKey.listTools()).tools.map((t) => t.name);
    expect(namesWith).toContain('generate_map');

    if (previous !== undefined) process.env.OPENROUTER_API_KEY = previous;
    else delete process.env.OPENROUTER_API_KEY;
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
});
