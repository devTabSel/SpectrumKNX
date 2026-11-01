import { useRef } from 'react';

/**
 * While `active` is on, a key that is checked joins the set and stays there
 * after it is unchecked. Turning the mode off clears the set.
 *
 * `seed` is false for Verdichten: checks that already exist when the mode
 * turns on do not join. A key joins only when it is checked or unchecked
 * while the mode is already on.
 */
export function useStickyChecked(active: boolean, checked: readonly string[], seed = true): Set<string> {
  const kept = useRef(new Set<string>());
  const wasActive = useRef(false);
  const seen = useRef<readonly string[]>([]);

  if (!active) {
    if (wasActive.current) kept.current = new Set();
    wasActive.current = false;
    seen.current = checked;
    return kept.current;
  }

  if (!wasActive.current) {
    kept.current = new Set(seed ? checked : []);
    wasActive.current = true;
    seen.current = checked;
    return kept.current;
  }

  if (!seed) {
    const now = new Set(checked);
    const next = new Set(kept.current);
    let changed = false;
    for (const key of seen.current) {
      if (!now.has(key) && !next.has(key)) {
        next.add(key);
        changed = true;
      }
    }
    for (const key of checked) {
      if (!seen.current.includes(key) && !next.has(key)) {
        next.add(key);
        changed = true;
      }
    }
    if (changed) kept.current = next;
  } else {
    for (const key of checked) kept.current.add(key);
  }
  seen.current = checked;
  return kept.current;
}
