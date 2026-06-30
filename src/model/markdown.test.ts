import { describe, expect, it } from 'vitest';
import { normalize } from './doc';
import { branchToMarkdown, markdownToBranches } from './markdown';
import type { FileNode } from './types';

/** Strip ids (and empty-children noise) so trees compare structurally. */
function shape(n: FileNode): { text: string; children: ReturnType<typeof shape>[] } {
  return { text: n.text, children: n.children.map(shape) };
}

const tree: FileNode = {
  id: 'root',
  text: 'Project plan',
  children: [
    {
      id: 'a',
      text: 'Research',
      children: [
        { id: 'a1', text: 'Read papers', children: [] },
        { id: 'a2', text: 'Interview users', children: [] },
      ],
    },
    { id: 'b', text: 'Build MVP', children: [{ id: 'b1', text: 'Auth flow', children: [] }] },
  ],
};

describe('branchToMarkdown', () => {
  it('serializes a branch with two-space indentation', () => {
    expect(branchToMarkdown(normalize(tree), 'root')).toBe(
      [
        '- Project plan',
        '  - Research',
        '    - Read papers',
        '    - Interview users',
        '  - Build MVP',
        '    - Auth flow',
      ].join('\n'),
    );
  });

  it('flattens internal newlines to single spaces', () => {
    const doc = normalize({ id: 'r', text: 'line one\nline two', children: [] });
    expect(branchToMarkdown(doc, 'r')).toBe('- line one line two');
  });
});

describe('markdownToBranches', () => {
  it('round-trips its own serialization', () => {
    const md = branchToMarkdown(normalize(tree), 'root');
    const parsed = markdownToBranches(md);
    expect(parsed).toHaveLength(1);
    expect(shape(parsed[0])).toEqual(shape(tree));
  });

  it('parses tab indentation', () => {
    const parsed = markdownToBranches('- a\n\t- b\n\t\t- c');
    expect(shape(parsed[0])).toEqual({
      text: 'a',
      children: [{ text: 'b', children: [{ text: 'c', children: [] }] }],
    });
  });

  it('parses 4-space indentation by inferring the unit', () => {
    const parsed = markdownToBranches('- a\n    - b\n        - c\n    - d');
    expect(shape(parsed[0])).toEqual({
      text: 'a',
      children: [
        { text: 'b', children: [{ text: 'c', children: [] }] },
        { text: 'd', children: [] },
      ],
    });
  });

  it('accepts * and + bullets', () => {
    const parsed = markdownToBranches('* a\n  + b');
    expect(shape(parsed[0])).toEqual({ text: 'a', children: [{ text: 'b', children: [] }] });
  });

  it('keeps " - " inside node text intact', () => {
    const parsed = markdownToBranches('- todo - urgent - now');
    expect(parsed[0].text).toBe('todo - urgent - now');
  });

  it('clamps ragged over-indentation to parent+1', () => {
    const parsed = markdownToBranches('- a\n      - way too deep\n  - normal');
    expect(shape(parsed[0])).toEqual({
      text: 'a',
      children: [
        { text: 'way too deep', children: [] },
        { text: 'normal', children: [] },
      ],
    });
  });

  it('returns multiple top-level bullets as multiple branches', () => {
    const parsed = markdownToBranches('- one\n- two\n  - two-child');
    expect(parsed).toHaveLength(2);
    expect(shape(parsed[1])).toEqual({ text: 'two', children: [{ text: 'two-child', children: [] }] });
  });

  it('treats bullet-free text as a single node', () => {
    const parsed = markdownToBranches('just a plain sentence\nover two lines');
    expect(parsed).toHaveLength(1);
    expect(parsed[0].text).toBe('just a plain sentence over two lines');
  });

  it('appends continuation lines to the previous bullet', () => {
    const parsed = markdownToBranches('- first line\n  wrapped continuation\n- second');
    expect(parsed[0].text).toBe('first line wrapped continuation');
    expect(parsed[1].text).toBe('second');
  });

  it('returns nothing for empty input', () => {
    expect(markdownToBranches('')).toEqual([]);
    expect(markdownToBranches('  \n \n')).toEqual([]);
  });
});
