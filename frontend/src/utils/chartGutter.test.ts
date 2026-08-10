import { describe, it, expect } from 'vitest';
import { chartTitleFor, computeSharedLeftGutter, MIN_LEFT_GUTTER, MAX_LEFT_GUTTER } from './chartGutter';
import type { ChartBucket, ChartSeries } from '../hooks/useChartData';

const series = (address: string, data: (number | null)[], name = address): ChartSeries => ({
  address, name, data, real: data.map(v => v != null),
});

const mixedBucket = (unit: string, data: (number | null)[] = [1]): ChartBucket => ({
  unit, isBinary: false, isEvents: false, timestamps: [1000], series: [series('1/1/1', data)],
});

const binaryBucket = (): ChartBucket => ({
  unit: 'binary', isBinary: true, isEvents: false, timestamps: [1000], series: [series('1/1/1', [1])],
});

const eventsBucket = (): ChartBucket => ({
  unit: 'events', isBinary: false, isEvents: true, timestamps: [1000], series: [series('1/1/1', [1])],
});

const customNamesBucket = (...names: string[]): ChartBucket => ({
  unit: 'events',
  isBinary: false,
  isEvents: true,
  timestamps: [1000],
  series: names.map((name, i) => series(`1/1/${i + 1}`, [1], name)),
});

// A stand-in for canvas text measurement: deterministic and independent of
// any real font metrics, so the aggregation/clamping logic is testable.
const fakeMeasure = (text: string) => text.length * 7;
const SAFETY_RESERVE = 20;
const GA_FIXED_BUDGET = 18 + 34;

describe('chartTitleFor', () => {
  it('matches the heading actually rendered by each chart type', () => {
    expect(chartTitleFor(binaryBucket())).toBe('Binary States Timeline');
    expect(chartTitleFor(eventsBucket())).toBe('Events (unchartable values)');
    expect(chartTitleFor(mixedBucket('lx'))).toBe('Metrics (lx)');
  });
});

describe('computeSharedLeftGutter', () => {
  it('clamps to the minimum gutter when nothing needs more room', () => {
    const width = computeSharedLeftGutter([mixedBucket('lx', [1])], () => 0);
    expect(width).toBe(Math.max(MIN_LEFT_GUTTER, GA_FIXED_BUDGET + SAFETY_RESERVE));
  });

  it('grows to fit a long chart title even when the y-axis values are short', () => {
    const width = computeSharedLeftGutter([eventsBucket()], fakeMeasure);
    const titleWidth = fakeMeasure('Events (unchartable values)') + 20 + SAFETY_RESERVE;
    expect(width).toBe(Math.min(MAX_LEFT_GUTTER, titleWidth));
  });

  it('grows to fit a wide numeric y-axis tick label even with a short title', () => {
    const width = computeSharedLeftGutter([mixedBucket('lx', [123456789])], fakeMeasure);
    const tickWidth = fakeMeasure('123,456,789 lx') + 30 + SAFETY_RESERVE;
    expect(width).toBe(Math.min(MAX_LEFT_GUTTER, tickWidth));
  });

  it('grows to fit the widest GA label when it exceeds title and tick needs', () => {
    const longName = 'Very long group address label for the gutter';
    const width = computeSharedLeftGutter(
      [customNamesBucket('GA', longName)],
      fakeMeasure,
    );
    const gaWidth = fakeMeasure(longName) + 18 + 34 + SAFETY_RESERVE;
    const titleWidth = fakeMeasure('Events (unchartable values)') + 20 + SAFETY_RESERVE;
    expect(width).toBe(Math.min(MAX_LEFT_GUTTER, Math.max(gaWidth, titleWidth)));
  });

  it('returns one shared width covering the widest requirement across every displayed bucket', () => {
    const buckets = [binaryBucket(), eventsBucket(), mixedBucket('lx', [1])];
    const shared = computeSharedLeftGutter(buckets, fakeMeasure);
    const perBucket = buckets.map(b => computeSharedLeftGutter([b], fakeMeasure));
    expect(shared).toBe(Math.max(...perBucket));
  });

  it('never exceeds the maximum gutter width', () => {
    const veryLongUnit = 'x'.repeat(200);
    const width = computeSharedLeftGutter([mixedBucket(veryLongUnit, [1])], fakeMeasure);
    expect(width).toBe(MAX_LEFT_GUTTER);
  });

  it('falls back to a real canvas-based measurement and still stays within bounds when no measurer is given', () => {
    const width = computeSharedLeftGutter([mixedBucket('lx', [1])]);
    expect(width).toBeGreaterThanOrEqual(MIN_LEFT_GUTTER);
    expect(width).toBeLessThanOrEqual(MAX_LEFT_GUTTER);
  });
});
