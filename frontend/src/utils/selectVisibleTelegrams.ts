import type { Telegram } from '../hooks/useWebSocket';
import { anchorKey } from './anchorKey';
import { expandWithDeltaContext } from './deltaContextExpansion';
import { forceIncludeKeys } from './forceIncludeKeys';
import { addKeys } from './markReasons';
import { activeQuickFilter, type QuickFilterColumnEnabled, type QuickPatterns } from './quickFilter';
import {
  effectiveDeltaContext,
  hasActiveFilters,
  matchesTelegram,
  type ActiveFilters,
} from '../types/filters';

const EMPTY_KEY_SET: ReadonlySet<string> = new Set();

/**
 * Rows the filter must keep: marks, the mouse selection, the last selected
 * row, and goto jump targets. Jump targets are their own set — not context
 * flags and not marks — and stay force-visible the same way.
 */
export function pinnedVisibleKeys(
  opts: Pick<SelectVisibleOpts, 'markedKeys' | 'mouseSelectedKeys' | 'lastSelectedKey' | 'jumpTargetKeys'>,
): Set<string> {
  return new Set(addKeys(
    addKeys(
      addKeys(opts.markedKeys, opts.mouseSelectedKeys),
      opts.jumpTargetKeys ?? [],
    ),
    opts.lastSelectedKey ? [opts.lastSelectedKey] : [],
  ));
}

export interface SelectVisibleOpts {
  /** Applied filters (typically already through `enabledFilters`). */
  filters: ActiveFilters;
  /** Master filter toggle (#370). When false, every row matches. */
  filtersEnabled: boolean;
  quickFilterOpen: boolean;
  quickFilterEnabled: boolean;
  quickPatterns: QuickPatterns;
  quickColumnEnabled?: QuickFilterColumnEnabled;
  /** Keys with the − (before) context flag on. */
  flaggedBeforeKeys: readonly string[];
  /** Keys with the + (after) context flag on. */
  flaggedAfterKeys: readonly string[];
  /** Marked rows, the mouse selection, and the last selected row stay in the list. */
  markedKeys: readonly string[];
  mouseSelectedKeys: readonly string[];
  lastSelectedKey: string | null;
  /**
   * Rows a goto has landed on. Always force-visible, including in the status
   * counts. Separate from marks and from the Time-Delta context flags.
   */
  jumpTargetKeys?: readonly string[];
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
 * `incremental` — nothing pulls older rows back in, so only the new and
 * dropped rows need the predicate.
 * `full` — a flagged side with a window, or a force-include, can change rows
 * that were already published.
 */
export function visibleSelectionMode(opts: SelectVisibleOpts): 'identity' | 'incremental' | 'full' {
  const { before, after } = effectiveDeltaContext(opts.filters);
  const marks = opts.markedKeys.length > 0
    || opts.mouseSelectedKeys.length > 0
    || opts.lastSelectedKey != null
    || (opts.jumpTargetKeys?.length ?? 0) > 0;
  const beforeOn = before > 0 && opts.flaggedBeforeKeys.length > 0;
  const afterOn = after > 0 && opts.flaggedAfterKeys.length > 0;
  if (marks || beforeOn || afterOn) return 'full';
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

function passesSidePanel(t: Telegram, opts: SelectVisibleOpts): boolean {
  return noMainFilter(opts) || matchesTelegram(t, opts.filters);
}

/**
 * A row that fails the side panel stays visible only as a quick-filter context
 * row: the quick filter is on, the delta window is on, and a quick-filter
 * match (that itself passes the side panel) pulls it in. Marked rows, the
 * mouse selection, the last selected row, and jump targets stay anyway.
 * Rows that pass the side panel keep the previous quick-filter behaviour.
 */
function keepDespiteSidePanel(
  t: Telegram,
  opts: SelectVisibleOpts,
  pinned: ReadonlySet<string>,
  quick: ((row: Telegram) => boolean) | null,
  contextParents: ReadonlyMap<string, readonly string[]>,
  byKey: ReadonlyMap<string, Telegram>,
  contextWindowOn: boolean,
): boolean {
  if (passesSidePanel(t, opts)) return true;
  const key = anchorKey(t);
  if (pinned.has(key)) return true;
  if (!quick || !contextWindowOn) return false;
  const parents = contextParents.get(key);
  if (!parents) return false;
  for (const parent of parents) {
    const row = byKey.get(parent);
    if (row && passesSidePanel(row, opts) && quick(row)) return true;
  }
  return false;
}

/**
 * Main-filter + QF-anchor + Time-Delta-Context expand + force-include of
 * marked, mouse-selected, last-selected, and jump-target rows.
 * `sorted` must already be in display sort order.
 *
 * A row that fails the side panel is not shown as side-panel context. It
 * stays only when it is force-visible, or when it sits in the quick filter's
 * context window. The caller keeps the underlying row (server context is stock).
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
  const sideFlags = {
    before: f.deltaContextEnabled ? new Set(opts.flaggedBeforeKeys) : EMPTY_KEY_SET,
    after: f.deltaContextEnabled ? new Set(opts.flaggedAfterKeys) : EMPTY_KEY_SET,
  };
  const pinned = pinnedVisibleKeys(opts);

  const expanded = expandWithDeltaContext(
    sorted as Telegram[], matches, anchorKey, sideFlags, before, after, {
      contextEnabled: f.deltaContextEnabled,
      pinnedKeys: pinned,
    },
  );
  const withPins = forceIncludeKeys(sorted, expanded.items, anchorKey, pinned);
  // Side panel off: every row passes it, so context and pins stay as before.
  if (noFilter || !hasActiveFilters(f)) {
    return {
      items: withPins,
      contextKeys: expanded.contextKeys,
      contextParents: expanded.contextParents,
    };
  }

  const contextWindowOn = (before > 0 || after > 0);
  const byKey = new Map<string, Telegram>();
  for (const row of sorted) byKey.set(anchorKey(row), row);
  const items = withPins.filter(t => keepDespiteSidePanel(
    t, opts, pinned, quick, expanded.contextParents, byKey, contextWindowOn,
  ));
  const kept = new Set(items.map(anchorKey));
  const contextKeys = new Set<string>();
  for (const key of expanded.contextKeys) if (kept.has(key)) contextKeys.add(key);
  const contextParents = new Map<string, readonly string[]>();
  for (const [key, parents] of expanded.contextParents) {
    if (kept.has(key)) contextParents.set(key, parents);
  }
  return { items, contextKeys, contextParents };
}
