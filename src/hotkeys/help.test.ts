import { describe, expect, it } from 'vitest';
import { buildHelpGroups } from './help';
import { DEFAULT_KEYMAP, resolveKeymap } from './keymap';

const COMMANDS = {
  'node.addChild': { description: 'Add a child node and edit it' },
  'node.indent': { description: 'Nest the node under its previous sibling' }, // unbound by default
  'nav.left': { description: 'Select leftward on screen' },
  'link.start': { description: 'Draw an arrow from the selected node' },
  'view.toggleHelp': { description: 'Show or hide the keyboard cheatsheet' },
  'gallery.down': { description: 'Select the next map' },
};

describe('buildHelpGroups', () => {
  it('groups bound commands by prefix in category order with all their combos', () => {
    const groups = buildHelpGroups(DEFAULT_KEYMAP, COMMANDS);
    // 'Arrows' (link.*) sits between Navigate and View per CATEGORY_ORDER.
    expect(groups.map((g) => g.label)).toEqual(['Nodes', 'Navigate', 'Arrows', 'View', 'Gallery']);
    const nav = groups.find((g) => g.label === 'Navigate')!;
    expect(nav.rows[0].combos).toEqual(['h', 'arrowleft']);
    const view = groups.find((g) => g.label === 'View')!;
    // bound in both nav and gallery contexts → deduped to one combo
    expect(view.rows[0].combos).toEqual(['shift+?']);
  });

  it('excludes commands with no binding', () => {
    const groups = buildHelpGroups(DEFAULT_KEYMAP, COMMANDS);
    const node = groups.find((g) => g.label === 'Nodes')!;
    expect(node.rows.map((r) => r.command)).toEqual(['node.addChild']);
  });

  it('reflects user overrides: an unbound default disappears', () => {
    const merged = resolveKeymap(DEFAULT_KEYMAP, [{ combo: 'tab', context: 'nav', command: null }]);
    const groups = buildHelpGroups(merged, COMMANDS);
    expect(groups.find((g) => g.label === 'Nodes')).toBeUndefined();
  });
});
