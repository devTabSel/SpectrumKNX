import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTERS } from '../types/filters';
import { makeTelegram } from '../test/telegramFactory';
import { anchorKey } from './anchorKey';
import { pinnedVisibleKeys, selectVisibleTelegrams, type SelectVisibleOpts } from './selectVisibleTelegrams';
import {
  END_MARKER_PX,
  DISPLAY_RUBBER_PX,
  anchorDisplayEdge,
  anchorEdgeCount,
  backlogStatusCount,
  contiguousFromAnchor,
  readingEndCause,
  spacerVariantA,
  bufferBacklogCounts,
  statusPillCount,
  statusViewRowCount,
  type ReadingEndInput,
} from './telegramDisplay';

const MIN = 60_000;

function endInput(over: Partial<ReadingEndInput> = {}): ReadingEndInput {
  return {
    direction: 'backward',
    anchorTs: 10 * MIN,
    oldestTs: 10 * MIN - MIN,
    newestTs: 10 * MIN,
    rangeMs: MIN,
    bufferCount: 10,
    loadLimit: 100,
    covered: [[10 * MIN - MIN, 10 * MIN]],
    loading: false,
    now: 10 * MIN + MIN,
    ...over,
  };
}

describe('readingEndCause', () => {
  it('says loading history while a fetch is in flight and a hole is still open', () => {
    expect(readingEndCause(endInput({
      loading: true,
      covered: [[10 * MIN - 1000, 10 * MIN]],
    }))).toBe('loading');
  });

  it('says loading history while a history hole is open and the buffer still has room', () => {
    expect(readingEndCause(endInput({
      covered: [[10 * MIN - 1000, 10 * MIN]],
      bufferCount: 4,
      loadLimit: 100,
    }))).toBe('loading');
  });

  it('says end of loadlimit when the budget stops inside an open hole', () => {
    expect(readingEndCause(endInput({
      covered: [[10 * MIN - 1000, 10 * MIN]],
      bufferCount: 100,
      loadLimit: 100,
    }))).toBe('loadlimit');
  });

  it('says end of range when the backward window is covered out to the range edge', () => {
    expect(readingEndCause(endInput())).toBe('range');
  });

  it('says end of data when the backward window is covered but the oldest row sits inside it', () => {
    expect(readingEndCause(endInput({
      oldestTs: 10 * MIN - 1000,
      covered: [[10 * MIN - MIN, 10 * MIN]],
    }))).toBe('data');
  });

  it('says end of data when forward reaches the present before the range', () => {
    const anchor = 1_000_000;
    expect(readingEndCause(endInput({
      direction: 'forward',
      anchorTs: anchor,
      oldestTs: anchor,
      newestTs: anchor + 5_000,
      rangeMs: MIN,
      now: anchor + 5_000,
      covered: [[anchor, anchor + 5_000]],
    }))).toBe('data');
  });

  it('says end of range when forward coverage reaches the range while now is beyond it', () => {
    const anchor = 1_000_000;
    expect(readingEndCause(endInput({
      direction: 'forward',
      anchorTs: anchor,
      oldestTs: anchor,
      newestTs: anchor + MIN,
      rangeMs: MIN,
      now: anchor + MIN + 10_000,
      covered: [[anchor, anchor + MIN]],
    }))).toBe('range');
  });

  it('says end of data when nothing has been anchored yet', () => {
    expect(readingEndCause(endInput({
      anchorTs: null,
      oldestTs: null,
      newestTs: null,
      covered: [],
    }))).toBe('data');
  });
});

describe('spacerVariantA', () => {
  it('keeps both ends clear at rest so a settled scroll sits on telegrams', () => {
    const plan = spacerVariantA({ temporal: true, hasRows: true });
    expect(plan.anchorPx).toBe(0);
    expect(plan.anchorRubberPx).toBe(0);
    expect(plan.markerPx).toBe(END_MARKER_PX);
    expect(plan.readingRubberPx).toBe(0);
    expect(plan.readingPx).toBe(0);
  });

  it('opens a half-row rubber only on the side that is scrolling', () => {
    const plan = spacerVariantA({
      temporal: true,
      hasRows: true,
      anchorRubberPx: DISPLAY_RUBBER_PX,
    });
    expect(plan.anchorPx).toBe(DISPLAY_RUBBER_PX);
    expect(plan.anchorRubberPx).toBe(DISPLAY_RUBBER_PX);
    expect(plan.readingPx).toBe(0);
    expect(plan.readingRubberPx).toBe(0);
    expect(plan.markerPx).toBe(END_MARKER_PX);
  });

  it('keeps a non-temporal sort free of rubber and the end marker at rest', () => {
    const plan = spacerVariantA({ temporal: false, hasRows: true });
    expect(plan.anchorPx).toBe(0);
    expect(plan.readingPx).toBe(0);
    expect(plan.markerPx).toBe(0);
  });
});

describe('contiguousFromAnchor', () => {
  const row = (second: number) => ({ timestamp: new Date(second * 1000).toISOString(), id: second });

  it('hides rows on the far side of an open gap, backward and forward', () => {
    const rows = [row(50), row(40), row(10)];
    const covered: [number, number][] = [[30_000, 50_000], [0, 15_000]];
    expect(contiguousFromAnchor(rows, 50_000, 'backward', covered).map(r => r.id)).toEqual([50, 40]);
    const forward = [row(10), row(20), row(40)];
    expect(contiguousFromAnchor(forward, 10_000, 'forward', covered).map(r => r.id)).toEqual([10]);
  });

  it('keeps the anchor row while the next timestamp is still uncovered', () => {
    const rows = [row(50), row(40)];
    expect(contiguousFromAnchor(rows, 50_000, 'backward', [], undefined, r => String(r.id)).map(r => r.id))
      .toEqual([50]);
  });
});

describe('anchorDisplayEdge', () => {
  it('places the anchor where that row sits for every direction and time sort', () => {
    // Forward anchor is the oldest row; backward is the newest.
    expect(anchorDisplayEdge('forward', 'desc')).toBe('bottom');
    expect(anchorDisplayEdge('forward', 'asc')).toBe('top');
    expect(anchorDisplayEdge('backward', 'desc')).toBe('top');
    expect(anchorDisplayEdge('backward', 'asc')).toBe('bottom');
  });

  it('keeps a non-time sort anchored at the top', () => {
    expect(anchorDisplayEdge('forward', null)).toBe('top');
    expect(anchorDisplayEdge('backward', null)).toBe('top');
  });
});

describe('status and anchor-edge counts', () => {
  it('uses the status pill digits for an unfiltered buffer and the filtered length otherwise', () => {
    expect(statusPillCount(4, 10, false)).toBe(10);
    expect(statusPillCount(4, 10, true)).toBe(4);
  });

  it('counts only rows scrolled toward the anchor, plus the backward backlog', () => {
    expect(anchorEdgeCount(2, 3, 'backward')).toBe(5);
    expect(anchorEdgeCount(2, 3, 'forward')).toBe(2);
    expect(anchorEdgeCount(0, 3, 'backward')).toBe(3);
    expect(anchorEdgeCount(0, 3, 'forward')).toBe(0);
    expect(anchorEdgeCount(0, 0, 'backward')).toBe(0);
    // The status pill keeps the filtered total. The anchor pill does not repeat it.
    expect(statusPillCount(10, 40, true)).toBe(10);
    expect(anchorEdgeCount(2, 3, 'backward')).not.toBe(10);
  });

  it('shows x / y only while the quick filter is effective', () => {
    const counts = {
      bufferCount: 20,
      backlogCount: 5,
      sidePanelBufferCount: 8,
      sidePanelBacklogCount: 2,
      quickBufferCount: 3,
      quickBacklogCount: 1,
    };
    // Quick filter on: x is side panel + quick filter, y is the side-panel count.
    expect(bufferBacklogCounts({ ...counts, sidePanelActive: true, quickFilterActive: true }))
      .toEqual({ filtered: 4, total: 10, unfiltered: 25 });
    // Side panel only: the pill shows y, not x / y.
    expect(bufferBacklogCounts({ ...counts, sidePanelActive: true, quickFilterActive: false }))
      .toEqual({ filtered: 10, total: 10, unfiltered: 25 });
    // Neither filter: y is the raw buffer plus backlog.
    expect(bufferBacklogCounts({ ...counts, sidePanelActive: false, quickFilterActive: false }))
      .toEqual({ filtered: 25, total: 25, unfiltered: 25 });
    // Quick filter only: y stays the raw total. The tooltip stays on that sum.
    expect(bufferBacklogCounts({ ...counts, sidePanelActive: false, quickFilterActive: true }))
      .toEqual({ filtered: 4, total: 25, unfiltered: 25 });
  });
});

describe('status pill x / y rows', () => {
  const filters = {
    ...DEFAULT_FILTERS,
    sources: ['1.1.1'],
    deltaBeforeMs: 0,
    deltaAfterMs: 1000,
    deltaContextEnabled: true,
  };
  const match = makeTelegram({
    timestamp: '2024-01-01T10:00:00.000Z',
    source_address: '1.1.1',
    target_name: 'EG Licht',
    raw_hex: '0xmatch',
  });
  const context = makeTelegram({
    timestamp: '2024-01-01T10:00:00.400Z',
    source_address: '9.9.9',
    target_name: 'OG Jalousie',
    raw_hex: '0xctx',
  });
  const markedNear = makeTelegram({
    timestamp: '2024-01-01T10:00:00.200Z',
    source_address: '9.9.9',
    target_name: 'OG Jalousie',
    raw_hex: '0xmark',
  });
  const other = makeTelegram({
    timestamp: '2024-01-01T10:00:09.000Z',
    source_address: '9.9.9',
    target_name: 'OG Jalousie',
    raw_hex: '0xother',
  });
  const buffer = [match, markedNear, context, other];
  const bNear = makeTelegram({
    timestamp: '2024-01-01T10:00:00.800Z',
    source_address: '9.9.9',
    target_name: 'OG Jalousie',
    raw_hex: '0xbnear',
  });
  const bFar = makeTelegram({
    timestamp: '2024-01-01T10:00:20.000Z',
    source_address: '9.9.9',
    target_name: 'OG Jalousie',
    raw_hex: '0xbfar',
  });
  const bDirect = makeTelegram({
    timestamp: '2024-01-01T10:00:30.000Z',
    source_address: '1.1.1',
    target_name: 'EG Licht',
    raw_hex: '0xbdirect',
  });
  const bSideOnly = makeTelegram({
    timestamp: '2024-01-01T10:00:40.000Z',
    source_address: '1.1.1',
    target_name: 'Keller',
    raw_hex: '0xbside',
  });
  const bMarked = makeTelegram({
    timestamp: '2024-01-01T10:00:50.000Z',
    source_address: '9.9.9',
    target_name: 'Keller',
    raw_hex: '0xbmark',
  });
  const backlog = [bNear, bFar, bDirect, bSideOnly, bMarked];

  const qfOpts: SelectVisibleOpts = {
    filters,
    filtersEnabled: true,
    quickFilterOpen: true,
    quickFilterEnabled: true,
    quickPatterns: { target: { top: '', bottom: 'EG' } },
    flaggedBeforeKeys: [],
    flaggedAfterKeys: [anchorKey(match)],
    markedKeys: [anchorKey(markedNear), anchorKey(bMarked)],
    mouseSelectedKeys: [],
    lastSelectedKey: null,
  };
  const sideOpts: SelectVisibleOpts = {
    ...qfOpts,
    quickFilterOpen: false,
    quickFilterEnabled: false,
    quickPatterns: {},
  };

  function backlogRowsIn(items: readonly { raw_hex?: string | null }[]): string[] {
    const want = new Set(backlog.map(t => t.raw_hex));
    return items.filter(t => want.has(t.raw_hex)).map(t => t.raw_hex ?? '');
  }

  it('counts x without context rows and still counts a force-visible context row', () => {
    const shown = selectVisibleTelegrams(buffer, qfOpts);
    expect(shown.contextKeys).toEqual(new Set([anchorKey(context), anchorKey(markedNear)]));
    const pinned = pinnedVisibleKeys(qfOpts);
    const x = statusViewRowCount(shown.items, shown.contextKeys, pinned, true);
    // Match plus the marked row. The pure context row is out.
    expect(x).toBe(2);
    expect(shown.items).toHaveLength(3);
  });

  it('counts y as the quick filter off, without side-panel context misses', () => {
    const side = selectVisibleTelegrams(buffer, sideOpts);
    // The context row fails the side panel and the quick filter is off, so it
    // stays loaded but is not part of y. The marked miss stays.
    expect(side.items.map(t => t.raw_hex)).toEqual(['0xmatch', '0xmark']);
    const combined = selectVisibleTelegrams(buffer.concat(backlog), sideOpts);
    expect(backlogRowsIn(combined.items).sort()).toEqual(['0xbdirect', '0xbmark', '0xbside']);
    expect(backlogStatusCount(buffer, backlog, sideOpts, false)).toBe(3);
    // The published buffer is newest-first. Membership does not depend on that order.
    expect(backlogStatusCount([...buffer].reverse(), [...backlog].reverse(), sideOpts, false)).toBe(3);
  });

  it('counts the backlog with the same rules: x drops context, y keeps the side-panel list', () => {
    expect(backlogStatusCount(buffer, backlog, qfOpts, true)).toBe(2);
    expect(backlogStatusCount(buffer, backlog, sideOpts, false)).toBe(3);
    const pinned = pinnedVisibleKeys(qfOpts);
    const quick = selectVisibleTelegrams(buffer, qfOpts);
    const side = selectVisibleTelegrams(buffer, sideOpts);
    const counts = bufferBacklogCounts({
      bufferCount: buffer.length,
      backlogCount: backlog.length,
      sidePanelBufferCount: side.items.length,
      sidePanelBacklogCount: backlogStatusCount(buffer, backlog, sideOpts, false),
      quickBufferCount: statusViewRowCount(quick.items, quick.contextKeys, pinned, true),
      quickBacklogCount: backlogStatusCount(buffer, backlog, qfOpts, true),
      sidePanelActive: true,
      quickFilterActive: true,
    });
    // x = (match + marked) + (direct QF hit + marked backlog) = 4
    // y = (match + marked) + (direct + side-only + marked) = 5
    // The side-panel context miss is out of y; it returns under the quick filter.
    expect(counts).toEqual({ filtered: 4, total: 5, unfiltered: 9 });
  });

  it('shows only y when the side panel is on and the quick filter is off', () => {
    const side = selectVisibleTelegrams(buffer, sideOpts);
    const yBacklog = backlogStatusCount(buffer, backlog, sideOpts, false);
    const y = side.items.length + yBacklog;
    expect(bufferBacklogCounts({
      bufferCount: buffer.length,
      backlogCount: backlog.length,
      sidePanelBufferCount: side.items.length,
      sidePanelBacklogCount: yBacklog,
      quickBufferCount: 0,
      quickBacklogCount: 0,
      sidePanelActive: true,
      quickFilterActive: false,
    })).toEqual({ filtered: y, total: y, unfiltered: buffer.length + backlog.length });
  });

  it('keeps a mouse-selected or last-selected backlog row when it misses the filter', () => {
    const picked = makeTelegram({
      timestamp: '2024-01-01T11:00:00.000Z',
      source_address: '9.9.9',
      target_name: 'Keller',
      raw_hex: '0xpick',
    });
    const base: SelectVisibleOpts = { ...qfOpts, markedKeys: [], flaggedAfterKeys: [] };
    expect(backlogStatusCount([], [picked], { ...base, mouseSelectedKeys: [anchorKey(picked)] }, true)).toBe(1);
    expect(backlogStatusCount([], [picked], { ...base, lastSelectedKey: anchorKey(picked) }, true)).toBe(1);
    expect(backlogStatusCount([], [picked], base, true)).toBe(0);
  });

  it('counts jump targets in x and y, in the buffer and the backlog', () => {
    const jump = makeTelegram({
      timestamp: '2024-01-01T10:00:00.400Z',
      source_address: '9.9.9',
      target_name: 'OG Jalousie',
      raw_hex: '0xjump',
    });
    const jumpBacklog = makeTelegram({
      timestamp: '2024-01-01T10:00:20.000Z',
      source_address: '9.9.9',
      target_name: 'Keller',
      raw_hex: '0xjumpb',
    });
    const opts: SelectVisibleOpts = {
      ...qfOpts,
      markedKeys: [],
      flaggedAfterKeys: [anchorKey(match)],
      jumpTargetKeys: [anchorKey(jump), anchorKey(jumpBacklog)],
    };
    const side: SelectVisibleOpts = {
      ...opts,
      quickFilterOpen: false,
      quickFilterEnabled: false,
      quickPatterns: {},
    };
    const shown = selectVisibleTelegrams([match, jump], opts);
    expect(shown.contextKeys.has(anchorKey(jump))).toBe(true);
    const pinned = pinnedVisibleKeys(opts);
    expect(pinned.has(anchorKey(jump))).toBe(true);
    // x drops the context row unless it is a jump target.
    expect(statusViewRowCount(shown.items, shown.contextKeys, new Set(), true)).toBe(1);
    expect(statusViewRowCount(shown.items, shown.contextKeys, pinned, true)).toBe(2);
    const y = selectVisibleTelegrams([match, jump], side);
    expect(y.items.map(t => t.raw_hex)).toEqual(['0xmatch', '0xjump']);
    expect(backlogStatusCount([], [jumpBacklog], opts, true)).toBe(1);
    expect(backlogStatusCount([match, jump], [jumpBacklog], side, false)).toBe(1);
    // Context flags are not jump targets.
    expect(backlogStatusCount([], [jumpBacklog], { ...opts, jumpTargetKeys: [] }, true)).toBe(0);
  });
});
