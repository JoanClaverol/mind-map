import { MAX_EDGE_LABEL_LEN, STEP_KINDS, type Doc, type FileNode, type StepKind } from './types';

/**
 * Serialize a branch as a nested markdown list. The branch root is depth 0;
 * node text is flattened to one line. The default (no opts) is the clipboard
 * interop format and must stay byte-identical. `ids` annotates every line with
 * `(id: …)` for MCP reads; `maxDepth` stops descending and marks the cut-off;
 * `meta` renders node metadata — icon before the text, `[color]` and `#tags`
 * after the id, and the note as an indented `>` line under the bullet. Meta
 * annotations are read-only decoration: never feed them back into a parser.
 */
export function branchToMarkdown(
  doc: Doc,
  nodeId: string,
  opts?: { ids?: boolean; maxDepth?: number; meta?: boolean },
): string {
  const lines: string[] = [];
  const walk = (id: string, depth: number) => {
    const node = doc.nodes[id];
    const text = node.text.replace(/\s+/g, ' ').trim();
    const icon = opts?.meta && node.icon ? `${node.icon} ` : '';
    const idTag = opts?.ids ? ` (id: ${id})` : '';
    const color = opts?.meta && node.color ? ` [${node.color}]` : '';
    const tags = opts?.meta && node.tags?.length ? ` ${node.tags.map((t) => `#${t}`).join(' ')}` : '';
    const step = opts?.meta && node.step ? `[${node.step}] ` : '';
    const edge = opts?.meta && node.edgeLabel ? ` <- ${node.edgeLabel}` : '';
    const cutOff = opts?.maxDepth !== undefined && depth >= opts.maxDepth && node.children.length > 0;
    const hidden = cutOff ? ` … (+${node.children.length} children hidden)` : '';
    lines.push(`${'  '.repeat(depth)}- ${step}${icon}${text}${edge}${idTag}${color}${tags}${hidden}`);
    if (opts?.meta && node.note) {
      lines.push(`${'  '.repeat(depth + 1)}> ${node.note.replace(/\s+/g, ' ').trim()}`);
    }
    if (cutOff) return;
    for (const child of node.children) walk(child, depth + 1);
  };
  walk(nodeId, 0);
  return lines.join('\n');
}

const BULLET_RE = /^([ \t]*)[-*+]\s+(.*)$/;

/**
 * Parse markdown into branches. Tolerant by design:
 * - `-`, `*`, `+` bullets; tabs count one level each
 * - the space indent unit is inferred from the first indented bullet (default 2)
 * - indents deeper than parent+1 clamp to parent+1; ragged input never crashes
 * - multiple top-level bullets → multiple branches (pasted as siblings)
 * - text without any bullets → one node with the whole trimmed text
 * Ids are placeholders — pasteBranches regenerates them.
 */
export function markdownToBranches(text: string): FileNode[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return [];

  if (!lines.some((l) => BULLET_RE.test(l))) {
    return [{ id: 'paste', text: text.replace(/\s+/g, ' ').trim(), children: [] }];
  }

  // The smallest nonzero space indent is the indent unit (a single ragged
  // deep indent must not poison the inference).
  let unit = Infinity;
  for (const line of lines) {
    const m = line.match(BULLET_RE);
    if (!m || m[1].includes('\t')) continue;
    const spaces = m[1].length;
    if (spaces > 0) unit = Math.min(unit, spaces);
  }
  if (!Number.isFinite(unit)) unit = 2;

  const roots: FileNode[] = [];
  const stack: { node: FileNode; level: number }[] = [];
  let seq = 0;
  for (const line of lines) {
    const m = line.match(BULLET_RE);
    if (!m) {
      // Continuation line of the previous bullet — append to its text.
      const last = stack[stack.length - 1];
      if (last) last.node.text += ` ${line.trim()}`;
      continue;
    }
    const [, ws, content] = m;
    const tabs = (ws.match(/\t/g) ?? []).length;
    const spaces = ws.replace(/\t/g, '').length;
    const level = tabs + Math.floor(spaces / unit);
    while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop();
    const node: FileNode = { id: `paste-${seq++}`, text: content.trim(), children: [] };
    const parent = stack[stack.length - 1];
    if (parent) {
      parent.node.children.push(node);
      stack.push({ node, level: parent.level + 1 });
    } else {
      roots.push(node);
      stack.push({ node, level: 0 });
    }
  }
  return roots;
}

const STEP_ALIASES: Record<string, StepKind> = { if: 'condition', llm: 'ai', agent: 'ai', api: 'tool', end: 'output' };
const STEP_MARK_RE = /^\[([a-z]+)\]\s+(.*)$/i;
const EDGE_MARK_RE = /^(.*?)\s+(?:<-|←)\s+(.+)$/;

/**
 * Workflow outline markers, for AI-written flows: a leading `[ai]` (any step
 * type, or if/llm/agent/api/end) sets the node's step, and a trailing
 * `<- label` (or `← label`) sets the label of the arrow coming into it —
 * `- [ai] Classify email <- email body`. Mutates the branches in place.
 * Unknown bracket words are left as text. MCP-only: the clipboard paste
 * format stays plain markdown.
 */
export function applyFlowMarkers(branches: FileNode[]): void {
  const walk = (n: FileNode) => {
    const step = STEP_MARK_RE.exec(n.text);
    if (step) {
      const word = step[1].toLowerCase();
      const kind = (STEP_KINDS as readonly string[]).includes(word) ? (word as StepKind) : STEP_ALIASES[word];
      if (kind) {
        n.step = kind;
        n.text = step[2];
      }
    }
    const edge = EDGE_MARK_RE.exec(n.text);
    if (edge) {
      n.text = edge[1].trim();
      n.edgeLabel = edge[2].trim().slice(0, MAX_EDGE_LABEL_LEN);
    }
    n.children.forEach(walk);
  };
  branches.forEach(walk);
}
