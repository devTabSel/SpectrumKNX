import { expect, test, beforeEach, vi } from 'vitest';
import {
  saveUiState,
  loadUiState,
  DEFAULT_UI_STATE,
  UI_STORAGE_KEY,
  type UiSessionState,
} from './uiState';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

test('round-trip save/load works correctly', () => {
  const state: UiSessionState = {
    quickFilter: {
      open: true,
      enabled: true,
      patterns: { source: { top: '1.1.1', bottom: '' } },
      columnEnabled: { time: true, delta: true, source: false, target: true, type: true, dpt: true, value: true },
    },
    listAnchorKey: 'some-key',
    infoBarOpen: true,
    zoomRange: [1000, 2000],
    statsSearch: 'stats',
    buildingSearch: 'building',
    lastSeenLimit: 50,
    lastSeenLive: false,
    lastSeenSearch: 'lastseen',
    filtersEnabled: false,
    markedKeys: ['k-1'],
    mouseSelectedKeys: ['k-1'],
    hiddenKeys: ['k-hide'],
    markColorIndices: { 'k-1': 2 },
    flaggedBeforeKeys: ['flag-a'],
    flaggedAfterKeys: ['flag-b'],
  };

  saveUiState(state);
  const loaded = loadUiState();
  expect(loaded).toEqual(state);
});

test('sanitize keeps marked and mouse flags and drops goto/auto/context', () => {
  localStorage.setItem(
    UI_STORAGE_KEY,
    JSON.stringify({
      v: 1,
      markReasons: {
        a: ['manual', 'goto', 'context', 'auto', 'hidden', 'nope'],
        b: ['mouse'],
      },
      markColorIndices: { a: 1, bad: 99 },
      flaggedKeys: ['x', 'x', 3, ''],
      contextForAllMatches: false,
      individualContextWindows: {
        ok: { beforeMs: 1500, afterMs: 0 },
        legacy: { beforeSec: 1, afterSec: 2 },
        explicitOff: { beforeMs: 0, afterMs: 0, enabled: false, off: true },
      },
    }),
  );
  const loaded = loadUiState();
  expect(loaded?.markedKeys).toEqual(['a']);
  expect(loaded?.mouseSelectedKeys).toEqual(['b']);
  expect(loaded?.hiddenKeys).toEqual(['a']);
  expect(loaded?.markColorIndices).toEqual({ a: 1 });
  expect(loaded?.flaggedBeforeKeys).toEqual(['x']);
  expect(loaded?.flaggedAfterKeys).toEqual(['x']);
  expect(loaded).not.toHaveProperty('contextForAllMatches');
  expect(loaded).not.toHaveProperty('individualContextWindows');
});

test('per-side context flags replace a legacy single flag list', () => {
  localStorage.setItem(
    UI_STORAGE_KEY,
    JSON.stringify({
      v: 1,
      flaggedBeforeKeys: ['before-only', 'before-only', ''],
      flaggedAfterKeys: ['after-only'],
      flaggedKeys: ['legacy'],
    }),
  );
  const loaded = loadUiState();
  expect(loaded?.flaggedBeforeKeys).toEqual(['before-only']);
  expect(loaded?.flaggedAfterKeys).toEqual(['after-only']);
});

test('returns null when storage is empty', () => {
  expect(loadUiState()).toBeNull();
});

test('version mismatch returns null', () => {
  localStorage.setItem(UI_STORAGE_KEY, JSON.stringify({ v: 2, listFollow: false }));
  expect(loadUiState()).toBeNull();
});

test('malformed JSON returns null', () => {
  localStorage.setItem(UI_STORAGE_KEY, '{invalid json');
  expect(loadUiState()).toBeNull();
});

test('storage throws returns null/gracefully handles error', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('Storage failed');
  });
  expect(loadUiState()).toBeNull();
});

test('sanitize drops invalid fields and fills defaults', () => {
  localStorage.setItem(
    UI_STORAGE_KEY,
    JSON.stringify({
      v: 1,
      quickFilter: {
        open: 'not a boolean',
        enabled: true,
        patterns: ['invalid array instead of object'],
      },
      zoomRange: [10, 'not a number'],
    })
  );

  const loaded = loadUiState();
  expect(loaded).toEqual({
    ...DEFAULT_UI_STATE,
    quickFilter: {
      open: false,
      enabled: true,
      patterns: {},
      columnEnabled: DEFAULT_UI_STATE.quickFilter.columnEnabled,
    },
    zoomRange: null,
  });
});

test('drops pre-#309 single-string pattern cells instead of guessing top/bottom', () => {
  localStorage.setItem(
    UI_STORAGE_KEY,
    JSON.stringify({
      v: 1,
      quickFilter: {
        open: true,
        enabled: true,
        patterns: { source: '1.1.1', target: { top: '1/2/3', bottom: 'kitchen' } },
      },
    })
  );

  const loaded = loadUiState();
  expect(loaded?.quickFilter.patterns).toEqual({ target: { top: '1/2/3', bottom: 'kitchen' } });
  expect(loaded?.quickFilter.columnEnabled).toEqual(DEFAULT_UI_STATE.quickFilter.columnEnabled);
});

test('sanitize keeps stored column filter on/off and fills missing columns', () => {
  localStorage.setItem(
    UI_STORAGE_KEY,
    JSON.stringify({
      v: 1,
      quickFilter: {
        open: true,
        enabled: true,
        patterns: {},
        columnEnabled: { target: false, bogus: 'nope' },
      },
    }),
  );
  const loaded = loadUiState();
  expect(loaded?.quickFilter.columnEnabled).toEqual({
    ...DEFAULT_UI_STATE.quickFilter.columnEnabled,
    target: false,
  });
});
