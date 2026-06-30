import { describe, expect, it } from 'vitest';
import { renderChatMarkdown } from './chat-markdown';

describe('renderChatMarkdown', () => {
  it('wraps plain text in a paragraph and renders inline spans', () => {
    expect(renderChatMarkdown('The budget is **2000 USD**.')).toBe(
      '<p>The budget is <strong>2000 USD</strong>.</p>',
    );
  });

  it('renders unordered and ordered lists', () => {
    expect(renderChatMarkdown('- Tokyo\n- Kyoto')).toBe('<ul><li>Tokyo</li><li>Kyoto</li></ul>');
    expect(renderChatMarkdown('1. first\n2. second')).toBe('<ol><li>first</li><li>second</li></ol>');
  });

  it('separates paragraphs on blank lines and joins soft breaks with <br>', () => {
    expect(renderChatMarkdown('a\nb\n\nc')).toBe('<p>a<br>b</p><p>c</p>');
  });

  it('renders headings as h3..h6', () => {
    expect(renderChatMarkdown('# Title')).toBe('<h3>Title</h3>');
    expect(renderChatMarkdown('### Deep')).toBe('<h5>Deep</h5>');
  });

  it('renders fenced code blocks verbatim and escaped (no inline parsing inside)', () => {
    expect(renderChatMarkdown('```\n<b>**x**</b>\n```')).toBe(
      '<pre><code>&lt;b&gt;**x**&lt;/b&gt;</code></pre>',
    );
  });

  it('escapes HTML in ordinary text (XSS-safe)', () => {
    expect(renderChatMarkdown('<script>alert(1)</script>')).toBe(
      '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>',
    );
  });

  it('leaves an unclosed code fence sane while streaming', () => {
    expect(renderChatMarkdown('```\npartial')).toBe('<pre><code>partial</code></pre>');
  });
});
