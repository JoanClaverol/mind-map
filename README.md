# mind-map

A personal, keyboard-first mind mapping tool — XMind-style hotkey brainstorming, but fully customizable and integrated with segon-cervell.

## Run it

```bash
# daily driver (always-on container at http://localhost:5454)
docker compose up -d --build

# development (same app + API on the same port, with HMR)
pnpm install
pnpm dev
```

Maps live as pretty-printed JSON files in `maps/` — one file per map, bind-mounted into the container, friendly to git and backups. When you share the app, your own map files stay on your machine (see [Share it](#share-it) below).

## Share it

Send the app to someone else without giving them your maps or secrets:

```bash
# build mind-map-share.zip (excludes maps/*.json and .env, includes one demo map)
./scripts/make-shareable.sh
```

The recipient extracts the zip and runs:

```bash
docker compose -f docker-compose.share.yml up -d --build
```

Then open http://localhost:5454. Their maps will be stored in the `maps/` folder next to `docker-compose.share.yml`. Voice transcription, AI refine, and segon-cervell integrations are disabled by default; add an `.env` file with the relevant keys to turn them on.

## Hotkeys

| Key | Action |
| --- | --- |
| `Tab` | Add child and edit it |
| `Enter` / `Shift+Enter` | Add sibling below / above and edit it |
| `Space` or `F2` | Edit selected node (cursor at end) |
| *type any character* | Edit selected node, replacing its text (XMind behavior) |
| `Enter` / `Esc` (while editing) | Commit (`Shift+Enter` inserts a line break) |
| `Delete` / `Backspace` | Delete subtree |
| `h j k l` or arrows | Navigate by screen direction (toward root / down / up / deeper — adapts to the layout structure) |
| `⇧J` / `⇧K` | Move node down / up on screen (reorder; nest/un-nest in org chart) |
| `⇧L` / `⇧H` | Move node right / left on screen (nest/un-nest; reorder in org chart) |
| `⇧S` | Cycle layout structure: right tree → balanced map → org chart → roadmap (per map, undoable) |
| `⇧R` | Record a voice note → transcript becomes nodes under the selection (press again to stop, Esc to discard) |
| `/` | Collapse / expand branch |
| `⇧A` | Draw an **arrow** (relationship) from the selected node — move (`hjkl`/click) to a target, `Enter` to connect, `Esc` to cancel; the label editor opens on connect |
| `⌘C` / `⌘X` / `⌘V` | Copy / cut branch as markdown outline · paste outline as subtree |
| `t` | Push node as todo into segon-cervell (lands in today's list) |
| `⇧T` | Save branch as a note in segon-cervell (node text = title, subtree = markdown outline) |
| `⌘Z` / `⌘⇧Z` | Undo / redo |
| `⌘=` / `⌘-` / `⌘0` | Zoom in / out / fit |
| `⌘K` | Ask-the-map chat — question answered from this map's content (see below) |
| `Esc` | Back to gallery |
| `?` | Keyboard cheatsheet — every bound command, generated from the live keymap (works in the gallery too) |

Mouse: scroll to pan, pinch (or `⌃`+scroll) to zoom at cursor, drag empty canvas to pan, double-click a node to edit. **Drag a node** to restructure: the middle of another node nests the branch inside it (appended; expands collapsed targets), the top/bottom edge inserts it between siblings (blue line shows where). `Esc` cancels a drag. **Click an arrow** (or its label) to select it — then `Enter` edits its label, `Delete`/`Backspace` removes it, `Esc` deselects; double-click edits the label directly.

Relationships are free, directional arrows that link any two nodes — across different branches/trees, not parent and child. They persist in the map JSON (a `relationships` array) but are deliberately **not** part of markdown copy/paste, which stays tree-only. An arrow hides while either endpoint is collapsed and returns when expanded. Deleting a node removes the arrows touching it (undo restores both).

Note: because `⇧HJKL` are move commands, `⇧A` draws an arrow, `⇧R` records, `⇧S` switches structure and `⇧T` saves a note, typing a *capital* A/H/J/K/L/R/S/T to replace a node's text won't trigger type-to-edit — press `Space` to edit instead, or unbind them via `localStorage.keymap` (e.g. `[{"combo":"shift+j","context":"nav","command":null}]`).

## Gallery

The `Esc` screen is a keyboard-driven map menu in three sections: **Pinned** (curated, sorted by title — `p` toggles a pin, stored as `pinned: true` in the map file so it survives backups/devices), **Recent** (last five opened, tracked in `localStorage.mindmap.lastOpened` so the map files stay diff-clean), and **All** (everything else by last edit).

| Key | Action |
| --- | --- |
| `j` / `k` or arrows | Move selection |
| `Enter` | Open the selected map |
| `/` | Fuzzy-search titles (substring first, then subsequence); `Esc` clears |
| `n` | New map (focus the title input) |
| `p` | Pin / unpin |
| `r` | Rename inline |
| `d` | Delete (confirms first) |
| `?` | Keyboard cheatsheet |

These are regular registry commands (`gallery.*`) bound in the `gallery` context — rebindable via `localStorage.keymap` like everything else.

## Voice capture

`⇧R` records from the mic (navigate the map freely while talking); `⇧R` again stops and transcribes **locally** via a Whisper sidecar container (faster-whisper large-v3-turbo, auto-detects ca/es/en, model shared via the `whisper-cache` Docker volume). You can also **drag an audio file** (.m4a/.mp3/.wav/.ogg/.webm…) onto the canvas. The transcript opens in a panel where you can edit it, run AI refine presets (clean up / summarize / key points / fix grammar), then:

- **⌘↩ Insert as outline** — an LLM (OpenRouter, `OPENROUTER_API_KEY` in `.env`) structures the transcript into a nested outline that becomes a subtree under the selected node; without a key it falls back to one node per spoken segment. One ⌘Z undoes the whole insert.
- **Insert raw** — the whole transcript as a single node.
- **→ segon cervell** — save the transcript as a note in the second brain.

Setup: copy `.env` values (see `.env` keys: `OPENROUTER_API_KEY`, `REFINE_MODEL`, `TRANSCRIBER_URL`); `docker compose up -d` runs both the app and the transcriber sidecar. In dev (`pnpm dev`), the sidecar is reachable on `localhost:8124`.

## Ask this map

`⌘K` opens a chat panel scoped to the current map. Ask a question in natural language
("what's the budget for Tokyo?", "which branches mention deadlines?") and an LLM
(OpenRouter, same `OPENROUTER_API_KEY` / `REFINE_MODEL` as voice refine) answers from the
map's content — the whole tree is serialized to a markdown outline (plus a relationships
list) and sent as grounding context, so answers stay anchored to what's actually on the
canvas and the model says when something isn't there. Answers **stream** in token-by-token.
The conversation is ephemeral: it lives in memory and clears when you reload or switch maps,
and nothing is written to the map file. Without a key the panel reports that AI chat is
disabled. Server route is `POST /api/chat` ([server/app.ts](server/app.ts)); it forwards to
OpenRouter with `stream: true` and re-emits text deltas.

## Markdown in nodes

Node text renders inline markdown: `**bold**`, `*italic*`, `` `code` ``, `~~strike~~`, `==highlight==` and `[text](url)` (Cmd+click opens the link; plain click just selects the node). The editor always shows the raw source, and that's also what's stored in the map file. Block syntax (`#`, `- `) stays literal — structure belongs to the tree. Parser lives in [src/model/inline-markdown.ts](src/model/inline-markdown.ts); output is escaped HTML by construction, and [src/layout/measure.ts](src/layout/measure.ts) measures the same rendered markup so node sizes always match.

## Markdown interop

`⌘C` puts the selected branch on the clipboard as a nested `- ` list. `⌘V` parses any nested list (from Notes, Obsidian, XMind exports — tabs, 2-space, 4-space, `-`/`*`/`+` all work) into a subtree under the selected node. Plain text pastes as a single node.

## Customizing (the whole point)

- **Keymap**: every action is a named command in [src/state/registry.ts](src/state/registry.ts); bindings are plain data in [src/hotkeys/keymap.ts](src/hotkeys/keymap.ts). Per-user overrides load from `localStorage.keymap` as JSON, e.g. `[{"combo":"x","context":"nav","command":"node.toggleCollapse"}]`; `"command": null` unbinds a default.
- **New commands**: add an entry to the registry, bind a combo — done. Doc mutations written as Immer-draft functions in [src/state/commands.ts](src/state/commands.ts) get correct undo/redo for free.
- **Layout**: one pure function in [src/layout/layout.ts](src/layout/layout.ts) (`(doc, sizes) → rects`) covering four structures — `right` (logic chart, default), `balanced` (children on both sides of the root), `down` (org chart), `timeline` (roadmap: first-level children become phases on a horizontal axis, their subtrees stack as indented outline columns below — Now/Next/Later style). The per-map style lives on the doc (`doc.layout`, persisted as `layout` in the JSON file) and `⇧S` cycles it; the result's `dirs` map tells rendering and navigation which way each branch grows.

## Architecture

- **Frontend**: Vite + React + TypeScript, Zustand store. Undo/redo via Immer `produceWithPatches` — every command records its patches and inverse patches; selection is restored from history.
- **Backend**: Hono app ([server/app.ts](server/app.ts)) mounted as Vite middleware in dev, served standalone ([server/standalone.ts](server/standalone.ts)) in Docker. Maps CRUD with atomic writes + `POST /api/todo` which calls segon-cervell's MCP server (`create_todo`) via the official MCP SDK. Set `SEGON_CERVELL_MCP_URL` to point elsewhere (the container uses `host.docker.internal:8000`).
- **Tests**: `pnpm test` — layout invariants, undo/redo property test (200 random commands), markdown round-trip, keymap resolution.
