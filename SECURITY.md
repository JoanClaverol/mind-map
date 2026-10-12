# Security

mind-map is a single-user tool that runs on your own computer. This page explains what it
protects against, what it doesn't, and how to report a problem.

## What it protects

- **Only your computer can reach it.** The server listens on `127.0.0.1` (loopback). Setting
  `MINDMAP_HOST` changes that, and the server then prints a warning on startup, because
  there is no login. The generic `HOST` variable is deliberately ignored, since shells and CI
  often set it to the machine's hostname.
- **Websites you visit can't touch your maps.** Every request is checked:
  - The `Host` header must be localhost, which blocks DNS rebinding.
  - The `Origin` header must be localhost. `null` origins, from sandboxed frames and
    `file://` pages, are rejected.
  - Every write must be `application/json`, which forces a CORS preflight that the server
    never approves.
  - The dev server sends no CORS headers and never serves the raw `maps/` files.
- **File names are never taken from input.** Map ids must match `^[A-Za-z0-9_-]{6,30}$`, and
  export file names are slugged.
- **Writes are atomic**: a temp file is written, then renamed. That rename replaces a planted
  symlink instead of writing through it, so a repo can't ship
  `mindmaps/exports/x.png → ~/.zshrc` and get your shell config overwritten. A symlinked
  `exports/` directory is refused.
- **Exports are checked**: an answer must really be a PNG (magic bytes) or an SVG document.
- **Size limits** apply to every request body (10 MB for maps and MCP, 40 MB for image
  exports), and idle MCP sessions expire after 6 hours.
- **Node text is escaped** before it reaches the page. Links only allow `http:`, `https:`
  and `mailto:`.
- **Bundled files** (`MCP.md`, `.env`, the demo `maps/`) are resolved from the install
  folder, never from the current directory. An untrusted project therefore can't swap in
  its own guide or environment.
- **The stdio bridge only connects to loopback URLs.** A committed `.mindmap/mcp.json` can't
  redirect your MCP traffic elsewhere.
- **The CLI starts processes without a shell**: arguments are passed as lists, so nothing you
  type is interpreted by a shell.
- **The in-app chat asks before acting on your computer.** Its agent (omp) runs in the
  folder you started mind-map from and may read files there. Before running a command or
  changing a file it asks, and the chat shows Allow / Reject. Map edits need no approval
  because each AI reply is one `⌘Z` away. The chat routes sit behind the same localhost
  guard as the rest of the API.

## What to keep in mind

- **Maps from other people are untrusted text.** If you clone a repo that contains a
  `mindmaps/` folder, its notes go to your AI when it reads the map. A map could try to
  instruct the AI to do something else (*prompt injection*). The MCP server tells every
  model to treat map content as data and to flag such instructions to you. Still, review
  what your AI proposes to run, especially in apps that can execute commands (Claude Code,
  omp, Codex…).
- **Your AI provider sees what the AI reads.** mind-map sends nothing anywhere itself. Your
  AI app sends map content to its provider (Anthropic, OpenAI, Google…) as part of the
  conversation.
- **Other programs running as your user** can reach `127.0.0.1` like any local app can. The
  limits above contain mistakes and runaway processes, not malware already on your machine.

## Reporting a vulnerability

Please open a private
[security advisory](https://github.com/JoanClaverol/mind-map/security/advisories/new) on
GitHub rather than a public issue. Include the steps to reproduce.
