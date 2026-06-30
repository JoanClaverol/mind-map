# mind-map — guidance for Claude

Personal keyboard-first mind map app (XMind-style) for Joan.

Canonical docs — read these rather than duplicating their content here:
- **[ARCHITECTURE.md](ARCHITECTURE.md)** — how it's built (frontend, server, data model, layout, command/undo-redo pattern).
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — setup, the correctness conventions in full, and how to add a feature.
- **[README.md](README.md)** — features and hotkeys. **[MCP.md](MCP.md)** — the built-in MCP server.

## Non-negotiable invariants (full detail in CONTRIBUTING.md)

- **All doc mutations go through commands**: pure Immer-draft functions in `src/state/commands.ts`, run via `store.runCommand` (produceWithPatches). Never mutate `doc` outside this path — undo/redo depends on it.
- **Hotkeys never call store internals**: they resolve to command ids in `src/state/registry.ts`. New feature = new registry command + keymap binding.
- **Layout is pure**: `layoutTree(doc, sizeOf)` in `src/layout/layout.ts`; `measure.ts` must mirror the `.node-text` CSS. A new structure must fill in the result's `dirs` map.
- The server (`server/`) imports shared types from `src/model/` only; `server/app.ts` stays framework-only (no `serve()`).

## Verify

`pnpm test`, `pnpm exec tsc --noEmit`, then manual: `pnpm dev` → http://localhost:5454. The optional todo-push feature needs an external second-brain MCP server (default `localhost:8000`).
