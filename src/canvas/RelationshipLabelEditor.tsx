import { useEffect, useRef, useState } from 'react';
import * as cmd from '../state/commands';
import { useStore } from '../state/store';

interface RelationshipLabelEditorProps {
  relId: string;
  /** World-space midpoint of the arrow's curve. */
  mid: { x: number; y: number };
  onDone(): void;
}

export function RelationshipLabelEditor({ relId, mid, onDone }: RelationshipLabelEditorProps) {
  const viewport = useStore((s) => s.viewport);
  const rel = useStore((s) => s.doc?.relationships.find((r) => r.id === relId));
  const [text, setText] = useState(() => rel?.label ?? '');
  const ref = useRef<HTMLInputElement>(null);
  const committed = useRef(false);
  const textRef = useRef(text);
  textRef.current = text;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, []);

  const commit = () => {
    if (committed.current) return;
    committed.current = true;
    useStore.getState().setEditingRel(null);
    if ((rel?.label ?? '') !== textRef.current.trim()) {
      useStore.getState().runCommand('setRelationshipLabel', (d) =>
        cmd.setRelationshipLabel(d, relId, textRef.current),
      );
    }
    onDone();
  };

  // Unmounting mid-edit (e.g. the arrow vanished) must still flush the text.
  useEffect(() => {
    return () => {
      if (committed.current) return;
      committed.current = true;
      const s = useStore.getState();
      s.setEditingRel(null);
      if ((s.doc?.relationships.find((r) => r.id === relId)?.label ?? '') !== textRef.current.trim()) {
        s.runCommand('setRelationshipLabel', (d) => cmd.setRelationshipLabel(d, relId, textRef.current));
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <input
      ref={ref}
      className="rel-label-editor"
      value={text}
      placeholder="label…"
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault();
          commit();
        }
      }}
      style={{
        left: viewport.x + mid.x * viewport.zoom,
        top: viewport.y + mid.y * viewport.zoom,
        transform: `translate(-50%, -50%) scale(${viewport.zoom})`,
        transformOrigin: 'center',
      }}
    />
  );
}
