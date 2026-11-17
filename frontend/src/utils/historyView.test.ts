import { expect, test } from 'vitest';
import { DEFAULT_FILTERS, type ActiveFilters } from '../types/filters';
import { makeTelegram } from '../test/telegramFactory';
import { anchorKey } from './anchorKey';
import { historyCounts, historyDisplayFilters, sidePanelPending } from './historyView';
import type { SelectVisibleOpts } from './selectVisibleTelegrams';

const applied: ActiveFilters = { ...DEFAULT_FILTERS, sources: ['1.1.1'] };

const baseOpts = (filters: ActiveFilters): SelectVisibleOpts => ({
  filters,
  filtersEnabled: true,
  quickFilterOpen: false,
  quickFilterEnabled: false,
  quickPatterns: {},
  flaggedBeforeKeys: [],
  flaggedAfterKeys: [],
  markedKeys: [],
  mouseSelectedKeys: [],
  lastSelectedKey: null,
});

test('every side-panel change, tighter or looser, stays pending until refresh', () => {
  expect(sidePanelPending(null, applied)).toBe(false);
  expect(sidePanelPending(applied, applied)).toBe(false);
  expect(sidePanelPending(applied, { ...applied, sources: ['1.1.1', '2.2.2'] })).toBe(true);
  expect(sidePanelPending(applied, { ...applied, sources: [] })).toBe(true);
  expect(sidePanelPending(applied, { ...applied, types: ['Write'] })).toBe(true);
});

test('a delta-window edit is not a pending side-panel change', () => {
  const widened = { ...applied, deltaBeforeMs: 500, deltaAfterMs: 500, deltaContextEnabled: true };
  expect(sidePanelPending(applied, widened)).toBe(false);
  expect(historyDisplayFilters(applied, widened).sources).toEqual(['1.1.1']);
  expect(historyDisplayFilters(applied, widened).deltaAfterMs).toBe(500);
});

test('the history counter shows x / y only while the quick filter is active', () => {
  const match = makeTelegram({
    timestamp: '2024-01-01T10:00:00.000Z',
    source_address: '1.1.1',
    target_name: 'EG Licht',
    simplified_type: 'Write',
    raw_hex: '0xmatch',
  });
  const other = makeTelegram({
    timestamp: '2024-01-01T10:00:01.000Z',
    source_address: '1.1.1',
    target_name: 'Keller',
    simplified_type: 'Write',
    raw_hex: '0xother',
  });
  const marked = makeTelegram({
    timestamp: '2024-01-01T10:00:02.000Z',
    source_address: '9.9.9',
    simplified_type: 'Read',
    raw_hex: '0xmark',
  });
  const rows = [match, other, marked];
  const side = historyCounts(rows, {
    ...baseOpts(applied),
    markedKeys: [anchorKey(marked)],
  });
  // y keeps the side-panel matches and the marked miss. No x / y yet.
  expect(side).toEqual({ x: 3, y: 3, quickActive: false });

  const quick = historyCounts(rows, {
    ...baseOpts(applied),
    markedKeys: [anchorKey(marked)],
    quickFilterOpen: true,
    quickFilterEnabled: true,
    quickPatterns: { target: { top: '', bottom: 'EG' } },
  });
  // x is the EG match plus the marked miss. Keller passes the side panel only, so it stays in y.
  expect(quick).toEqual({ x: 2, y: 3, quickActive: true });
});
