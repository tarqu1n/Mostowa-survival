import { useEffect, useState } from 'react';

/**
 * Single responsive breakpoint for the editor (plan 027, Step 1). "Compact" means the editor should
 * switch to its touch/phone shell — side panels become slide-in drawers (Step 8), the toolbar reflows
 * (Step 6), and the per-tool context bar appears (Step 9).
 *
 * We treat two situations as compact:
 *   - a genuinely narrow viewport (portrait phone through small tablet: `max-width: 960px`), OR
 *   - a coarse pointer (touch) on anything up to a small tablet (`(pointer: coarse) and
 *     (max-width: 1200px)`) — a phone in landscape can exceed 960px yet is still touch-first.
 * A phone-portrait width (~390–430px) is comfortably under the first clause, so it always reads
 * compact regardless of pointer reporting.
 *
 * SSR-safe: defaults to `false` (desktop) when `window`/`matchMedia` is unavailable.
 */
export const COMPACT_QUERY = '(max-width: 960px), (pointer: coarse) and (max-width: 1200px)';

export function useIsCompact(): boolean {
  const [isCompact, setIsCompact] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(COMPACT_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(COMPACT_QUERY);
    const onChange = (): void => setIsCompact(mql.matches);
    onChange(); // sync in case the query changed between initial render and effect
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  return isCompact;
}
