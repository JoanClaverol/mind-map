import { existsSync, readFileSync } from 'node:fs';
import { realpath } from 'node:fs/promises';
import path from 'node:path';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './mcp-server.js';

/**
 * stdio entry point. stdout IS the MCP transport — never print to it; logs go
 * to stderr.
 *
 * If the app is already running on the same maps directory, this process
 * becomes a thin bridge to its HTTP /mcp endpoint instead of serving the files
 * itself: edits then stream live onto the open canvas (and land in its undo
 * history) exactly as for an HTTP client. Otherwise it runs headless — edits
 * still reach the files, just not a live tab.
 */

// Load local overrides (e.g. MAPS_DIR, PORT) from .env if present.
if (existsSync(path.resolve(process.cwd(), '.env'))) {
  try {
    process.loadEnvFile();
  } catch {
    // ignore malformed/missing .env
  }
}

const mapsDir = process.env.MAPS_DIR ?? path.resolve(process.cwd(), 'maps');

/** Where a running app might be: explicit URL, the project session file, the default port. */
function candidateUrls(): string[] {
  const urls: string[] = [];
  if (process.env.MINDMAP_URL) urls.push(process.env.MINDMAP_URL);
  // Per-project sessions (`mindmap up/claude/omp`) record their URL next to mindmaps/.
  try {
    const session = JSON.parse(readFileSync(path.join(mapsDir, '..', '.mindmap', 'mcp.json'), 'utf8'));
    const url = Object.values<{ url?: string }>(session.mcpServers ?? {})[0]?.url;
    if (url) urls.push(new URL(url).origin);
  } catch {
    // no session file
  }
  // `localhost`, not 127.0.0.1: the Vite dev server may listen on ::1 only.
  urls.push(`http://localhost:${process.env.PORT ?? 5454}`);
  return [...new Set(urls)];
}

async function findRunningApp(): Promise<string | null> {
  const want = await realpath(mapsDir).catch(() => path.resolve(mapsDir));
  for (const base of candidateUrls()) {
    try {
      const res = await fetch(new URL('/api/info', base), { signal: AbortSignal.timeout(800) });
      if (!res.ok) continue;
      const info = (await res.json()) as { app?: string; mapsDir?: string };
      if (info.app === 'mindmap-mcp' && info.mapsDir === want) return base;
    } catch {
      // not running there
    }
  }
  return null;
}

async function bridge(base: string): Promise<void> {
  const stdio = new StdioServerTransport();
  const http = new StreamableHTTPClientTransport(new URL('/mcp', base));
  const die = (why: string) => {
    console.error(`[mcp-stdio] lost the app at ${base}: ${why} — restart the MCP server to reconnect`);
    process.exit(1);
  };
  stdio.onmessage = (msg) => void http.send(msg).catch((err: unknown) => die(err instanceof Error ? err.message : String(err)));
  http.onmessage = (msg) => void stdio.send(msg);
  http.onerror = (err) => console.error('[mcp-stdio] http:', err.message);
  http.onclose = () => die('connection closed');
  stdio.onclose = () => process.exit(0);
  await http.start();
  await stdio.start();
  console.error(`[mcp-stdio] bridging to the running app at ${base} — edits appear live`);
}

async function headless(): Promise<void> {
  await createMcpServer().connect(new StdioServerTransport());
}

(process.env.MINDMAP_NO_BRIDGE ? Promise.resolve(null) : findRunningApp())
  .then((base) => (base ? bridge(base) : headless()))
  .catch((err: unknown) => {
    console.error('[mcp-stdio] fatal:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
