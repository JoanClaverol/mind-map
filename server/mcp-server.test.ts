import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { MapFile } from '../src/model/types';

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

  it('generate_map returns an error when OpenRouter is not configured', async () => {
    const client = await createClient();
    const previous = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;

    const result = await client.callTool({
      name: 'generate_map',
      arguments: { prompt: 'a map about testing' },
    });
    expect(result.isError).toBe(true);
    expect(textContent(result)).toContain('AI generation disabled');

    if (previous !== undefined) process.env.OPENROUTER_API_KEY = previous;
  });
});
