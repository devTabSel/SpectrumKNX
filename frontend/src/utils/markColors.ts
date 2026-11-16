/**
 * Per-telegram colour index for list rows — parallel to mark reasons.
 * Indices refer into MARK_COLOR_PALETTE; null / missing means no colour.
 */

/** Distinct on light and dark themes (same set the active-filter swatches used). */
export const MARK_COLOR_PALETTE = [
  '#3b82f6', // blue
  '#ef4444', // red
  '#eab308', // yellow
  '#22c55e', // green
  '#a855f7', // purple
  '#f97316', // orange
  '#14b8a6', // teal
] as const;

export type MarkColorIndex = number;

/** Per-telegram colour index (anchorKey → palette index). */
export type MarkColorIndexMap = Record<string, MarkColorIndex>;

export function isValidMarkColorIndex(index: unknown): index is MarkColorIndex {
  return typeof index === 'number'
    && Number.isInteger(index)
    && index >= 0
    && index < MARK_COLOR_PALETTE.length;
}

/** Resolve a stored index to a CSS colour, or undefined if unset/invalid. */
export function markColorFromIndex(index: MarkColorIndex | null | undefined): string | undefined {
  if (!isValidMarkColorIndex(index)) return undefined;
  return MARK_COLOR_PALETTE[index];
}

export function getMarkColorIndex(
  map: MarkColorIndexMap,
  key: string,
): MarkColorIndex | undefined {
  const index = map[key];
  return isValidMarkColorIndex(index) ? index : undefined;
}

/** Set or clear (`null`) the colour index for `key`. */
export function setMarkColorIndex(
  map: MarkColorIndexMap,
  key: string,
  index: MarkColorIndex | null,
): MarkColorIndexMap {
  if (index === null) {
    if (!(key in map)) return map;
    const next = { ...map };
    delete next[key];
    return next;
  }
  if (!isValidMarkColorIndex(index)) return map;
  if (map[key] === index) return map;
  return { ...map, [key]: index };
}

/**
 * Advance the colour of `key`: none → first free index among `inUse`, then
 * through the palette, then back to none (`null`).
 */
export function nextMarkColorIndex(
  map: MarkColorIndexMap,
  key: string,
  inUse: Iterable<string> = Object.keys(map),
): MarkColorIndex | null {
  const own = getMarkColorIndex(map, key);
  if (own === undefined) {
    const taken = new Set<MarkColorIndex>();
    for (const k of inUse) {
      if (k === key) continue;
      const idx = getMarkColorIndex(map, k);
      if (idx !== undefined) taken.add(idx);
    }
    for (let i = 0; i < MARK_COLOR_PALETTE.length; i++) {
      if (!taken.has(i)) return i;
    }
    return 0;
  }
  return own === MARK_COLOR_PALETTE.length - 1 ? null : own + 1;
}

/** Cycle the colour index for `key` (none → … → none). */
export function cycleMarkColorIndex(
  map: MarkColorIndexMap,
  key: string,
  inUse?: Iterable<string>,
): MarkColorIndexMap {
  return setMarkColorIndex(map, key, nextMarkColorIndex(map, key, inUse));
}

/** Drop every colour index. */
export function clearAllMarkColorIndices(map: MarkColorIndexMap): MarkColorIndexMap {
  return Object.keys(map).length === 0 ? map : {};
}
