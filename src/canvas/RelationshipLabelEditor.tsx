import * as cmd from '../state/commands';
import { useStore } from '../state/store';
import { LabelEditor } from './LabelEditor';

interface RelationshipLabelEditorProps {
  relId: string;
  /** World-space midpoint of the arrow's curve. */
  mid: { x: number; y: number };
  onDone(): void;
}

export function RelationshipLabelEditor({ relId, mid, onDone }: RelationshipLabelEditorProps) {
  const label = useStore((s) => s.doc?.relationships.find((r) => r.id === relId)?.label ?? '');
  return (
    <LabelEditor
      current={label}
      at={mid}
      clear={() => useStore.getState().setEditingRel(null)}
      commit={(text) =>
        useStore.getState().runCommand('setRelationshipLabel', (d) => cmd.setRelationshipLabel(d, relId, text))
      }
      onDone={onDone}
    />
  );
}
