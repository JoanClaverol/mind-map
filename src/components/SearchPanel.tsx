import { useEffect, useMemo, useRef, useState } from 'react';
import { getCanvasHost, getLastLayout } from '../canvas/layoutCache';
import { buildParentMap } from '../model/doc';
import { searchMatches, viewScope } from '../model/search';
import { expandAncestors } from '../state/commands';
import { useStore } from '../state/store';

const MAX_ROWS = 50;

/**
 * In-canvas search (⌘F): type to dim non-matches live, ↑↓ to cycle hits (the
 * canvas follows visible ones), Enter to jump — expanding collapsed ancestors —
 * ⇧Enter to pin the query as a canvas filter that outlives the panel.
 * Same non-modal pattern as the inspector: keys never reach the canvas.
 */
export function SearchPanel() {
  const open = useStore((s) => s.searchOpen);
  const query = useStore((s) => s.searchQuery);
  const doc = useStore((s) => s.doc);
  const hoistId = useStore((s) => s.hoistId);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  /** Selection at open time, restored on Esc so a browse-around costs nothing. */
  const returnToRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    returnToRef.current = useStore.getState().selectedId;
    setActive(0);
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [open]);

  const results = useMemo(
    () => (open && doc ? searchMatches(viewScope(doc, hoistId), query) : []),
    [open, doc, hoistId, query],
  );
  const parents = useMemo(() => (open && doc ? buildParentMap(doc) : {}), [open, doc]);
  const clamped = Math.min(active, Math.max(0, results.length - 1));

  // The canvas follows the active hit while it's visible; hidden hits (inside
  // collapsed branches) only expand on an explicit Enter — no history noise.
  useEffect(() => {
    if (!open) return;
    const id = results[clamped];
    if (id && getLastLayout()?.rects.has(id)) useStore.getState().select(id);
  }, [open, results, clamped]);

  if (!open || !doc) return null;

  const close = () => {
    useStore.getState().closeSearch();
    getCanvasHost()?.focus();
  };

  const jumpTo = (id: string) => {
    const s = useStore.getState();
    s.runCommand('expand', (d) => expandAncestors(d, id));
    s.select(id);
    close();
  };

  const pinFilter = () => {
    useStore.getState().setFilterQuery(query.trim() || null);
    close();
  };

  const cancel = () => {
    const s = useStore.getState();
    const back = returnToRef.current;
    if (back && s.doc?.nodes[back]) s.select(back);
    close();
  };

  const move = (dir: 1 | -1) => {
    if (results.length > 0) setActive((clamped + dir + results.length) % results.length);
  };

  return (
    <div
      className="search-panel"
      onKeyDown={(e) => {
        e.stopPropagation(); // the canvas must not see keys typed here
        if (e.key === 'Escape') {
          e.preventDefault();
          cancel();
        } else if (e.key === 'Enter' && e.shiftKey) {
          e.preventDefault();
          pinFilter();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (results[clamped]) jumpTo(results[clamped]);
          else close();
        } else if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
          e.preventDefault();
          move(1);
        } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) {
          e.preventDefault();
          move(-1);
        }
      }}
    >
      <input
        ref={inputRef}
        className="search-input"
        value={query}
        placeholder="Search nodes — text and #tags"
        onChange={(e) => {
          useStore.getState().setSearchQuery(e.target.value);
          setActive(0);
        }}
      />
      {query.trim() !== '' && (
        <>
          <div className="search-results">
            {results.slice(0, MAX_ROWS).map((id, i) => {
              const node = doc.nodes[id];
              const parentText = parents[id] ? doc.nodes[parents[id]]?.text : null;
              const hidden = !getLastLayout()?.rects.has(id);
              return (
                <div
                  key={id}
                  className={`search-row${i === clamped ? ' active' : ''}`}
                  onMouseDown={(e) => {
                    e.preventDefault(); // keep focus in the input
                    jumpTo(id);
                  }}
                >
                  <span className="search-row-text">
                    {node.icon ? `${node.icon} ` : ''}
                    {node.text.trim() || '(empty node)'}
                  </span>
                  <span className="search-row-path">
                    {hidden ? '⊕ ' : ''}
                    {parentText ? `in ${parentText}` : 'root'}
                  </span>
                </div>
              );
            })}
            {results.length === 0 && <div className="search-empty">No matches in view.</div>}
          </div>
          <div className="search-footer">
            {results.length > MAX_ROWS ? `${results.length} matches (first ${MAX_ROWS})` : `${results.length} match${results.length === 1 ? '' : 'es'}`}
            {' · Enter jump · ⇧Enter pin filter · Esc close'}
          </div>
        </>
      )}
    </div>
  );
}
