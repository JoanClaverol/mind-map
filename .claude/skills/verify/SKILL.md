---
name: verify
description: Build, launch, and drive mind-map headlessly to verify UI changes at the canvas surface.
---

# Verifying mind-map changes

The surface is the browser canvas at the dev server. Drive it with playwright-core
against system Chrome (no browser download needed).

## Launch (isolated — never touch the user's real maps/)

```bash
mkdir -p "$SCRATCH/maps"          # seed MapFile JSON here (schemaVersion 2)
MAPS_DIR="$SCRATCH/maps" pnpm dev # dev is pinned to port 5454 (PORT only affects `pnpm start`)
curl -s http://localhost:5454/api/maps   # confirm only your seeded maps are served
```

If 5454 is busy, the user's daily instance is running — Vite will pick the next port;
read the task output for the real URL.

## Drive

```bash
cd "$SCRATCH" && npm init -y && npm install playwright-core
```

```js
const { chromium } = require('playwright-core');
const b = await chromium.launch({ channel: 'chrome', headless: true });
const page = await b.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto('http://localhost:5454/#/map/<seeded-id>');
await page.waitForSelector('.canvas-host svg .node');
```

- All interaction is keyboard-first: `page.keyboard.press('Meta+f')`, `.type(...)` etc.
  Click a node via `page.click('text=Node text')` to select it first.
- Useful hooks: `.node-text` (labels), `.node.dimmed`, `.node-rect.selected`,
  `.status-hints` (mode/breadcrumb line), `.toast`, `.search-panel`, `.node-editor`.
- Gotcha: the offscreen text measurer also renders a `.node-text` div — expect one
  phantom entry when scraping labels.
- Screenshot per step; check the status bar in the frame — it narrates the active mode.
