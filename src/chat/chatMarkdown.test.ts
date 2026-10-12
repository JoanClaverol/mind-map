import { describe, expect, it } from 'vitest';
import { renderChatMarkdown } from './chatMarkdown';

describe('renderChatMarkdown', () => {
  it('renders paragraphs, lists, tables and code', () => {
    const html = renderChatMarkdown(
      'I made **the map**.\n\n- one\n- two\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```\n<b>x</b>\n```',
    );
    expect(html).toContain('<p>I made <strong>the map</strong>.</p>');
    expect(html).toContain('<ul><li>one</li><li>two</li></ul>');
    expect(html).toContain('<th>A</th>');
    expect(html).toContain('<td>2</td>');
    expect(html).toContain('<pre><code>&lt;b&gt;x&lt;/b&gt;</code></pre>');
  });

  it('never emits raw HTML or unsafe links', () => {
    const html = renderChatMarkdown('<img src=x onerror=alert(1)> [x](javascript:alert(1))\n\n- <script>');
    expect(html).not.toMatch(/<img|<script|href="javascript/);
    expect(html).toContain("&lt;img");
  });
});
