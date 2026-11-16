import { describe, expect, it } from 'vitest';
import { DEFAULT_FILTERS } from '../types/filters';
import { makeTelegram } from '../test/telegramFactory';
import { anchorKey } from './anchorKey';
import { selectVisibleTelegrams } from './selectVisibleTelegrams';

const baseOpts = {
  filters: DEFAULT_FILTERS,
  filtersEnabled: true,
  quickFilterOpen: false,
  quickFilterEnabled: false,
  quickPatterns: {},
  flaggedBeforeKeys: [] as string[],
  flaggedAfterKeys: [] as string[],
  markedKeys: [],
  mouseSelectedKeys: [],
  lastSelectedKey: null,
};

describe('selectVisibleTelegrams', () => {
  it('returns every row when no filters are active', () => {
    const sorted = [
      makeTelegram({ timestamp: '2024-01-01T10:00:02.000Z', raw_hex: '0x2' }),
      makeTelegram({ timestamp: '2024-01-01T10:00:01.000Z', raw_hex: '0x1' }),
    ];
    expect(selectVisibleTelegrams(sorted, baseOpts).items).toBe(sorted);
  });

  it('keeps a marked row the main filter would drop', () => {
    const keep = makeTelegram({
      timestamp: '2024-01-01T10:00:02.000Z',
      source_address: '1.1.1',
      raw_hex: '0xkeep',
    });
    const drop = makeTelegram({
      timestamp: '2024-01-01T10:00:01.000Z',
      source_address: '2.2.2',
      raw_hex: '0xdrop',
    });
    const { items } = selectVisibleTelegrams([keep, drop], {
      ...baseOpts,
      filters: { ...DEFAULT_FILTERS, sources: ['1.1.1'] },
      markedKeys: [anchorKey(drop)],
      mouseSelectedKeys: [],
    });
    expect(items.map(t => t.raw_hex)).toEqual(['0xkeep', '0xdrop']);
  });

  it('pulls context only around a flagged side', () => {
    const anchor = makeTelegram({
      timestamp: '2024-01-01T10:00:00.000Z',
      source_address: '1.1.1',
      raw_hex: '0xa',
    });
    const near = makeTelegram({
      timestamp: '2024-01-01T10:00:00.400Z',
      source_address: '9.9.9',
      raw_hex: '0xb',
    });
    const filters = {
      ...DEFAULT_FILTERS,
      sources: ['1.1.1'],
      deltaBeforeMs: 0,
      deltaAfterMs: 1000,
      deltaContextEnabled: true,
    };
    const hidden = selectVisibleTelegrams([anchor, near], { ...baseOpts, filters });
    expect(hidden.items.map(t => t.raw_hex)).toEqual(['0xa']);

    const shown = selectVisibleTelegrams([anchor, near], {
      ...baseOpts,
      filters,
      flaggedAfterKeys: [anchorKey(anchor)],
    });
    expect(shown.items.map(t => t.raw_hex)).toEqual(['0xa', '0xb']);
    expect(shown.contextKeys).toEqual(new Set([anchorKey(near)]));
  });
});
