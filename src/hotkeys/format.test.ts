import { describe, expect, it } from 'vitest';
import { formatCombo } from './format';

describe('formatCombo', () => {
  it('renders mac modifiers as glyphs without separators', () => {
    expect(formatCombo('mod+shift+z', true)).toBe('⌘⇧Z');
    expect(formatCombo('mod+0', true)).toBe('⌘0');
    expect(formatCombo('shift+j', true)).toBe('⇧J');
  });

  it('renders non-mac modifiers as words joined with +', () => {
    expect(formatCombo('mod+shift+z', false)).toBe('Ctrl+⇧+Z');
    expect(formatCombo('mod+=', false)).toBe('Ctrl+=');
  });

  it('names special keys', () => {
    expect(formatCombo('escape', true)).toBe('Esc');
    expect(formatCombo('space', true)).toBe('Space');
    expect(formatCombo('arrowdown', true)).toBe('↓');
    expect(formatCombo('shift+enter', true)).toBe('⇧↩');
  });

  it('collapses shift+symbol to the symbol itself', () => {
    expect(formatCombo('shift+?', true)).toBe('?');
    expect(formatCombo('shift+?', false)).toBe('?');
  });

  it('uppercases bare letters', () => {
    expect(formatCombo('h', true)).toBe('H');
    expect(formatCombo('/', true)).toBe('/');
  });
});
