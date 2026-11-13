import type { Telegram } from '../hooks/useWebSocket';
import { anchorKey } from './anchorKey';
import { expandWithDeltaContext } from './deltaContextExpansion';
import { forceIncludeKeys } from './forceIncludeKeys';
import { visibleMarkedKeysFrom, type MarkReasonsMap } from './markReasons';
import { activeQuickFilter, type QuickPatterns } from './quickFilter';
import {
  effectiveDeltaContext,
  matchesTelegram,
  type ActiveFilters,
} from '../types/filters';

const EMPTY_KEY_SET: ReadonlySet<string> = new Set();

export interface SelectVisibleOpts {
  /** Applied filters (typically already through `enabledFilters`). */
  filters: ActiveFilters;
  /** Master filter toggle (#370). When false, every row matches. */
  filtersEnabled: boolean;
  quickFilterOpen: boolean;
  quickFilterEnabled: boolean;
  quickPatterns: QuickPatterns;
  flaggedKeys: readonly string[];
  contextForAllMatches: boolean;
  markReasons: MarkReasonsMap;
}

/**
 * Main-filter + QF-anchor + Time-Delta-Context expand + force-include of
 * non-hidden marks. `sorted` must already be in display sort order.
 */
export function selectVisibleTelegrams(
  sorted: readonly Telegram[],
  opts: SelectVisibleOpts,
): { items: Telegram[]; contextKeys: Set<string> } {
  const f = opts.filters;
  const noFilter =
    !opts.filtersEnabled ||
    (f.sources.length === 0 &&
      f.targets.length === 0 &&
      f.types.length === 0 &&
      f.directions.length === 0 &&
      f.dpts.length === 0);

  const quick = activeQuickFilter(opts.quickFilterOpen, opts.quickFilterEnabled, opts.quickPatterns);
  const matches = sorted.map(t =>
    (noFilter || matchesTelegram(t, f)) && (!quick || quick(t)),
  );

  const { before, after } = effectiveDeltaContext(f);
  const flags = f.deltaContextEnabled ? new Set(opts.flaggedKeys) : EMPTY_KEY_SET;

  const expanded = expandWithDeltaContext(
    sorted, matches, anchorKey, flags, before, after, opts.contextForAllMatches,
  );
  const forcedMarks = new Set(visibleMarkedKeysFrom(opts.markReasons));
  return {
    items: forceIncludeKeys(sorted, expanded.items, anchorKey, forcedMarks),
    contextKeys: expanded.contextKeys,
  };
}
