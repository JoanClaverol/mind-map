# mind-map — guidance for Claude

Personal keyboard-first mind map app (XMind-style) for Joan. See README.md for hotkeys and architecture.

## Conventions that matter

- **All doc mutations go through commands**: pure Immer-draft functions in `src/state/commands.ts`, executed by `store.runCommand` (produceWithPatches). Never mutate `doc` outside this path — undo/redo correctness depends on it.
- **Hotkeys never call store internals**: they resolve to command ids in `src/state/registry.ts`. New feature = new registry command + keymap binding.
- **Layout is pure**: `layoutTree(doc, sizeOf)` in `src/layout/layout.ts`. Text sizes come from `measure.ts` (offscreen div with the same `.node-text` CSS as rendering — keep them in sync). The structure (`right` / `balanced` / `down`) lives on `doc.layout`; the result's `dirs` map says which way each branch grows — rendering, hjkl navigation and drag-drop all key off it, so a new structure must fill it in.
- The server (`server/`) imports shared types from `src/model/` only. `server/app.ts` must stay framework-only (no `serve()`) — it's mounted by both the Vite plugin and `standalone.ts`/Docker.
- Editing server code: Vite auto-restarts (`pnpm dev` watches config deps).

## Verify

`pnpm test` (Vitest: layout invariants, undo/redo property test, markdown round-trip), `pnpm exec tsc --noEmit`, then manual: `pnpm dev` → http://localhost:5454. Todo push needs segon-cervell running on `localhost:8000`.
