import { useEffect, useMemo, useRef } from 'react';
import { formatCombo } from '../hotkeys/format';
import { buildHelpGroups } from '../hotkeys/help';
import { DEFAULT_KEYMAP, loadKeymapOverrides, resolveKeymap } from '../hotkeys/keymap';
import { registry } from '../state/registry';
import { useStore } from '../state/store';

export function HelpOverlay() {
  const open = useStore((s) => s.helpOpen);
  const panelRef = useRef<HTMLDivElement>(null);

  // Rebuilt per open so localStorage.keymap overrides show up without a reload.
  const groups = useMemo(() => {
    if (!open) return [];
    return buildHelpGroups(resolveKeymap(DEFAULT_KEYMAP, loadKeymapOverrides()), registry);
  }, [open]);

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div className="help-overlay" onClick={() => useStore.getState().setHelpOpen(false)}>
      <div
        className="help-panel"
        ref={panelRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation(); // the canvas/gallery must not see keys while open
          if (e.key === 'Escape' || e.key === '?') {
            e.preventDefault();
            useStore.getState().setHelpOpen(false);
          }
        }}
      >
        <div className="help-header">
          <h2>Keyboard</h2>
          <span className="help-close">Esc to close</span>
        </div>
        <div className="help-groups">
          {groups.map((g) => (
            <section key={g.label} className="help-group">
              <h3>{g.label}</h3>
              {g.rows.map((row) => (
                <div key={row.command} className="help-row">
                  <span className="help-keys">
                    {row.combos.map((combo) => (
                      <kbd key={combo}>{formatCombo(combo)}</kbd>
                    ))}
                  </span>
                  <span className="help-desc">{row.description}</span>
                </div>
              ))}
            </section>
          ))}
        </div>
        <div className="help-footer">Type any letter on the canvas to edit the selected node.</div>
      </div>
    </div>
  );
}
