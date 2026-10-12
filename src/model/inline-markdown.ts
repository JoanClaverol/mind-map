import { STEP_KINDS, STEP_LABELS, type StepKind } from './types';
/**
 * Inline markdown → HTML for node text: **bold**, *italic*, ***both***,
 * `code`, ~~strike~~, ==highlight== and [text](url) links. Inline-only by
 * design — `#`/`-` prefixes stay literal, structure belongs to the tree.
 *
 * Output is XSS-safe by construction: only the tags below are ever emitted
 * and every literal character passes through escapeHtml. NodeView renders
 * this string and measure.ts measures the same string, so sizes can't drift.
 */

const PAIRED: ReadonlyArray<[delim: string, open: string, close: string]> = [
  ['***', '<strong><em>', '</em></strong>'],
  ['**', '<strong>', '</strong>'],
  ['*', '<em>', '</em>'],
  ['~~', '<del>', '</del>'],
  ['==', '<mark>', '</mark>'],
];

const ESCAPABLE = '*`~=[]()\\';
const SAFE_URL = /^(https?:|mailto:)/i;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Closer must exist past `from`, be preceded by non-whitespace and not by a backslash escape. */
function findCloser(src: string, delim: string, from: number): number {
  for (let j = src.indexOf(delim, from); j !== -1; j = src.indexOf(delim, j + 1)) {
    if (/\S/.test(src[j - 1]) && src[j - 1] !== '\\') return j;
  }
  return -1;
}

function parseInline(src: string, inLink: boolean): string {
  let out = '';
  let i = 0;
  outer: while (i < src.length) {
    const ch = src[i];

    if (ch === '\\' && ESCAPABLE.includes(src[i + 1])) {
      out += escapeHtml(src[i + 1]);
      i += 2;
      continue;
    }

    if (ch === '`') {
      const j = src.indexOf('`', i + 1);
      if (j > i + 1) {
        out += `<code>${escapeHtml(src.slice(i + 1, j))}</code>`;
        i = j + 1;
        continue;
      }
    }

    if (ch === '[' && !inLink) {
      const close = src.indexOf(']', i + 1);
      if (close > i + 1 && src[close + 1] === '(') {
        const end = src.indexOf(')', close + 2);
        const url = end === -1 ? '' : src.slice(close + 2, end).trim();
        if (SAFE_URL.test(url)) {
          const label = parseInline(src.slice(i + 1, close), true);
          out += `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" draggable="false">${label}</a>`;
          i = end + 1;
          continue;
        }
      }
    }

    for (const [delim, open, close] of PAIRED) {
      if (!src.startsWith(delim, i)) continue;
      const start = i + delim.length;
      if (!/\S/.test(src[start] ?? '')) continue;
      const j = findCloser(src, delim, start + 1);
      if (j === -1) continue;
      out += open + parseInline(src.slice(start, j), inLink) + close;
      i = j + delim.length;
      continue outer;
    }

    out += escapeHtml(ch);
    i += 1;
  }
  return out;
}

const cache = new Map<string, string>();

export function renderInlineMarkdown(raw: string): string {
  const hit = cache.get(raw);
  if (hit !== undefined) return hit;
  const html = parseInline(raw, false);
  cache.set(raw, html);
  return html;
}

/**
 * The exact HTML NodeView renders AND measure.ts measures — icon included.
 * Both sides MUST use this function (the measure-mirror invariant): an icon
 * added only on one side makes measured and rendered widths drift. The icon
 * is escaped plain text, never markdown-parsed, and lives only in node.icon.
 */
export function renderNodeContent(text: string, icon?: string, step?: string): string {
  const body = renderInlineMarkdown(text);
  const withIcon = icon ? `<span class="node-icon">${escapeHtml(icon)}</span>${body}` : body;
  const kind = step && STEP_KINDS.includes(step as StepKind) ? (step as StepKind) : null;
  // Workflow step badge: its own line above the text, so it's measured like any content.
  return kind ? `<span class="node-step step-${kind}">${STEP_LABELS[kind]}</span>${withIcon}` : withIcon;
}
