// Time-Delta-Context expansion (#309/#318/#319): given which telegrams
// already match the active filters, keep those matches visible and optionally
// pull in every other telegram within a before/after window around each
// per-message-flagged telegram — even though it wouldn't otherwise pass the
// filter. Shared by the live Group Monitor and History Search views so the
// algorithm can't drift.

interface Timestamped {
  timestamp: string;
}

export interface DeltaExpansionResult<T> {
  /** The full visible set: filter matches, flagged anchors, and pulled-in context rows. */
  items: T[];
  /** Identity keys (via `anchorKeyOf`) of items present only because they fell
   * within a window — i.e. they did not match the primary filter. A flagged
   * message can still be listed here when it also falls into another flagged
   * message's context window.
   * Used to visually mark context-only rows (#343). */
  contextKeys: Set<string>;
}

/**
 * @param items The full (already sorted) buffer.
 * @param matches Per-item result of the primary filter match, same order as `items`.
 * @param anchorKeyOf Stable per-item identity, for testing `flaggedKeys` membership.
 * @param flaggedKeys Keys of telegrams individually flagged to always anchor a
 *   context window around themselves (#319), regardless of the primary filter.
 * @param beforeMs / @param afterMs The effective (already #318-gated) window.
 */
export function expandWithDeltaContext<T extends Timestamped>(
  items: T[],
  matches: boolean[],
  anchorKeyOf: (t: T) => string,
  flaggedKeys: ReadonlySet<string>,
  beforeMs: number,
  afterMs: number,
): DeltaExpansionResult<T> {
  // A flagged telegram is always shown and anchors its own context window,
  // independent of whether it passes the primary filter.
  const visibleMatch = items.map((t, i) => matches[i] || flaggedKeys.has(anchorKeyOf(t)));
  const contextAnchor = items.map(t => flaggedKeys.has(anchorKeyOf(t)));

  if (beforeMs <= 0 && afterMs <= 0) {
    return { items: items.filter((_, i) => visibleMatch[i]), contextKeys: new Set() };
  }

  const anchorEntries = items
    .filter((_, i) => contextAnchor[i])
    .map(t => ({ key: anchorKeyOf(t), ts: new Date(t.timestamp).getTime() }));

  if (anchorEntries.length === 0) {
    return { items: items.filter((_, i) => visibleMatch[i]), contextKeys: new Set() };
  }

  const contextKeys = new Set<string>();
  const kept = items.filter((t, i) => {
    const key = anchorKeyOf(t);
    const ts = new Date(t.timestamp).getTime();
    const withinAnotherAnchor = anchorEntries.some(anchor => anchor.key !== key && ts >= anchor.ts - beforeMs && ts <= anchor.ts + afterMs);
    const withinOwnOrAnotherAnchor = anchorEntries.some(anchor => ts >= anchor.ts - beforeMs && ts <= anchor.ts + afterMs);
    if (!matches[i] && withinAnotherAnchor) contextKeys.add(key);
    if (visibleMatch[i]) return true;
    if (!matches[i] && withinOwnOrAnotherAnchor) contextKeys.add(key);
    return withinOwnOrAnotherAnchor;
  });
  return { items: kept, contextKeys };
}
