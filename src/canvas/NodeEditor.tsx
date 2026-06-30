import { useEffect, useRef, useState } from 'react';
import type { Rect } from '../layout/layout';
import { measureRawText } from '../layout/measure';
import { useStore, type EditingState } from '../state/store';

interface NodeEditorProps {
  editing: EditingState;
  rect: Rect;
  onDone(): void;
}

export function NodeEditor({ editing, rect, onDone }: NodeEditorProps) {
  const viewport = useStore((s) => s.viewport);
  const node = useStore((s) => s.doc?.nodes[editing.nodeId]);
  const [text, setText] = useState(() =>
    editing.mode === 'append' ? (node?.text ?? '') : (editing.seed ?? ''),
  );
  const ref = useRef<HTMLTextAreaElement>(null);
  const committed = useRef(false);
  const textRef = useRef(text);
  textRef.current = text;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  // Unmounting mid-edit (e.g. navigating away) must not lose the text.
  useEffect(() => {
    return () => {
      if (committed.current) return;
      committed.current = true;
      useStore.getState().commitEdit(textRef.current.trim());
    };
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  const commit = () => {
    if (committed.current) return;
    committed.current = true;
    useStore.getState().commitEdit(text.trim());
    onDone();
  };

  const width = Math.max(rect.w, measureRawText(text).w);
  return (
    <textarea
      ref={ref}
      className="node-editor"
      value={text}
      rows={1}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        // Shift+Enter falls through to the textarea and inserts a newline.
        if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Escape') {
          e.preventDefault();
          commit();
        }
      }}
      style={{
        left: viewport.x + rect.x * viewport.zoom,
        top: viewport.y + rect.y * viewport.zoom,
        width,
        minHeight: rect.h,
        transform: `scale(${viewport.zoom})`,
        transformOrigin: '0 0',
      }}
    />
  );
}
