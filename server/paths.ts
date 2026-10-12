import { fileURLToPath } from 'node:url';

/**
 * The mind-map package root. Bundled files (MCP.md, the demo maps/, .env) are
 * resolved against it — never against process.cwd(), which may be an
 * untrusted project whose own MCP.md or .env must not be picked up.
 */
export const PKG_ROOT = fileURLToPath(new URL('..', import.meta.url));
