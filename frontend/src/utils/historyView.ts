import type { Telegram } from '../hooks/useWebSocket';
import type { ActiveFilters } from '../types/filters';
import { activeQuickFilter } from './quickFilter';
import { pinnedVisibleKeys, selectVisibleTelegrams, type SelectVisibleOpts } from './selectVisibleTelegrams';
import { statusViewRowCount } from './telegramDisplay';

function sameList(a: readonly (string | number)[], b: readonly (string | number)[]): boolean {
  if (a.length !== b.length) return false;
  const left = a.map(String).sort();
  const right = b.map(String).sort();
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false;
  return true;
}

/**
 * Side-panel selections and the context window. The quick filter's own
 * before/after bounds are not part of this snapshot.
 */
export function sameSidePanel(a: ActiveFilters, b: ActiveFilters): boolean {
  return sameList(a.sources, b.sources)
    && sameList(a.targets, b.targets)
    && sameList(a.types, b.types)
    && sameList(a.directions, b.directions)
    && sameList(a.dpts, b.dpts)
    && a.deltaBeforeMs === b.deltaBeforeMs
    && a.deltaAfterMs === b.deltaAfterMs
    && a.deltaContextEnabled === b.deltaContextEnabled;
}

/** True once a history load exists and the live side panel differs from it. */
export function sidePanelPending(applied: ActiveFilters | null, current: ActiveFilters): boolean {
  if (!applied) return false;
  return !sameSidePanel(applied, current);
}

/**
 * Visibility filters for a loaded history view: the side panel from the last
 * refresh, including its context window. Live edits stay pending until then.
 */
export function historyDisplayFilters(applied: ActiveFilters): ActiveFilters {
  return applied;
}

export interface HistoryCounts {
  x: number;
  y: number;
  quickActive: boolean;
}

/**
 * History status digits. `y` is the side-panel view with the quick filter off.
 * `x` is that view plus the quick filter, without quick-filter context rows.
 * The badge shows `x / y` only while the quick filter is effective.
 */
export function historyCounts(sorted: readonly Telegram[], opts: SelectVisibleOpts): HistoryCounts {
  const quickActive = activeQuickFilter(
    opts.quickFilterOpen,
    opts.quickFilterEnabled,
    opts.quickPatterns,
    opts.quickColumnEnabled,
  ) != null;
  const side = selectVisibleTelegrams(sorted, {
    ...opts,
    quickFilterOpen: false,
    quickFilterEnabled: false,
    quickPatterns: {},
  });
  const y = side.items.length;
  if (!quickActive) return { x: y, y, quickActive: false };
  const quick = selectVisibleTelegrams(sorted, opts);
  const x = statusViewRowCount(quick.items, quick.contextKeys, pinnedVisibleKeys(opts), true);
  return { x, y, quickActive: true };
}
