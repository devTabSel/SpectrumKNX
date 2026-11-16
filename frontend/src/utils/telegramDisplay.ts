import type { Interval } from '../services/telegram-coverage-service';

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
 * Status-pill figures. Both include the pause backlog.
 * The filtered side is the visible filtered length of that side, not a second
 * definition of "filtered".
 */
export function bufferBacklogCounts(
  bufferCount: number,
  backlogCount: number,
  filteredBufferCount: number,
  filteredBacklogCount: number,
): { filtered: number; total: number } {
  return {
    filtered: filteredBufferCount + filteredBacklogCount,
    total: bufferCount + backlogCount,
  };
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
