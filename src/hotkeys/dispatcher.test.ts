import { describe, expect, it } from 'vitest';
import { buildIndex, comboFromEvent, isPrintable, resolveCommand } from './dispatcher';
import { DEFAULT_KEYMAP, resolveKeymap } from './keymap';

function ev(key: string, mods: Partial<{ meta: boolean; ctrl: boolean; shift: boolean; alt: boolean }> = {}) {
  return {
    key,
    metaKey: mods.meta ?? false,
    ctrlKey: mods.ctrl ?? false,
    shiftKey: mods.shift ?? false,
    altKey: mods.alt ?? false,
  };
}

describe('comboFromEvent', () => {
  it('normalizes plain keys', () => {
    expect(comboFromEvent(ev('Tab'))).toBe('tab');
    expect(comboFromEvent(ev(' '))).toBe('space');
    expect(comboFromEvent(ev('ArrowDown'))).toBe('arrowdown');
    expect(comboFromEvent(ev('h'))).toBe('h');
  });

  it('normalizes modifiers in a stable order, cmd and ctrl both as mod', () => {
    expect(comboFromEvent(ev('z', { meta: true, shift: true }))).toBe('mod+shift+z');
    expect(comboFromEvent(ev('z', { ctrl: true, shift: true }))).toBe('mod+shift+z');
    expect(comboFromEvent(ev('Enter', { shift: true }))).toBe('shift+enter');
  });

  it('keeps shifted symbols as the produced character', () => {
    expect(comboFromEvent(ev('?', { shift: true }))).toBe('shift+?');
  });
});

describe('isPrintable', () => {
  it('accepts bare characters and rejects modified or named keys', () => {
    expect(isPrintable(ev('a'))).toBe(true);
    expect(isPrintable(ev('Ç'))).toBe(true);
    expect(isPrintable(ev('a', { meta: true }))).toBe(false);
    expect(isPrintable(ev('F5'))).toBe(false);
    expect(isPrintable(ev('Escape'))).toBe(false);
  });
});

describe('keymap resolution', () => {
  it('resolves defaults by context', () => {
    const index = buildIndex(DEFAULT_KEYMAP);
    expect(resolveCommand(index, 'nav', 'tab')).toBe('node.addChild');
    expect(resolveCommand(index, 'nav', 'mod+shift+z')).toBe('history.redo');
    expect(resolveCommand(index, 'edit', 'tab')).toBeUndefined();
  });

  it('keeps gallery and nav contexts independent', () => {
    const index = buildIndex(DEFAULT_KEYMAP);
    expect(resolveCommand(index, 'gallery', 'j')).toBe('gallery.down');
    expect(resolveCommand(index, 'nav', 'j')).toBe('nav.down');
    expect(resolveCommand(index, 'gallery', '/')).toBe('gallery.search');
    expect(resolveCommand(index, 'nav', 'shift+?')).toBe('view.toggleHelp');
    expect(resolveCommand(index, 'gallery', 'shift+?')).toBe('view.toggleHelp');
  });

  it('user overrides replace and unbind defaults', () => {
    const merged = resolveKeymap(DEFAULT_KEYMAP, [
      { combo: 't', context: 'nav', command: 'node.toggleCollapse' },
      { combo: '/', context: 'nav', command: null },
    ]);
    const index = buildIndex(merged);
    expect(resolveCommand(index, 'nav', 't')).toBe('node.toggleCollapse');
    expect(resolveCommand(index, 'nav', '/')).toBeUndefined();
    expect(resolveCommand(index, 'nav', 'tab')).toBe('node.addChild');
  });
});
