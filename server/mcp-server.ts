import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { nanoid } from 'nanoid';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { denormalize, docFromMap, serializeElements, serializeFloating, subtreeIds } from '../src/model/doc';
import { branchToMarkdown, markdownToBranches } from '../src/model/markdown';
import { applyDocOp, assignIds, type MapOp } from '../src/model/ops';
import { normalizeStroke } from '../src/model/strokes';
import {
  BRANCH_STYLES,
  ELEMENT_DEFAULT_SIZE,
  ELEMENT_KINDS,
  ELEMENT_SIDES,
  LAYOUT_STYLES,
  NODE_COLORS,
  SCHEMA_VERSION,
  type BranchStyle,
  type CanvasElement,
  type Doc,
  type ElementKind,
  type ElementSide,
  type FileNode,
  type LayoutStyle,
  type MapFile,
  type NodeColor,
} from '../src/model/types';
import { publish } from './events';
import { requestExport, saveExport } from './exports';
import { getActiveView } from './presence';
import * as storage from './storage';

function errorResult(message: string): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function nowIso(): string {
  return new Date().toISOString();
}

function buildMapFile(title: string, branches: FileNode[], layout: LayoutStyle = 'right'): MapFile {
  // A lone top-level bullet IS the central topic: never nest it under a title node
  // with one child (models often word the bullet differently from the title).
  const root: FileNode = branches.length === 1 ? branches[0] : { id: nanoid(12), text: title, children: branches };
  assignIds(root);
  return {
    schemaVersion: SCHEMA_VERSION,
    id: nanoid(12),
    title,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    layout,
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
  type Failure = { error: string; failedIndex?: number };
  const result = await storage.updateMap<MapFile | Failure>(mapId, (map) => {
    const doc = docFromMap(map);
    for (let i = 0; i < ops.length; i++) {
      const r = applyDocOp(doc, ops[i]);
      if (!r.ok) return { error: r.reason, failedIndex: i };
    }
    const updated: MapFile = { ...map, layout: doc.layout, root: denormalize(doc), updatedAt: nowIso() };
    // Relationship/group/floating changes flow through; omit when empty to keep files minimal.
    if (doc.relationships.length) updated.relationships = doc.relationships;
    else delete updated.relationships;
    if (doc.groups.length) updated.groups = doc.groups;
    else delete updated.groups;
    const floating = serializeFloating(doc);
    if (floating) updated.floating = floating;
    else delete updated.floating;
    const elements = serializeElements(doc);
    if (elements) updated.elements = elements;
    else delete updated.elements;
    return updated;
  });
  if (!result) return { error: 'map not found' };
  if ('error' in result) return result;
  const updated = result;
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
/** `id ("text")` for a node or a canvas element (arrows can end on either). */
function describeEndpoint(doc: Doc, id: string): string {
  const node = doc.nodes[id];
  if (node) return `${id} ("${truncateText(node.text)}")`;
  const el = doc.elements.find((e) => e.id === id);
  return el ? `${id} (${el.kind} "${truncateText(el.text)}")` : id;
}

function relationshipsSection(doc: Doc, scope?: Set<string>): string | null {
  const rels = doc.relationships.filter((r) => !scope || scope.has(r.from) || scope.has(r.to));
  if (rels.length === 0) return null;
  const lines = rels.map((r) => {
    const from = describeEndpoint(doc, r.from);
    const to = describeEndpoint(doc, r.to);
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

/**
 * The canvas elements as a markdown section, or null when there are none.
 * With `scope`, only elements anchored to a node in scope are included.
 */
function elementsSection(doc: Doc, scope?: Set<string>): string | null {
  const els = doc.elements.filter((e) => !scope || (e.anchor && scope.has(e.anchor.nodeId)));
  if (els.length === 0) return null;
  const lines = els.map((e) => {
    const where = e.anchor
      ? `${e.anchor.side} of ${describeEndpoint(doc, e.anchor.nodeId)}${e.x || e.y ? `, nudged (${e.x}, ${e.y})` : ''}`
      : `free at (${e.x}, ${e.y})`;
    const color = e.color ? ` [${e.color}]` : '';
    return `- [${e.id}] ${e.kind}${color} ${e.w}×${e.h}, ${where}${e.text ? ` — "${truncateText(e.text, 80)}"` : ''}`;
  });
  return `## Canvas elements\n${lines.join('\n')}`;
}

async function readTextFile(...segments: string[]): Promise<string | null> {
  try {
    return await fs.readFile(path.resolve(process.cwd(), ...segments), 'utf8');
  } catch {
    return null;
  }
}

/**
 * One `### heading` section of MCP.md (up to the next ### or ##), so the MCP
 * prompts below and the guide models read can never drift apart.
 */
async function guideSection(heading: string): Promise<string> {
  const guide = (await readTextFile('MCP.md')) ?? '';
  const start = guide.indexOf(`### ${heading}`);
  if (start === -1) return '';
  const rest = guide.slice(start);
  const end = rest.slice(4).search(/\n##+ /);
  return (end === -1 ? rest : rest.slice(0, end + 4)).trim();
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
  // Freeform sticky notes / text / shapes; anchored ones sit beside a node and follow it
  elements?: Array<{ id: string; kind: 'sticky' | 'text' | 'rect' | 'ellipse' | 'draw'; points?: number[] /* draw: normalized 0…1 */; text: string; w: number; h: number; x: number; y: number; anchor?: { nodeId: string; side: 'right' | 'left' | 'above' | 'below' }; color?: string }>;
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

const STYLE_CHOICES = ['inherit', ...BRANCH_STYLES] as [string, ...string[]];
const styleDescription =
  'Branch structure override for this subtree: right (logic chart), down (org chart), timeline (Now/Next/Later roadmap); "inherit" clears';

function toStyle(style: string | undefined): BranchStyle | null | undefined {
  return style === undefined ? undefined : style === 'inherit' ? null : (style as BranchStyle);
}


const KIND_CHOICES = ELEMENT_KINDS as unknown as [ElementKind, ...ElementKind[]];
const SIDE_CHOICES = ELEMENT_SIDES as unknown as [string, ...string[]];
const elementFields = {
  text: z.string().optional().describe('Text (inline markdown). Optional for rect/ellipse'),
  anchor_node_id: z
    .string()
    .optional()
    .describe('Attach beside this node: it follows the node through layout changes and is deleted with it. Preferred over x/y'),
  side: z.enum(SIDE_CHOICES).optional().describe('Which side of the anchor node (default right)'),
  x: z.number().optional().describe('Free: world x of the top-left. Anchored: horizontal nudge from the anchored spot'),
  y: z.number().optional().describe('Free: world y of the top-left. Anchored: vertical nudge'),
  w: z.number().optional().describe('Width in px (text-bearing kinds grow taller to fit their text)'),
  h: z.number().optional().describe('Minimum height in px'),
  color: z.enum([...NODE_COLORS, 'none']).optional().describe('Palette color; stickies default to yellow'),
  points: z
    .array(z.tuple([z.number(), z.number()]))
    .min(2)
    .max(2000)
    .optional()
    .describe(
      'draw only: one freehand stroke as [x, y] pixel points relative to the element (0,0 = its top-left) — an underline, a circle around something, an arrow sketch, a checkmark',
    ),
};

type ElementArgs = {
  kind: ElementKind;
  points?: Array<[number, number]>;
  text?: string;
  anchor_node_id?: string;
  side?: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  color?: string;
};

/** A new element from tool args. Free elements without x/y land below the map (advisory). */
function buildElement(args: ElementArgs, map: MapFile, index: number): CanvasElement {
  const size = ELEMENT_DEFAULT_SIZE[args.kind];
  const el: CanvasElement = {
    id: nanoid(12),
    kind: args.kind,
    text: args.text?.trim() ?? '',
    w: args.w ?? size.w,
    h: args.h ?? size.h,
    x: args.x ?? 0,
    y: args.y ?? 0,
  };
  if (args.anchor_node_id) {
    el.anchor = { nodeId: args.anchor_node_id, side: (args.side ?? 'right') as ElementSide };
  } else if (args.x === undefined || args.y === undefined) {
    const spot = defaultTreePos(map, index);
    el.x = args.x ?? spot.x + 320;
    el.y = args.y ?? spot.y;
  }
  if (args.color && args.color !== 'none') el.color = args.color;
  if (args.kind === 'draw' && args.points) {
    // Pixel points → a box + normalized stroke; ops reject a draw without points.
    const stroke = normalizeStroke(args.points.map(([x, y]) => ({ x, y })));
    if (stroke) {
      el.points = stroke.points;
      el.w = args.w ?? stroke.w;
      el.h = args.h ?? stroke.h;
      if (!el.anchor) {
        el.x += stroke.x;
        el.y += stroke.y;
      }
    }
  }
  return el;
}

type ElementPatchArgs = Omit<Partial<ElementArgs>, 'kind'> & { detach?: boolean };

function elementPatch(args: ElementPatchArgs): Omit<Extract<MapOp, { type: 'edit_element' }>, 'type' | 'elementId'> {
  return {
    text: args.text,
    x: args.x,
    y: args.y,
    w: args.w,
    h: args.h,
    color: args.color === undefined ? undefined : args.color === 'none' ? null : (args.color as NodeColor),
    anchor: args.detach
      ? null
      : args.anchor_node_id
        ? { nodeId: args.anchor_node_id, side: (args.side ?? 'right') as ElementSide }
        : undefined,
  };
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
      const doc = docFromMap(map);
      const markdown = branchToMarkdown(doc, map.root.id, { ids: true, meta: true });
      const floatingBlocks = doc.floating.map((f) => branchToMarkdown(doc, f.rootId, { ids: true, meta: true }));
      const floatingSection = floatingBlocks.length ? `\n\n## Floating trees\n${floatingBlocks.join('\n\n')}` : '';
      const sections = [relationshipsSection(doc), groupsSection(doc), elementsSection(doc)].filter(
        (s): s is string => s !== null,
      );
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
      const doc = docFromMap(map);
      if (!doc.nodes[args.node_id]) return errorResult(`node ${args.node_id} not found`);
      const markdown = branchToMarkdown(doc, args.node_id, { ids: true, meta: true, maxDepth: args.depth });
      const scope = new Set(subtreeIds(doc, args.node_id));
      const sections = [relationshipsSection(doc, scope), groupsSection(doc, scope), elementsSection(doc, scope)].filter(
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
        'Sets node metadata: style (the subtree\'s layout structure — e.g. make one branch an org chart or roadmap), color (one of sage/mist/clay/sand/rose — "none" clears), icon (a leading emoji; "" clears), note (longer hidden text shown in the inspector; "" clears), tags (searchable labels; [] clears, the array replaces the whole list). Absent fields are left untouched. Use color/icon to mark status (e.g. ❓ open question, sage = decided), notes for detail that would clutter the canvas. The edit appears live in an open browser tab and is undoable there.',
      inputSchema: z
        .object({
          map_id: z.string().describe('The map id'),
          node_id: z.string().describe('Id of the node'),
          color: z.enum([...NODE_COLORS, 'none']).optional().describe('Palette color name; "none" clears'),
          icon: z.string().optional().describe('Leading emoji/glyph; empty string clears'),
          note: z.string().optional().describe('Longer hidden text; empty string clears'),
          tags: z.array(z.string()).optional().describe('Replaces the tag list; [] clears'),
          style: z.enum(STYLE_CHOICES).optional().describe(styleDescription),
        })
        .refine(
          (a) =>
            a.color !== undefined ||
            a.icon !== undefined ||
            a.note !== undefined ||
            a.tags !== undefined ||
            a.style !== undefined,
          { message: 'provide at least one of color/icon/note/tags/style' },
        ),
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
          style: toStyle(args.style),
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
        'Draws a labeled directional arrow between any two nodes or canvas elements — a free cross-link connecting ideas, not a parent/child edge. Returns the relationship id for later edit/delete. Self-links and duplicate from→to arrows are rejected. The edit appears live in an open browser tab and is undoable there.',
      inputSchema: z.object({
        map_id: z.string().describe('The map id'),
        from_id: z.string().describe('Source node or element id'),
        to_id: z.string().describe('Target node or element id'),
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
      style: z.enum(STYLE_CHOICES).optional(),
    }),
    z.object({ op: z.literal('set_layout'), layout: z.enum(LAYOUT_STYLES as [LayoutStyle, ...LayoutStyle[]]) }),
    z.object({ op: z.literal('add_element'), kind: z.enum(KIND_CHOICES), ...elementFields }),
    z.object({
      op: z.literal('edit_element'),
      element_id: z.string(),
      ...elementFields,
      detach: z.boolean().optional(),
    }),
    z.object({ op: z.literal('delete_element'), element_id: z.string() }),
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
              style: toStyle(item.style),
            });
            summaries.push(`[${i}] set_node_meta ${item.node_id}`);
            break;
          case 'set_layout':
            ops.push({ type: 'set_layout', layout: item.layout });
            summaries.push(`[${i}] set_layout ${item.layout}`);
            break;
          case 'add_element': {
            if (!mapForPos) {
              if (!storage.isValidId(args.map_id)) return errorResult('invalid map id');
              mapForPos = await storage.readMap(args.map_id);
              if (!mapForPos) return errorResult('map not found');
            }
            const element = buildElement(item, mapForPos, autoPlaced++);
            ops.push({ type: 'add_element', element });
            summaries.push(`[${i}] add_element ${element.kind} ${element.id}`);
            break;
          }
          case 'edit_element':
            ops.push({ type: 'edit_element', elementId: item.element_id, ...elementPatch(item) });
            summaries.push(`[${i}] edit_element ${item.element_id}`);
            break;
          case 'delete_element':
            ops.push({ type: 'delete_element', elementId: item.element_id });
            summaries.push(`[${i}] delete_element ${item.element_id}`);
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
      description:
        'Creates a new map from a markdown outline (nested bullets: -, *, +; two-space indent per level). A single top-level bullet becomes the central topic; several become its children under a root named after the title. By default the map opens on the user\'s screen. Returns the outline annotated with node ids for follow-up edits.',
      inputSchema: z.object({
        title: z.string().describe('Title for the new map'),
        markdown: z.string().optional().describe('Markdown outline to use as the map content'),
        layout: z
          .enum(LAYOUT_STYLES as [LayoutStyle, ...LayoutStyle[]])
          .optional()
          .describe('right (logic chart, default), balanced (both sides), down (org chart), timeline (roadmap)'),
        open: z.boolean().optional().describe('Open it in the user\'s browser tab (default true)'),
      }),
    },
    async (args) => {
      const title = args.title.trim();
      if (!title) return errorResult('title is required');
      const branches = args.markdown ? markdownToBranches(args.markdown) : [];
      const map = buildMapFile(title, branches, args.layout);
      await storage.writeMap(map);
      publish({ kind: 'map-created', mapId: map.id, title: map.title });
      if (args.open !== false) publish({ kind: 'open-map', mapId: map.id });
      return {
        content: [
          { type: 'text', text: `Created map "${map.title}" (id: ${map.id})\n${outlineWithIds([map.root])}` },
        ],
      };
    },
  );

  server.registerTool(
    'add_element',
    {
      description:
        'Adds a freeform canvas element (Excalidraw-style, outside the trees): sticky (a note — callouts, caveats, open questions, summaries), text (a free heading/caption), rect or ellipse (a shape, e.g. a zone or a highlighted concept), draw (a freehand stroke from `points` — underline, circle, checkmark, squiggle). Anchor it to a node with anchor_node_id + side to place it beside that node without knowing pixel coordinates — it follows the node through layout changes. Arrows (add_relationship) can connect elements and nodes. Returns the element id. Live and undoable in the browser.',
      inputSchema: z.object({
        map_id: z.string().describe('The map id'),
        kind: z.enum(KIND_CHOICES),
        ...elementFields,
      }),
    },
    async (args) => {
      if (!storage.isValidId(args.map_id)) return errorResult('invalid map id');
      const map = await storage.readMap(args.map_id);
      if (!map) return errorResult('map not found');
      const element = buildElement(args, map, 0);
      const r = await mutateMap(args.map_id, [{ type: 'add_element', element }]);
      if ('error' in r) return errorResult(r.error);
      return { content: [{ type: 'text', text: `Added ${element.kind} ${element.id}` }] };
    },
  );

  server.registerTool(
    'edit_element',
    {
      description:
        'Changes a canvas element: text, color ("none" clears), size (w/h), position (x/y — a nudge when anchored), re-anchor (anchor_node_id + side), or detach: true to free it from its node (it keeps x/y as world coordinates — set them). Absent fields are untouched. Live and undoable.',
      inputSchema: z.object({
        map_id: z.string().describe('The map id'),
        element_id: z.string().describe('Element id (from add_element or read_map_markdown)'),
        ...elementFields,
        detach: z.boolean().optional().describe('Free the element from its anchor node'),
      }),
    },
    async (args) => {
      const r = await mutateMap(args.map_id, [{ type: 'edit_element', elementId: args.element_id, ...elementPatch(args) }]);
      if ('error' in r) return errorResult(r.error);
      return { content: [{ type: 'text', text: `Updated element ${args.element_id}` }] };
    },
  );

  server.registerTool(
    'delete_element',
    {
      description: 'Deletes a canvas element (and arrows touching it). Live and undoable.',
      inputSchema: z.object({ map_id: z.string().describe('The map id'), element_id: z.string() }),
    },
    async (args) => {
      const r = await mutateMap(args.map_id, [{ type: 'delete_element', elementId: args.element_id }]);
      if ('error' in r) return errorResult(r.error);
      return { content: [{ type: 'text', text: `Deleted element ${args.element_id}` }] };
    },
  );

  server.registerTool(
    'set_layout',
    {
      description:
        'Sets the whole map\'s layout structure: right (logic chart), balanced (branches on both sides of the root), down (org chart), timeline (Now/Next/Later roadmap). For a single branch, use set_node_meta style instead. Undoable in the browser.',
      inputSchema: z.object({
        map_id: z.string().describe('The map id'),
        layout: z.enum(LAYOUT_STYLES as [LayoutStyle, ...LayoutStyle[]]),
      }),
    },
    async (args) => {
      const r = await mutateMap(args.map_id, [{ type: 'set_layout', layout: args.layout }]);
      if ('error' in r) return errorResult(r.error);
      return { content: [{ type: 'text', text: `Layout set to ${args.layout}` }] };
    },
  );

  server.registerTool(
    'get_active_view',
    {
      description:
        'What the user is looking at right now in the browser: the open map (or the gallery), the selected node with its branch, and any hoisted branch. Call this first when the user says "this map", "this node", "here", or "the selected branch". Only available over the HTTP transport with the app open.',
      inputSchema: z.object({
        depth: z.number().int().min(0).max(10).optional().describe('Levels of the selected branch to include (default 2)'),
      }),
    },
    async (args) => {
      const view = getActiveView();
      if (!view) {
        return {
          content: [
            {
              type: 'text',
              text: 'No browser tab has reported a view to this server (no tab open, or this is a stdio server — use list_maps).',
            },
          ],
        };
      }
      const age = Math.round((Date.now() - view.at) / 1000);
      if (!view.mapId) return { content: [{ type: 'text', text: `The user is in the map gallery (reported ${age}s ago).` }] };
      const map = await storage.readMap(view.mapId);
      if (!map) return { content: [{ type: 'text', text: `The open map ${view.mapId} no longer exists on disk.` }] };
      const doc = docFromMap(map);
      const lines = [`Open map: "${map.title}" (id: ${map.id}, layout: ${doc.layout}, reported ${age}s ago)`];
      if (view.hoistId && doc.nodes[view.hoistId]) {
        lines.push(`Hoisted on: ${view.hoistId} "${doc.nodes[view.hoistId].text}" (the user only sees this branch)`);
      }
      const sel = view.selectedId && doc.nodes[view.selectedId] ? view.selectedId : null;
      if (sel) {
        lines.push(`Selected node: ${sel}`, '', branchToMarkdown(doc, sel, { ids: true, meta: true, maxDepth: args.depth ?? 2 }));
      } else {
        lines.push('Nothing selected.');
      }
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    },
  );

  server.registerTool(
    'open_map',
    {
      description:
        'Shows a map on the user\'s screen: every open browser tab navigates to it. Use after creating or before editing a map the user should watch. node_id also selects that node.',
      inputSchema: z.object({
        map_id: z.string().describe('The map id'),
        node_id: z.string().optional().describe('Node to select once it opens'),
      }),
    },
    async (args) => {
      if (!storage.isValidId(args.map_id)) return errorResult('invalid map id');
      const map = await storage.readMap(args.map_id);
      if (!map) return errorResult('map not found');
      publish({ kind: 'open-map', mapId: map.id, nodeId: args.node_id });
      return { content: [{ type: 'text', text: `Opened "${map.title}" in the browser` }] };
    },
  );

  server.registerTool(
    'export_map',
    {
      description:
        'Renders a map to an image through the user\'s open browser tab (it navigates there if needed) and saves it under the maps folder in exports/. PNG returns the image itself, so you can LOOK at the layout you built — use it to check readability, crowding, and balance. SVG is a scalable file for sharing. Exports what the tab shows: a hoisted branch or pinned filter applies. HTTP transport with the app open only.',
      inputSchema: z.object({
        map_id: z.string().describe('The map id'),
        format: z.enum(['png', 'svg']).optional().describe('png (default) or svg'),
      }),
    },
    async (args) => {
      if (!storage.isValidId(args.map_id)) return errorResult('invalid map id');
      const map = await storage.readMap(args.map_id);
      if (!map) return errorResult('map not found');
      const format = args.format ?? 'png';
      let result;
      try {
        result = await requestExport(map.id, format);
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err));
      }
      const slug = map.title.normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase();
      const file = await saveExport(storage.mapsDir(), `${slug || 'map'}-${map.id}`, result);
      const text = `Exported "${map.title}" to ${file}`;
      if (result.format === 'png') {
        return {
          content: [
            { type: 'text', text },
            { type: 'image', data: result.data, mimeType: 'image/png' },
          ],
        };
      }
      return { content: [{ type: 'text', text }] };
    },
  );

  // Prompts: client-side slash commands (omp, Claude Code /mcp__…, others) that
  // hand the model a complete routine. The routine text lives in MCP.md.
  const promptMessage = (text: string) => ({ messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }] });

  server.registerPrompt(
    'build_map',
    {
      title: 'Build a mind map',
      description: 'Plan, create, decorate, visually check, and polish a new mind map on a topic — live on the canvas',
      argsSchema: {
        topic: z.string().describe('What the map is about (and any must-haves)'),
        layout: z.string().optional().describe('Optional: right | balanced | down | timeline'),
      },
    },
    async ({ topic, layout }) =>
      promptMessage(
        `Build a mind map about: ${topic}${layout ? `\nUse the "${layout}" layout.` : ''}\n\n` +
          `Follow this routine exactly, using the mindmap tools:\n\n${await guideSection('Build a polished map in one go')}`,
      ),
  );

  server.registerPrompt(
    'expand_branch',
    {
      title: 'Expand the selected branch',
      description: 'Grow the branch selected in the browser, matching the map\'s existing style and legend',
      argsSchema: { focus: z.string().optional().describe('Optional: what to expand it with or toward') },
    },
    async ({ focus }) =>
      promptMessage(
        `Expand the branch I have selected in the mind map${focus ? `, focusing on: ${focus}` : ''}.\n\n` +
          `Follow this routine, using the mindmap tools:\n\n${await guideSection('Expand the selected branch')}`,
      ),
  );

  server.registerPrompt(
    'challenge_map',
    {
      title: 'Challenge this map',
      description: 'Stress-test the open map: mark weak spots with ❓ questions instead of adding content',
      argsSchema: { map: z.string().optional().describe('Optional map title or id; default: the open map') },
    },
    async ({ map }) =>
      promptMessage(
        `Challenge ${map ? `the map "${map}"` : 'the map I have open (get_active_view)'}.\n\n` +
          (await guideSection('Challenge the map (Socratic mode)')),
      ),
  );

  server.registerPrompt(
    'quiz_me',
    {
      title: 'Quiz me on this map',
      description: 'Examine your understanding of a map, one question at a time, then grade it on the canvas',
      argsSchema: { map: z.string().optional().describe('Optional map title or id; default: the open map') },
    },
    async ({ map }) =>
      promptMessage(
        `Quiz me on ${map ? `the map "${map}"` : 'the map I have open (get_active_view)'}.\n\n` +
          (await guideSection('Quiz the user (assessment mode)')),
      ),
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

