// Shared left-axis gutter for the visualization charts: every chart type
// (Mixed/Timeline/Events) must reserve the same width before its plot area
// begins, so their X-axes all start at the identical vertical pixel column
// when stacked, and the gutter must be wide enough for the widest y-axis
// tick label and chart title among every currently displayed chart.
import type { ChartBucket } from '../hooks/useChartData';

export const MIN_LEFT_GUTTER = 60;
export const MAX_LEFT_GUTTER = 260;

let measureCanvas: HTMLCanvasElement | null = null;

/** Canvas-based text measurement, matching how uPlot itself measures axis
 * labels. Returns 0 (never the widest) if canvas 2D isn't available. */
const measureTextWidth = (text: string, font: string): number => {
  measureCanvas ??= document.createElement('canvas');
  const ctx = measureCanvas.getContext('2d');
  if (!ctx) return 0;
  ctx.font = font;
  return ctx.measureText(text).width;
};

/** The heading rendered above each chart type — kept here so gutter sizing
 * can never drift from the actually-rendered title. */
export const chartTitleFor = (bucket: Pick<ChartBucket, 'isBinary' | 'isEvents' | 'unit'>): string =>
  bucket.isBinary ? 'Binary States Timeline'
    : bucket.isEvents ? 'Events (unchartable values)'
      : `Metrics (${bucket.unit})`;

/** Widest expected numeric y-axis tick label for a Mixed-chart bucket; the
 * Timeline/Events charts show no numeric ticks in their gutter. */
const widestTickLabelWidth = (bucket: ChartBucket, measure: typeof measureTextWidth): number => {
  if (bucket.isBinary || bucket.isEvents) return 0;
  let maxAbs = 0;
  for (const s of bucket.series) {
    for (const v of s.data) {
      if (v != null && Math.abs(v) > maxAbs) maxAbs = Math.abs(v);
    }
  }
  const sample = `${Math.ceil(maxAbs).toLocaleString()} ${bucket.unit}`;
  return measure(sample, '11px sans-serif');
};

/**
 * One shared gutter width for every bucket currently on screen: wide enough
 * for the widest y-axis tick label AND the widest chart title among them.
 * `measure` is injectable so the aggregation/clamping logic is unit-testable
 * without a real canvas; defaults to the canvas-based measurement above.
 */
export const computeSharedLeftGutter = (
  buckets: ChartBucket[],
  measure: (text: string, font: string) => number = measureTextWidth,
): number => {
  let widest = 0;
  for (const bucket of buckets) {
    widest = Math.max(widest, widestTickLabelWidth(bucket, measure) + 30);
    widest = Math.max(widest, measure(chartTitleFor(bucket), 'bold 14px sans-serif') + 20);
  }
  return Math.min(MAX_LEFT_GUTTER, Math.max(MIN_LEFT_GUTTER, Math.ceil(widest)));
};
