import type { Binding, Context } from './keymap';

interface KeyEventLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** Normalize a keyboard event to a combo string like "mod+shift+z". */
export function comboFromEvent(e: KeyEventLike): string {
  const parts: string[] = [];
  if (e.metaKey || e.ctrlKey) parts.push('mod');
  if (e.shiftKey) parts.push('shift');
  if (e.altKey) parts.push('alt');
  let key = e.key.toLowerCase();
  if (key === ' ') key = 'space';
  parts.push(key);
  return parts.join('+');
}

/** A printable character with no modifier — the type-to-edit trigger. */
export function isPrintable(e: KeyEventLike): boolean {
  return e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey;
}

export type KeymapIndex = Map<string, string>;

export function buildIndex(keymap: Binding[]): KeymapIndex {
  const index: KeymapIndex = new Map();
  for (const b of keymap) {
    if (b.command !== null) index.set(`${b.context}:${b.combo}`, b.command);
  }
  return index;
}

export function resolveCommand(index: KeymapIndex, context: Context, combo: string): string | undefined {
  return index.get(`${context}:${combo}`);
}
