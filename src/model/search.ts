import type { Doc } from './types';

/**
 * In-canvas node search (⌘F): plain tokens are case-insensitive substrings all
 * required in the node text; `#tag` tokens each must prefix-match one of the
 * node's tags. Mirrors find_nodes semantics, plus prefix tags for live typing.
 */
export interface Query {
  textTokens: string[];
  tagTokens: string[];
}

export function parseQuery(raw: string): Query {
  const textTokens: string[] = [];
  const tagTokens: string[] = [];
  for (const token of raw.trim().toLowerCase().split(/\s+/)) {
    if (!token) continue;
    if (token.startsWith('#')) {
      const tag = token.slice(1);
      if (tag) tagTokens.push(tag);
    } else {
      textTokens.push(token);
    }
  }
  return { textTokens, tagTokens };
}

export function isEmptyQuery(q: Query): boolean {
  return q.textTokens.length === 0 && q.tagTokens.length === 0;
}

export function nodeMatches(node: { text: string; tags?: string[] }, q: Query): boolean {
  if (isEmptyQuery(q)) return false;
  const text = node.text.toLowerCase();
  if (!q.textTokens.every((t) => text.includes(t))) return false;
  const tags = (node.tags ?? []).map((t) => t.toLowerCase());
  return q.tagTokens.every((t) => tags.some((tag) => tag.startsWith(t)));
}

/**
 * The doc as the canvas currently shows it: hoisting swaps the root to the
 * hoisted node and hides floating trees. Pure view restriction — same nodes
 * object, so commands and ids stay valid.
 */
export function viewScope(doc: Doc, hoistId: string | null): Doc {
  if (!hoistId || hoistId === doc.rootId || !doc.nodes[hoistId]) return doc;
  return { ...doc, rootId: hoistId, floating: [] };
}

/**
 * Matching node ids in document order (main tree, then floating trees),
 * including nodes hidden inside collapsed branches — search must find them.
 */
export function searchMatches(doc: Doc, raw: string): string[] {
  const q = parseQuery(raw);
  if (isEmptyQuery(q)) return [];
  const out: string[] = [];
  const walk = (id: string) => {
    const node = doc.nodes[id];
    if (nodeMatches(node, q)) out.push(id);
    for (const c of node.children) walk(c);
  };
  walk(doc.rootId);
  for (const f of doc.floating) walk(f.rootId);
  return out;
}
