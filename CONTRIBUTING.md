# Contributing

Thanks for taking a look. This is a small, focused codebase — the goal is that you can read
[ARCHITECTURE.md](ARCHITECTURE.md), set up in a couple of minutes, and make a change with
confidence that undo/redo and layout still hold.

## Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| [Node.js](https://nodejs.org) | 20+ | Tested on 22/26. |
| [pnpm](https://pnpm.io) | 9+ | The repo uses a pnpm workspace + lockfile. |
| [Docker](https://www.docker.com) | optional | Only needed for the container workflow and local voice transcription. |
| Python 3.12 | optional | Only the Whisper transcriber sidecar; you don't need it for app development. |

## Local setup

```bash
pnpm install
pnpm dev          # app + API on http://localhost:5454 with hot reload
```

That's the whole loop for working on the UI, the layout engine, commands, or the API — no
Docker required. Optional features (voice, AI refine, ask-this-map, the external
second-brain) stay disabled until you add the matching keys to `.env`; see
[`.env.example`](.env.example) and the [README](README.md#optional-integrations).

## Verify your change

```bash
pnpm test                 # Vitest: layout invariants, undo/redo property test,
                          # markdown round-trip, keymap resolution
pnpm exec tsc --noEmit    # type-check
```

Then do a manual pass in `pnpm dev` at http://localhost:5454. If you touched layout,
navigation, or drag-and-drop, exercise all four structures (`⇧S` cycles them).

## Conventions that matter

These three rules keep the app correct; please follow them.

1. **All document mutations go through commands.** Write the change as a pure Immer-draft
   function in [`src/state/commands.ts`](src/state/commands.ts) and run it via
   `store.runCommand`. Never mutate `doc` outside this path — undo/redo correctness depends
   on `produceWithPatches` seeing every change.

2. **Hotkeys never call store internals.** A key combo resolves to a **command id** in
   [`src/state/registry.ts`](src/state/registry.ts), bound in
   [`src/hotkeys/keymap.ts`](src/hotkeys/keymap.ts). A new feature is a new registry command
   plus a keymap binding.

3. **Layout is pure, and `measure.ts` mirrors the CSS.** `layoutTree(doc, sizeOf)` in
   [`src/layout/layout.ts`](src/layout/layout.ts) must stay side-effect-free. Text sizes come
   from [`src/layout/measure.ts`](src/layout/measure.ts), an offscreen div that uses the same
   `.node-text` styling as real nodes — keep them in sync. A new layout structure must fill in
   the result's `dirs` map (which way each branch grows), because rendering, `hjkl`
   navigation, and drag-drop all read it.

A few more:

- The server (`server/`) may import from `src/model/` only. Keep `server/app.ts`
  framework-only (no `serve()`); it's mounted by both the Vite plugin and `standalone.ts`.
- Editing server code under `pnpm dev` auto-restarts (Vite watches config deps).
- Match the style of the surrounding code — naming, comment density, and idiom.

## Adding a feature

The common path, end to end:

1. **Add a command** to the registry in [`src/state/registry.ts`](src/state/registry.ts)
   with a stable id and a description (descriptions feed the `?` cheatsheet automatically).
2. If it changes the document, **add an Immer-draft function** in
   [`src/state/commands.ts`](src/state/commands.ts) and call it through `store.runCommand` —
   undo/redo comes for free.
3. **Bind a key** in [`src/hotkeys/keymap.ts`](src/hotkeys/keymap.ts) (mind the existing
   `⇧`-letter bindings; see the README note on type-to-edit).
4. **Add a test** if there's logic worth pinning — layout, markdown, and command behavior all
   have existing test files to follow.

Users can override any binding at runtime via `localStorage.keymap`, so prefer adding a
sensible default over hard-coding behavior.

## Commit & PR

- Keep commits focused; explain the *why* in the body when it isn't obvious.
- Make sure `pnpm test` and `pnpm exec tsc --noEmit` pass before opening a PR.
- Describe what you changed and how you verified it.
