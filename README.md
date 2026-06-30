# mind-map

A keyboard-first, [XMind](https://xmind.app)-style mind mapping tool. Brainstorm at the
speed of typing — every action has a hotkey, maps are plain JSON files you own, and the
whole thing is small enough to read and bend to your workflow.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

<!-- TODO: drop a screenshot or GIF here — e.g. ![mind-map](docs/screenshot.png) -->
<p align="center"><em>(screenshot coming soon)</em></p>

## Why

Most mind-map tools are mouse-driven and lock your data in a proprietary file. mind-map is
the opposite: you keep your hands on the keyboard like in vim, the structure is a tree you
navigate with `hjkl`, and each map is a human-readable JSON file that's friendly to git and
backups. It runs entirely on your machine.

## Features

- **Keyboard-first editing** — add, navigate, reorder, and restructure without the mouse.
- **Four layouts** — logic chart, balanced map, org chart, and a Now/Next/Later roadmap;
  cycle per-map with `⇧S`.
- **Relationship arrows** — free directional links between any two nodes, across branches.
- **Inline markdown** in node text: bold, italic, code, strike, highlight, links.
- **Markdown interop** — copy a branch as a nested list; paste any outline (Obsidian, Notes,
  XMind exports) as a subtree.
- **Local-first storage** — one JSON file per map in `maps/`, no database.
- **Optional AI & voice** — voice notes transcribed locally, AI outline/refine, and an
  "ask this map" chat (all off until you add a key). See [Optional integrations](#optional-integrations).
- **MCP server** — let an AI client (e.g. Claude) read and generate maps. See [MCP.md](MCP.md).

## Prerequisites

- To **run** it: [Docker](https://www.docker.com), or [Node.js](https://nodejs.org) 20+ with
  [pnpm](https://pnpm.io) 9+.
- To **develop** it: Node 20+ and pnpm 9+. (Docker and Python are only needed for the
  container workflow and local voice transcription.)

## Quick start

**Try it (Docker, no integrations needed):**

```bash
docker compose -f docker-compose.share.yml up -d --build
```

Open <http://localhost:5454>. Maps are stored as JSON in the `maps/` folder next to the
compose file. Voice, AI, and the second-brain integration are disabled by default.

**Develop it (app + API on one port, with hot reload):**

```bash
pnpm install
pnpm dev
```

Then open <http://localhost:5454>.

> The full `docker-compose.yml` is the author's personal setup — it expects a pre-existing
> external `whisper-cache` Docker volume and a running second-brain service. Use
> `docker-compose.share.yml` (above) unless you've set those up.

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
for what you want. With no keys, the app works fully as an offline mind mapper.

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
