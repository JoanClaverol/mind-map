const KEY_LABELS: Record<string, string> = {
  escape: 'Esc',
  space: 'Space',
  enter: '↩',
  tab: 'Tab',
  backspace: '⌫',
  delete: '⌦',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
};

function detectMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
}

/** Render a normalized combo ("mod+shift+z") for humans ("⌘⇧Z"). */
export function formatCombo(combo: string, isMac = detectMac()): string {
  const parts = combo.split('+');
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  // A shifted symbol key ("shift+?") is just the symbol — that's how you type it.
  if (mods.length === 1 && mods[0] === 'shift' && key.length === 1 && key.toLowerCase() === key.toUpperCase()) {
    return key;
  }
  const out: string[] = [];
  for (const mod of mods) {
    if (mod === 'mod') out.push(isMac ? '⌘' : 'Ctrl');
    else if (mod === 'shift') out.push('⇧');
    else if (mod === 'alt') out.push(isMac ? '⌥' : 'Alt');
  }
  out.push(KEY_LABELS[key] ?? (key.length === 1 ? key.toUpperCase() : key));
  return out.join(isMac ? '' : '+');
}
