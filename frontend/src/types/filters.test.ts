import { describe, expect, test } from 'vitest';
import { DEFAULT_FILTERS, countAppliedFilterOptions, countFilterOptions, countSelections, dptKey, effectiveDeltaContext, enabledFilters, focusAddressesForList, hasActiveFilters, isFilterDisabled, matchesDpt, matchesTelegram, passesFocusAddressFilter, pruneDisabled, toggleFilterDisabled } from './filters';

describe('passesFocusAddressFilter', () => {
  const telegram = { source_address: '1.1.1', target_address: '1/2/3' };

  test('an empty selection does not hide telegrams', () => {
    expect(passesFocusAddressFilter(telegram, [], [])).toBe(true);
  });

  test('devices and group addresses each constrain their side, and both sides combine', () => {
    expect(passesFocusAddressFilter(telegram, [], ['1.1.1'])).toBe(true);
    expect(passesFocusAddressFilter(telegram, [], ['1.1.2'])).toBe(false);
    expect(passesFocusAddressFilter(telegram, ['1/2/3'], [])).toBe(true);
    expect(passesFocusAddressFilter(telegram, ['1/2/4'], ['1.1.1'])).toBe(false);
    expect(passesFocusAddressFilter(telegram, ['1/2/3'], ['1.1.1'])).toBe(true);
  });

  test('a side narrows the list only while its filter-focused checkbox is on', () => {
    expect(focusAddressesForList(['1/2/3'], ['1.1.1'], false, false)).toEqual({ gas: [], devices: [] });
    expect(focusAddressesForList(['1/2/3'], ['1.1.1'], true, false)).toEqual({ gas: [], devices: ['1.1.1'] });
    expect(focusAddressesForList(['1/2/3'], ['1.1.1'], false, true)).toEqual({ gas: ['1/2/3'], devices: [] });
  });
});

describe('effectiveDeltaContext', () => {
  test('returns the stored before/after values when enabled', () => {
    const f = { ...DEFAULT_FILTERS, deltaBeforeMs: 500, deltaAfterMs: 250, deltaContextEnabled: true };
    expect(effectiveDeltaContext(f)).toEqual({ before: 500, after: 250 });
  });

  test('zeroes the effective window when disabled, without touching the stored values (#318)', () => {
    const f = { ...DEFAULT_FILTERS, deltaBeforeMs: 500, deltaAfterMs: 250, deltaContextEnabled: false };
    expect(effectiveDeltaContext(f)).toEqual({ before: 0, after: 0 });
    expect(f.deltaBeforeMs).toBe(500); // re-enabling would restore these, not lose them
    expect(f.deltaAfterMs).toBe(250);
  });

  test('zeroes the effective window when the Δt column filter is off, without touching the stored values', () => {
    const f = { ...DEFAULT_FILTERS, deltaBeforeMs: 500, deltaAfterMs: 250, deltaContextEnabled: true };
    expect(effectiveDeltaContext(f, false)).toEqual({ before: 0, after: 0 });
    expect(f.deltaBeforeMs).toBe(500);
    expect(f.deltaAfterMs).toBe(250);
  });
});

describe('dptKey', () => {
  test('pads the sub to three digits', () => {
    expect(dptKey(1, 1)).toBe('1.001');
    expect(dptKey(9, 21)).toBe('9.021');
    expect(dptKey(16, 100)).toBe('16.100');
  });

  test('bare main when sub is missing', () => {
    expect(dptKey(9)).toBe('9');
    expect(dptKey(9, null)).toBe('9');
  });
});

describe('matchesDpt', () => {
  test('exact subtype match only selects that subtype (#180)', () => {
    expect(matchesDpt(['1.001'], 1, 1)).toBe(true);
    expect(matchesDpt(['1.001'], 1, 8)).toBe(false);
    expect(matchesDpt(['1.001'], 1, null)).toBe(false);
    expect(matchesDpt(['1.001'], 5, 1)).toBe(false);
  });

  test('bare main matches every subtype', () => {
    expect(matchesDpt(['1'], 1, 1)).toBe(true);
    expect(matchesDpt(['1'], 1, 8)).toBe(true);
    expect(matchesDpt(['1'], 1, null)).toBe(true);
    expect(matchesDpt(['1'], 11, 1)).toBe(false);
  });

  test('telegram without a DPT never matches', () => {
    expect(matchesDpt(['1.001'], null, null)).toBe(false);
    expect(matchesDpt(['1'], undefined, undefined)).toBe(false);
  });
});

describe('matchesTelegram DPT filtering', () => {
  const telegram = {
    source_address: '1.1.1',
    target_address: '1/2/3',
    simplified_type: 'Write',
    dpt_main: 1,
    dpt_sub: 8,
  };

  test('filters by sub-DPT key', () => {
    expect(matchesTelegram(telegram, { ...DEFAULT_FILTERS, dpts: ['1.008'] })).toBe(true);
    expect(matchesTelegram(telegram, { ...DEFAULT_FILTERS, dpts: ['1.001'] })).toBe(false);
    expect(matchesTelegram(telegram, { ...DEFAULT_FILTERS, dpts: ['1'] })).toBe(true);
  });
});

describe('matchesTelegram direction filtering (#194)', () => {
  const incoming = { source_address: '1.1.1', target_address: '1/2/3', simplified_type: 'Write', direction: 'Incoming' };
  const outgoing = { ...incoming, direction: 'Outgoing' };
  const undirected = { ...incoming, direction: null };

  test('filters by direction', () => {
    expect(matchesTelegram(incoming, { ...DEFAULT_FILTERS, directions: ['Outgoing'] })).toBe(false);
    expect(matchesTelegram(outgoing, { ...DEFAULT_FILTERS, directions: ['Outgoing'] })).toBe(true);
    expect(matchesTelegram(incoming, { ...DEFAULT_FILTERS, directions: ['Incoming', 'Outgoing'] })).toBe(true);
  });

  test('is orthogonal to the type filter', () => {
    expect(matchesTelegram(outgoing, { ...DEFAULT_FILTERS, types: ['Write'], directions: ['Outgoing'] })).toBe(true);
    expect(matchesTelegram(outgoing, { ...DEFAULT_FILTERS, types: ['Read'], directions: ['Outgoing'] })).toBe(false);
  });

  test('telegrams without a direction pass only when unfiltered', () => {
    expect(matchesTelegram(undirected, DEFAULT_FILTERS)).toBe(true);
    expect(matchesTelegram(undirected, { ...DEFAULT_FILTERS, directions: ['Incoming'] })).toBe(false);
  });
});

describe('matchesTelegram source/target combination (#275)', () => {
  const t = { source_address: '1.2.3', target_address: '0/1/2', simplified_type: 'Write' };

  test('source and target always combine with AND', () => {
    const f = { ...DEFAULT_FILTERS, sources: ['1.2.3'], targets: ['0/1/2'] };
    expect(matchesTelegram(t, f)).toBe(true);
    expect(matchesTelegram({ ...t, target_address: '9/9/9' }, f)).toBe(false);
    expect(matchesTelegram({ ...t, source_address: '9.9.9' }, f)).toBe(false);
  });

  test('legacy sourceTargetRelation="OR" is ignored and applied as AND', () => {
    const legacy = { ...DEFAULT_FILTERS, sources: ['1.2.3'], targets: ['0/1/2'], sourceTargetRelation: 'OR' as const };
    expect(matchesTelegram({ ...t, target_address: '9/9/9' }, legacy)).toBe(false);
    expect(matchesTelegram(t, legacy)).toBe(true);
  });
});

test('countFilterOptions tallies telegrams per filter option', () => {
  const t = (source_address: string, target_address: string, simplified_type: string, dpt_main: number | null, dpt_sub: number | null) =>
    ({ source_address, target_address, simplified_type, direction: 'Incoming', dpt_main, dpt_sub });
  const counts = countFilterOptions([
    t('1.1.1', '1/0/1', 'Write', 9, 1),
    t('1.1.1', '1/0/2', 'Write', 9, 4),
    t('1.1.2', '1/0/1', 'Read', 9, 1),
    t('1.1.2', '2/0/0', 'Write', 14, null),
    t('1.1.3', '3/0/0', 'Write', null, null),
  ]);
  expect(counts.sources).toEqual({ '1.1.1': 2, '1.1.2': 2, '1.1.3': 1 });
  expect(counts.targets).toEqual({ '1/0/1': 2, '1/0/2': 1, '2/0/0': 1, '3/0/0': 1 });
  expect(counts.types).toEqual({ Write: 4, Read: 1 });
  expect(counts.directions).toEqual({ Incoming: 5 });
  // Subtypes count under their own key and under the bare main type.
  expect(counts.dpts).toEqual({ '9.001': 2, '9.004': 1, '9': 3, '14': 1 });
});

test('countAppliedFilterOptions counts only telegrams the selections would keep', () => {
  const t = (source_address: string, target_address: string, simplified_type: string) =>
    ({ source_address, target_address, simplified_type, direction: 'Incoming', dpt_main: null, dpt_sub: null });
  const telegrams = [
    t('1.1.1', '1/0/1', 'Write'),
    t('1.1.1', '1/0/2', 'Read'),
    t('1.1.2', '1/0/1', 'Write'),
  ];
  const filters = { ...DEFAULT_FILTERS, sources: ['1.1.1'] };

  const counts = countAppliedFilterOptions(telegrams, filters);
  expect(counts.sources).toEqual({ '1.1.1': 2 });
  expect(counts.targets).toEqual({ '1/0/1': 1, '1/0/2': 1 });
  expect(counts.types).toEqual({ Write: 1, Read: 1 });

  // A switched-off selection does not constrain the count.
  const withBoth = { ...DEFAULT_FILTERS, sources: ['1.1.1', '1.1.2'], disabled: ['sources:1.1.2'] };
  expect(countAppliedFilterOptions(telegrams, withBoth).sources).toEqual({ '1.1.1': 2 });

  // No selection counts the whole set.
  expect(countAppliedFilterOptions(telegrams, DEFAULT_FILTERS).sources).toEqual({ '1.1.1': 2, '1.1.2': 1 });
});

describe('switching single filters off (#437)', () => {
  const base = { ...DEFAULT_FILTERS, sources: ['1.1.1', '1.1.2'], targets: ['1/0/1'], types: ['Write'], dpts: ['9.001'] };

  test('toggleFilterDisabled switches one entry off and on again', () => {
    const off = toggleFilterDisabled(base, 'sources', '1.1.2');
    expect(off.disabled).toEqual(['sources:1.1.2']);
    expect(isFilterDisabled(off, 'sources', '1.1.2')).toBe(true);
    expect(isFilterDisabled(off, 'sources', '1.1.1')).toBe(false);
    // the same value in another category is a different entry
    expect(isFilterDisabled(off, 'targets', '1.1.2')).toBe(false);
    expect(toggleFilterDisabled(off, 'sources', '1.1.2').disabled).toEqual([]);
    // the selections themselves are untouched
    expect(off.sources).toEqual(base.sources);
  });

  test('enabledFilters leaves the switched-off entries out', () => {
    const f = { ...base, disabled: ['sources:1.1.2', 'types:Write'] };
    const on = enabledFilters(f);
    expect(on.sources).toEqual(['1.1.1']);
    expect(on.types).toEqual([]);
    expect(on.targets).toEqual(['1/0/1']);
    expect(on.dpts).toEqual(['9.001']);
    expect(on.disabled).toEqual([]);
    // nothing switched off: the very same object, so memos downstream hold
    expect(enabledFilters(base)).toBe(base);
  });

  test('a switched-off entry no longer filters', () => {
    const t = { source_address: '1.1.9', target_address: '1/0/1', simplified_type: 'Write', direction: 'Incoming', dpt_main: 9, dpt_sub: 1 };
    expect(matchesTelegram(t, enabledFilters(base))).toBe(false);          // source 1.1.9 not selected
    const withoutSources = { ...base, disabled: ['sources:1.1.1', 'sources:1.1.2'] };
    expect(matchesTelegram(t, enabledFilters(withoutSources))).toBe(true); // category now unfiltered
  });

  test('switching everything off means no filter at all', () => {
    const all = { ...base, disabled: ['sources:1.1.1', 'sources:1.1.2', 'targets:1/0/1', 'types:Write', 'dpts:9.001'] };
    expect(hasActiveFilters(enabledFilters(all))).toBe(false);
    expect(countSelections(all)).toBe(5);
    expect(countSelections(enabledFilters(all))).toBe(0);
  });

  test('pruneDisabled forgets markers of entries that are no longer selected', () => {
    const f = { ...base, sources: ['1.1.1'], disabled: ['sources:1.1.2', 'targets:1/0/1', 'types:Read'] };
    expect(pruneDisabled(f).disabled).toEqual(['targets:1/0/1']);
    expect(pruneDisabled(base)).toBe(base);
    const clean = { ...base, disabled: ['targets:1/0/1'] };
    expect(pruneDisabled(clean)).toBe(clean);
  });
});
