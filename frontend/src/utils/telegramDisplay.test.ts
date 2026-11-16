import { describe, expect, it } from 'vitest';
import {
  END_MARKER_PX,
  DISPLAY_ROW_PX,
  DISPLAY_RUBBER_PX,
  anchorEdgeCount,
  contiguousFromAnchor,
  readingEndCause,
  spacerVariantA,
  statusPillCount,
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
  const viewport = 800;

  it('sizes the reading end for one row plus the marker, and the anchor end at half a row', () => {
    const plan = spacerVariantA({ viewportPx: viewport, temporal: true, hasRows: true });
    expect(plan.anchorPx).toBe(DISPLAY_RUBBER_PX);
    expect(plan.anchorRubberPx).toBe(DISPLAY_RUBBER_PX);
    expect(plan.markerPx).toBe(END_MARKER_PX);
    expect(plan.readingRubberPx).toBe(DISPLAY_RUBBER_PX);
    expect(plan.readingPx).toBe(viewport - DISPLAY_ROW_PX - END_MARKER_PX + DISPLAY_RUBBER_PX);
    // Settled reading scroll shows one row + marker; the rubber sits past that.
    const travel = plan.readingPx - plan.readingRubberPx;
    expect(travel + DISPLAY_ROW_PX + plan.markerPx).toBe(viewport);
  });

  it('uses the same anchor and reading sizes in either direction', () => {
    const back = spacerVariantA({ viewportPx: viewport, temporal: true, hasRows: true });
    const fore = spacerVariantA({ viewportPx: 800, temporal: true, hasRows: true });
    expect(fore).toEqual(back);
  });

  it('keeps a half-row rubber at both ends when the sort is not temporal', () => {
    const plan = spacerVariantA({ viewportPx: viewport, temporal: false, hasRows: true });
    expect(plan.anchorPx).toBe(DISPLAY_RUBBER_PX);
    expect(plan.readingPx).toBe(DISPLAY_RUBBER_PX);
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

describe('status and anchor-edge counts', () => {
  it('uses the status pill digits for an unfiltered buffer and the filtered length otherwise', () => {
    expect(statusPillCount(4, 10, false)).toBe(10);
    expect(statusPillCount(4, 10, true)).toBe(4);
  });

  it('counts the same filtered rows toward the anchor, plus the backward backlog', () => {
    expect(anchorEdgeCount(4, 3, 'backward')).toBe(7);
    expect(anchorEdgeCount(4, 3, 'forward')).toBe(4);
    // Backlog is the whole filtered set: the edge count matches the status pill.
    expect(anchorEdgeCount(0, 3, 'backward')).toBe(statusPillCount(3, 3, false));
  });
});
