import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * A stand-in for `omp acp`: answers initialize / session/new, and for each
 * prompt streams a text chunk and a tool call, asks permission, then reports
 * what the user decided and ends the turn.
 */
const FAKE_AGENT = `#!/usr/bin/env node
const rl = require('readline').createInterface({ input: process.stdin });
const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\\n');
const update = (u) => send({ method: 'session/update', params: { sessionId: 's1', update: u } });
let promptId = null;
rl.on('line', (line) => {
  const m = JSON.parse(line);
  if (m.method === 'initialize') send({ id: m.id, result: { protocolVersion: 1 } });
  else if (m.method === 'session/new') {
    const url = m.params.mcpServers[0].url;
    send({ id: m.id, result: { sessionId: 's1', configOptions: [{ id: 'model', currentValue: 'm', options: [{ value: 'm', name: 'Fake Model' }] }] } });
    update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'mcp=' + url } });
  } else if (m.method === 'session/prompt') {
    promptId = m.id;
    const text = m.params.prompt[0].text;
    update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Got ' } });
    update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: text.includes('<context>') ? 'context' : 'none' } });
    update({ sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Creating map', status: 'pending' });
    update({ sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed' });
    send({ id: 900, method: 'session/request_permission', params: { sessionId: 's1', toolCall: { title: 'rm -rf x', rawInput: { command: 'rm -rf x' } }, options: [{ optionId: 'yes', kind: 'allow_once' }, { optionId: 'no', kind: 'reject_once' }] } });
  } else if (m.id === 900) {
    update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'decision=' + m.result.outcome.optionId } });
    send({ id: promptId, result: { stopReason: 'end_turn' } });
  }
});
`;

let dir: string;
const LOCAL = { host: 'localhost:5454', 'content-type': 'application/json' };

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'mindmap-agent-'));
  const bin = path.join(dir, 'fake-agent.js');
  writeFileSync(bin, FAKE_AGENT);
  chmodSync(bin, 0o755);
  process.env.MINDMAP_AGENT_CMD = bin;
  process.env.MAPS_DIR = dir;
  process.env.MINDMAP_PROJECT_DIR = dir;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  delete process.env.MINDMAP_AGENT_CMD;
  delete process.env.MAPS_DIR;
  delete process.env.MINDMAP_PROJECT_DIR;
});

async function until<T>(get: () => Promise<T>, ok: (v: T) => boolean): Promise<T> {
  for (let i = 0; i < 100; i++) {
    const v = await get();
    if (ok(v)) return v;
    await new Promise((r) => setTimeout(r, 30));
  }
  throw new Error('timed out');
}

describe('in-app chat', () => {
  it('streams a reply, asks permission in the panel, and relays the answer', async () => {
    vi.resetModules();
    const { app } = await import('./app.js');
    const { agent } = await import('./agent.js');
    const state = async () => (await app.request('/api/chat', { headers: LOCAL })).json();
    try {
      const res = await app.request('/api/chat', { method: 'POST', headers: LOCAL, body: JSON.stringify({ text: 'make a map' }) });
      expect(res.status).toBe(202);
      const pending = await until(state, (s) => s.items.some((i: { kind: string }) => i.kind === 'permission'));
      expect(pending.status).toBe('busy');
      expect(pending.model).toBe('Fake Model');
      expect(pending.turnId).toBeTruthy();
      const perm = pending.items.find((i: { kind: string }) => i.kind === 'permission');
      expect(perm).toMatchObject({ detail: '$ rm -rf x', state: 'pending' });
      expect(pending.items.find((i: { kind: string }) => i.kind === 'tool')).toMatchObject({ title: 'Creating map', status: 'completed' });

      const busy = await app.request('/api/chat', { method: 'POST', headers: LOCAL, body: JSON.stringify({ text: 'again' }) });
      expect(busy.status).toBe(409);

      await app.request('/api/chat/permission', { method: 'POST', headers: LOCAL, body: JSON.stringify({ id: perm.id, allow: false }) });
      const done = await until(state, (s) => s.status === 'idle');
      const texts = done.items.filter((i: { kind: string }) => i.kind === 'text').map((i: { text: string }) => i.text);
      expect(texts.join(' ')).toContain('Got context');
      expect(texts.join(' ')).toContain('decision=no');
      expect(done.items[0]).toMatchObject({ kind: 'user', text: 'make a map', context: 'Gallery' });
      expect(done.turnId).toBeNull();

      await app.request('/api/chat/reset', { method: 'POST', headers: LOCAL, body: '{}' });
      expect((await state()).items).toEqual([]);
    } finally {
      agent.shutdown();
    }
  });

  it('reports a missing agent instead of hanging', async () => {
    process.env.MINDMAP_AGENT_CMD = path.join(dir, 'does-not-exist');
    vi.resetModules();
    const { app } = await import('./app.js');
    await app.request('/api/chat', { method: 'POST', headers: LOCAL, body: JSON.stringify({ text: 'hi' }) });
    const s = await until(
      async () => (await app.request('/api/chat', { headers: LOCAL })).json(),
      (v) => v.status === 'unavailable',
    );
    expect(s.error).toMatch(/not installed/);
  });
});
