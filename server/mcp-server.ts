import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { nanoid } from 'nanoid';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { normalize } from '../src/model/doc';
import { branchToMarkdown, markdownToBranches } from '../src/model/markdown';
import { SCHEMA_VERSION, type FileNode, type MapFile } from '../src/model/types';
import { generateOutline } from './openrouter';
import * as storage from './storage';

function errorResult(message: string): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Recursively replace every id in a FileNode tree with fresh nanoids. */
export function assignIds(node: FileNode): void {
  node.id = nanoid(12);
  for (const child of node.children) assignIds(child);
}

function buildMapFile(title: string, branches: FileNode[]): MapFile {
  const root: FileNode = { id: nanoid(12), text: title, children: branches };
  assignIds(root);
  return {
    schemaVersion: SCHEMA_VERSION,
    id: nanoid(12),
    title,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    layout: 'right',
    root,
  };
}

async function readTextFile(...segments: string[]): Promise<string | null> {
  try {
    return await fs.readFile(path.resolve(process.cwd(), ...segments), 'utf8');
  } catch {
    return null;
  }
}

async function buildProjectContext(): Promise<string> {
  const mcpGuide = (await readTextFile('MCP.md')) ?? '(MCP.md not available)';
  const schema = `MapFile schema version ${SCHEMA_VERSION}:
\`\`\`ts
interface MapFile {
  schemaVersion: 1;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  layout?: 'right' | 'balanced' | 'down' | 'timeline';
  pinned?: boolean;
  relationships?: Array<{ id: string; from: string; to: string; label?: string }>;
  root: FileNode;
}

interface FileNode {
  id: string;
  text: string;
  collapsed?: boolean;
  todoId?: string;
  children: FileNode[];
}
\`\`\`

All map files are stored as pretty-printed JSON in the maps/ directory.`;
  return `${mcpGuide}\n\n---\n\n# Schema reference\n\n${schema}`;
}

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'mind-map', version: '0.1.0' });

  server.registerTool(
    'get_project_context',
    { description: 'Returns the project README, agent guidance, and map schema so the model knows how to generate valid maps.' },
    async () => {
      const context = await buildProjectContext();
      return { content: [{ type: 'text', text: context }] };
    },
  );

  server.registerTool(
    'list_maps',
    { description: 'Lists all saved mind maps with id, title, node count, and last update time.' },
    async () => {
      const { maps, warnings } = await storage.listMaps();
      const lines = maps.map((m) => `- ${m.title} (id: ${m.id}, nodes: ${m.nodeCount}, updated: ${m.updatedAt})`);
      const text = lines.length ? lines.join('\n') : 'No maps found.';
      if (warnings.length) {
        return { content: [{ type: 'text', text: `${text}\n\nWarnings:\n${warnings.map((w) => `- ${w}`).join('\n')}` }] };
      }
      return { content: [{ type: 'text', text }] };
    },
  );

  server.registerTool(
    'read_map',
    {
      description: 'Reads a map as pretty-printed JSON.',
      inputSchema: z.object({ map_id: z.string().describe('The map id') }),
    },
    async (args) => {
      if (!storage.isValidId(args.map_id)) return errorResult('invalid map id');
      const map = await storage.readMap(args.map_id);
      if (!map) return errorResult('map not found');
      return { content: [{ type: 'text', text: JSON.stringify(map, null, 2) }] };
    },
  );

  server.registerTool(
    'read_map_markdown',
    {
      description: 'Reads a map as a nested markdown outline (useful for feeding context back to the model).',
      inputSchema: z.object({ map_id: z.string().describe('The map id') }),
    },
    async (args) => {
      if (!storage.isValidId(args.map_id)) return errorResult('invalid map id');
      const map = await storage.readMap(args.map_id);
      if (!map) return errorResult('map not found');
      const doc = normalize(map.root, map.layout ?? 'right', map.relationships ?? []);
      const markdown = branchToMarkdown(doc, map.root.id);
      return { content: [{ type: 'text', text: `# ${map.title}\n\n${markdown}` }] };
    },
  );

  server.registerTool(
    'create_map_from_outline',
    {
      description: 'Creates a new map from a markdown outline. The outline can be a nested list of bullets (-, *, +).',
      inputSchema: z.object({
        title: z.string().describe('Title for the new map'),
        markdown: z.string().optional().describe('Markdown outline to use as the map content'),
      }),
    },
    async (args) => {
      const title = args.title.trim();
      if (!title) return errorResult('title is required');
      const branches = args.markdown ? markdownToBranches(args.markdown) : [];
      const map = buildMapFile(title, branches);
      await storage.writeMap(map);
      return { content: [{ type: 'text', text: `Created map "${map.title}" (id: ${map.id})` }] };
    },
  );

  server.registerTool(
    'generate_map',
    {
      description: 'Generates a new mind map from a prompt using an LLM (OpenRouter). Optionally uses an existing map as context.',
      inputSchema: z.object({
        prompt: z.string().describe('What the map should be about'),
        title: z.string().optional().describe('Optional title; defaults to the first line of the prompt'),
        source_map_id: z.string().optional().describe('Optional existing map id to use as context'),
      }),
    },
    async (args) => {
      const prompt = args.prompt.trim();
      if (!prompt) return errorResult('prompt is required');

      let contextMarkdown: string | undefined;
      if (args.source_map_id) {
        if (!storage.isValidId(args.source_map_id)) return errorResult('invalid source_map_id');
        const source = await storage.readMap(args.source_map_id);
        if (!source) return errorResult('source_map_id not found');
        const doc = normalize(source.root, source.layout ?? 'right', source.relationships ?? []);
        contextMarkdown = branchToMarkdown(doc, source.root.id);
      }

      let outline: string;
      try {
        outline = await generateOutline(prompt, contextMarkdown);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : 'AI generation failed');
      }

      const branches = markdownToBranches(outline);
      const displayTitle = args.title?.trim() ?? prompt.split('\n')[0].slice(0, 80);
      const map = buildMapFile(displayTitle, branches);
      await storage.writeMap(map);
      return {
        content: [
          {
            type: 'text',
            text: `Generated map "${map.title}" (id: ${map.id})\n\nOutline used:\n${outline}`,
          },
        ],
      };
    },
  );

  server.registerResource(
    'Mind Map MCP Guide',
    'docs://mcp',
    { mimeType: 'text/markdown', description: 'Complete guide for models using this MCP server, including tools, schema, and workflows.' },
    async () => ({
      contents: [{ uri: 'docs://mcp', mimeType: 'text/markdown', text: await buildProjectContext() }],
    }),
  );

  return server;
}
