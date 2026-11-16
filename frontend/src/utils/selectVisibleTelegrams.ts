import type { Telegram } from '../hooks/useWebSocket';
import { anchorKey } from './anchorKey';
import { expandWithDeltaContext, type IndividualContextWindows } from './deltaContextExpansion';
import { forceIncludeKeys } from './forceIncludeKeys';
import { addKeys } from './markReasons';
import { activeQuickFilter, type QuickFilterColumnEnabled, type QuickPatterns } from './quickFilter';
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
  quickColumnEnabled?: QuickFilterColumnEnabled;
  flaggedKeys: readonly string[];
  contextForAllMatches: boolean;
  /** Per-row before/after in ms. Applied only while Time-Delta-Context is on. */
  individualContextWindows?: IndividualContextWindows;
  /** Marked rows, the mouse selection, and the last selected row stay in the list. */
  markedKeys: readonly string[];
  mouseSelectedKeys: readonly string[];
  lastSelectedKey: string | null;
}

function noMainFilter(opts: SelectVisibleOpts): boolean {
  const f = opts.filters;
  return !opts.filtersEnabled ||
    (f.sources.length === 0 &&
      f.targets.length === 0 &&
      f.types.length === 0 &&
      f.directions.length === 0 &&
      f.dpts.length === 0);
}

/**
 * How a live prepend can update the visible list.
 * `identity` — every row stays, return the sorted array itself.
 * `incremental` — window is off and nothing pulls older rows back in, so only
 * the new and dropped rows need the predicate.
 * `full` — a delta window or force-include can change rows that were already published.
 */
export function visibleSelectionMode(opts: SelectVisibleOpts): 'identity' | 'incremental' | 'full' {
  const { before, after } = effectiveDeltaContext(opts.filters);
  const marks = opts.markedKeys.length > 0 || opts.mouseSelectedKeys.length > 0 || opts.lastSelectedKey != null;
  const flags = opts.filters.deltaContextEnabled && opts.flaggedKeys.length > 0;
  const individual = opts.filters.deltaContextEnabled
    && !!opts.individualContextWindows
    && Object.keys(opts.individualContextWindows).length > 0;
  if (before > 0 || after > 0 || marks || flags || individual) return 'full';
  const quick = activeQuickFilter(opts.quickFilterOpen, opts.quickFilterEnabled, opts.quickPatterns, opts.quickColumnEnabled);
  if (noMainFilter(opts) && !quick) return 'identity';
  return 'incremental';
}

/** Primary match for an incremental prepend. Ignores delta windows and marks. */
export function matchVisibleTelegram(opts: SelectVisibleOpts): (t: Telegram) => boolean {
  const f = opts.filters;
  const noFilter = noMainFilter(opts);
  const quick = activeQuickFilter(opts.quickFilterOpen, opts.quickFilterEnabled, opts.quickPatterns, opts.quickColumnEnabled);
  if (noFilter && !quick) return () => true;
  return (t) => (noFilter || matchesTelegram(t, f)) && (!quick || quick(t));
}

/**
 * Main-filter + QF-anchor + Time-Delta-Context expand + force-include of
 * marked, mouse-selected, and last-selected rows. `sorted` must already be in display sort order.
 */
export function selectVisibleTelegrams(
  sorted: readonly Telegram[],
  opts: SelectVisibleOpts,
): { items: Telegram[]; contextKeys: Set<string>; contextParents: Map<string, readonly string[]> } {
  // No filter, no quick filter, no window, no marks: the sorted list is the
  // visible list. Returning it avoids a boolean array over the whole buffer.
  if (visibleSelectionMode(opts) === 'identity') {
    return { items: sorted as Telegram[], contextKeys: new Set(), contextParents: new Map() };
  }

  const f = opts.filters;
  const noFilter = noMainFilter(opts);
  const quick = activeQuickFilter(opts.quickFilterOpen, opts.quickFilterEnabled, opts.quickPatterns, opts.quickColumnEnabled);
  const matches = sorted.map(t =>
    (noFilter || matchesTelegram(t, f)) && (!quick || quick(t)),
  );

  const { before, after } = effectiveDeltaContext(f);
  const flags = f.deltaContextEnabled ? new Set(opts.flaggedKeys) : EMPTY_KEY_SET;
  const pinned = new Set(addKeys(
    addKeys(opts.markedKeys, opts.mouseSelectedKeys),
    opts.lastSelectedKey ? [opts.lastSelectedKey] : [],
  ));

  const expanded = expandWithDeltaContext(
    sorted as Telegram[], matches, anchorKey, flags, before, after, opts.contextForAllMatches, {
      contextEnabled: f.deltaContextEnabled,
      individualWindows: opts.individualContextWindows,
      pinnedKeys: pinned,
    },
  );
  return {
    items: forceIncludeKeys(sorted, expanded.items, anchorKey, pinned),
    contextKeys: expanded.contextKeys,
    contextParents: expanded.contextParents,
  };
}
