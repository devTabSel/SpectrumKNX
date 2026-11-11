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
  /**
   * Identity keys of visible rows that do **not** match the primary filter.
   * Independent of per-row context flags: flagging anchors a window around a
   * row but must not change whether that row is classified as context (#343).
   */
  contextKeys: Set<string>;
}

/**
 * @param items The full (already sorted) buffer.
 * @param matches Per-item result of the primary filter match, same order as `items`.
 * @param anchorKeyOf Stable per-item identity, for testing `flaggedKeys` membership.
 * @param flaggedKeys Keys of telegrams individually flagged to always anchor a
 *   context window around themselves (#319), regardless of the primary filter.
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
  // A flagged telegram is always shown and always anchors its own window,
  // independent of whether it passes the primary filter.
  const flagged = items.map(t => flaggedKeys.has(anchorKeyOf(t)));
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
    // Filter matches are never context rows.
    if (matches[i]) return true;
    // Flagged non-matches stay visible and still count as context — the flag
    // only adds an anchor window, it does not clear context classification.
    if (flagged[i]) {
      contextKeys.add(anchorKeyOf(t));
      return true;
    }
    const ts = new Date(t.timestamp).getTime();
    const within = anchorTimestamps.some(mts => ts >= mts - beforeMs && ts <= mts + afterMs);
    if (within) contextKeys.add(anchorKeyOf(t));
    return within;
  });
  return { items: kept, contextKeys };
}

/** Whether a context row sits before (∧) and/or after (∨) active context anchors. */
export interface ContextRailSigns {
  /** Row is older than an anchor and inside that anchor's before-window → rail ∧. */
  before: boolean;
  /** Row is newer than an anchor and inside that anchor's after-window → rail ∨. */
  after: boolean;
}

/**
 * Rail ∧/∨ for a context-only row relative to telegrams that currently anchor
 * a context window (active context button / all-matches). A row can be before
 * one anchor and after another at the same time.
 */
export function contextRailSigns(
  rowTs: number,
  anchorTimestamps: readonly number[],
  beforeMs: number,
  afterMs: number,
): ContextRailSigns {
  let before = false;
  let after = false;
  for (const ats of anchorTimestamps) {
    if (beforeMs > 0 && rowTs < ats && rowTs >= ats - beforeMs) before = true;
    if (afterMs > 0 && rowTs > ats && rowTs <= ats + afterMs) after = true;
    if (before && after) break;
  }
  return { before, after };
}
