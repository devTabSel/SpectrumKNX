import { expect, test, vi } from 'vitest';
import {
  applyFilterParams,
  buildHistoryUrl,
  capHistory,
  dedupeByTimestamp,
  loadHistoryTelegrams,
  mergeHistoryWindow,
  rangeToMs,
  replaceHistoryWindow,
  retainLoadedJumpTargets,
} from './historyLoad';
import { DEFAULT_FILTERS } from '../types/filters';
import { makeTelegram } from '../test/telegramFactory';
import { anchorKey } from './anchorKey';

test('applyFilterParams sends the Time-Delta-Context window when enabled', () => {
  const url = applyFilterParams('/api/telegrams', { ...DEFAULT_FILTERS, deltaBeforeMs: 500, deltaAfterMs: 250 });
  expect(url).toContain('delta_before_ms=500');
  expect(url).toContain('delta_after_ms=250');
});

test('applyFilterParams omits the window while disabled, even with stored values (#318)', () => {
  const url = applyFilterParams('/api/telegrams', {
    ...DEFAULT_FILTERS, deltaBeforeMs: 500, deltaAfterMs: 250, deltaContextEnabled: false,
  });
  expect(url).not.toContain('delta_before_ms');
  expect(url).not.toContain('delta_after_ms');
});

test('buildHistoryUrl handles relative ranges correctly', () => {
  const url = buildHistoryUrl({ kind: 'relative', seconds: 3600 }, 100);
  expect(url).toContain('limit=100');
  expect(url).toContain('order=desc');
  expect(url).toContain('start_time=');
  expect(buildHistoryUrl({ kind: 'relative', seconds: 60 }, 10, 'asc')).toContain('order=asc');
});

test('buildHistoryUrl parses absolute local datetimes as local time and formats to UTC ISO', () => {
  const startTime = '2001-01-01T07:00';
  const endTime = '2001-01-01T09:00';
  const url = buildHistoryUrl({ kind: 'absolute', startTime, endTime }, 50);

  const expectedStart = new Date(startTime).toISOString();
  const expectedEnd = new Date(endTime).toISOString();

  expect(url).toContain('limit=50');
  expect(url).toContain(`start_time=${encodeURIComponent(expectedStart)}`);
  expect(url).toContain(`end_time=${encodeURIComponent(expectedEnd)}`);
});

test('rangeToMs resolves relative ranges to epoch ms', () => {
  const now = Date.now();
  const { startMs, endMs } = rangeToMs({ kind: 'relative', seconds: 10 }, now);
  expect(endMs).toBe(now);
  expect(startMs).toBe(now - 10000);
});

test('applyFilterParams leaves the direction filter for the client', () => {
  const url = applyFilterParams('/api/telegrams', { ...DEFAULT_FILTERS, directions: ['Incoming'] });
  expect(url).not.toContain('direction');
});

test('merge drops rows outside the new window and dedupes the fetch by timestamp', () => {
  const keep = makeTelegram({ timestamp: '2024-01-01T10:00:01.000Z', raw_hex: '0xkeep' });
  const drop = makeTelegram({ timestamp: '2024-01-01T10:00:09.000Z', raw_hex: '0xdrop' });
  const again = makeTelegram({ timestamp: '2024-01-01T10:00:01.000Z', raw_hex: '0xdup' });
  const added = makeTelegram({ timestamp: '2024-01-01T10:00:02.000Z', raw_hex: '0xadd' });
  const start = Date.parse(keep.timestamp);
  const end = Date.parse(added.timestamp);
  const merged = mergeHistoryWindow([keep, drop], [again, added], start, end, 10, 'backward');
  expect(merged.map(t => t.raw_hex)).toEqual(['0xkeep', '0xadd']);
});

test('capHistory keeps the anchor side', () => {
  const rows = [0, 1, 2, 3].map(i => makeTelegram({
    timestamp: new Date(Date.parse('2024-01-01T10:00:00.000Z') + i * 1000).toISOString(),
    raw_hex: `0x${i}`,
  }));
  expect(capHistory(rows, 2, 'backward').map(t => t.raw_hex)).toEqual(['0x2', '0x3']);
  expect(capHistory(rows, 2, 'forward').map(t => t.raw_hex)).toEqual(['0x0', '0x1']);
  expect(dedupeByTimestamp([rows[0], rows[0]])).toHaveLength(1);
});

test('replaceHistoryWindow discards the previous list and a missing jump target', () => {
  const stay = makeTelegram({ timestamp: '2024-01-01T10:00:01.000Z', raw_hex: '0xstay' });
  const gone = makeTelegram({ timestamp: '2024-01-01T10:00:02.000Z', raw_hex: '0xgone' });
  const next = replaceHistoryWindow([stay], 10, 'backward');
  expect(next).toEqual([stay]);
  expect(retainLoadedJumpTargets([anchorKey(stay), anchorKey(gone)], next)).toEqual([anchorKey(stay)]);
});

test('loadHistoryTelegrams aborts without reading a body', async () => {
  const fetchMock = vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      reject(new DOMException('Aborted', 'AbortError'));
    });
  }));
  vi.stubGlobal('fetch', fetchMock);
  const ctrl = new AbortController();
  const pending = loadHistoryTelegrams({ kind: 'relative', seconds: 30 }, 10, undefined, ctrl.signal);
  ctrl.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  vi.unstubAllGlobals();
});

test('rangeToMs resolves absolute ranges to local timezone epoch ms', () => {
  const startTime = '2001-01-01T07:00';
  const endTime = '2001-01-01T09:00';
  const { startMs, endMs } = rangeToMs({ kind: 'absolute', startTime, endTime });

  expect(startMs).toBe(new Date(startTime).getTime());
  expect(endMs).toBe(new Date(endTime).getTime());
});
