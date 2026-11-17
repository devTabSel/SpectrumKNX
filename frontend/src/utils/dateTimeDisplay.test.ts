import { describe, expect, test } from 'vitest';
import {
  datesDiffer,
  idleDateTimeParts,
  resolveReferenceMs,
  shouldShowDate,
} from './dateTimeDisplay';

const dayA = Date.parse('2026-03-01T10:00:00');
const dayALater = Date.parse('2026-03-01T12:00:00');
const dayB = Date.parse('2026-03-02T09:00:00');
const nowSameDay = Date.parse('2026-03-01T18:00:00');
const nowOtherDay = Date.parse('2026-11-17T12:00:00');

describe('dateTimeDisplay if-differs', () => {
  test('datesDiffer compares local calendar days', () => {
    expect(datesDiffer(dayA, dayALater)).toBe(false);
    expect(datesDiffer(dayA, dayB)).toBe(true);
  });

  test('missing reference falls back to now', () => {
    expect(resolveReferenceMs(undefined, nowOtherDay)).toBe(nowOtherDay);
    expect(resolveReferenceMs(null, nowOtherDay)).toBe(nowOtherDay);
    expect(resolveReferenceMs(dayB, nowOtherDay)).toBe(dayB);

    expect(datesDiffer(dayA, null, nowSameDay)).toBe(false);
    expect(datesDiffer(dayA, undefined, nowOtherDay)).toBe(true);
    expect(shouldShowDate('if-differs', dayA, null, nowSameDay)).toBe(false);
    expect(shouldShowDate('if-differs', dayA, undefined, nowOtherDay)).toBe(true);
  });

  test('shouldShowDate respects modes', () => {
    expect(shouldShowDate('always', dayA, dayALater)).toBe(true);
    expect(shouldShowDate('never', dayA, dayB)).toBe(false);
    expect(shouldShowDate('time-only', dayA, dayB)).toBe(false);
    expect(shouldShowDate('date-only', dayA, dayALater)).toBe(true);
    expect(shouldShowDate('if-differs', dayA, dayALater)).toBe(false);
    expect(shouldShowDate('if-differs', dayA, dayB)).toBe(true);
  });

  test('idleDateTimeParts hides date when same day as reference', () => {
    const same = idleDateTimeParts(dayA, 'if-differs', {
      referenceMs: dayALater,
      withCentiseconds: true,
    });
    expect(same.time).toBe('10:00:00.00');
    expect(same.date).toBeNull();
    expect(same.full).toContain('2026-03-01');

    const diff = idleDateTimeParts(dayA, 'if-differs', { referenceMs: dayB });
    expect(diff.date).toBe('2026-03-01');
    expect(diff.time).toBe('10:00:00.00');

    const vsNowSame = idleDateTimeParts(dayA, 'if-differs', { nowMs: nowSameDay });
    expect(vsNowSame.date).toBeNull();
    const vsNowDiff = idleDateTimeParts(dayA, 'if-differs', { nowMs: nowOtherDay });
    expect(vsNowDiff.date).toBe('2026-03-01');
  });
});
