import { describe, expect, test } from 'vitest';
import {
  MARK_COLOR_PALETTE,
  clearAllMarkColorIndices,
  cycleMarkColorIndex,
  getMarkColorIndex,
  isValidMarkColorIndex,
  markColorFromIndex,
  nextMarkColorIndex,
  setMarkColorIndex,
  type MarkColorIndexMap,
} from './markColors';

describe('markColors', () => {
  test('palette indices resolve to colours; invalid indices are rejected', () => {
    expect(markColorFromIndex(0)).toBe(MARK_COLOR_PALETTE[0]);
    expect(markColorFromIndex(MARK_COLOR_PALETTE.length - 1)).toBe(
      MARK_COLOR_PALETTE[MARK_COLOR_PALETTE.length - 1],
    );
    expect(markColorFromIndex(null)).toBeUndefined();
    expect(markColorFromIndex(-1)).toBeUndefined();
    expect(markColorFromIndex(99)).toBeUndefined();
    expect(isValidMarkColorIndex(0)).toBe(true);
    expect(isValidMarkColorIndex(1.5)).toBe(false);
  });

  test('set / get / clear colour index per key', () => {
    let map: MarkColorIndexMap = {};
    map = setMarkColorIndex(map, 'a', 2);
    expect(getMarkColorIndex(map, 'a')).toBe(2);
    expect(markColorFromIndex(getMarkColorIndex(map, 'a'))).toBe(MARK_COLOR_PALETTE[2]);

    map = setMarkColorIndex(map, 'a', 2);
    expect(Object.keys(map)).toEqual(['a']);

    map = setMarkColorIndex(map, 'a', null);
    expect(getMarkColorIndex(map, 'a')).toBeUndefined();
    expect(map).toEqual({});
  });

  test('nextMarkColorIndex prefers a free slot, then walks the palette', () => {
    expect(nextMarkColorIndex({}, 'a')).toBe(0);
    expect(nextMarkColorIndex({ b: 0 }, 'a')).toBe(1);

    let map: MarkColorIndexMap = { a: 0 };
    const seen: Array<number | null> = [];
    for (let i = 0; i <= MARK_COLOR_PALETTE.length; i++) {
      const next = nextMarkColorIndex(map, 'a');
      seen.push(next);
      map = setMarkColorIndex(map, 'a', next);
    }
    expect(seen).toEqual([
      ...Array.from({ length: MARK_COLOR_PALETTE.length - 1 }, (_, i) => i + 1),
      null,
      0,
    ]);
  });

  test('cycleMarkColorIndex updates the map', () => {
    let map = cycleMarkColorIndex({}, 'x');
    expect(map).toEqual({ x: 0 });
    map = cycleMarkColorIndex(map, 'x');
    expect(map).toEqual({ x: 1 });
  });

  test('clearAllMarkColorIndices empties the map', () => {
    expect(clearAllMarkColorIndices({ a: 0, b: 3 })).toEqual({});
  });
});
