import type { Telegram } from '../hooks/useWebSocket';
import type { Interval } from '../services/telegram-coverage-service';
import { anchorKey } from './anchorKey';
import {
  matchVisibleTelegram,
  pinnedVisibleKeys,
  selectVisibleTelegrams,
  type SelectVisibleOpts,
} from './selectVisibleTelegrams';

/**
 * Why the reading end stopped. The cache hook derives this from coverage,
 * the anchor window and the shared load budget; the table only paints it.
 */
export type ReadingEndCause = 'range' | 'loadlimit' | 'data' | 'loading';

export const READING_END_LABEL: Record<ReadingEndCause, string> = {
  range: 'end of range',
  loadlimit: 'end of loadlimit',
  data: 'end of data',
  loading: 'loading history',
};

/** Default two-line row estimate. The table passes its own constants. */
export const DISPLAY_ROW_PX = 85;
export const DISPLAY_RUBBER_PX = Math.round(DISPLAY_ROW_PX / 2);
/** End-marker block at the inner edge of the reading spacer. */
export const END_MARKER_PX = 24;

export interface ReadingEndInput {
  direction: 'forward' | 'backward';
  /** Explicit anchor. Null uses the buffer edge (oldest forward, newest backward). */
  anchorTs: number | null;
  oldestTs: number | null;
  newestTs: number | null;
  rangeMs: number;
  bufferCount: number;
  loadLimit: number;
  /** Sorted, merged coverage. Same intervals `TelegramCoverageService.covered` returns. */
  covered: readonly Interval[];
  /** A history fetch or a reconnect gap fill is in flight. */
  loading: boolean;
  now: number;
}

/**
 * Uncovered sub-ranges of `[start, end]`. `covered` must be sorted and merged
 * the way `TelegramCoverageService` keeps it.
 */
export function gapsBetween(
  covered: readonly Interval[],
  start: number,
  end: number,
): Interval[] {
  if (end < start) return [];
  const result: Interval[] = [];
  let cursor = start;
  for (const [s, e] of covered) {
    if (e < cursor) continue;
    if (s > end) break;
    if (s > cursor) result.push([cursor, s - 1]);
    cursor = Math.max(cursor, e + 1);
    if (cursor > end) break;
  }
  if (cursor <= end) result.push([cursor, end]);
  return result;
}

/**
 * Limit that bounds the reading end.
 *
 * A hole that still hides rows is `loading`, unless the buffer is already at
 * `loadLimit` — then the budget is what stopped the read. A window that is
 * covered out to the minute range is `range`. Forward stops at the present
 * before that range, and a backward window whose oldest telegram sits strictly
 * inside the range (the lead-in was empty), is `data`.
 */
export function readingEndCause(input: ReadingEndInput): ReadingEndCause {
  const anchor = input.direction === 'forward'
    ? (input.anchorTs ?? input.oldestTs)
    : (input.anchorTs ?? input.newestTs);
  if (anchor == null) return input.loading ? 'loading' : 'data';

  const rangeFar = input.direction === 'forward'
    ? anchor + input.rangeMs
    : anchor - input.rangeMs;
  const far = input.direction === 'forward' ? Math.min(rangeFar, input.now) : rangeFar;
  const winStart = input.direction === 'forward' ? anchor : far;
  const winEnd = input.direction === 'forward' ? far : anchor;
  if (input.loading) return 'loading';
  const gaps = gapsBetween(input.covered, winStart, winEnd);
  // A tail after the newest buffered telegram hides no row. It is the present
  // (or a quiet lead), not an open history hole.
  const historyGaps = gaps.filter(([s]) => input.newestTs == null || s <= input.newestTs);
  if (historyGaps.length > 0) {
    return input.bufferCount >= input.loadLimit ? 'loadlimit' : 'loading';
  }
  if (input.bufferCount >= input.loadLimit && gaps.length > 0) return 'loadlimit';
  if (input.direction === 'forward' && input.now < rangeFar) return 'data';
  if (
    input.direction === 'backward'
    && input.oldestTs != null
    && input.oldestTs > rangeFar
  ) {
    return 'data';
  }
  if (gaps.length > 0) return 'data';
  return 'range';
}

export interface SpacerPlan {
  /** Anchor-end block: at most half a row, and that half is the rubber band. */
  anchorPx: number;
  /** Reading-end spacer excluding the end marker: travel + rubber. */
  readingPx: number;
  anchorRubberPx: number;
  readingRubberPx: number;
  markerPx: number;
}

/**
 * Variant A. Time sort: the reading end is tall enough that the settled scroll
 * shows one row plus the end marker, then a half-row rubber band. The anchor
 * end is only that half-row rubber. Any other sort keeps a half-row rubber at
 * both ends and no marker, so the top row can stay put.
 */
export function spacerVariantA(opts: {
  viewportPx: number;
  rowPx?: number;
  markerPx?: number;
  rubberPx?: number;
  temporal: boolean;
  hasRows: boolean;
}): SpacerPlan {
  const row = opts.rowPx ?? DISPLAY_ROW_PX;
  const rubber = opts.hasRows ? (opts.rubberPx ?? DISPLAY_RUBBER_PX) : 0;
  const marker = opts.temporal && opts.hasRows ? (opts.markerPx ?? END_MARKER_PX) : 0;
  if (!opts.temporal || !opts.hasRows) {
    return {
      anchorPx: rubber,
      readingPx: rubber,
      anchorRubberPx: rubber,
      readingRubberPx: rubber,
      markerPx: 0,
    };
  }
  const travel = Math.max(0, opts.viewportPx - row - marker);
  return {
    anchorPx: rubber,
    readingPx: travel + rubber,
    anchorRubberPx: rubber,
    readingRubberPx: rubber,
    markerPx: marker,
  };
}

export interface AnchorSideRow {
  timestamp: string;
}

/**
 * Rows of the gapless run that starts at the anchor. The anchor row itself
 * stays even while the timestamp next to it is still uncovered. Rows on the
 * far side of an open gap stay out until that gap closes.
 */
export function contiguousFromAnchor<T extends AnchorSideRow>(
  rows: readonly T[],
  anchorTs: number,
  direction: 'forward' | 'backward',
  covered: readonly Interval[],
  keepKey?: string | null,
  keyOf?: (row: T) => string,
): T[] {
  if (rows.length === 0) return [];
  const tsOf = (row: T) => new Date(row.timestamp).getTime();
  let anchorRowTs: number | null = null;
  if (keepKey && keyOf) {
    const kept = rows.find(row => keyOf(row) === keepKey);
    if (kept) anchorRowTs = tsOf(kept);
  }
  if (anchorRowTs == null) {
    for (const row of rows) {
      const ts = tsOf(row);
      if (direction === 'forward' && ts < anchorTs) continue;
      if (direction === 'backward' && ts > anchorTs) continue;
      if (anchorRowTs == null || Math.abs(ts - anchorTs) < Math.abs(anchorRowTs - anchorTs)) {
        anchorRowTs = ts;
      }
    }
  }
  if (anchorRowTs == null) return [];
  const kept: T[] = [];
  for (const row of rows) {
    if (keepKey && keyOf && keyOf(row) === keepKey) {
      kept.push(row);
      continue;
    }
    const ts = tsOf(row);
    if (ts === anchorRowTs) {
      kept.push(row);
      continue;
    }
    if (direction === 'forward' && ts < anchorRowTs) continue;
    if (direction === 'backward' && ts > anchorRowTs) continue;
    const lo = Math.min(ts, anchorRowTs);
    const hi = Math.max(ts, anchorRowTs);
    if (gapsBetween(covered, lo, hi).length === 0) kept.push(row);
  }
  return kept.length === rows.length ? (rows as T[]) : kept;
}

/**
 * Side where the anchor row sits in the current sort.
 *
 * Forward's anchor is the oldest telegram, backward's the newest. Descending
 * time puts the newest row on top; ascending puts it on the bottom. The
 * reading end, its spacer and its end marker sit on the other side. A
 * non-time sort keeps the anchor on top. Direction alone does not pick the side.
 */
export function anchorDisplayEdge(
  direction: 'forward' | 'backward',
  timeSort: 'asc' | 'desc' | null,
): 'top' | 'bottom' {
  if (timeSort == null) return 'top';
  if (direction === 'forward') return timeSort === 'desc' ? 'bottom' : 'top';
  return timeSort === 'asc' ? 'bottom' : 'top';
}

/**
 * Digits the status pill shows: the filtered length while a filter is on,
 * otherwise the buffer length. The anchor-end pill uses the same filtered
 * rows but only those scrolled out toward the anchor, so the two counts differ.
 */
export function statusPillCount(
  filteredCount: number,
  totalCount: number,
  filterActive: boolean,
): number {
  return filterActive ? filteredCount : totalCount;
}

/**
 * Inputs for the header status-pill digits.
 *
 * `total` (y) is the row count after the side-panel filter only: the buffer
 * list with the quick filter off (matches, context, and force-visible rows)
 * plus backlog rows that pass that same selection. With the side panel off,
 * y is the raw buffer plus the raw backlog.
 *
 * `filtered` (x) is the row count after the side panel and the quick filter,
 * excluding context rows. Force-visible rows still count, in the buffer and
 * in the backlog — marks, the mouse selection, the last selected row, and
 * goto jump targets. The pill shows `x / y` only while the quick filter is
 * effective; otherwise it shows y.
 *
 * `unfiltered` is the raw buffer plus the raw backlog. The range tooltip and
 * the empty-buffer clear stay on this figure.
 */
export interface BufferBacklogCountInput {
  bufferCount: number;
  backlogCount: number;
  /** Buffer rows the side-panel list shows with the quick filter off. */
  sidePanelBufferCount: number;
  /** Backlog rows under that same side-panel selection. */
  sidePanelBacklogCount: number;
  /** Buffer rows after the side panel and the quick filter, without context rows. */
  quickBufferCount: number;
  /** Backlog rows under that same quick-filter selection. */
  quickBacklogCount: number;
  sidePanelActive: boolean;
  quickFilterActive: boolean;
}

/**
 * Status-pill length of one filtered buffer view.
 *
 * With `excludeContext`, rows listed only as Time-Delta context drop out
 * (`contextKeys`). A force-visible row (marked, mouse-selected, last
 * selected, or a goto jump target) stays even when that key is also a
 * context key.
 */
export function statusViewRowCount(
  items: readonly Telegram[],
  contextKeys: ReadonlySet<string>,
  forceVisibleKeys: ReadonlySet<string>,
  excludeContext: boolean,
): number {
  if (!excludeContext || contextKeys.size === 0) return items.length;
  let n = 0;
  for (const t of items) {
    const key = anchorKey(t);
    if (contextKeys.has(key) && !forceVisibleKeys.has(key)) continue;
    n++;
  }
  return n;
}

/**
 * Backlog rows for the status pill, under the same selection as the buffer.
 *
 * `excludeContext` false (y, quick filter off): a backlog row counts when the
 * side-panel selection would show it, including context and force-visible rows.
 * The expansion sees the published buffer and the backlog together, so a
 * backlog row's context window is the same one the list uses. Row order does
 * not change membership.
 *
 * `excludeContext` true (x): context-only rows drop out. A row counts when it
 * matches the side panel and the quick filter, or when it is force-visible.
 * Both are known on the backlog row itself, so this path does not consult the
 * buffer. A context key shared with a buffer row cannot hide a direct hit.
 */
export function backlogStatusCount(
  buffer: readonly Telegram[],
  backlog: readonly Telegram[],
  opts: SelectVisibleOpts,
  excludeContext: boolean,
): number {
  if (backlog.length === 0) return 0;
  if (excludeContext) {
    const match = matchVisibleTelegram(opts);
    const pinned = pinnedVisibleKeys(opts);
    let n = 0;
    for (const t of backlog) {
      if (match(t) || pinned.has(anchorKey(t))) n++;
    }
    return n;
  }
  const visible = selectVisibleTelegrams(buffer.concat(backlog), opts);
  const inBacklog = new Set<Telegram>(backlog);
  let n = 0;
  for (const t of visible.items) if (inBacklog.has(t)) n++;
  return n;
}

export function bufferBacklogCounts(
  input: BufferBacklogCountInput,
): { filtered: number; total: number; unfiltered: number } {
  const unfiltered = input.bufferCount + input.backlogCount;
  const total = input.sidePanelActive
    ? input.sidePanelBufferCount + input.sidePanelBacklogCount
    : unfiltered;
  const filtered = input.quickFilterActive
    ? input.quickBufferCount + input.quickBacklogCount
    : total;
  return { filtered, total, unfiltered };
}

/**
 * Anchor-end pill. Only filtered rows scrolled fully out of the viewport
 * toward the anchor, plus the backward pause backlog. Zero hides the pill.
 * Not the status pill's total.
 */
export function anchorEdgeCount(
  scrolledTowardAnchor: number,
  pausedVisible: number,
  direction: 'forward' | 'backward',
): number {
  if (direction === 'forward') return scrolledTowardAnchor;
  return scrolledTowardAnchor + pausedVisible;
}
