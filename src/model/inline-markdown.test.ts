import { describe, expect, it } from 'vitest';
import { renderInlineMarkdown } from './inline-markdown';

describe('renderInlineMarkdown', () => {
  it('renders each inline mark', () => {
    expect(renderInlineMarkdown('**b**')).toBe('<strong>b</strong>');
    expect(renderInlineMarkdown('*i*')).toBe('<em>i</em>');
    expect(renderInlineMarkdown('***bi***')).toBe('<strong><em>bi</em></strong>');
    expect(renderInlineMarkdown('`c`')).toBe('<code>c</code>');
    expect(renderInlineMarkdown('~~s~~')).toBe('<del>s</del>');
    expect(renderInlineMarkdown('==h==')).toBe('<mark>h</mark>');
  });

  it('nests and combines marks', () => {
    expect(renderInlineMarkdown('**a *b* c**')).toBe('<strong>a <em>b</em> c</strong>');
    expect(renderInlineMarkdown('*x* and `y` done')).toBe('<em>x</em> and <code>y</code> done');
  });

  it('leaves unbalanced markers literal', () => {
    expect(renderInlineMarkdown('**a')).toBe('**a');
    expect(renderInlineMarkdown('lone * star')).toBe('lone * star');
    expect(renderInlineMarkdown('tick `')).toBe('tick `');
  });

  it('ignores non-flanking delimiters', () => {
    expect(renderInlineMarkdown('2 * 3 * 4')).toBe('2 * 3 * 4');
    expect(renderInlineMarkdown('a == b')).toBe('a == b');
  });

  it('keeps snake_case literal (underscore is not a delimiter)', () => {
    expect(renderInlineMarkdown('snake_case_name')).toBe('snake_case_name');
  });

  it('supports backslash escapes for delimiters', () => {
    expect(renderInlineMarkdown('\\*x\\*')).toBe('*x*');
    expect(renderInlineMarkdown('*a\\*b*')).toBe('<em>a*b</em>');
  });

  it('escapes HTML in text and code', () => {
    expect(renderInlineMarkdown('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
    expect(renderInlineMarkdown('**<img onerror=x>**')).toBe(
      '<strong>&lt;img onerror=x&gt;</strong>',
    );
    expect(renderInlineMarkdown('`a < b & c`')).toBe('<code>a &lt; b &amp; c</code>');
  });

  it('renders http/https/mailto links with safe attributes', () => {
    expect(renderInlineMarkdown('[doc](https://example.com)')).toBe(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer" draggable="false">doc</a>',
    );
    expect(renderInlineMarkdown('[mail](mailto:a@b.com)')).toBe(
      '<a href="mailto:a@b.com" target="_blank" rel="noopener noreferrer" draggable="false">mail</a>',
    );
    expect(renderInlineMarkdown('[*it*](https://x.com)')).toBe(
      '<a href="https://x.com" target="_blank" rel="noopener noreferrer" draggable="false"><em>it</em></a>',
    );
  });

  it('rejects unsafe or malformed links as literal text', () => {
    expect(renderInlineMarkdown('[x](javascript:alert(1))')).toBe('[x](javascript:alert(1))');
    expect(renderInlineMarkdown('[x]()')).toBe('[x]()');
    expect(renderInlineMarkdown('[x] (https://a.com)')).toBe('[x] (https://a.com)');
  });

  it('code spans swallow other markers', () => {
    expect(renderInlineMarkdown('`**x**`')).toBe('<code>**x**</code>');
  });

  it('handles empty text and preserves newlines', () => {
    expect(renderInlineMarkdown('')).toBe('');
    expect(renderInlineMarkdown('one\ntwo')).toBe('one\ntwo');
    expect(renderInlineMarkdown('**a**\n*b*')).toBe('<strong>a</strong>\n<em>b</em>');
  });

  it('keeps block syntax literal', () => {
    expect(renderInlineMarkdown('# heading')).toBe('# heading');
    expect(renderInlineMarkdown('- item')).toBe('- item');
  });
});
