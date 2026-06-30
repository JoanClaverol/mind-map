import type { Doc, FileNode } from './types';

/**
 * Serialize a branch as a nested markdown list. The branch root is depth 0;
 * node text is flattened to one line. This is the clipboard interop format.
 */
export function branchToMarkdown(doc: Doc, nodeId: string): string {
  const lines: string[] = [];
  const walk = (id: string, depth: number) => {
    const node = doc.nodes[id];
    lines.push(`${'  '.repeat(depth)}- ${node.text.replace(/\s+/g, ' ').trim()}`);
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
