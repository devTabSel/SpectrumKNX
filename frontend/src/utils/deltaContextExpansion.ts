// Time-Delta-Context expansion (#309/#318/#319): given which telegrams
// already match the active filters, pull in every other telegram within a
// before/after window around each matching (or per-message-flagged) telegram
// — even though it wouldn't otherwise pass the filter. Shared by the live
// Group Monitor and History Search views so the algorithm can't drift.

interface Timestamped {
  timestamp: string;
}

export interface DeltaExpansionResult<T> {
  /** The full visible set: filter matches, flagged anchors, and pulled-in context rows. */
  items: T[];
  /** Identity keys (via `anchorKeyOf`) of rows that did not match the filter:
   * neighbours pulled into a window, and flagged non-matches. A flag anchors a
   * window around that row without promoting it out of the context colour (#343). */
  contextKeys: Set<string>;
}

/**
 * @param items The full (already sorted) buffer.
 * @param matches Per-item result of the primary filter match, same order as `items`.
 * @param anchorKeyOf Stable per-item identity, for testing `flaggedKeys` membership.
 * @param flaggedKeys Keys of telegrams individually flagged to anchor a context
 *   window around themselves (#319), regardless of the primary filter. A flag
 *   keeps a non-match only while `beforeMs` or `afterMs` is positive.
 * @param beforeMs / @param afterMs The effective (already #318-gated) window.
 * @param anchorMatches Whether every filter match anchors a window (the global
 *   "all" state). When false only the flagged telegrams do, so the context can
 *   be limited to single messages (#319); matches are shown either way.
 */
export function expandWithDeltaContext<T extends Timestamped>(
  items: T[],
  matches: boolean[],
  anchorKeyOf: (t: T) => string,
  flaggedKeys: ReadonlySet<string>,
  beforeMs: number,
  afterMs: number,
  anchorMatches = true,
): DeltaExpansionResult<T> {
  // A flag anchors a window and keeps a non-match only while a window is open.
  // With no window there is no context to add, so the flag does not keep the
  // row the way a mark would. A flagged non-match stays a context row.
  const windowOpen = beforeMs > 0 || afterMs > 0;
  const flagged = items.map(t => windowOpen && flaggedKeys.has(anchorKeyOf(t)));
  const effectiveMatch = items.map((_, i) => matches[i] || flagged[i]);

  if (beforeMs <= 0 && afterMs <= 0) {
    return { items: items.filter((_, i) => effectiveMatch[i]), contextKeys: new Set() };
  }

  const anchorTimestamps = items
    .filter((_, i) => flagged[i] || (anchorMatches && matches[i]))
    .map(t => new Date(t.timestamp).getTime());

  if (anchorTimestamps.length === 0) {
    return { items: items.filter((_, i) => effectiveMatch[i]), contextKeys: new Set() };
  }

  const contextKeys = new Set<string>();
  const kept = items.filter((t, i) => {
    if (matches[i]) return true;
    const ts = new Date(t.timestamp).getTime();
    const within = anchorTimestamps.some(mts => ts >= mts - beforeMs && ts <= mts + afterMs);
    // A flagged non-match is inside its own window, so it stays a context row
    // while the same window reaches neighbours the original anchor did not.
    if (within || flagged[i]) contextKeys.add(anchorKeyOf(t));
    return within || flagged[i];
  });
  return { items: kept, contextKeys };
}

/**
 * Stripe marks stay in the list when the focus or quick filter would hide them,
 * but that keep is not a filter match. Folding it into the match flags would
 * drop a context-only telegram out of `contextKeys` and make it anchor a window
 * of its own. A mouse selection is not a mark and is never kept this way.
 * The panel filter still applies: a kept row the panel rejects stays out.
 */
export function retainKeptRows<T>(
  items: T[],
  expanded: DeltaExpansionResult<T>,
  anchorKeyOf: (t: T) => string,
  kept: ReadonlySet<string>,
  panelPass: (t: T) => boolean,
): DeltaExpansionResult<T> {
  if (kept.size === 0) return expanded;
  const visible = new Set(expanded.items.map(anchorKeyOf));
  let added = false;
  for (const t of items) {
    const key = anchorKeyOf(t);
    if (visible.has(key) || !kept.has(key) || !panelPass(t)) continue;
    visible.add(key);
    added = true;
  }
  if (!added) return expanded;
  return {
    items: items.filter(t => visible.has(anchorKeyOf(t))),
    contextKeys: expanded.contextKeys,
  };
}
