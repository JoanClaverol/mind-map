# mindmap-mcp

**A local mind-map canvas any MCP-capable LLM can co-edit live, while you edit it too.**

Open a map in your browser, connect Claude Code, Claude Desktop, Codex, opencode — or any
other [MCP](https://modelcontextprotocol.io) client — and develop ideas together: the AI
adds, restructures, and connects nodes through the MCP server; every change streams onto
your canvas instantly and lands in your undo history (`⌘Z` reverts an AI edit like your
own). You keep editing by hand the whole time — on conflicts, your version wins.

Underneath it's a keyboard-first, [XMind](https://xmind.app)-style mind mapper: every
action has a hotkey, and each map is a human-readable JSON file that's friendly to git and
backups. Everything runs on your machine.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

<!-- Placeholder art. Replace docs/screenshot.svg with a real screenshot or GIF (a .png/.gif is fine — just update the path below). -->
<p align="center"><img src="docs/screenshot.svg" alt="mindmap-mcp" width="100%"></p>

## How it works

Maps are plain JSON files. A small local server exposes them two ways at once: to your
**browser** (the canvas) and to your **LLM** (the MCP server, over stdio or HTTP). AI edits
are surgical operations — add/move/edit/delete nodes, draw relationship arrows, atomic
batches — broadcast over SSE to the open tab and replayed through the same undo pipeline
as your keystrokes. See [ARCHITECTURE.md](ARCHITECTURE.md) for the full picture.

## Install

Requires [Node.js](https://nodejs.org) 20+ and [pnpm](https://pnpm.io) 9+.

```bash
git clone https://github.com/joanclaverol/mind-map.git && cd mind-map
pnpm install && pnpm build
pnpm link --global        # exposes the `mindmap` command
```

(Prefer containers? `docker compose -f docker-compose.share.yml up -d --build` runs the
app without any integrations.)

## Quick start

**The main library** — your personal collection of maps:

```bash
pnpm dev                  # or Docker, above
```

Open <http://localhost:5454>, create a map, then connect your AI (next section).

**A per-project session** — maps that live *inside* another repo (repo analysis,
presentation prep…), served ephemerally:

```bash
cd ~/your/other/project
mindmap claude    # serve ./mindmaps on a free port, open the browser,
                  # launch claude with the tools injected; teardown on exit
mindmap up        # same server, foreground — prints the config to connect
                  # any other client yourself
```

The only thing left in the host repo is `mindmaps/` — plain map JSON, meant to be
committed so the maps version with that project. Session files live in `.mindmap/`,
auto-added to `.git/info/exclude`.

## Connect your AI

`mindmap config` prints ready-to-paste MCP config for every supported client
(`claude-code`, `claude-desktop`, `codex`, `opencode`) — stdio and HTTP variants:

```bash
mindmap config claude-code
# claude mcp add mindmap -- node /path/to/mind-map/bin/mindmap.js stdio
```

- **stdio** (`mindmap stdio`) — the client spawns the server itself; serves the main
  library by default (`--maps DIR` to override). No app needs to be running.
- **HTTP** (`http://localhost:5454/mcp`) — connect to the running app; required for the
  live-canvas experience, since the browser and the LLM share one server.

## What your AI can do

The MCP server (guide: [MCP.md](MCP.md)) exposes the full editing surface:

| | Tools |
| --- | --- |
| Read | `read_map`, `read_map_markdown` (id-annotated + arrows), `get_subtree`, `list_maps` |
| Search | `find_nodes` — locate ideas across one or **all** maps without reading them whole |
| Edit nodes | `add_nodes`, `edit_node`, `move_node`, `delete_node` |
| Connect ideas | `add_relationship`, `edit_relationship`, `delete_relationship` — labeled arrows between any two nodes |
| Batch | `apply_ops` — up to 50 edits, atomic on disk, **one undo step** for you |
| Create | `create_map_from_outline`, `generate_map` (only with an OpenRouter key) |

## Features

- **Live AI co-editing** — any MCP client edits the open map; changes stream in, undoable.
- **Keyboard-first editing** — add, navigate, reorder, and restructure without the mouse.
- **Four layouts** — logic chart, balanced map, org chart, and a Now/Next/Later roadmap;
  cycle per-map with `⇧S`.
- **Relationship arrows** — free directional links between any two nodes, across branches.
- **Inline markdown** in node text: bold, italic, code, strike, highlight, links.
- **Markdown interop** — copy a branch as a nested list; paste any outline (Obsidian, Notes,
  XMind exports) as a subtree.
- **Local-first storage** — one JSON file per map, no database, no cloud.
- **Optional AI & voice** — voice notes transcribed locally, AI outline/refine, and an
  "ask this map" chat (all off until you add a key). See [Optional integrations](#optional-integrations).

New to the code? Start with [ARCHITECTURE.md](ARCHITECTURE.md), then
[CONTRIBUTING.md](CONTRIBUTING.md).

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
| `t` | Push node as a todo to the external second-brain (optional) |
| `⇧T` | Save branch as a note in the external second-brain (node text = title, subtree = markdown outline) |
| `⌘Z` / `⌘⇧Z` | Undo / redo |
| `⌘=` / `⌘-` / `⌘0` | Zoom in / out / fit |
| `⌘K` | Ask-the-map chat — question answered from this map's content |
| `Esc` | Back to gallery |
| `?` | Keyboard cheatsheet — every bound command, generated from the live keymap (works in the gallery too) |

**Mouse:** scroll to pan, pinch (or `⌃`+scroll) to zoom at cursor, drag empty canvas to pan,
double-click a node to edit. **Drag a node** to restructure: the middle of another node nests
the branch inside it (expands collapsed targets), the top/bottom edge inserts it between
siblings (a blue line shows where). `Esc` cancels a drag. **Click an arrow** (or its label) to
select it — `Enter` edits its label, `Delete`/`Backspace` removes it, `Esc` deselects.

> Because `⇧HJKL` move, `⇧A` draws an arrow, `⇧R` records, `⇧S` switches structure, and `⇧T`
> saves a note, typing a *capital* A/H/J/K/L/R/S/T won't trigger type-to-edit — press `Space`
> to edit instead, or unbind them via `localStorage.keymap`.

## Gallery

The `Esc` screen is a keyboard-driven map menu in three sections: **Pinned** (curated by
title; `p` toggles a pin, stored in the map file), **Recent** (last five opened, tracked in
`localStorage` so map files stay diff-clean), and **All** (everything else by last edit).

| Key | Action |
| --- | --- |
| `j` / `k` or arrows | Move selection |
| `Enter` | Open the selected map |
| `/` | Fuzzy-search titles; `Esc` clears |
| `n` | New map (focus the title input) |
| `p` | Pin / unpin |
| `r` | Rename inline |
| `d` | Delete (confirms first) |
| `?` | Keyboard cheatsheet |

## Maps & storage

Each map is a pretty-printed JSON file in `maps/`, named `<id>.json` — one file per map,
human-readable, easy to diff and back up. There's no database. The schema is documented in
[ARCHITECTURE.md](ARCHITECTURE.md#data-model). Your own map files stay on your machine; only
the demo `welcome.json` is committed to this repo.

## Optional integrations

Everything below is **off by default**. Copy `.env.example` to `.env` and set only the keys
for what you want. With no keys, the app works fully as an offline mind mapper (and the
full `docker-compose.yml` is the author's personal setup — it expects an external
`whisper-cache` volume and a second-brain service; use `docker-compose.share.yml` instead).

| Feature | What it does | Env keys |
| --- | --- | --- |
| **AI refine / outline / chat** | Structures voice transcripts into outlines, refines text, and powers `⌘K` "ask this map". Uses [OpenRouter](https://openrouter.ai). | `OPENROUTER_API_KEY`, `REFINE_MODEL` |
| **Voice capture** | `⇧R` records from the mic and transcribes **locally** via a Whisper sidecar container (faster-whisper, auto-detects language). You can also drag an audio file onto the canvas. | `TRANSCRIBER_URL` |
| **External second-brain** | `t` pushes a node as a todo and `⇧T` saves a branch as a note to an external todo/notes service over [MCP](https://modelcontextprotocol.io). Point it at any compatible server. | `SEGON_CERVELL_MCP_URL` |

**Ask this map (`⌘K`):** a chat panel scoped to the current map. The tree is serialized to a
markdown outline (plus relationships) and sent as grounding context, so answers stay anchored
to what's on the canvas and stream in token by token. The conversation is ephemeral — nothing
is written to the map file.

## Share a maps-free copy

To hand the app to someone without your maps or secrets:

```bash
./scripts/make-shareable.sh   # builds mind-map-share.zip (excludes maps/*.json and .env)
```

The recipient unzips it and runs `docker compose -f docker-compose.share.yml up -d --build`.

## Documentation

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — how it's built: frontend, server, data model,
  layout, the command/undo-redo pattern, and a diagram.
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — setup, conventions, how to add a feature.
- **[MCP.md](MCP.md)** — connecting an AI client to the built-in MCP server.

## License

[MIT](LICENSE) © 2026 Joan Claverol
