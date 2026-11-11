import { describe, expect, test } from 'vitest';
import { activeQuickFilter, compileQuickFilters, makeTextMatcher } from './quickFilter';
import { expandWithDeltaContext } from './deltaContextExpansion';
import { anchorKey } from './anchorKey';
import { makeTelegram } from '../test/telegramFactory';

const TELEGRAMS = [
  makeTelegram({ timestamp: '2024-01-01T10:00:00.000Z', target_address: '1/0/1', target_name: 'EG Licht' }),
  makeTelegram({ timestamp: '2024-01-01T10:00:00.500Z', target_address: '2/0/1', target_name: 'OG Jalousie' }),
  makeTelegram({ timestamp: '2024-01-01T10:00:05.000Z', target_address: '3/0/1', target_name: 'OG Heizung' }),
];

describe('makeTextMatcher', () => {
  test('default is case-insensitive substring', () => {
    const m = makeTextMatcher('licht');
    expect(m('EG Licht')).toBe(true);
    expect(m('OG Jalousie')).toBe(false);
  });

  test('regex: prefix compiles a case-insensitive regex', () => {
    const m = makeTextMatcher('regex:^EG');
    expect(m('EG Licht')).toBe(true);
    expect(m('xEG')).toBe(false);
  });

  test('quoted wildcard list matches any entry', () => {
    const m = makeTextMatcher('"EG*","OG Heizung"');
    expect(m('EG Licht')).toBe(true);
    expect(m('OG Heizung')).toBe(true);
    expect(m('OG Jalousie')).toBe(false);
  });
});

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

  test('skips patterns on a disabled column', () => {
    const patterns = { type: { top: 'Write', bottom: '' } };
    expect(activeQuickFilter(true, true, patterns, { type: false })).toBeNull();
  });
});

describe('compileQuickFilters TYPE', () => {
  const rows = [
    makeTelegram({ simplified_type: 'Write', direction: 'Incoming' }),
    makeTelegram({ simplified_type: 'Read', direction: 'Incoming' }),
    makeTelegram({ simplified_type: 'Response', direction: 'Outgoing' }),
  ];

  test('top filters type and bottom filters direction', () => {
    const byType = compileQuickFilters({ type: { top: 'Write', bottom: '' } });
    expect(rows.filter(byType).map(t => t.simplified_type)).toEqual(['Write']);

    const byDir = compileQuickFilters({ type: { top: '', bottom: 'Outgoing' } });
    expect(rows.filter(byDir).map(t => t.simplified_type)).toEqual(['Response']);

    const both = compileQuickFilters({ type: { top: 'regex:Write|Response', bottom: 'Outgoing' } });
    expect(rows.filter(both).map(t => t.simplified_type)).toEqual(['Response']);
  });
});

describe('compileQuickFilters DPT cells', () => {
  const rows = [
    makeTelegram({ dpt_main: 1, dpt_sub: 1, dpt_name: '1.001 - Switch', unit: null }),
    makeTelegram({ dpt_main: 9, dpt_sub: 1, dpt_name: '9.001 - Temperature', unit: '°C' }),
  ];

  test('bottom matches the displayed description, not the composite dpt_name', () => {
    const bySw = compileQuickFilters({ dpt: { top: '', bottom: '"sw*"' } });
    expect(rows.filter(bySw).map(t => t.dpt_name)).toEqual(['1.001 - Switch']);

    const byTemp = compileQuickFilters({ dpt: { top: '', bottom: '"temp*"' } });
    expect(rows.filter(byTemp).map(t => t.dpt_main)).toEqual([9]);
  });

  test('top matches the displayed DPT key label', () => {
    const byKey = compileQuickFilters({ dpt: { top: '1.001', bottom: '' } });
    expect(rows.filter(byKey).map(t => t.dpt_main)).toEqual([1]);
  });
});
