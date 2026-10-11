export type Context = 'nav' | 'edit' | 'gallery' | 'link' | 'relsel' | 'group' | 'groupsel' | 'elemsel';

export interface Binding {
  /** Normalized combo: "[mod+][shift+][alt+]key", e.g. "tab", "mod+shift+z", "h". */
  combo: string;
  context: Context;
  /** Command id in the registry; null unbinds a default. */
  command: string | null;
}

export const DEFAULT_KEYMAP: Binding[] = [
  // structure
  { combo: 'tab', context: 'nav', command: 'node.addChild' },
  { combo: 'enter', context: 'nav', command: 'node.addSiblingBelow' },
  { combo: 'shift+enter', context: 'nav', command: 'node.addSiblingAbove' },
  { combo: 'delete', context: 'nav', command: 'node.deleteSubtree' },
  { combo: 'backspace', context: 'nav', command: 'node.deleteSubtree' },
  { combo: '/', context: 'nav', command: 'node.toggleCollapse' },
  // moving (note: these win over type-to-edit for capital H/J/K/L — Space edits instead)
  { combo: 'shift+j', context: 'nav', command: 'node.moveDown' },
  { combo: 'shift+k', context: 'nav', command: 'node.moveUp' },
  { combo: 'shift+l', context: 'nav', command: 'node.moveRight' },
  { combo: 'shift+h', context: 'nav', command: 'node.moveLeft' },
  // editing
  { combo: 'space', context: 'nav', command: 'node.editAppend' },
  { combo: 'f2', context: 'nav', command: 'node.editAppend' },
  // navigation (XMind arrows + vim hjkl; screen-direction — style-aware)
  { combo: 'h', context: 'nav', command: 'nav.left' },
  { combo: 'arrowleft', context: 'nav', command: 'nav.left' },
  { combo: 'l', context: 'nav', command: 'nav.right' },
  { combo: 'arrowright', context: 'nav', command: 'nav.right' },
  { combo: 'j', context: 'nav', command: 'nav.down' },
  { combo: 'arrowdown', context: 'nav', command: 'nav.down' },
  { combo: 'k', context: 'nav', command: 'nav.up' },
  { combo: 'arrowup', context: 'nav', command: 'nav.up' },
  // relationships (shift+a = Arrow; shadows type-to-edit for capital A, like H/J/K/L/R/S/T)
  { combo: 'shift+a', context: 'nav', command: 'link.start' },
  // while drawing an arrow: hjkl/arrows move the target cursor, enter confirms, esc cancels
  { combo: 'h', context: 'link', command: 'nav.left' },
  { combo: 'arrowleft', context: 'link', command: 'nav.left' },
  { combo: 'l', context: 'link', command: 'nav.right' },
  { combo: 'arrowright', context: 'link', command: 'nav.right' },
  { combo: 'j', context: 'link', command: 'nav.down' },
  { combo: 'arrowdown', context: 'link', command: 'nav.down' },
  { combo: 'k', context: 'link', command: 'nav.up' },
  { combo: 'arrowup', context: 'link', command: 'nav.up' },
  { combo: 'enter', context: 'link', command: 'link.confirm' },
  { combo: 'escape', context: 'link', command: 'link.cancel' },
  // when an arrow is selected: enter edits its label, delete removes it, esc deselects
  { combo: 'enter', context: 'relsel', command: 'link.editLabel' },
  { combo: 'delete', context: 'relsel', command: 'link.delete' },
  { combo: 'backspace', context: 'relsel', command: 'link.delete' },
  { combo: 'escape', context: 'relsel', command: 'link.deselect' },
  // groups (shift+g = Group; shadows type-to-edit for capital G, like A/H/J/K/L)
  { combo: 'shift+g', context: 'nav', command: 'group.start' },
  // while picking group members: hjkl/arrows move the cursor, space toggles, enter confirms
  { combo: 'h', context: 'group', command: 'nav.left' },
  { combo: 'arrowleft', context: 'group', command: 'nav.left' },
  { combo: 'l', context: 'group', command: 'nav.right' },
  { combo: 'arrowright', context: 'group', command: 'nav.right' },
  { combo: 'j', context: 'group', command: 'nav.down' },
  { combo: 'arrowdown', context: 'group', command: 'nav.down' },
  { combo: 'k', context: 'group', command: 'nav.up' },
  { combo: 'arrowup', context: 'group', command: 'nav.up' },
  { combo: 'space', context: 'group', command: 'group.toggleMember' },
  { combo: 'enter', context: 'group', command: 'group.confirm' },
  { combo: 'escape', context: 'group', command: 'group.cancel' },
  // when a group is selected: enter edits its label, c recolors, shift+g edits members
  { combo: 'enter', context: 'groupsel', command: 'group.editLabel' },
  { combo: 'c', context: 'groupsel', command: 'group.cycleColor' },
  { combo: 'shift+g', context: 'groupsel', command: 'group.start' },
  { combo: 'delete', context: 'groupsel', command: 'group.delete' },
  { combo: 'backspace', context: 'groupsel', command: 'group.delete' },
  { combo: 'escape', context: 'groupsel', command: 'group.deselect' },
  // freeform canvas elements (capitals shadow type-to-edit, like A/G/H/J/K/L):
  // ⇧P sticky (Post-it — beside the selected node), ⇧T text, ⇧R rectangle, ⇧O ellipse (Oval)
  { combo: 'shift+p', context: 'nav', command: 'element.addSticky' },
  { combo: 'shift+t', context: 'nav', command: 'element.addText' },
  { combo: 'shift+r', context: 'nav', command: 'element.addRect' },
  { combo: 'shift+o', context: 'nav', command: 'element.addEllipse' },
  // when an element is selected: enter edits, c recolors, hjkl nudges (⇧ = 5×), delete removes
  { combo: 'enter', context: 'elemsel', command: 'element.edit' },
  { combo: 'c', context: 'elemsel', command: 'element.cycleColor' },
  { combo: 'h', context: 'elemsel', command: 'element.nudgeLeft' },
  { combo: 'arrowleft', context: 'elemsel', command: 'element.nudgeLeft' },
  { combo: 'l', context: 'elemsel', command: 'element.nudgeRight' },
  { combo: 'arrowright', context: 'elemsel', command: 'element.nudgeRight' },
  { combo: 'k', context: 'elemsel', command: 'element.nudgeUp' },
  { combo: 'arrowup', context: 'elemsel', command: 'element.nudgeUp' },
  { combo: 'j', context: 'elemsel', command: 'element.nudgeDown' },
  { combo: 'arrowdown', context: 'elemsel', command: 'element.nudgeDown' },
  { combo: 'shift+h', context: 'elemsel', command: 'element.nudgeLeftFar' },
  { combo: 'shift+l', context: 'elemsel', command: 'element.nudgeRightFar' },
  { combo: 'shift+k', context: 'elemsel', command: 'element.nudgeUpFar' },
  { combo: 'shift+j', context: 'elemsel', command: 'element.nudgeDownFar' },
  { combo: 'delete', context: 'elemsel', command: 'element.delete' },
  { combo: 'backspace', context: 'elemsel', command: 'element.delete' },
  { combo: 'escape', context: 'elemsel', command: 'element.deselect' },
  { combo: 'mod+z', context: 'elemsel', command: 'history.undo' },
  { combo: 'mod+shift+z', context: 'elemsel', command: 'history.redo' },
  // history
  { combo: 'mod+z', context: 'nav', command: 'history.undo' },
  { combo: 'mod+shift+z', context: 'nav', command: 'history.redo' },
  // clipboard (markdown interop)
  { combo: 'mod+c', context: 'nav', command: 'clipboard.copyBranch' },
  { combo: 'mod+x', context: 'nav', command: 'clipboard.cutBranch' },
  { combo: 'mod+v', context: 'nav', command: 'clipboard.paste' },
  // floating trees (shift+n shadows type-to-edit for capital N, like H/J/K/L/R/S/T)
  { combo: 'shift+n', context: 'nav', command: 'tree.addFloating' },
  // node inspector (shift+i shadows type-to-edit for capital I)
  { combo: 'shift+i', context: 'nav', command: 'node.toggleInspector' },
  // view (shift+s/shift+b shadow type-to-edit for capitals S/B, like H/J/K/L/R)
  { combo: 'shift+s', context: 'nav', command: 'map.cycleLayout' },
  { combo: 'shift+b', context: 'nav', command: 'node.cycleStyle' },
  { combo: 'mod+f', context: 'nav', command: 'view.search' },
  { combo: 'mod+.', context: 'nav', command: 'view.hoist' },
  { combo: 'mod+=', context: 'nav', command: 'view.zoomIn' },
  { combo: 'mod+shift+=', context: 'nav', command: 'view.zoomIn' },
  { combo: 'mod+-', context: 'nav', command: 'view.zoomOut' },
  { combo: 'mod+0', context: 'nav', command: 'view.fit' },
  // sketch look (shift+d = Draw; shadows type-to-edit for capital D, like A/G/H/J/K/L)
  { combo: 'shift+d', context: 'nav', command: 'view.toggleSketch' },
  // export
  { combo: 'mod+e', context: 'nav', command: 'export.png' },
  { combo: 'mod+shift+e', context: 'nav', command: 'export.svg' },
  { combo: 'escape', context: 'nav', command: 'view.backToGallery' },
  // help (shift+? assumes a layout where ? is shifted; override via localStorage.keymap otherwise)
  { combo: 'shift+?', context: 'nav', command: 'view.toggleHelp' },
  { combo: 'shift+?', context: 'gallery', command: 'view.toggleHelp' },
  // gallery
  { combo: 'j', context: 'gallery', command: 'gallery.down' },
  { combo: 'arrowdown', context: 'gallery', command: 'gallery.down' },
  { combo: 'k', context: 'gallery', command: 'gallery.up' },
  { combo: 'arrowup', context: 'gallery', command: 'gallery.up' },
  { combo: 'enter', context: 'gallery', command: 'gallery.open' },
  { combo: 'n', context: 'gallery', command: 'gallery.new' },
  { combo: 'r', context: 'gallery', command: 'gallery.rename' },
  { combo: 'd', context: 'gallery', command: 'gallery.delete' },
  { combo: 'p', context: 'gallery', command: 'gallery.togglePin' },
  { combo: '/', context: 'gallery', command: 'gallery.search' },
  { combo: 'escape', context: 'gallery', command: 'gallery.dismiss' },
  // folders
  { combo: 'm', context: 'gallery', command: 'gallery.move' },
  { combo: 'f', context: 'gallery', command: 'gallery.newFolder' },
  { combo: 'shift+r', context: 'gallery', command: 'gallery.renameFolder' },
  { combo: 'shift+d', context: 'gallery', command: 'gallery.deleteFolder' },
  { combo: 'h', context: 'gallery', command: 'gallery.collapseFolder' },
  { combo: 'l', context: 'gallery', command: 'gallery.expandFolder' },
];

/** User keymap overrides from localStorage (plain data, see README). */
export function loadKeymapOverrides(): Binding[] {
  try {
    const raw = localStorage.getItem('keymap');
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Binding[]) : [];
  } catch {
    return [];
  }
}

/** User overrides: same (combo, context) replaces the default; command null unbinds. */
export function resolveKeymap(defaults: Binding[], overrides: Binding[]): Binding[] {
  const merged = new Map<string, Binding>();
  for (const b of defaults) merged.set(`${b.context}:${b.combo}`, b);
  for (const b of overrides) merged.set(`${b.context}:${b.combo}`, b);
  return [...merged.values()].filter((b) => b.command !== null);
}
