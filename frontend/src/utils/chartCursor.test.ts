import { describe, expect, it } from 'vitest';
import { floorDataIdx } from './chartCursor';

describe('floorDataIdx', () => {
  const xs = [10, 20, 30, 40];

  it('returns -1 when val is before the first point', () => {
    expect(floorDataIdx(xs, 5)).toBe(-1);
  });

  it('returns -1 for an empty array', () => {
    expect(floorDataIdx([], 5)).toBe(-1);
  });

  it('returns the exact index on an exact match', () => {
    expect(floorDataIdx(xs, 20)).toBe(1);
  });

  it('returns the preceding index, never the next one, for a value in between', () => {
    expect(floorDataIdx(xs, 25)).toBe(1);
    expect(floorDataIdx(xs, 39)).toBe(2);
  });

  it('returns the last index when val is at or after the last point', () => {
    expect(floorDataIdx(xs, 40)).toBe(3);
    expect(floorDataIdx(xs, 1000)).toBe(3);
  });
});
