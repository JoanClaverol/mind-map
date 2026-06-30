import type { ChatTurn } from '../src/model/types';

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const CHAT_TIMEOUT_MS = 120_000;

// All env reads are lazy — Vite's loadEnv populates process.env after import time.
function apiKey(): string {
  return (process.env.OPENROUTER_API_KEY ?? '').trim();
}

export function refineEnabled(): boolean {
  return apiKey().length > 0;
}

function model(): string {
  return (process.env.REFINE_MODEL ?? 'deepseek/deepseek-v4-flash').trim();
}

/** Models routinely wrap output in ``` fences despite instructions — strip them
 * here so the route contract is clean markdown (a stray trailing fence would
 * otherwise be glued onto the deepest node by the outline parser). */
export function stripCodeFences(s: string): string {
  return s
    .replace(/^\s*```[a-zA-Z]*\s*\n?/, '')
    .replace(/\n?\s*```\s*$/, '')
    .trim();
}

async function chat(system: string, user: string): Promise<string> {
  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey()}` },
    body: JSON.stringify({
      model: model(),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }),
    signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = data.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || !text.trim()) throw new Error('OpenRouter returned no content');
  return text.trim();
}

const STRUCTURE_SYSTEM =
  'You convert a raw voice-note transcript into a nested markdown bullet outline for a mind map. ' +
  'Output ONLY markdown list lines: "- " bullets with two-space indentation for nesting — ' +
  'no title, no preamble, no explanations, no code fences. ' +
  'Keep the transcript\'s original language (Catalan, Spanish, or English). ' +
  'Group related ideas under short parent bullets; keep each bullet concise. ' +
  'Do not invent content that is not in the transcript.';

export async function structureTranscript(text: string): Promise<string> {
  return stripCodeFences(await chat(STRUCTURE_SYSTEM, text));
}

const REFINE_SYSTEM =
  "You improve personal notes. Apply the user's instruction to the note. " +
  'Preserve the original language of the note (Catalan, English, or Spanish) ' +
  "unless the instruction explicitly asks to translate. Keep the author's " +
  'meaning and facts; do not invent content. Return ONLY the improved note in ' +
  'Markdown — no preamble, no explanation, no code fences.';

export async function refineText(text: string, instruction: string): Promise<string> {
  return stripCodeFences(await chat(REFINE_SYSTEM, `Instruction: ${instruction}\n\nNote:\n${text}`));
}

const GENERATE_MAP_SYSTEM =
  'You convert a user request into a nested markdown bullet outline for a mind map. ' +
  'Output ONLY markdown list lines: "- " bullets with two-space indentation for nesting — ' +
  'no title, no preamble, no explanations, no code fences. ' +
  'Keep the user\'s original language. ' +
  'Group related ideas under short parent bullets; keep each bullet concise. ' +
  'Do not invent content that is not implied by the request.';

export async function generateOutline(prompt: string, contextMarkdown?: string): Promise<string> {
  if (!refineEnabled()) throw new Error('AI generation disabled (no OPENROUTER_API_KEY)');
  const user = contextMarkdown
    ? `Request:\n${prompt}\n\nExisting map context (for reference, do not copy verbatim unless asked):\n${contextMarkdown}`
    : prompt;
  return stripCodeFences(await chat(GENERATE_MAP_SYSTEM, user));
}

const ASK_SYSTEM =
  'You answer questions about a single mind map. Base every answer ONLY on the map below — ' +
  'do not invent facts. If the map does not contain the answer, say so plainly. ' +
  "Reply in the language of the user's question (Catalan, Spanish, or English). " +
  'Be concise; quote or reference the relevant nodes when helpful. The map is given as a ' +
  'nested markdown outline, optionally followed by a "Relationships" list of cross-links.\n\n' +
  'Mind map:\n';

/**
 * Stream an answer to a question about the given map. Yields text deltas as they
 * arrive from OpenRouter (stream:true SSE), so the UI can render token-by-token.
 */
export async function* streamMapAnswer(mapMarkdown: string, turns: ChatTurn[]): AsyncGenerator<string> {
  const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey()}` },
    body: JSON.stringify({
      model: model(),
      stream: true,
      messages: [{ role: 'system', content: ASK_SYSTEM + mapMarkdown }, ...turns],
    }),
    signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
  });
  if (!res.ok || !res.body) {
    throw new Error(`OpenRouter ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') return;
      try {
        const json = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] };
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        // OpenRouter occasionally emits keep-alive comment lines; ignore non-JSON.
      }
    }
  }
}
