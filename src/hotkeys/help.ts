import type { Binding } from './keymap';

export interface HelpRow {
  command: string;
  description: string;
  combos: string[];
}

export interface HelpGroup {
  label: string;
  rows: HelpRow[];
}

const CATEGORY_ORDER = ['node', 'nav', 'link', 'clipboard', 'history', 'audio', 'todo', 'note', 'chat', 'map', 'view', 'gallery'];

const CATEGORY_LABELS: Record<string, string> = {
  node: 'Nodes',
  nav: 'Navigate',
  link: 'Arrows',
  clipboard: 'Clipboard',
  history: 'History',
  audio: 'Voice',
  todo: 'Todos',
  note: 'Notes',
  chat: 'Chat',
  map: 'Map',
  view: 'View',
  gallery: 'Gallery',
};

/**
 * Join the resolved keymap with command descriptions into display groups.
 * Only bound commands appear — the cheatsheet shows what the keyboard can do,
 * and it stays correct under user overrides because it reads the live keymap.
 */
export function buildHelpGroups(
  keymap: Binding[],
  commands: Record<string, { description: string }>,
): HelpGroup[] {
  const combosByCommand = new Map<string, string[]>();
  for (const b of keymap) {
    if (b.command === null) continue;
    const combos = combosByCommand.get(b.command) ?? [];
    if (!combos.includes(b.combo)) combos.push(b.combo); // same combo in two contexts → one row
    combosByCommand.set(b.command, combos);
  }
  const groups = new Map<string, HelpRow[]>();
  for (const [id, { description }] of Object.entries(commands)) {
    const combos = combosByCommand.get(id);
    if (!combos) continue;
    const prefix = id.split('.')[0];
    const rows = groups.get(prefix) ?? [];
    rows.push({ command: id, description, combos });
    groups.set(prefix, rows);
  }
  const ordered = [...groups.keys()].sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a);
    const ib = CATEGORY_ORDER.indexOf(b);
    return (ia === -1 ? CATEGORY_ORDER.length : ia) - (ib === -1 ? CATEGORY_ORDER.length : ib);
  });
  return ordered.map((prefix) => ({
    label: CATEGORY_LABELS[prefix] ?? prefix.charAt(0).toUpperCase() + prefix.slice(1),
    rows: groups.get(prefix)!,
  }));
}
