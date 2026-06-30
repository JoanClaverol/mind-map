import { renderInlineMarkdown } from './inline-markdown';

/**
 * Block-level markdown → HTML for chat answers: paragraphs, `#`..`######`
 * headings, `-`/`*`/`+` and `1.` lists, and ``` fenced code blocks. Inline spans
 * (bold, code, links…) are delegated to renderInlineMarkdown.
 *
 * XSS-safe by construction, exactly like inline-markdown: every wrapper tag here
 * is a fixed literal, and all dynamic text flows through renderInlineMarkdown
 * (which escapes) or the local escapeHtml for code blocks. Tolerant of partial
 * input so it can render a streaming answer token-by-token.
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const BULLET = /^[ \t]*[-*+][ \t]+(.*)$/;
const ORDERED = /^[ \t]*\d+[.)][ \t]+(.*)$/;
const HEADING = /^(#{1,6})[ \t]+(.*)$/;

export function renderChatMarkdown(raw: string): string {
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let para: string[] = [];
  let i = 0;

  const flushPara = () => {
    if (para.length === 0) return;
    out.push(`<p>${para.map(renderInlineMarkdown).join('<br>')}</p>`);
    para = [];
  };

  while (i < lines.length) {
    const line = lines[i];

    const fence = line.match(/^[ \t]*```/);
    if (fence) {
      flushPara();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^[ \t]*```/.test(lines[i])) buf.push(lines[i++]);
      i++; // skip closing fence (or run off the end while still streaming)
      out.push(`<pre><code>${escapeHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }

    if (line.trim() === '') {
      flushPara();
      i++;
      continue;
    }

    const h = line.match(HEADING);
    if (h) {
      flushPara();
      const level = Math.min(h[1].length + 2, 6); // `#` → h3, capped at h6
      out.push(`<h${level}>${renderInlineMarkdown(h[2].trim())}</h${level}>`);
      i++;
      continue;
    }

    if (BULLET.test(line)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && BULLET.test(lines[i])) {
        items.push(`<li>${renderInlineMarkdown(lines[i].match(BULLET)![1].trim())}</li>`);
        i++;
      }
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    if (ORDERED.test(line)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && ORDERED.test(lines[i])) {
        items.push(`<li>${renderInlineMarkdown(lines[i].match(ORDERED)![1].trim())}</li>`);
        i++;
      }
      out.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    para.push(line.trim());
    i++;
  }
  flushPara();
  return out.join('');
}
