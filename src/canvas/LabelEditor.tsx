import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';

interface LabelEditorProps {
  /** The item's live label — compared against the input so unchanged text is a no-op. */
  current: string;
  /** World-space point the editor floats over. */
  at: { x: number; y: number };
  /** Clear the store's editing flag (called exactly once, before commit). */
  clear(): void;
  /** Persist the new label (the command trims it). */
  commit(text: string): void;
  /** Refocus the canvas after an explicit commit (not after an unmount flush). */
  onDone(): void;
}

/**
 * The floating one-line label input shared by relationship arrows and group
 * boundaries. Enter/Escape/blur commit; unmounting mid-edit (the labeled item
 * vanished under us) still flushes the text.
 */
export function LabelEditor({ current, at, clear, commit, onDone }: LabelEditorProps) {
  const viewport = useStore((s) => s.viewport);
  const [text, setText] = useState(() => current);
  const ref = useRef<HTMLInputElement>(null);
  const committed = useRef(false);
  const latest = useRef({ current, text, clear, commit });
  latest.current = { current, text, clear, commit };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  const flush = () => {
    if (committed.current) return false;
    committed.current = true;
    const l = latest.current;
    l.clear();
    if (l.current !== l.text.trim()) l.commit(l.text);
    return true;
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => void flush(), []);

  return (
    <input
      ref={ref}
      className="rel-label-editor"
      value={text}
      placeholder="label…"
      onChange={(e) => setText(e.target.value)}
      onBlur={() => flush() && onDone()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault();
          if (flush()) onDone();
        }
      }}
      style={{
        left: viewport.x + at.x * viewport.zoom,
        top: viewport.y + at.y * viewport.zoom,
        transform: `translate(-50%, -50%) scale(${viewport.zoom})`,
        transformOrigin: 'center',
      }}
    />
  );
}
