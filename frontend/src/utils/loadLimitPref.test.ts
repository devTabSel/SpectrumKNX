import { beforeEach, expect, test } from 'vitest';
import { getPref, setPref } from './prefs';
import {
  HISTORY_LOAD_LIMIT_PREF,
  LEGACY_LOAD_LIMIT_PREF,
  MONITOR_LOAD_LIMIT_PREF,
  readLoadLimit,
} from './loadLimitPref';

beforeEach(() => {
  localStorage.clear();
});

test('monitor and history load limits start from the legacy preference', () => {
  setPref(LEGACY_LOAD_LIMIT_PREF, '25000');
  expect(readLoadLimit(MONITOR_LOAD_LIMIT_PREF)).toBe(25000);
  expect(readLoadLimit(HISTORY_LOAD_LIMIT_PREF)).toBe(25000);
});

test('each view keeps its own load limit once it has been stored', () => {
  setPref(LEGACY_LOAD_LIMIT_PREF, '25000');
  setPref(MONITOR_LOAD_LIMIT_PREF, '4000');
  setPref(HISTORY_LOAD_LIMIT_PREF, '8000');
  expect(readLoadLimit(MONITOR_LOAD_LIMIT_PREF)).toBe(4000);
  expect(readLoadLimit(HISTORY_LOAD_LIMIT_PREF)).toBe(8000);
  expect(getPref(LEGACY_LOAD_LIMIT_PREF)).toBe('25000');
});

test('a missing legacy preference falls back to the built-in default', () => {
  expect(readLoadLimit(MONITOR_LOAD_LIMIT_PREF)).toBe(100_000);
  expect(readLoadLimit(HISTORY_LOAD_LIMIT_PREF)).toBe(100_000);
});
