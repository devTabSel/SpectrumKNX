/**
 * Index of the last x-value at or before `val` (i.e. the preceding data
 * point), or -1 if `val` is before every point. Used for hover legends: since
 * series data holds each value forward until its next telegram (#... ),
 * uPlot's own nearest-neighbor `cursor.idx` can round up to a future point
 * when the cursor sits closer to it — showing a value that hasn't happened
 * yet at the hovered time. This always resolves to the preceding telegram
 * instead (#391).
 */
export function floorDataIdx(xs: readonly number[], val: number): number {
  if (xs.length === 0 || xs[0] > val) return -1;
  let lo = 0;
  let hi = xs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (xs[mid] <= val) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
