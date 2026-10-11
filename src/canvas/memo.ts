/**
 * memo() comparator that ignores function props. Canvas views get fresh
 * inline handlers every render, but those handlers read live state through
 * useStore.getState()/refs (never render-time closures), so a stale handler
 * behaves identically — and skipping them lets a pan or a selection change
 * re-render only the views whose data actually changed.
 */
export function sameDataProps<P extends object>(a: P, b: P): boolean {
  for (const key of Object.keys(a) as (keyof P)[]) {
    if (typeof a[key] === 'function') continue;
    if (!Object.is(a[key], b[key])) return false;
  }
  return Object.keys(a).length === Object.keys(b).length;
}
