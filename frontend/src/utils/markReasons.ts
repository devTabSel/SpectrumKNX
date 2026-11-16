/** Row flags that used to be mark reasons. A row is marked or mouse-selected independently. */

export function addKeys(keys: readonly string[], extra: Iterable<string>): string[] {
  const have = new Set(keys);
  let next: string[] | null = null;
  for (const key of extra) {
    if (!key || have.has(key)) continue;
    have.add(key);
    if (!next) next = keys.slice();
    next.push(key);
  }
  return next ?? (keys as string[]);
}

export function removeKeys(keys: readonly string[], drop: Iterable<string>): string[] {
  const gone = drop instanceof Set ? drop : new Set(drop);
  if (gone.size === 0) return keys as string[];
  const next = keys.filter(key => !gone.has(key));
  return next.length === keys.length ? (keys as string[]) : next;
}

export function toggleKey(keys: readonly string[], key: string): string[] {
  return keys.includes(key) ? keys.filter(k => k !== key) : [...keys, key];
}

/** The list is exactly `next`, in that order, without duplicates. */
export function soleKeys(next: Iterable<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const key of next) {
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

export interface LegacyMarkFlags {
  markedKeys: string[];
  mouseSelectedKeys: string[];
  hiddenKeys: string[];
}

/**
 * Split a stored reason map. `manual` becomes the marked flag, `mouse` the
 * selection flag, `hidden` the hide flag. `goto`, `auto`, and `context` are
 * not reasons anymore and are dropped.
 */
export function splitLegacyMarkReasons(raw: unknown): LegacyMarkFlags {
  const markedKeys: string[] = [];
  const mouseSelectedKeys: string[] = [];
  const hiddenKeys: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { markedKeys, mouseSelectedKeys, hiddenKeys };
  }
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (!key || !Array.isArray(val)) continue;
    const reasons = val.filter((r): r is string => typeof r === 'string');
    if (reasons.includes('manual')) markedKeys.push(key);
    if (reasons.includes('mouse')) mouseSelectedKeys.push(key);
    if (reasons.includes('hidden')) hiddenKeys.push(key);
  }
  return { markedKeys, mouseSelectedKeys, hiddenKeys };
}
