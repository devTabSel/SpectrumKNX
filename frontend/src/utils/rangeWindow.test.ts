import { expect, test } from 'vitest';
import {
  formatRangeMs,
  parseRangePreset,
  RANGE_PRESETS,
  rangeValueToMs,
  windowFromRange,
} from './rangeWindow';

test('windowFromRange keeps the newest anchor when reading backward', () => {
  const anchor = Date.parse('2024-06-01T12:00:00.000Z');
  expect(windowFromRange('backward', anchor, 30_000)).toEqual({
    startMs: anchor - 30_000,
    endMs: anchor,
  });
  expect(windowFromRange('backward', anchor, 86_400_000)).toEqual({
    startMs: anchor - 86_400_000,
    endMs: anchor,
  });
});

test('windowFromRange keeps the oldest anchor when reading forward', () => {
  const anchor = Date.parse('2024-06-01T12:00:00.000Z');
  expect(windowFromRange('forward', anchor, 5 * 60_000)).toEqual({
    startMs: anchor,
    endMs: anchor + 5 * 60_000,
  });
  expect(windowFromRange('forward', anchor, 7 * 86_400_000)).toEqual({
    startMs: anchor,
    endMs: anchor + 7 * 86_400_000,
  });
});

test('range presets cover the common windows in s / m / h / t', () => {
  expect(RANGE_PRESETS.map(p => p.label)).toEqual([
    '30 s', '1 m', '5 m', '15 m', '1 h', '6 h', '12 h', '1 t', '7 t',
  ]);
  expect(parseRangePreset('30 s')).toEqual({ value: 30, unit: 's' });
  expect(parseRangePreset('1 t')).toEqual({ value: 1, unit: 't' });
  expect(rangeValueToMs('30', 's')).toBe(30_000);
  expect(rangeValueToMs('1 t', 'm')).toBe(86_400_000);
  expect(rangeValueToMs('7', 't')).toBe(7 * 86_400_000);
  expect(formatRangeMs(3_600_000, 'h')).toBe('1');
  expect(formatRangeMs(86_400_000, 't')).toBe('1');
});
