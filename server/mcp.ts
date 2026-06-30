import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const MCP_URL = process.env.SEGON_CERVELL_MCP_URL ?? 'http://localhost:8000/mcp';
const TIMEOUT_MS = 10_000;

let clientPromise: Promise<Client> | null = null;

async function connect(): Promise<Client> {
  const client = new Client({ name: 'mind-map', version: '0.1.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(MCP_URL)));
  return client;
}

function getClient(): Promise<Client> {
  if (!clientPromise) clientPromise = connect();
  return clientPromise;
}

interface TextBlock {
  type: string;
  text?: string;
}

function extractText(result: unknown): string {
  const content = (result as { content?: TextBlock[] }).content;
  if (Array.isArray(content)) {
    const block = content.find((b) => b.type === 'text' && typeof b.text === 'string');
    if (block?.text) return block.text;
  }
  return JSON.stringify(result);
}

/** "Created todo <uuid>" → "<uuid>"; tolerant of other phrasings. */
function parseTodoId(raw: string): string {
  const uuid = raw.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (uuid) return uuid[0];
  const trailing = raw.match(/created todo\s+(\S+)/i);
  if (trailing) return trailing[1];
  return raw.slice(0, 80);
}

/**
 * Save a transcript as a note in segon-cervell. Its save_note runs an AI
 * organize step before returning, so the per-call timeout is generous.
 * extract_todos is off — a rambling voice note shouldn't spawn spurious todos.
 * The tool reports its own failures as normal text starting with "Error:".
 */
export async function saveNote(title: string, content: string): Promise<{ raw: string }> {
  try {
    const client = await getClient();
    const result = await client.callTool(
      { name: 'save_note', arguments: { content, title, extract_todos: false } },
      undefined,
      { timeout: 180_000 },
    );
    const raw = extractText(result);
    if ((result as { isError?: boolean }).isError || /^error:/i.test(raw.trim())) throw new Error(raw);
    return { raw };
  } catch (err) {
    clientPromise = null; // drop the cached client so the next attempt reconnects
    throw err;
  }
}

/**
 * Push a todo into segon-cervell. plannedFor (YYYY-MM-DD) must be passed
 * explicitly — omitting it lands the todo in the backlog, not today.
 */
export async function createTodo(text: string, plannedFor?: string): Promise<{ todoId: string; raw: string }> {
  try {
    const client = await getClient();
    const args: Record<string, string> = { text };
    if (plannedFor) args.planned_for = plannedFor;
    const result = await client.callTool({ name: 'create_todo', arguments: args }, undefined, {
      timeout: TIMEOUT_MS,
    });
    const raw = extractText(result);
    if ((result as { isError?: boolean }).isError) throw new Error(raw);
    return { todoId: parseTodoId(raw), raw };
  } catch (err) {
    clientPromise = null; // drop the cached client so the next attempt reconnects
    throw err;
  }
}
