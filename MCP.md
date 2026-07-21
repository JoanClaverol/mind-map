# Mind Map MCP Guide

This document is for AI models connecting to the **mind-map MCP server**. Read this first so you know how to inspect and create mind maps correctly.

## What this MCP server does

mindmap-mcp is a local, keyboard-first mind mapping canvas. Maps are stored as pretty-printed JSON files in a maps directory. This MCP server lets you:

- Read the project context and map schema.
- List existing maps; **search node text across one or all maps**.
- Read a map as JSON or as an id-annotated markdown outline (including its floating trees and relationship arrows), or read just one branch.
- **Edit an existing map surgically**: add, edit, move, or delete specific nodes.
- **Annotate nodes**: color (small named palette), a leading icon/emoji, a hidden note, and searchable tags — use these to mark status (❓ open question, ✅ decided…) without cluttering the canvas.
- **Work with floating trees**: create detached trees on the canvas (`create_tree`), split a branch out (`detach_node`), attach a tree under a node (`move_node` on its root).
- **Connect ideas with relationship arrows**: free directional cross-links between any two nodes — including across trees.
- **Batch several edits atomically** with `apply_ops`.
- Create a new map from a markdown outline.

Edits appear **live** in a browser tab that has the map open, and the user can undo them there with Ctrl+Z — treat your edits as collaborator edits on a shared document, not batch rewrites.

## Connection

The MCP server is available in two forms:

- **HTTP/SSE** (when the app is running — `pnpm dev`, `pnpm start`, or `mindmap up`): `http://localhost:5454/mcp` (`mindmap up` prints its own per-session URL).
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
  - ✈️ Flights (id: q7Rt2LwN8vXc) [sage] #booked
    > Prices locked in — check baggage rules before packing.
  - Accommodation (id: dF5gH1jK3sQw)

## Relationships
- [rM4nP6bV0zXy] q7Rt2LwN8vXc ("Flights") -> dF5gH1jK3sQw ("Accommodation") — "book together"
```

Node metadata renders inline: the icon before the text, `[color]` and `#tags` after the id, and the note as an indented `>` line. **These annotations are read-only decoration — never paste them back into an outline** (`create_map_from_outline`, `add_nodes`): the parser would treat `>` lines as continuation text. Use `set_node_meta` to write metadata.

### `get_subtree`

- Arguments: `{ map_id: string, node_id: string, depth?: number }`
- Returns one branch as an id-annotated outline plus any arrows touching it. Cheaper than `read_map` on large maps.
- `depth` limits levels of descendants; a cut-off node shows `… (+N children hidden)`.

### `find_nodes`

- Arguments: `{ query?: string, tags?: string[], map_id?: string }` — provide `query`, `tags`, or both.
- Case-insensitive substring search over node text, and/or tag filtering (a node must carry **all** requested tags) — one map, or **all maps** when `map_id` is omitted.
- Returns hits as `- <node_id> "text" — map <map_id> ("Title"), path: Root > Parent > … #tag1 #tag2`, capped at 50 (most recently updated maps first). Use this to locate ids before editing instead of reading whole maps.

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

### `set_node_meta`

- Arguments: `{ map_id: string, node_id: string, color?: string, icon?: string, note?: string, tags?: string[] }`
- Partial update: absent fields are left untouched. Clearing: `color: "none"`, `icon: ""`, `note: ""`, `tags: []` (the array always replaces the whole list).
- `color` is one of the palette names `sage | mist | clay | sand | rose` — rendered as a subtle tint. `icon` is a leading emoji (max 16 chars) shown before the text. `note` (max 2000 chars) is hidden behind the node — a dot marks it on canvas; the user reads it in the inspector. `tags` (max 8 × 24 chars) are searchable via `find_nodes`.
- Suggested conventions: ❓ + a note for open questions, ✅ or `sage` for decided, `rose` for blocked/risky — tell the user what your markings mean.

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
  { "op": "detach_node", "node_id": "…", "x": 700, "y": 40 },
  { "op": "set_node_meta", "node_id": "…", "color": "sage", "icon": "✅", "tags": ["decided"] }
] }
```

- Returns per-op results including newly assigned node/relationship ids. On failure the error names the failing op index and nothing is applied.

### `create_map_from_outline`

- Arguments: `{ title: string, markdown?: string }`
- Parses the markdown into a tree and saves a new map.
- Returns the new map id.

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
  color?: string;       // palette name: sage | mist | clay | sand | rose
  icon?: string;        // leading emoji shown before the text (max 16 chars)
  note?: string;        // longer hidden text (max 2000 chars)
  tags?: string[];      // searchable labels (max 8 tags, 24 chars each)
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

When you produce markdown for `create_map_from_outline`, `add_nodes`, or `create_tree`, follow these rules:

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
2. Compose a markdown outline yourself and call `create_map_from_outline`.
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

### Challenge the map (Socratic mode)

When the user asks you to challenge, probe, or stress-test a map — or their understanding of
the topic it describes — **do not add content nodes**. The understanding they're building
comes from answering questions themselves; a complete tree you wrote is *your* model of the
topic, not theirs. Add questions instead:

1. `read_map_markdown` the whole map. Look for: unsupported claims, overlapping or
   suspiciously tidy categories, branches that contradict each other, missing
   counter-arguments, and ideas whose placement forces one framing where others exist.
2. Mark each finding **on the node itself** with one `apply_ops` batch of `set_node_meta`
   ops: icon `❓`, a `note` holding the actual question ("What evidence supports this?",
   "How does this square with X?"), and the tag `open`. One undo step, quiet canvas.
3. Where two ideas conflict or secretly depend on each other, draw it:
   `add_relationship` with labels like "contradicts?", "assumes", "depends on?".
4. In chat, list the questions briefly — then stop. Let the user answer by editing the map.
   Only clear a ❓ (icon `""`, drop the `open` tag) or mark a node decided (✅ / `sage`)
   when the user resolves it.
5. Keep the tag vocabulary stable: the user finds open questions later with `find_nodes`
   `tags: ["open"]`, or on the canvas by typing `#open` into the ⌘F search/filter.

### Quiz the user (assessment mode)

When the user asks to be tested on a map ("quiz me", "do I actually know this?"), the map
is their claimed understanding and you are the examiner. Tool discipline is what makes the
quiz honest:

1. **Read once, silently.** `read_map_markdown` at the start. From then on, never quote or
   paraphrase a node's text, note, or arrow label in a question before the user has
   answered — a quiz that echoes the map tests nothing.
2. **One question at a time, in chat.** Wait for each answer. Climb the ladder: *recall*
   ("what's under X? explain it from memory"), then *connections* (the `## Relationships`
   section is your question bank — "why do A and B relate? which arrow would you draw?"),
   then *transfer* (a scenario not on the map — "how does your model handle …?").
3. **Judge each answer twice**: against the map, and against your own knowledge of the
   topic. Name which kind of miss it is — "not what your map says" vs "your map itself is
   wrong or incomplete here". The second is the more valuable finding.
4. **No map edits during the quiz.** A ❓ appearing mid-quiz telegraphs the next question
   on the user's live canvas.
5. **Score in one `apply_ops` batch at the end**: `sage` + ✅ on branches explained well;
   ❓ + `rose` + tag `open` on gaps, with what was actually missed in the `note`. One
   batch = one Ctrl+Z if the user disputes the grading.
6. **Re-quizzes start from the scars**: `find_nodes` with `tags: ["open"]`, question those
   first, and clear a node's ❓/`open` only once the user answers it correctly.

Same tag vocabulary as Socratic mode (`open`) — the user's ⌘F `#open` filter must surface
every gap regardless of which mode created it.

### Restructure in one step

Use `apply_ops` when a change involves several edits that belong together (split a node, regroup a branch, rename several siblings). It is atomic on disk and lands as a single Ctrl+Z for the user — much better than a stream of individual edits they'd have to undo one by one.

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
- Empty title or prompt.
