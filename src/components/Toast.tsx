import { useStore } from '../state/store';

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => useStore.getState().dismissToast(t.id)}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
