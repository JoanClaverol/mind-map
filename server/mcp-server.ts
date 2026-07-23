import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { nanoid } from 'nanoid';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { denormalize, normalize, serializeFloating, subtreeIds } from '../src/model/doc';
import { branchToMarkdown, markdownToBranches } from '../src/model/markdown';
import { applyDocOp, assignIds, type MapOp } from '../src/model/ops';
import { NODE_COLORS, SCHEMA_VERSION, type Doc, type FileNode, type MapFile, type NodeColor } from '../src/model/types';
import { publish } from './events';
import * as storage from './storage';

function errorResult(message: string): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function nowIso(): string {
  return new Date().toISOString();
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

/**
 * Apply surgical ops to a map on disk — all-or-nothing: the first failing op
 * aborts the whole batch with nothing written and nothing published. On success
 * the batch is broadcast as ONE event, so an open browser tab replays it as a
 * single undoable step. Everything the ops don't touch (ids, metadata, pinned,
 * folder, viewport, createdAt) rides along.
 */
async function mutateMap(
  mapId: string,
  ops: MapOp[],
): Promise<{ map: MapFile } | { error: string; failedIndex?: number }> {
  if (!storage.isValidId(mapId)) return { error: 'invalid map id' };
  const map = await storage.readMap(mapId);
  if (!map) return { error: 'map not found' };
  const doc = normalize(map.root, map.layout ?? 'right', map.relationships ?? [], map.floating ?? [], map.groups ?? []);
  for (let i = 0; i < ops.length; i++) {
    const result = applyDocOp(doc, ops[i]);
    if (!result.ok) return { error: result.reason, failedIndex: i };
  }
  const updated: MapFile = { ...map, root: denormalize(doc), updatedAt: nowIso() };
  // Relationship/group/floating changes flow through; omit when empty to keep files minimal.
  if (doc.relationships.length) updated.relationships = doc.relationships;
  else delete updated.relationships;
  if (doc.groups.length) updated.groups = doc.groups;
  else delete updated.groups;
  const floating = serializeFloating(doc);
  if (floating) updated.floating = floating;
  else delete updated.floating;
  await storage.writeMap(updated);
  publish({ kind: 'map-ops', mapId, ops });
  return { map: updated };
}

/**
 * Where a new floating tree lands when the client gives no position. The
 * server has no layout, so this is a heuristic below the existing trees —
 * advisory only; the user drags trees where they want them.
 */
function defaultTreePos(map: MapFile, index = 0): { x: number; y: number } {
  const ys = (map.floating ?? []).map((f) => f.pos.y);
  const base = ys.length ? Math.max(...ys) + 200 : 300;
  return { x: 0, y: base + 200 * index };
}

/** Render inserted branches as an outline annotated with their new ids. */
function outlineWithIds(branches: FileNode[], depth = 0): string {
  return branches
    .map((b) => {
      const line = `${'  '.repeat(depth)}- ${b.text} (id: ${b.id})`;
      return b.children.length ? `${line}\n${outlineWithIds(b.children, depth + 1)}` : line;
    })
    .join('\n');
}

function truncateText(text: string, max = 40): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * The arrows of a map as a markdown section, or null when there are none.
 * With `scope`, only arrows touching one of those node ids are included
 * (used by get_subtree so a branch read shows its cross-links).
 */
function relationshipsSection(doc: Doc, scope?: Set<string>): string | null {
  const rels = doc.relationships.filter((r) => !scope || scope.has(r.from) || scope.has(r.to));
  if (rels.length === 0) return null;
  const lines = rels.map((r) => {
    const from = `${r.from} ("${truncateText(doc.nodes[r.from].text)}")`;
    const to = `${r.to} ("${truncateText(doc.nodes[r.to].text)}")`;
    return `- [${r.id}] ${from} -> ${to}${r.label ? ` — "${r.label}"` : ''}`;
  });
  return `## Relationships\n${lines.join('\n')}`;
}

/**
 * The group boundaries of a map as a markdown section, or null when there are
 * none. With `scope`, only groups with a member in scope are included.
 */
function groupsSection(doc: Doc, scope?: Set<string>): string | null {
  const groups = doc.groups.filter((g) => !scope || g.members.some((m) => scope.has(m)));
  if (groups.length === 0) return null;
  const lines = groups.map((g) => {
    const members = g.members.map((m) => `${m} ("${truncateText(doc.nodes[m].text)}")`).join(', ');
    return `- [${g.id}]${g.label ? ` "${g.label}"` : ''} — members: ${members}`;
  });
  return `## Groups\n${lines.join('\n')}`;
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
  schemaVersion: 2;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  layout?: 'right' | 'balanced' | 'down' | 'timeline';
  pinned?: boolean;
  relationships?: Array<{ id: string; from: string; to: string; label?: string }>;
  // Dashed boundaries around sets of nodes (≥ 2 members each, possibly from different parents)
  groups?: Array<{ id: string; members: string[]; label?: string; color?: string }>;
  root: FileNode;
  floating?: Array<{ pos: { x: number; y: number }; root: FileNode }>;
}

interface FileNode {
  id: string;
  text: string;
  collapsed?: boolean;
  color?: string;   // palette name: sage | mist | clay | sand | rose
  icon?: string;    // leading emoji shown before the text (max 16 chars)
  note?: string;    // longer hidden text (max 2000 chars)
  tags?: string[];  // searchable labels (max 8 tags, 24 chars each)
  style?: string;   // subtree structure override: right | down | timeline ('balanced' is map-level only)
  children: FileNode[];
}
\`\`\`

All map files are stored as pretty-printed JSON in the maps/ directory.`;
  return `${mcpGuide}\n\n---\n\n# Schema reference\n\n${schema}`;
}

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'mindmap-mcp', version: '0.2.0' });

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
      description:
        'Reads a map as a nested markdown outline annotated with node ids, followed by its relationship arrows and group boundaries — everything needed to edit surgically without calling read_map.',
      inputSchema: z.object({ map_id: z.string().describe('The map id') }),
    },
    async (args) => {
      if (!storage.isValidId(args.map_id)) return errorResult('invalid map id');
      const map = await storage.readMap(args.map_id);
      if (!map) return errorResult('map not found');
      const doc = normalize(map.root, map.layout ?? 'right', map.relationships ?? [], map.floating ?? [], map.groups ?? []);
      const markdown = branchToMarkdown(doc, map.root.id, { ids: true, meta: true });
      const floatingBlocks = doc.floating.map((f) => branchToMarkdown(doc, f.rootId, { ids: true, meta: true }));
      const floatingSection = floatingBlocks.length ? `\n\n## Floating trees\n${floatingBlocks.join('\n\n')}` : '';
      const sections = [relationshipsSection(doc), groupsSection(doc)].filter((s): s is string => s !== null);
      const tail = sections.length ? `\n\n${sections.join('\n\n')}` : '';
      return {
        content: [{ type: 'text', text: `# ${map.title}\n\n${markdown}${floatingSection}${tail}` }],
      };
    },
  );

  server.registerTool(
    'get_subtree',
    {
      description:
        'Reads one branch of a map as an id-annotated outline, plus any relationship arrows and group boundaries touching it. Cheaper than read_map for large maps. depth limits how many levels of descendants are included.',
      inputSchema: z.object({
        map_id: z.string().describe('The map id'),
        node_id: z.string().describe('Root node of the branch to read'),
        depth: z.number().int().min(1).optional().describe('Levels of descendants to include; omit for the whole branch'),
      }),
    },
    async (args) => {
      if (!storage.isValidId(args.map_id)) return errorResult('invalid map id');
      const map = await storage.readMap(args.map_id);
      if (!map) return errorResult('map not found');
      const doc = normalize(map.root, map.layout ?? 'right', map.relationships ?? [], map.floating ?? [], map.groups ?? []);
      if (!doc.nodes[args.node_id]) return errorResult(`node ${args.node_id} not found`);
      const markdown = branchToMarkdown(doc, args.node_id, { ids: true, meta: true, maxDepth: args.depth });
      const scope = new Set(subtreeIds(doc, args.node_id));
      const sections = [relationshipsSection(doc, scope), groupsSection(doc, scope)].filter(
        (s): s is string => s !== null,
      );
      return { content: [{ type: 'text', text: `${markdown}${sections.length ? `\n\n${sections.join('\n\n')}` : ''}` }] };
    },
  );

  server.registerTool(
    'find_nodes',
    {
      description:
        'Finds nodes by text (case-insensitive substring) and/or tags in one map or, when map_id is omitted, across all maps. Provide query, tags, or both (tags must ALL be present on a node). Use this to locate node ids before editing instead of reading whole maps into context.',
      inputSchema: z
        .object({
          query: z.string().min(1).optional().describe('Text to search for'),
          tags: z.array(z.string().min(1)).min(1).optional().describe('Only nodes carrying ALL of these tags'),
          map_id: z.string().optional().describe('Limit the search to one map'),
        })
        .refine((a) => a.query !== undefined || a.tags !== undefined, {
          message: 'provide query, tags, or both',
        }),
    },
    async (args) => {
      const needle = args.query?.toLowerCase();
      const wantTags = args.tags?.map((t) => t.toLowerCase());
      let targets: MapFile[];
      if (args.map_id !== undefined) {
        if (!storage.isValidId(args.map_id)) return errorResult('invalid map id');
        const map = await storage.readMap(args.map_id);
        if (!map) return errorResult('map not found');
        targets = [map];
      } else {
        // listMaps is updatedAt-desc, so truncation keeps the most recent maps.
        const { maps } = await storage.listMaps();
        targets = (await Promise.all(maps.map((m) => storage.readMap(m.id)))).filter((m): m is MapFile => m !== null);
      }
      const MAX_HITS = 50;
      const hits: string[] = [];
      let truncated = false;
      outer: for (const map of targets) {
        const walk = (node: FileNode, path: string[]): boolean => {
          const textMatch = needle === undefined || node.text.toLowerCase().includes(needle);
          const tagsMatch =
            wantTags === undefined || wantTags.every((t) => node.tags?.some((x) => x.toLowerCase() === t));
          if (textMatch && tagsMatch) {
            if (hits.length >= MAX_HITS) return true;
            const where = path.length ? `, path: ${path.join(' > ')}` : '';
            const tagSuffix = node.tags?.length ? ` ${node.tags.map((t) => `#${t}`).join(' ')}` : '';
            hits.push(`- ${node.id} "${truncateText(node.text, 60)}" — map ${map.id} ("${map.title}")${where}${tagSuffix}`);
          }
          for (const child of node.children) {
            if (walk(child, [...path, truncateText(node.text, 30)])) return true;
          }
          return false;
        };
        if (walk(map.root, [])) {
          truncated = true;
          break outer;
        }
        for (const f of map.floating ?? []) {
          if (walk(f.root, [])) {
            truncated = true;
            break outer;
          }
        }
      }
      if (hits.length === 0) return { content: [{ type: 'text', text: 'No matches.' }] };
      const note = truncated ? '\n(more matches truncated — narrow the query or pass map_id)' : '';
      return { content: [{ type: 'text', text: `${hits.join('\n')}${note}` }] };
    },
  );

  server.registerTool(
    'add_nodes',
    {
      description:
        'Adds nodes under an existing node, parsed from a markdown bullet outline (two-space indent per level). Get node ids from read_map first. The edit appears live in an open browser tab and is undoable there. Returns the inserted outline annotated with the new node ids so follow-up edits can target them without re-reading the map.',
      inputSchema: z.object({
        map_id: z.string().describe('The map id'),
        parent_id: z.string().describe('Id of the node to add children under'),
        markdown: z.string().describe('Markdown bullet outline for the new nodes'),
      }),
    },
    async (args) => {
      const branches = markdownToBranches(args.markdown);
      if (branches.length === 0) return errorResult('markdown produced no nodes');
      for (const branch of branches) assignIds(branch);
      const r = await mutateMap(args.map_id, [{ type: 'add_nodes', parentId: args.parent_id, branches }]);
      if ('error' in r) return errorResult(r.error);
      return { content: [{ type: 'text', text: `Added under ${args.parent_id}:\n${outlineWithIds(branches)}` }] };
    },
  );

  server.registerTool(
    'edit_node',
    {
      description:
        'Replaces the text of one node. Node text supports inline markdown. Editing the root node changes its label, not the map title. The edit appears live in an open browser tab and is undoable there.',
      inputSchema: z.object({
        map_id: z.string().describe('The map id'),
        node_id: z.string().describe('Id of the node to edit'),
        text: z.string().describe('New text for the node'),
      }),
    },
    async (args) => {
      const r = await mutateMap(args.map_id, [{ type: 'edit_node', nodeId: args.node_id, text: args.text }]);
      if ('error' in r) return errorResult(r.error);
      return { content: [{ type: 'text', text: `Updated node ${args.node_id}` }] };
    },
  );

  server.registerTool(
    'move_node',
    {
      description:
        'Moves a node (with its subtree) under a new parent. Omit before_sibling_id to append at the end, or pass a child of the new parent to insert before it. Passing a floating tree\'s root ATTACHES that whole tree under the new parent. The edit appears live in an open browser tab and is undoable there.',
      inputSchema: z.object({
        map_id: z.string().describe('The map id'),
        node_id: z.string().describe('Id of the node to move'),
        new_parent_id: z.string().describe('Id of the destination parent node'),
        before_sibling_id: z.string().optional().describe('Insert before this child of the new parent; omit to append'),
      }),
    },
    async (args) => {
      const r = await mutateMap(args.map_id, [
        {
          type: 'move_node',
          nodeId: args.node_id,
          newParentId: args.new_parent_id,
          beforeSiblingId: args.before_sibling_id ?? null,
        },
      ]);
      if ('error' in r) return errorResult(r.error);
      return { content: [{ type: 'text', text: `Moved node ${args.node_id} under ${args.new_parent_id}` }] };
    },
  );

  server.registerTool(
    'delete_node',
    {
      description:
        'Deletes a node and its whole subtree; a floating tree\'s root deletes that whole tree. The main root cannot be deleted. Relationships touching deleted nodes are pruned. The edit appears live in an open browser tab and is undoable there.',
      inputSchema: z.object({
        map_id: z.string().describe('The map id'),
        node_id: z.string().describe('Id of the node to delete'),
      }),
    },
    async (args) => {
      const r = await mutateMap(args.map_id, [{ type: 'delete_node', nodeId: args.node_id }]);
      if ('error' in r) return errorResult(r.error);
      return { content: [{ type: 'text', text: `Deleted node ${args.node_id} and its subtree` }] };
    },
  );

  server.registerTool(
    'create_tree',
    {
      description:
        'Creates a floating tree on the canvas — a detached tree alongside the main one, for ideas that do not (yet) belong anywhere. The markdown must have exactly ONE top-level bullet (it becomes the tree root). Connect it later with relationship arrows, or attach it under a node via move_node on its root. Appears live in an open browser tab and is undoable there.',
      inputSchema: z.object({
        map_id: z.string().describe('The map id'),
        markdown: z.string().describe('Markdown bullet outline with exactly one top-level bullet'),
        x: z.number().optional().describe('Canvas x for the tree root; omit to auto-place below existing trees'),
        y: z.number().optional().describe('Canvas y for the tree root; omit to auto-place'),
      }),
    },
    async (args) => {
      const branches = markdownToBranches(args.markdown);
      if (branches.length === 0) return errorResult('markdown produced no nodes');
      if (branches.length > 1) {
        return errorResult(
          'markdown has multiple top-level bullets — wrap them under a single bullet, or call create_tree once per tree',
        );
      }
      const root = branches[0];
      assignIds(root);
      let pos: { x: number; y: number };
      if (args.x !== undefined && args.y !== undefined) {
        pos = { x: args.x, y: args.y };
      } else {
        if (!storage.isValidId(args.map_id)) return errorResult('invalid map id');
        const map = await storage.readMap(args.map_id);
        if (!map) return errorResult('map not found');
        pos = defaultTreePos(map);
      }
      const r = await mutateMap(args.map_id, [{ type: 'create_tree', root, pos }]);
      if ('error' in r) return errorResult(r.error);
      return {
        content: [{ type: 'text', text: `Created floating tree at (${pos.x}, ${pos.y}):\n${outlineWithIds([root])}` }],
      };
    },
  );

  server.registerTool(
    'detach_node',
    {
      description:
        'Detaches a node (with its whole subtree) from its parent so it becomes a floating tree on the canvas. The main root and existing floating roots cannot be detached. Appears live in an open browser tab and is undoable there.',
      inputSchema: z.object({
        map_id: z.string().describe('The map id'),
        node_id: z.string().describe('Id of the node to detach'),
        x: z.number().optional().describe('Canvas x for the detached tree; omit to auto-place'),
        y: z.number().optional().describe('Canvas y; omit to auto-place'),
      }),
    },
    async (args) => {
      let pos: { x: number; y: number };
      if (args.x !== undefined && args.y !== undefined) {
        pos = { x: args.x, y: args.y };
      } else {
        if (!storage.isValidId(args.map_id)) return errorResult('invalid map id');
        const map = await storage.readMap(args.map_id);
        if (!map) return errorResult('map not found');
        pos = defaultTreePos(map);
      }
      const r = await mutateMap(args.map_id, [{ type: 'detach_node', nodeId: args.node_id, pos }]);
      if ('error' in r) return errorResult(r.error);
      return {
        content: [{ type: 'text', text: `Detached ${args.node_id} into a floating tree at (${pos.x}, ${pos.y})` }],
      };
    },
  );

  server.registerTool(
    'set_node_meta',
    {
      description:
        'Sets node metadata: color (one of sage/mist/clay/sand/rose — "none" clears), icon (a leading emoji; "" clears), note (longer hidden text shown in the inspector; "" clears), tags (searchable labels; [] clears, the array replaces the whole list). Absent fields are left untouched. Use color/icon to mark status (e.g. ❓ open question, sage = decided), notes for detail that would clutter the canvas. The edit appears live in an open browser tab and is undoable there.',
      inputSchema: z
        .object({
          map_id: z.string().describe('The map id'),
          node_id: z.string().describe('Id of the node'),
          color: z.enum([...NODE_COLORS, 'none']).optional().describe('Palette color name; "none" clears'),
          icon: z.string().optional().describe('Leading emoji/glyph; empty string clears'),
          note: z.string().optional().describe('Longer hidden text; empty string clears'),
          tags: z.array(z.string()).optional().describe('Replaces the tag list; [] clears'),
        })
        .refine((a) => a.color !== undefined || a.icon !== undefined || a.note !== undefined || a.tags !== undefined, {
          message: 'provide at least one of color/icon/note/tags',
        }),
    },
    async (args) => {
      const r = await mutateMap(args.map_id, [
        {
          type: 'set_node_meta',
          nodeId: args.node_id,
          color: args.color === undefined ? undefined : args.color === 'none' ? null : (args.color as NodeColor),
          icon: args.icon === undefined ? undefined : args.icon || null,
          note: args.note === undefined ? undefined : args.note || null,
          tags: args.tags === undefined ? undefined : args.tags.length ? args.tags : null,
        },
      ]);
      if ('error' in r) return errorResult(r.error);
      return { content: [{ type: 'text', text: `Updated metadata on ${args.node_id}` }] };
    },
  );

  server.registerTool(
    'add_relationship',
    {
      description:
        'Draws a labeled directional arrow between any two nodes — a free cross-link connecting ideas, not a parent/child edge. Returns the relationship id for later edit/delete. Self-links and duplicate from→to arrows are rejected. The edit appears live in an open browser tab and is undoable there.',
      inputSchema: z.object({
        map_id: z.string().describe('The map id'),
        from_id: z.string().describe('Source node id'),
        to_id: z.string().describe('Target node id'),
        label: z.string().optional().describe('Optional label shown on the arrow'),
      }),
    },
    async (args) => {
      const relId = nanoid(12);
      const r = await mutateMap(args.map_id, [
        { type: 'add_relationship', relId, fromId: args.from_id, toId: args.to_id, label: args.label },
      ]);
      if ('error' in r) return errorResult(r.error);
      return { content: [{ type: 'text', text: `Added relationship ${relId}: ${args.from_id} -> ${args.to_id}` }] };
    },
  );

  server.registerTool(
    'edit_relationship',
    {
      description:
        'Changes the label of an existing relationship arrow. An empty label removes it. The edit appears live in an open browser tab and is undoable there.',
      inputSchema: z.object({
        map_id: z.string().describe('The map id'),
        relationship_id: z.string().describe('Id of the relationship (from add_relationship or read_map_markdown)'),
        label: z.string().describe('New label; empty string removes the label'),
      }),
    },
    async (args) => {
      const r = await mutateMap(args.map_id, [
        { type: 'edit_relationship', relId: args.relationship_id, label: args.label },
      ]);
      if ('error' in r) return errorResult(r.error);
      return { content: [{ type: 'text', text: `Updated relationship ${args.relationship_id}` }] };
    },
  );

  server.registerTool(
    'delete_relationship',
    {
      description:
        'Deletes a relationship arrow (the nodes stay). The edit appears live in an open browser tab and is undoable there.',
      inputSchema: z.object({
        map_id: z.string().describe('The map id'),
        relationship_id: z.string().describe('Id of the relationship to delete'),
      }),
    },
    async (args) => {
      const r = await mutateMap(args.map_id, [{ type: 'delete_relationship', relId: args.relationship_id }]);
      if ('error' in r) return errorResult(r.error);
      return { content: [{ type: 'text', text: `Deleted relationship ${args.relationship_id}` }] };
    },
  );

  server.registerTool(
    'add_group',
    {
      description:
        'Draws a dashed boundary around a set of nodes — possibly from different parents — to relate them visually and semantically. Encloses exactly the listed nodes (not their subtrees). Needs at least 2 distinct members; overlapping groups are allowed, an identical member set is not. Returns the group id for later edit/delete. The edit appears live in an open browser tab and is undoable there.',
      inputSchema: z.object({
        map_id: z.string().describe('The map id'),
        member_ids: z.array(z.string()).min(2).describe('Ids of the nodes to enclose (at least 2)'),
        label: z.string().optional().describe('Optional label shown on the boundary'),
        color: z.enum([...NODE_COLORS]).optional().describe('Optional boundary color'),
      }),
    },
    async (args) => {
      const groupId = nanoid(12);
      const r = await mutateMap(args.map_id, [
        { type: 'add_group', groupId, members: args.member_ids, label: args.label, color: args.color },
      ]);
      if ('error' in r) return errorResult(r.error);
      return {
        content: [{ type: 'text', text: `Added group ${groupId} around ${args.member_ids.join(', ')}` }],
      };
    },
  );

  server.registerTool(
    'edit_group',
    {
      description:
        'Updates a group boundary: member_ids replaces the whole member list (still needs ≥ 2), label "" removes the label, color "none" clears the color. Absent fields are left untouched. The edit appears live in an open browser tab and is undoable there.',
      inputSchema: z
        .object({
          map_id: z.string().describe('The map id'),
          group_id: z.string().describe('Id of the group (from add_group or read_map_markdown)'),
          member_ids: z.array(z.string()).min(2).optional().describe('Replaces the member list (at least 2 ids)'),
          label: z.string().optional().describe('New label; empty string removes it'),
          color: z.enum([...NODE_COLORS, 'none']).optional().describe('Boundary color; "none" clears'),
        })
        .refine((a) => a.member_ids !== undefined || a.label !== undefined || a.color !== undefined, {
          message: 'provide at least one of member_ids/label/color',
        }),
    },
    async (args) => {
      const r = await mutateMap(args.map_id, [
        {
          type: 'edit_group',
          groupId: args.group_id,
          members: args.member_ids,
          label: args.label === undefined ? undefined : args.label || null,
          color: args.color === undefined ? undefined : args.color === 'none' ? null : (args.color as NodeColor),
        },
      ]);
      if ('error' in r) return errorResult(r.error);
      return { content: [{ type: 'text', text: `Updated group ${args.group_id}` }] };
    },
  );

  server.registerTool(
    'delete_group',
    {
      description:
        'Deletes a group boundary (the nodes stay). The edit appears live in an open browser tab and is undoable there.',
      inputSchema: z.object({
        map_id: z.string().describe('The map id'),
        group_id: z.string().describe('Id of the group to delete'),
      }),
    },
    async (args) => {
      const r = await mutateMap(args.map_id, [{ type: 'delete_group', groupId: args.group_id }]);
      if ('error' in r) return errorResult(r.error);
      return { content: [{ type: 'text', text: `Deleted group ${args.group_id}` }] };
    },
  );

  const batchOp = z.discriminatedUnion('op', [
    z.object({
      op: z.literal('add_nodes'),
      parent_id: z.string(),
      markdown: z.string().describe('Markdown bullet outline for the new nodes'),
    }),
    z.object({ op: z.literal('edit_node'), node_id: z.string(), text: z.string() }),
    z.object({
      op: z.literal('move_node'),
      node_id: z.string(),
      new_parent_id: z.string(),
      before_sibling_id: z.string().optional(),
    }),
    z.object({ op: z.literal('delete_node'), node_id: z.string() }),
    z.object({
      op: z.literal('add_relationship'),
      from_id: z.string(),
      to_id: z.string(),
      label: z.string().optional(),
    }),
    z.object({ op: z.literal('edit_relationship'), relationship_id: z.string(), label: z.string() }),
    z.object({ op: z.literal('delete_relationship'), relationship_id: z.string() }),
    z.object({
      op: z.literal('add_group'),
      member_ids: z.array(z.string()).min(2),
      label: z.string().optional(),
      color: z.enum([...NODE_COLORS]).optional(),
    }),
    z.object({
      op: z.literal('edit_group'),
      group_id: z.string(),
      member_ids: z.array(z.string()).min(2).optional(),
      label: z.string().optional(),
      color: z.enum([...NODE_COLORS, 'none']).optional(),
    }),
    z.object({ op: z.literal('delete_group'), group_id: z.string() }),
    z.object({
      op: z.literal('create_tree'),
      markdown: z.string().describe('Outline with exactly one top-level bullet'),
      x: z.number().optional(),
      y: z.number().optional(),
    }),
    z.object({ op: z.literal('detach_node'), node_id: z.string(), x: z.number().optional(), y: z.number().optional() }),
    z.object({
      op: z.literal('set_node_meta'),
      node_id: z.string(),
      color: z.enum([...NODE_COLORS, 'none']).optional(),
      icon: z.string().optional(),
      note: z.string().optional(),
      tags: z.array(z.string()).optional(),
    }),
  ]);

  server.registerTool(
    'apply_ops',
    {
      description:
        'Applies up to 50 edits to one map in a single atomic call — all succeed or none are applied — and lands as ONE undo step in the user\'s browser. Prefer this over sequential single-op calls when restructuring. Each op mirrors the corresponding single tool. Returns per-op results including newly assigned ids.',
      inputSchema: z.object({
        map_id: z.string().describe('The map id'),
        ops: z.array(batchOp).min(1).max(50).describe('The edits, applied in order'),
      }),
    },
    async (args) => {
      const ops: MapOp[] = [];
      const summaries: string[] = [];
      // Pre-read once when any tree op needs an auto position (mutateMap re-reads).
      let mapForPos: MapFile | null = null;
      let autoPlaced = 0;
      const nextPos = async (x?: number, y?: number) => {
        if (x !== undefined && y !== undefined) return { x, y };
        if (!mapForPos) {
          if (!storage.isValidId(args.map_id)) return null;
          mapForPos = await storage.readMap(args.map_id);
          if (!mapForPos) return null;
        }
        return defaultTreePos(mapForPos, autoPlaced++);
      };
      for (let i = 0; i < args.ops.length; i++) {
        const item = args.ops[i];
        switch (item.op) {
          case 'add_nodes': {
            const branches = markdownToBranches(item.markdown);
            if (branches.length === 0) {
              return errorResult(`op ${i} (add_nodes): markdown produced no nodes — no changes were applied`);
            }
            for (const branch of branches) assignIds(branch);
            ops.push({ type: 'add_nodes', parentId: item.parent_id, branches });
            summaries.push(`[${i}] add_nodes under ${item.parent_id}:\n${outlineWithIds(branches, 1)}`);
            break;
          }
          case 'edit_node':
            ops.push({ type: 'edit_node', nodeId: item.node_id, text: item.text });
            summaries.push(`[${i}] edit_node ${item.node_id}`);
            break;
          case 'move_node':
            ops.push({
              type: 'move_node',
              nodeId: item.node_id,
              newParentId: item.new_parent_id,
              beforeSiblingId: item.before_sibling_id ?? null,
            });
            summaries.push(`[${i}] move_node ${item.node_id} under ${item.new_parent_id}`);
            break;
          case 'delete_node':
            ops.push({ type: 'delete_node', nodeId: item.node_id });
            summaries.push(`[${i}] delete_node ${item.node_id}`);
            break;
          case 'add_relationship': {
            const relId = nanoid(12);
            ops.push({ type: 'add_relationship', relId, fromId: item.from_id, toId: item.to_id, label: item.label });
            summaries.push(`[${i}] add_relationship ${relId}: ${item.from_id} -> ${item.to_id}`);
            break;
          }
          case 'edit_relationship':
            ops.push({ type: 'edit_relationship', relId: item.relationship_id, label: item.label });
            summaries.push(`[${i}] edit_relationship ${item.relationship_id}`);
            break;
          case 'delete_relationship':
            ops.push({ type: 'delete_relationship', relId: item.relationship_id });
            summaries.push(`[${i}] delete_relationship ${item.relationship_id}`);
            break;
          case 'add_group': {
            const groupId = nanoid(12);
            ops.push({ type: 'add_group', groupId, members: item.member_ids, label: item.label, color: item.color });
            summaries.push(`[${i}] add_group ${groupId} around ${item.member_ids.join(', ')}`);
            break;
          }
          case 'edit_group':
            ops.push({
              type: 'edit_group',
              groupId: item.group_id,
              members: item.member_ids,
              label: item.label === undefined ? undefined : item.label || null,
              color: item.color === undefined ? undefined : item.color === 'none' ? null : (item.color as NodeColor),
            });
            summaries.push(`[${i}] edit_group ${item.group_id}`);
            break;
          case 'delete_group':
            ops.push({ type: 'delete_group', groupId: item.group_id });
            summaries.push(`[${i}] delete_group ${item.group_id}`);
            break;
          case 'create_tree': {
            const branches = markdownToBranches(item.markdown);
            if (branches.length === 0) {
              return errorResult(`op ${i} (create_tree): markdown produced no nodes — no changes were applied`);
            }
            if (branches.length > 1) {
              return errorResult(
                `op ${i} (create_tree): markdown has multiple top-level bullets — no changes were applied`,
              );
            }
            const root = branches[0];
            assignIds(root);
            const pos = await nextPos(item.x, item.y);
            if (!pos) return errorResult('map not found');
            ops.push({ type: 'create_tree', root, pos });
            summaries.push(`[${i}] create_tree at (${pos.x}, ${pos.y}):\n${outlineWithIds([root], 1)}`);
            break;
          }
          case 'detach_node': {
            const pos = await nextPos(item.x, item.y);
            if (!pos) return errorResult('map not found');
            ops.push({ type: 'detach_node', nodeId: item.node_id, pos });
            summaries.push(`[${i}] detach_node ${item.node_id} to (${pos.x}, ${pos.y})`);
            break;
          }
          case 'set_node_meta':
            ops.push({
              type: 'set_node_meta',
              nodeId: item.node_id,
              color: item.color === undefined ? undefined : item.color === 'none' ? null : (item.color as NodeColor),
              icon: item.icon === undefined ? undefined : item.icon || null,
              note: item.note === undefined ? undefined : item.note || null,
              tags: item.tags === undefined ? undefined : item.tags.length ? item.tags : null,
            });
            summaries.push(`[${i}] set_node_meta ${item.node_id}`);
            break;
        }
      }
      const r = await mutateMap(args.map_id, ops);
      if ('error' in r) {
        const where = r.failedIndex !== undefined ? `op ${r.failedIndex} (${ops[r.failedIndex].type}): ` : '';
        return errorResult(`${where}${r.error} — no changes were applied`);
      }
      return { content: [{ type: 'text', text: `Applied ${ops.length} ops:\n${summaries.join('\n')}` }] };
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
      publish({ kind: 'map-created', mapId: map.id, title: map.title });
      return { content: [{ type: 'text', text: `Created map "${map.title}" (id: ${map.id})` }] };
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

