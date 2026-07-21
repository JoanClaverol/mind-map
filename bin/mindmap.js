#!/usr/bin/env node
/**
 * mindmap — the mindmap-mcp CLI.
 *
 *   mindmap up [--port N]     serve <cwd>/mindmaps/ on a free port (foreground)
 *   mindmap claude [args…]    up + open browser + launch claude with the
 *                             mind-map MCP injected; teardown when claude exits
 *   mindmap stdio [--maps D]  stdio MCP server for clients that spawn processes
 *   mindmap config [client]   print MCP config snippets per client
 *
 * Per-project sessions leave exactly one thing in the host project: the
 * mindmaps/ folder (meant to be committed). Session config lives in .mindmap/,
 * which is added to .git/info/exclude — never to the project's .gitignore.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = fileURLToPath(new URL('..', import.meta.url));
const projectDir = process.cwd();
const mapsDir = path.join(projectDir, 'mindmaps');
const sessionDir = path.join(projectDir, '.mindmap');
const mcpConfigPath = path.join(sessionDir, 'mcp.json');

function fail(message) {
  console.error(`mindmap: ${message}`);
  process.exit(1);
}

function findFreePort(preferred) {
  const tryPort = (port) =>
    new Promise((resolve) => {
      const srv = net.createServer();
      srv.once('error', () => resolve(null));
      srv.once('listening', () => srv.close(() => resolve(port)));
      // Bind exactly like standalone.ts (0.0.0.0): a 127.0.0.1 or wildcard-:: probe
      // can succeed while 0.0.0.0:port is taken (e.g. by Docker or another session).
      srv.listen(port, '0.0.0.0');
    });
  return (async () => {
    for (let port = preferred; port < preferred + 100; port++) {
      if (await tryPort(port)) return port;
    }
    fail(`no free port found in ${preferred}–${preferred + 99}`);
  })();
}

/** Keep .mindmap/ out of the project's history without touching its .gitignore. */
function excludeSessionDirFromGit() {
  try {
    const excludePath = execFileSync('git', ['rev-parse', '--git-path', 'info/exclude'], {
      cwd: projectDir,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    const abs = path.resolve(projectDir, excludePath);
    const current = existsSync(abs) ? readFileSync(abs, 'utf8') : '';
    if (!current.split('\n').includes('.mindmap/')) {
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, `${current}${current && !current.endsWith('\n') ? '\n' : ''}.mindmap/\n`);
    }
  } catch {
    // Not a git repo — nothing to exclude.
  }
}

async function waitUntilReady(port, child) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) fail(`server exited early (code ${child.exitCode}) — see .mindmap/server.log`);
    try {
      const res = await fetch(`http://localhost:${port}/api/maps`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  child.kill();
  fail('server did not become ready within 10s');
}

async function startServer({ preferredPort, logToFile }) {
  if (!existsSync(path.join(pkgRoot, 'dist', 'index.html'))) {
    fail(`mind-map isn't built — run "pnpm build" in ${pkgRoot}`);
  }
  mkdirSync(mapsDir, { recursive: true });
  mkdirSync(sessionDir, { recursive: true });
  excludeSessionDirFromGit();

  const port = await findFreePort(preferredPort);
  writeFileSync(
    mcpConfigPath,
    `${JSON.stringify({ mcpServers: { 'mind-map': { type: 'http', url: `http://localhost:${port}/mcp` } } }, null, 2)}\n`,
  );

  // cwd = pkgRoot so ./dist static serving and MCP.md context resolve;
  // MAPS_DIR (absolute) points storage at this project's mindmaps/.
  const out = logToFile ? openSync(path.join(sessionDir, 'server.log'), 'w') : 'inherit';
  const child = spawn(path.join(pkgRoot, 'node_modules', '.bin', 'tsx'), ['server/standalone.ts'], {
    cwd: pkgRoot,
    env: { ...process.env, PORT: String(port), MAPS_DIR: mapsDir },
    stdio: ['ignore', out, out],
  });
  await waitUntilReady(port, child);
  return { port, child };
}

function openBrowser(url) {
  const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(opener, [url], { stdio: 'ignore', detached: true }).unref();
}

// Default away from 5454 so ephemeral sessions never race the daily-driver app.
const DEFAULT_PORT = 5460;

async function up(args) {
  const portFlag = args.indexOf('--port');
  const preferredPort = portFlag !== -1 ? Number(args[portFlag + 1]) || DEFAULT_PORT : DEFAULT_PORT;
  const { port, child } = await startServer({ preferredPort, logToFile: false });

  console.log(`\n  mind-map serving ${path.relative(projectDir, mapsDir) || mapsDir}`);
  console.log(`  ➜  browser:  http://localhost:${port}`);
  console.log(`  ➜  mcp:      http://localhost:${port}/mcp\n`);
  console.log(`  claude --mcp-config ${path.relative(projectDir, mcpConfigPath)}\n`);
  console.log('  ^C to stop — nothing persists outside mindmaps/\n');

  const stop = () => {
    child.kill();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  child.on('exit', (code) => process.exit(code ?? 0));
}

async function claude(args) {
  const { port, child } = await startServer({ preferredPort: DEFAULT_PORT, logToFile: true });
  const url = `http://localhost:${port}`;
  console.log(`  ➜  serving mindmaps/ on ${url} (browser opening)`);
  openBrowser(url);

  console.log('  ➜  launching claude with mind-map tools…\n');
  const cc = spawn('claude', ['--mcp-config', mcpConfigPath, ...args], { stdio: 'inherit' });
  cc.on('error', (err) => {
    child.kill();
    fail(err.code === 'ENOENT' ? 'claude CLI not found — is Claude Code installed?' : err.message);
  });
  cc.on('exit', (code) => {
    child.kill();
    process.exit(code ?? 0);
  });
  const forward = () => cc.kill('SIGINT'); // let claude handle ^C; teardown follows its exit
  process.on('SIGINT', forward);
  process.on('SIGTERM', forward);
}

/**
 * Run the stdio MCP server (stdout is the MCP transport — this code path must
 * never print to stdout; errors go to stderr via fail()).
 */
function stdio(args) {
  const tsxBin = path.join(pkgRoot, 'node_modules', '.bin', 'tsx');
  if (!existsSync(tsxBin)) fail(`dependencies missing — run "pnpm install" in ${pkgRoot}`);
  const mapsFlag = args.indexOf('--maps');
  const dir =
    mapsFlag !== -1 && args[mapsFlag + 1]
      ? path.resolve(projectDir, args[mapsFlag + 1])
      : path.join(pkgRoot, 'maps'); // default: the main library
  mkdirSync(dir, { recursive: true });
  const child = spawn(tsxBin, ['server/mcp-stdio.ts'], {
    cwd: pkgRoot, // MCP.md context + repo .env resolve here
    env: { ...process.env, MAPS_DIR: dir },
    stdio: 'inherit',
  });
  const forward = (sig) => () => child.kill(sig);
  process.on('SIGINT', forward('SIGINT'));
  process.on('SIGTERM', forward('SIGTERM'));
  child.on('exit', (code) => process.exit(code ?? 0));
}

function config(args) {
  const binPath = path.join(pkgRoot, 'bin', 'mindmap.js');
  const stdioJson = JSON.stringify(
    { mcpServers: { mindmap: { command: 'node', args: [binPath, 'stdio'] } } },
    null,
    2,
  );
  const desktopJson = JSON.stringify(
    { mcpServers: { mindmap: { command: process.execPath, args: [binPath, 'stdio'] } } },
    null,
    2,
  );
  const httpNote =
    'HTTP variants need the app running (pnpm dev, Docker, or `mindmap up` — up prints its own per-session URL).';
  const sections = {
    'claude-code': `# Claude Code
claude mcp add mindmap -- node ${binPath} stdio
# or, HTTP against a running app:
claude mcp add --transport http mindmap http://localhost:5454/mcp
# or in a project's .mcp.json:
${stdioJson}`,
    'claude-desktop': `# Claude Desktop — macOS: ~/Library/Application Support/Claude/claude_desktop_config.json
#                   Linux: ~/.config/Claude/claude_desktop_config.json
# (absolute node path: GUI apps don't inherit your shell PATH; restart Claude Desktop after)
${desktopJson}`,
    codex: `# Codex CLI — ~/.codex/config.toml
[mcp_servers.mindmap]
command = "node"
args = ["${binPath}", "stdio"]

# or, HTTP against a running app:
[mcp_servers.mindmap]
url = "http://localhost:5454/mcp"`,
    opencode: `# opencode — opencode.json in your project
{
  "mcp": {
    "mindmap": { "type": "local", "command": ["node", "${binPath}", "stdio"], "enabled": true }
  }
}

# or, HTTP against a running app:
{
  "mcp": {
    "mindmap": { "type": "remote", "url": "http://localhost:5454/mcp", "enabled": true }
  }
}`,
  };
  const which = args[0];
  if (which && !sections[which]) {
    fail(`unknown client "${which}" — one of: ${Object.keys(sections).join(', ')}`);
  }
  const chosen = which ? [sections[which]] : Object.values(sections);
  console.log(chosen.join('\n\n'));
  console.log(`\n# ${httpNote}`);
}

const [command, ...rest] = process.argv.slice(2);
switch (command) {
  case 'up':
    await up(rest);
    break;
  case 'claude':
    await claude(rest);
    break;
  case 'stdio':
    stdio(rest);
    break;
  case 'config':
    config(rest);
    break;
  default:
    console.log(`mindmap — a mind-map canvas your LLM can co-edit live (mindmap-mcp)

Usage:
  mindmap up [--port N]      serve ./mindmaps on a free port (Ctrl+C to stop)
  mindmap claude [args…]     up + open browser + launch claude with the tools
  mindmap stdio [--maps D]   stdio MCP server (default maps dir: the main library)
  mindmap config [client]    MCP config for claude-code | claude-desktop | codex | opencode

Per-project maps live in ./mindmaps (commit them); session files in ./.mindmap (git-excluded).`);
    process.exit(command ? 1 : 0);
}
