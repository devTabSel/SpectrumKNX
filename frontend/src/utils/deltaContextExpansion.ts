// Time-Delta-Context expansion (#309/#318/#319/#380): given which telegrams
// already match the active filters, keep those matches visible and optionally
// pull in every other telegram that counts as "context" for one of several
// reasons — currently a Time-Delta-Context window around a flagged message,
// or being individually marked in another main panel (marks are lifted
// app-wide, so a row marked from the Visualizer, Last Seen, etc. always stays
// visible here too, independent of the delta-context window/toggle).

interface Timestamped {
  timestamp: string;
}

/** Why a row is present despite not matching the active filters. Extensible:
 * new reasons (e.g. tagged from another main panel) can be added here. */
export type ContextReason = 'delta' | 'marked' | 'visualization';

export interface DeltaExpansionResult<T> {
  /** The full visible set: filter matches, flagged anchors, marked rows, and pulled-in context rows. */
  items: T[];
  /** Identity keys (via `anchorKeyOf`) of items present only because of a
   * context reason, not because they matched the primary filter — mapped to
   * that reason for distinct visual treatment (#343, #380). A marked row
   * always wins the reason over a delta-context window it also falls into. */
  contextReasons: Map<string, ContextReason>;
}

const EMPTY_CONTEXT_REASON_MAP: ReadonlyMap<string, Exclude<ContextReason, 'delta'>> = new Map();

/**
 * @param items The full (already sorted) buffer.
 * @param matches Per-item result of the primary filter match, same order as `items`.
 * @param anchorKeyOf Stable per-item identity, for testing `flaggedKeys`/`markedKeys` membership.
 * @param flaggedKeys Keys of telegrams individually flagged as context anchors.
 *   Only rows that are both flagged and currently matched can anchor context.
 * @param beforeMs / @param afterMs The effective (already #318-gated) window.
 * @param forcedContextReasons Keys of telegrams that must remain visible with a
 *   non-delta reason (e.g. marked in another panel or navigated from the
 *   visualization). These also count as visible anchors for delta expansion,
 *   and take priority over a 'delta' reason.
 */
export function expandWithDeltaContext<T extends Timestamped>(
  items: T[],
  matches: boolean[],
  anchorKeyOf: (t: T) => string,
  flaggedKeys: ReadonlySet<string>,
  beforeMs: number,
  afterMs: number,
  forcedContextReasons: ReadonlyMap<string, Exclude<ContextReason, 'delta'>> = EMPTY_CONTEXT_REASON_MAP,
): DeltaExpansionResult<T> {
  const hasWindow = beforeMs > 0 || afterMs > 0;
  const contextAnchor = items.map((t, i) => {
    const key = anchorKeyOf(t);
    return flaggedKeys.has(key) && (matches[i] || forcedContextReasons.has(key));
  });
  const anchorTimestamps = hasWindow
    ? items.filter((_, i) => contextAnchor[i]).map(t => new Date(t.timestamp).getTime())
    : [];

  const contextReasons = new Map<string, ContextReason>();
  const kept: T[] = [];

  for (let i = 0; i < items.length; i++) {
    const t = items[i];
    const key = anchorKeyOf(t);
    const forcedReason = forcedContextReasons.get(key);

    // A visualization-navigation target keeps its reason (and thus its
    // indicator) even when it also matches the active filters — the click
    // target must always be identifiable in the list, real match or not.
    if (forcedReason === 'visualization') {
      contextReasons.set(key, forcedReason);
    }

    if (matches[i]) {
      kept.push(t);
      continue;
    }

    if (forcedReason) {
      contextReasons.set(key, forcedReason);
      kept.push(t);
      continue;
    }

    if (hasWindow) {
      const ts = new Date(t.timestamp).getTime();
      const withinWindow = anchorTimestamps.some(anchorTs => ts >= anchorTs - beforeMs && ts <= anchorTs + afterMs);
      if (withinWindow) {
        contextReasons.set(key, 'delta');
        kept.push(t);
      }
    }
  }

  return { items: kept, contextReasons };
}
