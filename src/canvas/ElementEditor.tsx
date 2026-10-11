import { useEffect, useRef, useState } from 'react';
import type { Rect } from '../layout/layout';
import * as cmd from '../state/commands';
import { useStore } from '../state/store';

interface ElementEditorProps {
  elementId: string;
  rect: Rect;
  onDone(): void;
}

/** Inline text editor over a canvas element. Enter commits (⇧Enter = newline), Esc too. */
export function ElementEditor({ elementId, rect, onDone }: ElementEditorProps) {
  const viewport = useStore((s) => s.viewport);
  const el = useStore((s) => s.doc?.elements.find((e) => e.id === elementId));
  const [text, setText] = useState(el?.text ?? '');
  const ref = useRef<HTMLTextAreaElement>(null);
  const committed = useRef(false);
  const textRef = useRef(text);
  textRef.current = text;

  const save = (value: string) => {
    if (committed.current) return;
    committed.current = true;
    const s = useStore.getState();
    s.setEditingElement(null);
    if (s.doc?.elements.some((e) => e.id === elementId)) {
      s.runCommand('editElementText', (d) => cmd.editElement(d, elementId, { text: value.trim() }));
    }
  };

  useEffect(() => {
    const t = ref.current;
    if (!t) return;
    t.focus();
    t.setSelectionRange(t.value.length, t.value.length);
  }, []);

  // Unmounting mid-edit (navigation, AI deleted it) must not lose the text.
  useEffect(() => () => save(textRef.current), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = ref.current;
    if (!t) return;
    t.style.height = 'auto';
    t.style.height = `${Math.max(t.scrollHeight, rect.h)}px`;
  }, [text, rect.h]);

  const commit = () => {
    save(text);
    onDone();
  };

  return (
    <textarea
      ref={ref}
      className={`element-editor element-text kind-${el?.kind ?? 'text'}`}
      value={text}
      placeholder={el?.kind === 'sticky' ? 'Note…' : 'Text…'}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Escape') {
          e.preventDefault();
          commit();
        }
      }}
      style={{
        left: viewport.x + rect.x * viewport.zoom,
        top: viewport.y + rect.y * viewport.zoom,
        width: rect.w,
        minHeight: rect.h,
        transform: `scale(${viewport.zoom})`,
        transformOrigin: '0 0',
      }}
    />
  );
}
