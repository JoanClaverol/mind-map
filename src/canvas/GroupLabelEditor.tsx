import * as cmd from '../state/commands';
import { useStore } from '../state/store';
import { LabelEditor } from './LabelEditor';

interface GroupLabelEditorProps {
  groupId: string;
  /** World-space anchor of the group hull (its topmost point). */
  anchor: { x: number; y: number };
  onDone(): void;
}

export function GroupLabelEditor({ groupId, anchor, onDone }: GroupLabelEditorProps) {
  const label = useStore((s) => s.doc?.groups.find((g) => g.id === groupId)?.label ?? '');
  return (
    <LabelEditor
      current={label}
      at={anchor}
      clear={() => useStore.getState().setEditingGroup(null)}
      commit={(text) => useStore.getState().runCommand('setGroupLabel', (d) => cmd.setGroupLabel(d, groupId, text))}
      onDone={onDone}
    />
  );
}
