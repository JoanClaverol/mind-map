# Mind Map MCP Guide

This document is for AI models connecting to the **mind-map MCP server**. Read this first so you know how to inspect and create mind maps correctly.

## What this MCP server does

mindmap-mcp is a local, keyboard-first mind mapping canvas. Maps are stored as pretty-printed JSON files in a maps directory. This MCP server lets you:

- Read the project context and map schema.
- List existing maps; **search node text across one or all maps**.
- Read a map as JSON or as an id-annotated markdown outline (including its floating trees and relationship arrows), or read just one branch.
- **Edit an existing map surgically**: add, edit, move, or delete specific nodes.
- **Work with floating trees**: create detached trees on the canvas (`create_tree`), split a branch out (`detach_node`), attach a tree under a node (`move_node` on its root).
- **Connect ideas with relationship arrows**: free directional cross-links between any two nodes — including across trees.
- **Batch several edits atomically** with `apply_ops`.
- Create a new map from a markdown outline.
- Generate a new map from a prompt using an LLM (only present when OpenRouter is configured).

Edits appear **live** in a browser tab that has the map open, and the user can undo them there with Ctrl+Z — treat your edits as collaborator edits on a shared document, not batch rewrites.

## Connection

The MCP server is available in two forms:

- **HTTP/SSE** (when the app is running — Docker, `pnpm dev`, or `mindmap up`): `http://localhost:5454/mcp` (`mindmap up` prints its own per-session URL).
- **stdio** (for clients that spawn a process): `mindmap stdio [--maps DIR]`, or `node --import tsx server/mcp-stdio.ts` from the project root.

Run `mindmap config <client>` for ready-to-paste config (claude-code, claude-desktop, codex, opencode). There is no authentication; it is intended for local use only.

## Tools

### `get_project_context`

Returns this guide plus the map schema. Call this first.

### `list_maps`

Returns all saved maps with id, title, node count, and last update time.

### `read_map`

- Arguments: `{ map_id: string }`
- Returns the full `MapFile` JSON for that map.

### `read_map_markdown`

- Arguments: `{ map_id: string }`
- Returns the map as a nested markdown outline **annotated with node ids**, followed by a `## Relationships` section listing the arrows — everything needed to edit surgically without calling `read_map`:

```markdown
# Trip to Japan

- Trip to Japan (id: aB3xY9kQ2mZp)
  - Flights (id: q7Rt2LwN8vXc)
  - Accommodation (id: dF5gH1jK3sQw)

## Relationships
- [rM4nP6bV0zXy] q7Rt2LwN8vXc ("Flights") -> dF5gH1jK3sQw ("Accommodation") — "book together"
```

### `get_subtree`

- Arguments: `{ map_id: string, node_id: string, depth?: number }`
- Returns one branch as an id-annotated outline plus any arrows touching it. Cheaper than `read_map` on large maps.
- `depth` limits levels of descendants; a cut-off node shows `… (+N children hidden)`.

### `find_nodes`

- Arguments: `{ query: string, map_id?: string }`
- Case-insensitive substring search over node text — one map, or **all maps** when `map_id` is omitted.
- Returns hits as `- <node_id> "text" — map <map_id> ("Title"), path: Root > Parent > …`, capped at 50 (most recently updated maps first). Use this to locate ids before editing instead of reading whole maps.

### `add_nodes`

- Arguments: `{ map_id: string, parent_id: string, markdown: string }`
- Parses the markdown outline and inserts it under the given node, preserving all other nodes.
- Returns the inserted outline annotated with the new node ids, so follow-up edits can target them without re-reading the map.

### `edit_node`

- Arguments: `{ map_id: string, node_id: string, text: string }`
- Replaces one node's text. Inline markdown is supported.
- Editing the root node changes its label on the canvas, not the map's gallery title.

### `move_node`

- Arguments: `{ map_id: string, node_id: string, new_parent_id: string, before_sibling_id?: string }`
- Moves a node with its whole subtree. Omit `before_sibling_id` to append at the end; pass a child of the new parent to insert before it.
- Passing a **floating tree's root** attaches that whole tree under the new parent.
- Moving a node into its own subtree is rejected; the main root cannot be moved.

### `delete_node`

- Arguments: `{ map_id: string, node_id: string }`
- Deletes the node and its whole subtree; a **floating tree's root** deletes that whole tree. The main root cannot be deleted. Relationships touching deleted nodes are pruned.

### `create_tree`

- Arguments: `{ map_id: string, markdown: string, x?: number, y?: number }`
- Creates a **floating tree**: a detached tree on the same canvas, for ideas that don't (yet) belong anywhere. The markdown must have exactly **one** top-level bullet — it becomes the tree root. Omit `x`/`y` to auto-place below existing trees (position is advisory; the user drags trees around).
- Returns the new tree's id-annotated outline and position.

### `detach_node`

- Arguments: `{ map_id: string, node_id: string, x?: number, y?: number }`
- Splits a node (with its whole subtree) out of its parent so it becomes a floating tree. The main root and existing floating roots cannot be detached.
- To re-attach any floating tree, call `move_node` with its root id and a new parent.

### `add_relationship`

- Arguments: `{ map_id: string, from_id: string, to_id: string, label?: string }`
- Draws a labeled directional arrow between any two nodes — a free cross-link connecting ideas, **not** a parent/child edge. Works across branches.
- Returns the relationship id for later edit/delete. Self-links and duplicate `from→to` arrows are rejected.

### `edit_relationship`

- Arguments: `{ map_id: string, relationship_id: string, label: string }`
- Changes the arrow's label; an empty label removes it.

### `delete_relationship`

- Arguments: `{ map_id: string, relationship_id: string }`
- Deletes the arrow; the nodes stay.

### `apply_ops`

- Arguments: `{ map_id: string, ops: BatchOp[] }` (1–50 ops)
- Applies several edits in one **atomic** call — all succeed or none are applied — and lands as **one undo step** in the user's browser. Prefer this over sequential single-op calls when restructuring.
- Each op mirrors a single tool, discriminated by `op`:

```json
{ "map_id": "…", "ops": [
  { "op": "add_nodes", "parent_id": "…", "markdown": "- New idea\n  - Detail" },
  { "op": "edit_node", "node_id": "…", "text": "Renamed" },
  { "op": "move_node", "node_id": "…", "new_parent_id": "…", "before_sibling_id": "…" },
  { "op": "delete_node", "node_id": "…" },
  { "op": "add_relationship", "from_id": "…", "to_id": "…", "label": "causes" },
  { "op": "edit_relationship", "relationship_id": "…", "label": "…" },
  { "op": "delete_relationship", "relationship_id": "…" },
  { "op": "create_tree", "markdown": "- New cluster\n  - Spark", "x": 500, "y": 100 },
  { "op": "detach_node", "node_id": "…", "x": 700, "y": 40 }
] }
```

- Returns per-op results including newly assigned node/relationship ids. On failure the error names the failing op index and nothing is applied.

### `create_map_from_outline`

- Arguments: `{ title: string, markdown?: string }`
- Parses the markdown into a tree and saves a new map.
- Returns the new map id.

### `generate_map`

- Arguments: `{ prompt: string, title?: string, source_map_id?: string }`
- Sends the prompt to OpenRouter and asks for a nested markdown outline.
- If `source_map_id` is provided, the existing map is included as context (it is not copied unless the prompt asks for it).
- Saves the result as a new map and returns its id plus the outline that was used.

This tool is **only registered when `OPENROUTER_API_KEY` is configured** — if you don't see it, generate the outline yourself and use `create_map_from_outline`.

## Map file format (`MapFile`)

```ts
interface MapFile {
  schemaVersion: 2;
  id: string;           // map id, also the JSON file name
  title: string;
  createdAt: string;    // ISO 8601
  updatedAt: string;    // ISO 8601
  layout?: 'right' | 'balanced' | 'down' | 'timeline';
  pinned?: boolean;
  relationships?: Relationship[];
  root: FileNode;
  floating?: Array<{ pos: { x: number; y: number }; root: FileNode }>;
}

interface FileNode {
  id: string;
  text: string;
  collapsed?: boolean;
  todoId?: string;      // set only if pushed to the external todo service
  color?: string;       // reserved for a future release — do not set yet
  icon?: string;        // reserved
  note?: string;        // reserved
  tags?: string[];      // reserved
  children: FileNode[];
}

interface Relationship {
  id: string;
  from: string;         // source node id
  to: string;           // target node id
  label?: string;
}
```

- The root node is the map title. `floating` holds detached trees (XMind floating topics); `pos` is the world position of each tree root, advisory for you (the user drags trees).
- `layout` defaults to `'right'` if omitted; floating trees always lay out as compact right-trees.
- `relationships` are free directional arrows between any two nodes — including across trees; they are **not** parent/child links.

## How to generate a good map

When you generate a map, either through `generate_map` or by producing markdown for `create_map_from_outline`, follow these rules:

1. **Output only markdown bullet outlines.** Use `- ` for every line.
2. **Indent with two spaces per level.** Do not use tabs or mixed indentation.
3. **No code fences, no preamble, no explanations.** Return only the outline.
4. **Keep node text concise.** One short phrase per node is ideal.
5. **Group related ideas** under shared parent nodes.
6. **Preserve the user's language.** If the prompt is in Catalan, reply in Catalan; if Spanish, Spanish; if English, English.
7. **Do not invent content** that is not implied by the prompt or the provided context.

Example of a valid outline:

```markdown
- Trip to Japan
  - Flights
    - Search Skyscanner
    - Book by end of month
  - Accommodation
    - Tokyo: 3 nights in Shibuya
    - Kyoto: 2 nights in Gion
  - Itinerary
    - Day 1: arrive in Tokyo
    - Day 2: Shibuya and Harajuku
    - Day 3: train to Kyoto
  - Packing
    - Portable charger
    - Pocket Wi-Fi
```

This will create a root node "Trip to Japan" with four children, each with their own subtrees.

## Workflows

### Create a brand new map from a conversation

1. Call `get_project_context` if you need the schema.
2. Call `generate_map` with a clear prompt.
3. Read the returned map id and tell the user.

### Co-edit a map with the user (preferred for existing maps)

1. Call `read_map_markdown` to get the id-annotated tree and its arrows (or `find_nodes` to locate a specific idea).
2. Use `add_nodes` / `edit_node` / `move_node` / `delete_node` to develop the map incrementally — or `apply_ops` for a multi-step change.
3. Each edit shows up instantly in the user's browser. The user may be editing at the same time — re-read before a batch of edits if some time has passed, and expect an occasional "node not found" if the user deleted or undid something you were building on. That is normal: the user's edits and undos win.

### Search, then edit (large maps or many maps)

1. `find_nodes` with a phrase the user mentioned → get the node id and its map.
2. `get_subtree` on that node (with `depth` if the branch is big) to see local context.
3. Edit surgically. This keeps big maps out of your context window.

### Connect ideas with arrows

1. Locate the two node ids (`find_nodes` or `read_map_markdown`).
2. `add_relationship` with a short label naming the connection ("causes", "depends on", "contrasts with").
3. Arrows are for cross-cutting links — if one idea simply belongs under another, `move_node` it there instead.

### Brainstorm with floating trees

1. When an idea doesn't fit the current structure, `create_tree` it as its own floating cluster instead of forcing it under a node.
2. Connect clusters to the main tree (or each other) with `add_relationship` arrows as the relations emerge.
3. When a cluster's place becomes clear, attach it: `move_node` with the tree's root id. The reverse — `detach_node` — splits an overgrown branch out to stand alone.

### Restructure in one step

Use `apply_ops` when a change involves several edits that belong together (split a node, regroup a branch, rename several siblings). It is atomic on disk and lands as a single Ctrl+Z for the user — much better than a stream of individual edits they'd have to undo one by one.

### Build on an existing map with AI generation

1. Call `read_map_markdown` with the existing map id to get its outline.
2. Call `generate_map` with the prompt and `source_map_id` set to the existing map id.
3. The model will receive the existing outline as context and can extend or reorganize it. Note this creates a **new** map; to change the existing one, use the surgical edit tools instead.

### Create a map manually from an outline

1. Format the outline as markdown bullets.
2. Call `create_map_from_outline` with `title` and `markdown`.

## Important conventions

- **Only mutate maps when the user asks.** Prefer surgical edits over creating a new map — they preserve node ids, todo links, and the user's undo history.
- **Prefer `apply_ops` for multi-step changes** — one atomic write, one undo step for the user.
- **Ids are generated by the server.** When creating nodes from markdown, placeholder ids are fine; the server replaces them with nanoids. Relationship ids come from `add_relationship`'s response or `read_map_markdown`.
- **Node text supports inline markdown:** `**bold**`, `*italic*`, `` `code` ``, `~~strike~~`, `==highlight==`, and `[label](url)`.
- **Map files are saved immediately** to `maps/<id>.json` and appear in the web gallery.

## Errors

Tools return `{ isError: true, content: [...] }` for problems such as:

- Invalid map id format.
- Map not found.
- Missing OpenRouter API key for `generate_map`.
- Empty title or prompt.
