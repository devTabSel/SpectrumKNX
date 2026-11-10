import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { resetDatabaseTimeRangeCache, useDatabaseTimeRange } from './useDatabaseTimeRange';

afterEach(() => {
  resetDatabaseTimeRangeCache();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('maps oldest/newest timestamps to local minDate/maxDate', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({
      oldest_timestamp: '2024-01-05T10:00:00.000Z',
      newest_timestamp: '2026-07-18T15:00:00.000Z',
    }),
  })));

  const { result } = renderHook(() => useDatabaseTimeRange());
  await waitFor(() => expect(result.current).not.toBeNull());

  const oldest = new Date('2024-01-05T10:00:00.000Z');
  const newest = new Date('2026-07-18T15:00:00.000Z');
  const pad = (n: number) => String(n).padStart(2, '0');
  const dateKey = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const dateTime = (d: Date) =>
    `${dateKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  expect(result.current).toEqual({
    minDate: dateKey(oldest),
    maxDate: dateKey(newest),
    minDateTime: dateTime(oldest),
    maxDateTime: dateTime(newest),
  });
});
