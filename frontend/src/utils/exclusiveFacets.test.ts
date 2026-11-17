import { describe, expect, test } from 'vitest';
import {
  clampExclusiveAssignment,
  cycleExclusiveSlot,
  initialExclusiveAssignment,
  peekExclusiveCycle,
} from './exclusiveFacets';

describe('initialExclusiveAssignment', () => {
  test('fills from preferred then available', () => {
    expect(
      initialExclusiveAssignment(['decoded', 'decimal', 'hex', 'bin'], 2, ['decoded', 'hex']),
    ).toEqual(['decoded', 'hex']);
  });

  test('skips preferred that are unavailable and avoids duplicates', () => {
    expect(
      initialExclusiveAssignment(['decoded', 'hex'], 2, ['decoded', 'bin', 'decoded']),
    ).toEqual(['decoded', 'hex']);
  });

  test('may return fewer slots than requested', () => {
    expect(initialExclusiveAssignment(['decoded'], 2)).toEqual(['decoded']);
  });
});

describe('clampExclusiveAssignment', () => {
  test('drops facets that left available and tops up', () => {
    expect(
      clampExclusiveAssignment(['decoded', 'hex'], ['decoded', 'bin']),
    ).toEqual(['decoded', 'hex']);
  });
});

describe('cycleExclusiveSlot', () => {
  test('2-of-2 date/time swaps on either slot', () => {
    const available = ['time', 'date'] as const;
    expect(cycleExclusiveSlot(available, ['time', 'date'], 0)).toEqual(['date', 'time']);
    expect(cycleExclusiveSlot(available, ['time', 'date'], 1)).toEqual(['date', 'time']);
    expect(cycleExclusiveSlot(available, ['date', 'time'], 0)).toEqual(['time', 'date']);
  });

  test('with spare facets, cycles only free ones without touching the sibling', () => {
    const available = ['decoded', 'decimal', 'hex', 'bin'] as const;
    expect(cycleExclusiveSlot(available, ['decoded', 'hex'], 0)).toEqual(['decimal', 'hex']);
    expect(cycleExclusiveSlot(available, ['decimal', 'hex'], 0)).toEqual(['bin', 'hex']);
    expect(cycleExclusiveSlot(available, ['bin', 'hex'], 0)).toEqual(['decoded', 'hex']);
    expect(cycleExclusiveSlot(available, ['decoded', 'hex'], 1)).toEqual(['decoded', 'bin']);
  });

  test('peek reports the facet the clicked slot would show', () => {
    expect(peekExclusiveCycle(['time', 'date'], ['time', 'date'], 0)).toBe('date');
    expect(peekExclusiveCycle(['decoded', 'decimal', 'hex'], ['decoded', 'hex'], 0)).toBe('decimal');
  });
});
