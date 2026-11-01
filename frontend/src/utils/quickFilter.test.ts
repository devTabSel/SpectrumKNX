import { describe, expect, test } from 'vitest';
import { activeQuickFilter, DEFAULT_QUICK_FILTER_COLUMN_ENABLED, isPlainTextSearch, matchesAnyText } from './quickFilter';
import { expandWithDeltaContext } from './deltaContextExpansion';
import { anchorKey } from './anchorKey';
import { makeTelegram } from '../test/telegramFactory';

const TELEGRAMS = [
  makeTelegram({ timestamp: '2024-01-01T10:00:00.000Z', target_address: '1/0/1', target_name: 'EG Licht' }),
  makeTelegram({ timestamp: '2024-01-01T10:00:00.500Z', target_address: '2/0/1', target_name: 'OG Jalousie' }),
  makeTelegram({ timestamp: '2024-01-01T10:00:05.000Z', target_address: '3/0/1', target_name: 'OG Heizung' }),
];

describe('activeQuickFilter', () => {
  test('is null while the bar is closed, disabled or empty', () => {
    const patterns = { target: { top: '', bottom: 'EG' } };
    expect(activeQuickFilter(false, true, patterns)).toBeNull();
    expect(activeQuickFilter(true, false, patterns)).toBeNull();
    expect(activeQuickFilter(true, true, {})).toBeNull();
    expect(activeQuickFilter(true, true, { delta: { top: '100', bottom: '' } })).toBeNull();
  });

  test('quick-filter matches anchor the Time-Delta-Context window (#520)', () => {
    const quick = activeQuickFilter(true, true, { target: { top: '', bottom: 'regex:^EG' } })!;
    const matches = TELEGRAMS.map(quick);
    const { items, contextKeys } = expandWithDeltaContext(TELEGRAMS, matches, anchorKey, new Set(), 1000, 1000);
    expect(items.map(t => t.target_name)).toEqual(['EG Licht', 'OG Jalousie']);
    expect([...contextKeys]).toEqual([anchorKey(TELEGRAMS[1])]);
  });

  test('a name is a literal substring unless it is a quoted wildcard list or a regex: expression', () => {
    const names = (pattern: string) => TELEGRAMS
      .filter(activeQuickFilter(true, true, { target: { top: '', bottom: pattern } })!)
      .map(t => t.target_name);
    expect(names('EG')).toEqual(['EG Licht']);
    expect(names('Licht|Jalousie')).toEqual([]);
    expect(names('regex:^EG')).toEqual(['EG Licht']);
    expect(names('"EG*"')).toEqual(['EG Licht']);
    expect(names('"OG Jalousi+"')).toEqual(['OG Jalousie']);
    expect(names('regex:(')).toEqual([]);
  });

  test('matchesAnyText uses the same grammar on every listed field', () => {
    expect(matchesAnyText('', undefined, null)).toBe(true);
    expect(matchesAnyText('licht', '1/2/3', 'EG Licht')).toBe(true);
    expect(matchesAnyText('licht', '1/2/3', 'OG Heizung')).toBe(false);
    expect(matchesAnyText('"EG *"', '1/2/3', 'EG Licht')).toBe(true);
    expect(matchesAnyText('regex:^1/2', '1/2/3', 'EG Licht')).toBe(true);
    expect(matchesAnyText('regex:(', '1/2/3', 'EG Licht')).toBe(false);
    expect(isPlainTextSearch('EG Licht')).toBe(true);
    expect(isPlainTextSearch('regex:^EG')).toBe(false);
    expect(isPlainTextSearch('"EG*"')).toBe(false);
  });

  test('a column switched off does not apply its pattern', () => {
    const columns = { ...DEFAULT_QUICK_FILTER_COLUMN_ENABLED, target: false };
    expect(activeQuickFilter(true, true, { target: { top: '', bottom: 'EG' } }, columns)).toBeNull();
  });
});
