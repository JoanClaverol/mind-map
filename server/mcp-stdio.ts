import { existsSync } from 'node:fs';
import path from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './mcp-server.js';

// Load local secrets the same way `pnpm dev` does for the API server.
if (existsSync(path.resolve(process.cwd(), '.env'))) {
  try {
    process.loadEnvFile();
  } catch {
    // ignore malformed/missing .env
  }
}

const server = createMcpServer();
const transport = new StdioServerTransport();

server.connect(transport).catch((err: unknown) => {
  console.error('[mcp-stdio] fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
