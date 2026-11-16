import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
  clampMonitorPageSize,
  isSameMillisecondStall,
  MONITOR_PAGE_SIZE_DEFAULT,
  MONITOR_PAGE_SIZE_MAX,
  MONITOR_PAGE_SIZE_MIN,
  budgetSegments,
  resolveFullBufferPaging,
  useTelegramCache,
} from './useTelegramCache';
import { TelegramBufferService } from '../services/telegram-buffer-service';
import { gaReadPhases } from '../utils/groupValueEvents';
import { makeTelegram } from '../test/telegramFactory';
import { toEntry } from '../utils/telegramId';
import { COVERAGE_STORAGE_KEY } from '../services/telegram-coverage-service';
import type { Telegram } from './useWebSocket';

// In-memory IDB stand-in shared with the cache service.
const _idb = new Map<string, { ts: number; telegram: Telegram }>();
// Flip on to make cache writes reject (simulates IndexedDB quota failures).
let storeShouldFail = false;

vi.mock('idb-keyval', () => ({
  createStore: () => 'mock-store',
  setMany: async (pairs: [string, { ts: number; telegram: Telegram }][]) => {
    if (storeShouldFail) throw new Error('QuotaExceededError');
    for (const [k, v] of pairs) _idb.set(k, v);
  },
  entries: async () => Array.from(_idb.entries()),
  delMany: async (keys: string[]) => {
    for (const k of keys) _idb.delete(k);
  },
  clear: async () => _idb.clear(),
}));

/** Telegram with a distinct identity at the given epoch-ms timestamp. */
const tg = (ts: number, key = String(ts)): Telegram =>
  makeTelegram({
    timestamp: new Date(ts).toISOString(),
    source_address: `1.2.${key}`,
  });

const seedIdb = (telegrams: Telegram[]) => {
  for (const t of telegrams) {
    const e = toEntry(t);
    _idb.set(e.id, { ts: e.ts, telegram: e.telegram });
  }
};

interface MockResponse {
  telegrams: Telegram[];
  limitReached?: boolean;
}

let telegramResponses: MockResponse[];
let fetchCalls: string[];

const jsonRes = (body: unknown) =>
  ({ ok: true, json: async () => body }) as Response;

beforeEach(() => {
  _idb.clear();
  storeShouldFail = false;
  localStorage.clear();
  telegramResponses = [];
  fetchCalls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      fetchCalls.push(u);
      if (u.includes('/api/database/info')) {
        return jsonRes({ retention_days: null });
      }
      const next = telegramResponses.shift() ?? { telegrams: [] };
      return jsonRes({
        telegrams: next.telegrams,
        metadata: { limit_reached: next.limitReached ?? false },
      });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Waits for the startup restore + gap fill to settle. */
const settle = async (result: { current: { isLoading: boolean } }) => {
  await waitFor(() => expect(result.current.isLoading).toBe(false));
};

describe('budgetSegments', () => {
  it('walks backward from the new edge and forward from the start', () => {
    const gaps: [number, number][] = [[0, 99], [200, 300]];
    expect(budgetSegments(0, 400, gaps, 'backward')).toEqual([
      { kind: 'cache', start: 301, end: 400 },
      { kind: 'gap', start: 200, end: 300 },
      { kind: 'cache', start: 100, end: 199 },
      { kind: 'gap', start: 0, end: 99 },
    ]);
    expect(budgetSegments(0, 400, gaps, 'forward')).toEqual([
      { kind: 'gap', start: 0, end: 99 },
      { kind: 'cache', start: 100, end: 199 },
      { kind: 'gap', start: 200, end: 300 },
      { kind: 'cache', start: 301, end: 400 },
    ]);
  });
});

describe('resolveFullBufferPaging (#313)', () => {
  it('continues when the buffer is not full', () => {
    expect(resolveFullBufferPaging({
      forward: false, bufferFull: false, cursor: 100, oldestTs: 500,
    })).toEqual({ action: 'continue' });
    expect(resolveFullBufferPaging({
      forward: true, bufferFull: false, cursor: 100, oldestTs: 500,
    })).toEqual({ action: 'continue' });
  });

  it('continues when oldestTs is unknown', () => {
    expect(resolveFullBufferPaging({
      forward: false, bufferFull: true, cursor: 100, oldestTs: null,
    })).toEqual({ action: 'continue' });
  });

  it('continues once the cursor is inside or above the buffer window', () => {
    expect(resolveFullBufferPaging({
      forward: false, bufferFull: true, cursor: 500, oldestTs: 500,
    })).toEqual({ action: 'continue' });
    expect(resolveFullBufferPaging({
      forward: true, bufferFull: true, cursor: 900, oldestTs: 500,
    })).toEqual({ action: 'continue' });
  });

  it('breaks backward when the cursor is below oldestTs', () => {
    expect(resolveFullBufferPaging({
      forward: false, bufferFull: true, cursor: 100, oldestTs: 500,
    })).toEqual({ action: 'break' });
  });

  it('skips forward ahead to oldestTs when the cursor is below it', () => {
    // Mirror of #313 for forward: discardable [cursor, oldestTs) stays
    // uncovered; paging resumes at the kept window. Do not break above newestTs.
    expect(resolveFullBufferPaging({
      forward: true, bufferFull: true, cursor: 100, oldestTs: 500,
    })).toEqual({ action: 'skip', cursor: 500 });
  });
});

describe('useTelegramCache', () => {
  it('starts empty and fetches nothing without prior coverage or cache', async () => {
    const { result } = renderHook(() => useTelegramCache(1000));
    await settle(result);

    expect(result.current.telegrams).toEqual([]);
    expect(fetchCalls.filter(u => u.includes('/api/telegrams'))).toEqual([]);
  });

  it('paints cached telegrams on startup and fetches only the gap up to now', async () => {
    const t1 = tg(1000, 'a');
    const t2 = tg(2000, 'b');
    seedIdb([t1, t2]);
    localStorage.setItem(COVERAGE_STORAGE_KEY, JSON.stringify([[1000, 2000]]));
    const gapTelegram = tg(5000, 'c');
    telegramResponses.push({ telegrams: [gapTelegram] });

    const { result } = renderHook(() => useTelegramCache(1000));
    await settle(result);

    // Newest first: gap fill result, then the cached entries.
    expect(result.current.telegrams.map(t => t.source_address)).toEqual([
      '1.2.c',
      '1.2.b',
      '1.2.a',
    ]);

    const gapCall = fetchCalls.find(u => u.includes('/api/telegrams'));
    expect(gapCall).toBeDefined();
    // The covered range [1000, 2000] is not re-fetched: the gap starts after it.
    const params = new URLSearchParams(gapCall!.split('?')[1]);
    expect(Date.parse(params.get('start_time')!)).toBe(2001);
  });

  it('skips the startup restore when restoreFromCache is off, keeping live and manual loads', async () => {
    seedIdb([tg(1000, 'a'), tg(2000, 'b')]);
    localStorage.setItem(COVERAGE_STORAGE_KEY, JSON.stringify([[1000, 2000]]));

    const { result } = renderHook(() => useTelegramCache(1000, false));
    await settle(result);

    // Nothing restored and nothing fetched from the backend on startup.
    expect(result.current.telegrams).toEqual([]);
    expect(fetchCalls.filter(u => u.includes('/api/telegrams'))).toEqual([]);

    // Live telegrams still flow into the view.
    act(() => {
      result.current.addLive(tg(3000, 'live'));
    });
    expect(result.current.telegrams.map(t => t.source_address)).toEqual(['1.2.live']);

    // A manual history load still serves cache hits.
    await act(async () => {
      await result.current.loadRange(1000, 2000);
    });
    expect(result.current.telegrams.map(t => t.source_address)).toEqual([
      '1.2.live',
      '1.2.b',
      '1.2.a',
    ]);
  });

  it('startup admits at most loadLimit new rows from the cache and the database together', async () => {
    const limit = 4;
    seedIdb(Array.from({ length: 6 }, (_, i) => tg(i + 1, `c${i + 1}`)));
    localStorage.setItem(COVERAGE_STORAGE_KEY, JSON.stringify([[1, 6]]));
    // Newer than the covered cache, so the backward walk takes these first.
    telegramResponses.push({
      telegrams: [tg(9, 'n3'), tg(8, 'n2'), tg(7, 'n1')],
    });

    const { result } = renderHook(() => useTelegramCache(limit));
    await settle(result);

    // 3 database rows + the 1 newest cached row. The older cache stays in IDB.
    expect(result.current.telegrams.map(t => t.source_address)).toEqual([
      '1.2.n3', '1.2.n2', '1.2.n1', '1.2.c6',
    ]);
    const startupCall = fetchCalls.find(u => u.includes('/api/telegrams'));
    expect(new URLSearchParams(startupCall!.split('?')[1]).get('limit')).toBe(String(limit));
    expect(_idb.size).toBe(9);

    // The covered tail is not asked of the database again.
    const before = fetchCalls.filter(u => u.includes('/api/telegrams')).length;
    await act(async () => {
      await result.current.loadRange(1, 2);
    });
    expect(fetchCalls.filter(u => u.includes('/api/telegrams')).length).toBe(before);
  });

  it('publishes live telegrams newest first', async () => {
    const { result } = renderHook(() => useTelegramCache(1000));
    await settle(result);

    act(() => {
      result.current.addLive(tg(1000, 'a'));
      result.current.addLive(tg(2000, 'b'));
    });

    expect(result.current.telegrams.map(t => t.source_address)).toEqual(['1.2.b', '1.2.a']);
  });

  it('deduplicates a live telegram already delivered by a fetch', async () => {
    const dup = tg(5000, 'dup');
    localStorage.setItem(COVERAGE_STORAGE_KEY, JSON.stringify([[1000, 1000]]));
    telegramResponses.push({ telegrams: [dup] });

    const { result } = renderHook(() => useTelegramCache(1000));
    await settle(result);
    expect(result.current.telegrams).toHaveLength(1);

    act(() => {
      result.current.addLive(dup);
    });
    expect(result.current.telegrams).toHaveLength(1);
  });

  it('freezes the snapshot while paused and reveals everything on resume', async () => {
    const { result } = renderHook(() => useTelegramCache(1000));
    await settle(result);

    act(() => {
      result.current.addLive(tg(1000, 'a'));
    });
    act(() => {
      result.current.setPaused(true);
    });
    act(() => {
      result.current.addLive(tg(2000, 'b'));
      result.current.addLive(tg(3000, 'c'));
    });

    // Snapshot frozen, but ingestion keeps counting. The backlog array is
    // mutated in place — a new arrival must not allocate a fresh copy.
    // The ingested view keeps the live tail for GA read phase.
    expect(result.current.telegrams).toHaveLength(1);
    expect(result.current.ingested).toHaveLength(3);
    expect(result.current.pausedCount).toBe(2);
    const backlog = result.current.pausedTelegrams;
    expect(backlog.map(t => t.source_address)).toEqual(['1.2.c', '1.2.b']);
    act(() => {
      result.current.addLive(tg(4000, 'd'));
    });
    expect(result.current.pausedTelegrams).toBe(backlog);
    expect(backlog.map(t => t.source_address)).toEqual(['1.2.d', '1.2.c', '1.2.b']);

    act(() => {
      result.current.addLive(makeTelegram({
        timestamp: new Date(4000).toISOString(),
        source_address: '1.2.read',
        target_address: '9/9/9',
        simplified_type: 'Read',
        telegram_type: 'GroupValueRead',
      }));
      result.current.addLive(makeTelegram({
        timestamp: new Date(5000).toISOString(),
        source_address: '1.2.rsp',
        target_address: '9/9/9',
        simplified_type: 'Response',
        telegram_type: 'GroupValueResponse',
      }));
    });
    // The pause backlog stays out of the published snapshot. GA read phase
    // follows `ingested`, so a Response still in the backlog still answers.
    expect(gaReadPhases(result.current.telegrams).get('9/9/9')).toBeUndefined();
    expect(gaReadPhases(result.current.ingested).get('9/9/9')).toBe('answered');

    act(() => {
      result.current.setPaused(false);
    });
    expect(result.current.telegrams).toHaveLength(6);
    expect(result.current.pausedCount).toBe(0);
    expect(result.current.pausedTelegrams).toEqual([]);
  });

  it('revealPaused publishes the oldest n of the backlog, stays paused and keeps counting', async () => {
    const { result } = renderHook(() => useTelegramCache(1000));
    await settle(result);

    act(() => {
      result.current.addLive(tg(1000, 'a'));
    });
    act(() => {
      result.current.setPaused(true);
    });
    act(() => {
      result.current.addLive(tg(2000, 'b'));
      result.current.addLive(tg(3000, 'c'));
      result.current.addLive(tg(4000, 'd'));
      result.current.addLive(tg(5000, 'e'));
    });
    expect(result.current.telegrams.map(t => t.source_address)).toEqual(['1.2.a']);
    expect(result.current.pausedCount).toBe(4);
    expect(result.current.pausedTelegrams.map(t => t.source_address)).toEqual([
      '1.2.e', '1.2.d', '1.2.c', '1.2.b',
    ]);

    // Oldest two of the backlog become visible; the two newest stay hidden.
    let remaining = -1;
    act(() => {
      remaining = result.current.revealPaused(2);
    });
    expect(remaining).toBe(2);
    expect(result.current.pausedCount).toBe(2);
    expect(result.current.pausedTelegrams.map(t => t.source_address)).toEqual(['1.2.e', '1.2.d']);
    expect(result.current.telegrams.map(t => t.source_address)).toEqual(['1.2.c', '1.2.b', '1.2.a']);

    // Still paused: a new live telegram is hidden and counted, nothing else moves.
    act(() => {
      result.current.addLive(tg(6000, 'f'));
    });
    expect(result.current.pausedCount).toBe(3);
    expect(result.current.pausedTelegrams.map(t => t.source_address)).toEqual([
      '1.2.f', '1.2.e', '1.2.d',
    ]);
    expect(result.current.telegrams.map(t => t.source_address)).toEqual(['1.2.c', '1.2.b', '1.2.a']);

    // Over-revealing clamps at zero and shows everything.
    act(() => {
      remaining = result.current.revealPaused(10);
    });
    expect(remaining).toBe(0);
    expect(result.current.pausedCount).toBe(0);
    expect(result.current.telegrams.map(t => t.source_address)).toEqual([
      '1.2.f', '1.2.e', '1.2.d', '1.2.c', '1.2.b', '1.2.a',
    ]);

    // Not paused: no-op.
    act(() => {
      result.current.setPaused(false);
      result.current.addLive(tg(7000, 'g'));
    });
    act(() => {
      remaining = result.current.revealPaused(1);
    });
    expect(remaining).toBe(0);
    expect(result.current.telegrams).toHaveLength(7);
  });

  it('revealPaused prepends the revealed rows and does not copy the buffer snapshot', async () => {
    const desc = Object.getOwnPropertyDescriptor(TelegramBufferService.prototype, 'snapshot')!;
    let reads = 0;
    Object.defineProperty(TelegramBufferService.prototype, 'snapshot', {
      configurable: true,
      get() {
        reads += 1;
        return desc.get!.call(this);
      },
    });
    try {
      const { result } = renderHook(() => useTelegramCache(1000));
      await settle(result);
      act(() => {
        result.current.addLive(tg(1000, 'a'));
      });
      const frozen = result.current.telegrams;
      act(() => {
        result.current.setPaused(true);
      });
      act(() => {
        result.current.addLive(tg(2000, 'b'));
        result.current.addLive(tg(3000, 'c'));
      });
      reads = 0;
      act(() => {
        result.current.revealPaused(1);
      });
      expect(reads).toBe(0);
      expect(result.current.telegrams.map(t => t.source_address)).toEqual(['1.2.b', '1.2.a']);
      expect(result.current.telegrams[1]).toBe(frozen[0]);

      act(() => {
        result.current.revealPaused(1);
      });
      const shown = result.current.telegrams;
      expect(shown.map(t => t.source_address)).toEqual(['1.2.c', '1.2.b', '1.2.a']);
      act(() => {
        result.current.setPaused(false);
      });
      expect(result.current.telegrams).toBe(shown);
      expect(reads).toBe(0);
    } finally {
      Object.defineProperty(TelegramBufferService.prototype, 'snapshot', desc);
    }
  });

  it('drops evicted rows when the buffer is full and a portion is revealed', async () => {
    const { result } = renderHook(() => useTelegramCache(3));
    await settle(result);
    act(() => {
      result.current.addLive(tg(1000, 'a'));
      result.current.addLive(tg(2000, 'b'));
      result.current.addLive(tg(3000, 'c'));
    });
    act(() => {
      result.current.setPaused(true);
    });
    act(() => {
      result.current.addLive(tg(4000, 'd'));
      result.current.addLive(tg(5000, 'e'));
      result.current.addLive(tg(6000, 'f'));
      result.current.addLive(tg(7000, 'g'));
    });
    act(() => {
      result.current.revealPaused(1);
    });
    expect(result.current.telegrams).toEqual([]);
    act(() => {
      result.current.revealPaused(10);
    });
    expect(result.current.telegrams.map(t => t.source_address)).toEqual(['1.2.g', '1.2.f', '1.2.e']);
  });

  it('a live telegram on a full buffer prepends and drops the oldest', async () => {
    const { result } = renderHook(() => useTelegramCache(3));
    await settle(result);
    act(() => {
      result.current.addLive(tg(1000, 'a'));
      result.current.addLive(tg(2000, 'b'));
      result.current.addLive(tg(3000, 'c'));
    });
    const before = result.current.telegrams;
    act(() => {
      result.current.addLive(tg(4000, 'd'));
    });
    expect(result.current.telegrams.map(t => t.source_address)).toEqual(['1.2.d', '1.2.c', '1.2.b']);
    expect(result.current.telegrams[1]).toBe(before[0]);
    expect(result.current.telegrams[2]).toBe(before[1]);
  });


  it('loadRange serves cache hits and fetches only the gaps', async () => {
    const cached = tg(1500, 'cached');
    seedIdb([cached]);
    localStorage.setItem(COVERAGE_STORAGE_KEY, JSON.stringify([[1000, 2000]]));
    // Startup gap [2001, now], then the explicit load's gap [0, 999].
    telegramResponses.push({ telegrams: [] });
    telegramResponses.push({ telegrams: [tg(500, 'older')] });

    const { result } = renderHook(() => useTelegramCache(1000));
    await settle(result);

    await act(async () => {
      await result.current.loadRange(0, 2000);
    });

    expect(result.current.telegrams.map(t => t.source_address)).toEqual([
      '1.2.cached',
      '1.2.older',
    ]);
    const loadCall = fetchCalls.filter(u => u.includes('/api/telegrams')).at(-1)!;
    const params = new URLSearchParams(loadCall.split('?')[1]);
    expect(Date.parse(params.get('start_time')!)).toBe(0);
    expect(Date.parse(params.get('end_time')!)).toBe(999);
  });

  it('loads a gap in newest-first chunks, painting after each (#284)', async () => {
    // Coverage forces a single gap [0, 6000]; the backend serves it in two chunks.
    localStorage.setItem(COVERAGE_STORAGE_KEY, JSON.stringify([[6001, 6001]]));
    telegramResponses.push({ telegrams: [] }); // startup gap [6002, now]
    telegramResponses.push({ telegrams: [tg(5000, 'a'), tg(4000, 'b')], limitReached: true }); // chunk 1 (newest)
    telegramResponses.push({ telegrams: [tg(3000, 'c'), tg(2000, 'd')] }); // chunk 2 (older, final)

    const { result } = renderHook(() => useTelegramCache(1000));
    await settle(result);

    const before = fetchCalls.filter(u => u.includes('/api/telegrams')).length;
    await act(async () => {
      await result.current.loadRange(0, 6000);
    });
    const loadFetches = fetchCalls.filter(u => u.includes('/api/telegrams')).length - before;

    // Two chunk requests, all four telegrams merged newest-first.
    expect(loadFetches).toBe(2);
    expect(result.current.telegrams.map(t => t.source_address)).toEqual([
      '1.2.a', '1.2.b', '1.2.c', '1.2.d',
    ]);
    // The second chunk paged back to just the older remainder (up to chunk 1's oldest ts).
    const chunk2 = fetchCalls.filter(u => u.includes('/api/telegrams')).at(-1)!;
    const chunk2Params = new URLSearchParams(chunk2.split('?')[1]);
    expect(Date.parse(chunk2Params.get('end_time')!)).toBe(4000);
    expect(chunk2Params.get('order')).toBe('desc');
  });

  it('loads a gap forward in oldest-first chunks with order=asc', async () => {
    localStorage.setItem(COVERAGE_STORAGE_KEY, JSON.stringify([[6001, 6001]]));
    telegramResponses.push({ telegrams: [] }); // startup gap
    // Ascending chunks: oldest first within each page.
    telegramResponses.push({ telegrams: [tg(2000, 'd'), tg(3000, 'c')], limitReached: true });
    telegramResponses.push({ telegrams: [tg(4000, 'b'), tg(5000, 'a')] });

    const { result } = renderHook(() => useTelegramCache(1000));
    await settle(result);

    const before = fetchCalls.filter(u => u.includes('/api/telegrams')).length;
    await act(async () => {
      await result.current.loadRange(0, 6000, 'forward');
    });
    const loadUrls = fetchCalls.filter(u => u.includes('/api/telegrams')).slice(before);

    expect(loadUrls).toHaveLength(2);
    expect(result.current.telegrams.map(t => t.source_address)).toEqual([
      '1.2.a', '1.2.b', '1.2.c', '1.2.d',
    ]);
    const chunk1Params = new URLSearchParams(loadUrls[0].split('?')[1]);
    expect(chunk1Params.get('order')).toBe('asc');
    expect(Date.parse(chunk1Params.get('start_time')!)).toBe(0);
    // Second chunk continues from the newest ts of chunk 1.
    const chunk2Params = new URLSearchParams(loadUrls[1].split('?')[1]);
    expect(chunk2Params.get('order')).toBe('asc');
    expect(Date.parse(chunk2Params.get('start_time')!)).toBe(3000);
  });

  it('stops at the load budget and leaves the older remainder uncovered (#284)', async () => {
    localStorage.setItem(COVERAGE_STORAGE_KEY, JSON.stringify([[10_000, 10_000]]));
    telegramResponses.push({ telegrams: [] }); // startup gap fill

    // Buffer size 1 → the load budget is a single telegram: the first chunk
    // exhausts it and paging stops, deferring the rest.
    const { result } = renderHook(() => useTelegramCache(1));
    await settle(result);

    telegramResponses.push({ telegrams: [tg(9000, 'partial')], limitReached: true });
    await act(async () => {
      await result.current.loadRange(0, 10_000);
    });

    const saved = JSON.parse(localStorage.getItem(COVERAGE_STORAGE_KEY)!) as [number, number][];
    // [0, 8999] must remain a gap; coverage starts at the oldest returned row.
    expect(saved.some(([s]) => s === 9000)).toBe(true);
    expect(saved.some(([s]) => s === 0)).toBe(false);
  });

  it('forward budget leaves the newer remainder uncovered', async () => {
    localStorage.setItem(COVERAGE_STORAGE_KEY, JSON.stringify([[10_000, 10_000]]));
    telegramResponses.push({ telegrams: [] }); // startup gap fill

    const { result } = renderHook(() => useTelegramCache(1));
    await settle(result);

    telegramResponses.push({ telegrams: [tg(1000, 'partial')], limitReached: true });
    await act(async () => {
      await result.current.loadRange(0, 10_000, 'forward');
    });

    const saved = JSON.parse(localStorage.getItem(COVERAGE_STORAGE_KEY)!) as [number, number][];
    // Covered through the returned row; the newer side of the gap stays open.
    expect(saved.some(([s, e]) => s <= 1000 && 1000 <= e)).toBe(true);
    expect(saved.some(([s, e]) => s <= 0 && e >= 10_000)).toBe(false);
  });

  it('loadRange pages through the full range even when the buffer is full (#317)', async () => {
    // Buffer size 2, filled with the two newest (live) telegrams.
    const { result } = renderHook(() => useTelegramCache(2));
    await settle(result);
    act(() => {
      result.current.addLive(tg(8000, 'live1'));
      result.current.addLive(tg(9000, 'live2'));
    });
    expect(result.current.telegrams.map(t => t.source_address)).toEqual(['1.2.live2', '1.2.live1']);

    // User-initiated loadRange bypasses the full-buffer early break (#317):
    // older data IS fetched and persisted to IDB, even though the in-memory
    // buffer will evict it (buffer is at capacity with newer rows).
    telegramResponses.push({ telegrams: [tg(3000, 'old')] });
    const before = fetchCalls.filter(u => u.includes('/api/telegrams')).length;
    await act(async () => {
      await result.current.loadRange(1000, 5000);
    });
    const loadFetches = fetchCalls.filter(u => u.includes('/api/telegrams')).length - before;

    // A fetch WAS made (the old behavior would have skipped it entirely).
    expect(loadFetches).toBeGreaterThan(0);
    // The fetched telegram is persisted in IDB even if it got evicted from buffer.
    expect(_idb.has(toEntry(tg(3000, 'old')).id)).toBe(true);
  });

  it('startup gap fill still stops early when the buffer is full (#313)', async () => {
    // Buffer size 2 with prior coverage forcing a gap below the buffer window.
    localStorage.setItem(COVERAGE_STORAGE_KEY, JSON.stringify([[1000, 9000]]));
    seedIdb([tg(8000, 'a'), tg(9000, 'b')]);
    telegramResponses.push({ telegrams: [] }); // startup gap [9001, now]

    const { result } = renderHook(() => useTelegramCache(2));
    await settle(result);

    // The automatic startup restore still respects the full-buffer early break.
    // Reconnect gap fills hit fillGaps without skipBufferFullBreak.
    act(() => { result.current.setConnected(true); });
    act(() => { result.current.setConnected(false); });
    act(() => { result.current.setConnected(true); });

    // Only the reconnect gap [disconnect..now] is fetched, not older gaps.
    const reconnectFetches = fetchCalls
      .filter(u => u.includes('/api/telegrams'))
      .filter(u => {
        const p = new URLSearchParams(u.split('?')[1]);
        return Date.parse(p.get('end_time')!) < 8000;
      });
    expect(reconnectFetches).toHaveLength(0);
  });

  it('does not mark a range covered when the cache write fails (#317)', async () => {
    localStorage.setItem(COVERAGE_STORAGE_KEY, JSON.stringify([[10_000, 10_000]]));
    telegramResponses.push({ telegrams: [] }); // startup gap fill
    const { result } = renderHook(() => useTelegramCache(1000));
    await settle(result);

    // The load fetches a row, but persisting it to the cache fails.
    storeShouldFail = true;
    telegramResponses.push({ telegrams: [tg(5000, 'x')] });
    await act(async () => {
      await result.current.loadRange(0, 6000);
    });

    // The row is painted, but coverage must not claim its range — otherwise a
    // reload would trust coverage and never refetch the (uncached) row.
    expect(result.current.telegrams.map(t => t.source_address)).toContain('1.2.x');
    const saved = JSON.parse(localStorage.getItem(COVERAGE_STORAGE_KEY)!) as [number, number][];
    expect(saved.some(([s, e]) => s <= 5000 && 5000 <= e)).toBe(false);
  });

  it('defers coverage persistence while IDB writes are in flight (#317)', async () => {
    // Use a gated store to keep the IDB write pending.
    let releaseStore: () => void = () => {};
    const storeGate = new Promise<void>(res => { releaseStore = res; });
    let storeGateArmed = false;
    const origSetMany = vi.mocked(await import('idb-keyval')).setMany;
    vi.mocked(await import('idb-keyval')).setMany = vi.fn(async (...args: Parameters<typeof origSetMany>) => {
      if (storeGateArmed) await storeGate;
      return origSetMany(...args);
    }) as unknown as typeof origSetMany;

    const { result } = renderHook(() => useTelegramCache(1000));
    await settle(result);

    // Arm the gate so the next IDB write blocks.
    storeGateArmed = true;
    localStorage.removeItem(COVERAGE_STORAGE_KEY);

    // Add a live telegram — its batch flush will start a pending store.
    act(() => {
      for (let i = 0; i < 200; i++) result.current.addLive(tg(1000 + i, `batch${i}`));
    });

    // Coverage should NOT have been saved while the write is in flight.
    expect(localStorage.getItem(COVERAGE_STORAGE_KEY)).toBeNull();

    // Release the store and let the deferred save run.
    await act(async () => {
      releaseStore();
      // Allow microtasks to flush.
      await new Promise(r => setTimeout(r, 10));
    });

    // Now coverage should be persisted.
    expect(localStorage.getItem(COVERAGE_STORAGE_KEY)).not.toBeNull();

    // Restore the original mock.
    vi.mocked(await import('idb-keyval')).setMany = origSetMany;
  });

  it('records a load failure without breaking the buffer', async () => {
    const { result } = renderHook(() => useTelegramCache(1000));
    await settle(result);

    act(() => {
      result.current.addLive(tg(1000, 'a'));
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 }) as Response));

    await act(async () => {
      await result.current.loadRange(0, 500);
    });

    expect(result.current.loadError).toContain('500');
    expect(result.current.telegrams).toHaveLength(1);
  });

  it('discards an in-flight history chunk when the buffer is cleared mid-load (#339)', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>(res => { release = res; });
    let gateArmed = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        const u = String(url);
        fetchCalls.push(u);
        if (u.includes('/api/database/info')) return jsonRes({ retention_days: null });
        // Hold the history chunk in flight until the test releases it.
        if (gateArmed) await gate;
        return jsonRes({
          telegrams: [tg(2000, 'x'), tg(1000, 'y')],
          metadata: { limit_reached: false },
        });
      }),
    );

    const { result } = renderHook(() => useTelegramCache(1000));
    await settle(result);

    gateArmed = true;
    let load!: Promise<void>;
    act(() => {
      load = result.current.loadRange(0, 5000);
    });
    await waitFor(() => expect(result.current.isLoading).toBe(true));

    // User clears the buffer while the chunk is still loading.
    await act(async () => {
      await result.current.clear();
    });

    // The now-stale chunk resolves: it must be dropped, not merged back in.
    await act(async () => {
      release();
      await load;
    });

    expect(result.current.telegrams).toEqual([]);
    // Nothing was marked covered, so a later load can still fetch the range —
    // no gap between the discarded chunk and newer telegrams (#339).
    expect(JSON.parse(localStorage.getItem(COVERAGE_STORAGE_KEY)!)).toEqual([]);
  });

  it('clear wipes buffer, persistent cache and coverage', async () => {
    seedIdb([tg(1000, 'a')]);
    localStorage.setItem(COVERAGE_STORAGE_KEY, JSON.stringify([[1000, 1000]]));
    telegramResponses.push({ telegrams: [] });

    const { result } = renderHook(() => useTelegramCache(1000));
    await settle(result);
    expect(result.current.telegrams).toHaveLength(1);

    await act(async () => {
      await result.current.clear();
    });

    expect(result.current.telegrams).toEqual([]);
    expect(_idb.size).toBe(0);
    expect(JSON.parse(localStorage.getItem(COVERAGE_STORAGE_KEY)!)).toEqual([]);
  });

  it('clear resets pausedCount so the jump pill cannot show deleted telegrams', async () => {
    const { result } = renderHook(() => useTelegramCache(1000));
    await settle(result);

    act(() => {
      result.current.addLive(tg(1000, 'a'));
      result.current.setPaused(true);
      result.current.addLive(tg(2000, 'b'));
      result.current.addLive(tg(3000, 'c'));
    });
    expect(result.current.pausedCount).toBe(2);

    await act(async () => {
      await result.current.clear();
    });

    expect(result.current.telegrams).toEqual([]);
    expect(result.current.pausedCount).toBe(0);
  });

  it('evicts the oldest telegrams when shrinking the buffer limit', async () => {
    const { result, rerender } = renderHook(({ limit }) => useTelegramCache(limit), {
      initialProps: { limit: 3 },
    });
    await settle(result);

    act(() => {
      result.current.addLive(tg(1000, 'a'));
      result.current.addLive(tg(2000, 'b'));
      result.current.addLive(tg(3000, 'c'));
    });
    expect(result.current.telegrams).toHaveLength(3);

    rerender({ limit: 2 });
    expect(result.current.telegrams.map(t => t.source_address)).toEqual(['1.2.c', '1.2.b']);
  });

  it('fillForwardFrom pages the anchor window instead of stopping at the buffer oldest', async () => {
    // restoreFromCache=false: no startup fetch; responses are for fill only.
    const { result } = renderHook(() => useTelegramCache(1000, false));
    await settle(result);

    act(() => {
      result.current.setBufferRangeMinutes(1);
      result.current.addLive(tg(5000, 'live'));
    });
    expect(result.current.oldestTs).toBe(5000);

    // Ascending chunk older than the live edge. The live millisecond is covered,
    // so the window continues past it up to x + range.
    telegramResponses.push({
      telegrams: [tg(1000, 'old1'), tg(2000, 'old2'), tg(3000, 'old3')],
    });

    const before = fetchCalls.filter(u => u.includes('/api/telegrams')).length;
    await act(async () => {
      await result.current.fillForwardFrom(1000);
    });
    const loadCalls = fetchCalls.filter(u => u.includes('/api/telegrams')).slice(before);
    const first = new URLSearchParams(loadCalls[0].split('?')[1]);
    expect(first.get('order')).toBe('asc');
    expect(Date.parse(first.get('start_time')!)).toBe(1000);
    const ends = loadCalls.map(u => Date.parse(new URLSearchParams(u.split('?')[1]).get('end_time')!));
    expect(Math.max(...ends)).toBe(1000 + 60_000);
    expect(result.current.telegrams.map(t => t.source_address)).toEqual([
      '1.2.live', '1.2.old3', '1.2.old2', '1.2.old1',
    ]);
  });

  it('fillForwardFrom fills the tail past the buffer when x lies inside it', async () => {
    const { result } = renderHook(() => useTelegramCache(100, false));
    await settle(result);
    act(() => {
      result.current.setBufferRangeMinutes(1);
      result.current.addLive(tg(10_000, 'a'));
      result.current.addLive(tg(20_000, 'b'));
    });

    telegramResponses.push({ telegrams: [tg(30_000, 'c')] });
    const before = fetchCalls.filter(u => u.includes('/api/telegrams')).length;
    await act(async () => {
      await result.current.fillForwardFrom(15_000);
    });
    const call = fetchCalls.filter(u => u.includes('/api/telegrams')).slice(before).at(0)!;
    const params = new URLSearchParams(call.split('?')[1]);
    // Live coverage already holds [10_000, 20_000]; the gap starts after it
    // and runs to x + range, not to the old oldest edge.
    expect(Date.parse(params.get('start_time')!)).toBe(20_001);
    expect(Date.parse(params.get('end_time')!)).toBe(15_000 + 60_000);
    expect(result.current.telegrams.map(t => t.source_address)).toEqual([
      '1.2.c', '1.2.b', '1.2.a',
    ]);
  });

  it('fillForwardFrom treats a known-empty stretch as already filled', async () => {
    const { result } = renderHook(() => useTelegramCache(100, false));
    await settle(result);
    act(() => {
      result.current.setBufferRangeMinutes(1);
      result.current.addLive(tg(1000, 'a'));
    });
    telegramResponses.push({ telegrams: [] });
    await act(async () => {
      await result.current.loadRange(1001, 3000, 'forward');
    });

    telegramResponses.push({ telegrams: [tg(4000, 'b')] });
    const before = fetchCalls.filter(u => u.includes('/api/telegrams')).length;
    await act(async () => {
      await result.current.fillForwardFrom(1000);
    });
    const calls = fetchCalls.filter(u => u.includes('/api/telegrams')).slice(before);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      const params = new URLSearchParams(call.split('?')[1]);
      const start = Date.parse(params.get('start_time')!);
      const end = Date.parse(params.get('end_time')!);
      const overlapsEmpty = start <= 3000 && end >= 1001;
      expect(overlapsEmpty).toBe(false);
    }
    expect(result.current.telegrams.map(t => t.source_address)).toEqual(['1.2.b', '1.2.a']);
  });

  it('fillBackwardTo loads newest-first covering [endMs, now]', async () => {
    const { result } = renderHook(() => useTelegramCache(1000, false));
    await settle(result);

    const endMs = 2000;
    telegramResponses.push({ telegrams: [tg(3000, 'n'), tg(2500, 'm')] });
    await act(async () => {
      await result.current.fillBackwardTo(endMs);
    });
    const loadCall = fetchCalls.filter(u => u.includes('/api/telegrams')).at(-1)!;
    const params = new URLSearchParams(loadCall.split('?')[1]);
    expect(Date.parse(params.get('start_time')!)).toBe(endMs);
    expect(result.current.telegrams.map(t => t.source_address)).toEqual(['1.2.n', '1.2.m']);
  });

  it('cancelLoad invalidates an in-flight load so late chunks are ignored', async () => {
    const { result } = renderHook(() => useTelegramCache(1000, false));
    await settle(result);

    let release!: () => void;
    const blocked = new Promise<void>(r => { release = r; });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        const u = String(url);
        fetchCalls.push(u);
        if (u.includes('/api/database/info')) return jsonRes({ retention_days: null });
        if (u.includes('/api/telegrams')) {
          await blocked;
          return jsonRes({
            telegrams: [tg(1000, 'a')],
            metadata: { limit_reached: false },
          });
        }
        return jsonRes({});
      }),
    );

    let load!: Promise<void>;
    act(() => {
      load = result.current.loadRange(0, 5000);
    });
    await waitFor(() => expect(result.current.isLoading).toBe(true));
    act(() => {
      result.current.cancelLoad();
    });
    expect(result.current.isLoading).toBe(false);
    await act(async () => {
      release();
      await load;
    });
    // Cancelled load must not have published the delayed chunk.
    expect(result.current.telegrams).toEqual([]);
  });

  it('enforceTimeWindow trims forward to [oldest, oldest+range]', async () => {
    const { result } = renderHook(() => useTelegramCache(100, false));
    await settle(result);
    act(() => {
      result.current.setEvictionMode('keepOldest');
      result.current.addLive(tg(0, 'a'));
      result.current.addLive(tg(60_000, 'b'));
      result.current.addLive(tg(120_000, 'c'));
    });
    act(() => {
      result.current.enforceTimeWindow('forward', 1);
    });
    expect(result.current.telegrams.map(t => t.source_address)).toEqual([
      '1.2.b', '1.2.a',
    ]);
  });

  it('keepOldest eviction drops newest live telegrams when over maxSize', async () => {
    const { result } = renderHook(() => useTelegramCache(2, false));
    await settle(result);
    act(() => {
      result.current.setEvictionMode('keepOldest');
      result.current.addLive(tg(1000, 'a'));
      result.current.addLive(tg(2000, 'b'));
      result.current.addLive(tg(3000, 'c'));
    });
    expect(result.current.telegrams.map(t => t.source_address)).toEqual([
      '1.2.b', '1.2.a',
    ]);
  });
});

describe('buffer anchor', () => {
  const sources = (rows: { source_address: string }[]) => rows.map(t => t.source_address);

  const savedCoverage = () =>
    JSON.parse(localStorage.getItem(COVERAGE_STORAGE_KEY)!) as [number, number][];

  it('trims forward from an explicit anchor, not from the buffer edge', async () => {
    const { result } = renderHook(() => useTelegramCache(100, false));
    await settle(result);
    act(() => {
      result.current.addLive(tg(0, 'a'));
      result.current.addLive(tg(60_000, 'b'));
      result.current.addLive(tg(120_000, 'c'));
      result.current.addLive(tg(180_000, 'd'));
      result.current.setBufferAnchor({ direction: 'forward', ts: 60_000 });
      result.current.enforceTimeWindow('forward', 1);
    });
    expect(sources(result.current.telegrams)).toEqual(['1.2.c', '1.2.b']);
    expect(result.current.bufferAnchor).toEqual({ direction: 'forward', ts: 60_000 });
  });

  it('trims backward from an explicit anchor, not from the newest edge', async () => {
    const { result } = renderHook(() => useTelegramCache(100, false));
    await settle(result);
    act(() => {
      result.current.addLive(tg(0, 'a'));
      result.current.addLive(tg(60_000, 'b'));
      result.current.addLive(tg(120_000, 'c'));
      result.current.addLive(tg(180_000, 'd'));
      result.current.setBufferAnchor({ direction: 'backward', ts: 120_000 });
      result.current.enforceTimeWindow('backward', 1);
    });
    expect(sources(result.current.telegrams)).toEqual(['1.2.c', '1.2.b']);
    expect(result.current.bufferAnchor).toEqual({ direction: 'backward', ts: 120_000 });
  });

  it('drops the newest on forward overflow and the oldest on backward overflow', async () => {
    const { result: forward } = renderHook(() => useTelegramCache(3, false));
    await settle(forward);
    act(() => {
      forward.current.setBufferAnchor({ direction: 'forward', ts: 0 });
      forward.current.setBufferRangeMinutes(60);
      forward.current.addLive(tg(1000, 'a'));
      forward.current.addLive(tg(2000, 'b'));
    });
    telegramResponses.push({
      telegrams: [tg(3000, 'c'), tg(4000, 'd'), tg(5000, 'e')],
    });
    await act(async () => {
      await forward.current.loadRange(3000, 5000, 'forward');
    });
    expect(sources(forward.current.telegrams)).toEqual(['1.2.c', '1.2.b', '1.2.a']);
    expect(_idb.has(toEntry(tg(4000, 'd')).id)).toBe(true);
    expect(_idb.has(toEntry(tg(5000, 'e')).id)).toBe(true);

    const { result: backward } = renderHook(() => useTelegramCache(3, false));
    await settle(backward);
    act(() => {
      backward.current.setBufferAnchor({ direction: 'backward', ts: 5000 });
      backward.current.addLive(tg(4000, 'd'));
      backward.current.addLive(tg(5000, 'e'));
    });
    telegramResponses.push({
      telegrams: [tg(3000, 'c'), tg(2000, 'b'), tg(1000, 'a')],
    });
    await act(async () => {
      await backward.current.loadRange(1000, 3000);
    });
    expect(sources(backward.current.telegrams)).toEqual(['1.2.e', '1.2.d', '1.2.c']);
    expect(backward.current.bufferAnchor).toEqual({ direction: 'backward', ts: 5000 });
    expect(_idb.has(toEntry(tg(1000, 'a')).id)).toBe(true);
    expect(_idb.has(toEntry(tg(2000, 'b')).id)).toBe(true);
  });

  it('admits a forward telegram inside the window and keeps x fixed', async () => {
    const { result, unmount } = renderHook(() => useTelegramCache(10, false));
    await settle(result);
    act(() => {
      result.current.setBufferAnchor({ direction: 'forward', ts: 0 });
      result.current.setBufferRangeMinutes(1);
      result.current.addLive(tg(0, 'edge'));
      result.current.addLive(tg(60_000, 'inside'));
    });
    expect(sources(result.current.telegrams)).toEqual(['1.2.inside', '1.2.edge']);
    expect(result.current.bufferAnchor).toEqual({ direction: 'forward', ts: 0 });
    unmount();
    await waitFor(() => {
      expect(_idb.has(toEntry(tg(0, 'edge')).id)).toBe(true);
      expect(_idb.has(toEntry(tg(60_000, 'inside')).id)).toBe(true);
    });
  });

  it('keeps a forward telegram outside the window out of the buffer and in IndexedDB', async () => {
    const { result, unmount } = renderHook(() => useTelegramCache(10, false));
    await settle(result);
    act(() => {
      result.current.setBufferAnchor({ direction: 'forward', ts: 0 });
      result.current.setBufferRangeMinutes(1);
      result.current.addLive(tg(0, 'edge'));
    });
    const frozen = result.current.telegrams;
    const outside = tg(120_000, 'out');
    act(() => {
      result.current.addLive(outside);
    });
    expect(result.current.telegrams).toBe(frozen);
    expect(result.current.bufferAnchor).toEqual({ direction: 'forward', ts: 0 });
    unmount();
    await waitFor(() => {
      expect(_idb.has(toEntry(outside).id)).toBe(true);
      expect(savedCoverage().some(([s, e]) => s <= 120_000 && 120_000 <= e)).toBe(true);
    });
  });

  it('does not persist coverage for a forward miss when the cache write fails', async () => {
    const { result, unmount } = renderHook(() => useTelegramCache(10, false));
    await settle(result);
    act(() => {
      result.current.setBufferAnchor({ direction: 'forward', ts: 0 });
      result.current.setBufferRangeMinutes(1);
    });
    storeShouldFail = true;
    act(() => {
      result.current.addLive(tg(120_000, 'out'));
    });
    unmount();
    await act(async () => {
      await new Promise(r => setTimeout(r, 20));
    });
    expect(_idb.has(toEntry(tg(120_000, 'out')).id)).toBe(false);
    expect(localStorage.getItem(COVERAGE_STORAGE_KEY)).toBeNull();
  });

  it('leaves the forward buffer unchanged when it is already full', async () => {
    const { result, unmount } = renderHook(() => useTelegramCache(2, false));
    await settle(result);
    act(() => {
      result.current.setBufferAnchor({ direction: 'forward', ts: 0 });
      result.current.setBufferRangeMinutes(60);
      result.current.addLive(tg(1000, 'a'));
      result.current.addLive(tg(2000, 'b'));
    });
    const frozen = result.current.telegrams;
    const extra = tg(1500, 'mid');
    act(() => {
      result.current.addLive(extra);
    });
    expect(result.current.telegrams).toBe(frozen);
    expect(sources(result.current.telegrams)).toEqual(['1.2.b', '1.2.a']);
    expect(result.current.bufferAnchor).toEqual({ direction: 'forward', ts: 0 });
    unmount();
    await waitFor(() => {
      expect(_idb.has(toEntry(extra).id)).toBe(true);
    });
  });

  it('moves the backward anchor with the newest live telegram and drops the oldest', async () => {
    const { result } = renderHook(() => useTelegramCache(2, false));
    await settle(result);
    act(() => {
      result.current.setBufferAnchor({ direction: 'backward', ts: 1000 });
      result.current.addLive(tg(1000, 'a'));
      result.current.addLive(tg(2000, 'b'));
    });
    expect(result.current.bufferAnchor).toEqual({ direction: 'backward', ts: 2000 });
    act(() => {
      result.current.addLive(tg(1500, 'mid'));
    });
    expect(result.current.bufferAnchor.ts).toBe(2000);
    expect(sources(result.current.telegrams)).toEqual(['1.2.b', '1.2.mid']);
    act(() => {
      result.current.addLive(tg(3000, 'c'));
    });
    expect(result.current.bufferAnchor).toEqual({ direction: 'backward', ts: 3000 });
    expect(sources(result.current.telegrams)).toEqual(['1.2.c', '1.2.b']);
  });

  it('adopts a direction change by clearing the timestamp and keeping it when the direction stays', async () => {
    const { result } = renderHook(() => useTelegramCache(10, false));
    await settle(result);
    act(() => {
      result.current.setBufferAnchor({ direction: 'forward', ts: 5 });
      result.current.adoptAnchorDirection('backward');
    });
    expect(result.current.bufferAnchor).toEqual({ direction: 'backward', ts: null });
    act(() => {
      result.current.setBufferAnchor({ direction: 'backward', ts: 9 });
      result.current.adoptAnchorDirection('backward');
    });
    expect(result.current.bufferAnchor).toEqual({ direction: 'backward', ts: 9 });
  });

  it('switches direction by trimming to the buffer edge and filling the gap, without clearing', async () => {
    const { result } = renderHook(() => useTelegramCache(100, false));
    await settle(result);
    act(() => {
      result.current.setBufferRangeMinutes(1);
    });
    telegramResponses.push({ telegrams: [tg(30_000, 'b'), tg(0, 'a')] });
    await act(async () => {
      await result.current.loadRange(0, 30_000);
    });
    act(() => {
      result.current.addLive(tg(90_000, 'c'));
    });
    expect(sources(result.current.telegrams)).toEqual(['1.2.c', '1.2.b', '1.2.a']);

    // Pill direction change: anchor = oldest edge, window [oldest, oldest+range].
    act(() => {
      result.current.adoptAnchorDirection('forward');
      result.current.enforceTimeWindow('forward', 1);
    });
    expect(sources(result.current.telegrams)).toEqual(['1.2.b', '1.2.a']);
    telegramResponses.push({ telegrams: [tg(45_000, 'gap')] });
    await act(async () => {
      await result.current.fillForwardFrom(result.current.oldestTs!);
    });

    expect(sources(result.current.telegrams)).toEqual(['1.2.gap', '1.2.b', '1.2.a']);
    expect(result.current.bufferAnchor).toEqual({ direction: 'forward', ts: null });
    // The trimmed row and the kept rows are still in IndexedDB: this was not a clear.
    expect(_idb.has(toEntry(tg(0, 'a')).id)).toBe(true);
    expect(_idb.has(toEntry(tg(30_000, 'b')).id)).toBe(true);
    const saved = savedCoverage();
    expect(saved.some(([s, e]) => s <= 0 && 0 <= e)).toBe(true);
    expect(saved.some(([s, e]) => s <= 30_000 && 30_000 <= e)).toBe(true);
    expect(saved.some(([s, e]) => s <= 45_000 && 45_000 <= e)).toBe(true);
  });

  it('goto outside the buffer trims to the new window and fills it without clearing', async () => {
    const { result } = renderHook(() => useTelegramCache(100, false));
    await settle(result);
    telegramResponses.push({ telegrams: [tg(120_000, 'n'), tg(100_000, 'o')] });
    await act(async () => {
      await result.current.loadRange(100_000, 120_000);
    });
    expect(_idb.has(toEntry(tg(100_000, 'o')).id)).toBe(true);

    act(() => {
      result.current.setBufferAnchor({ direction: 'forward', ts: 0 });
      result.current.enforceTimeWindow('forward', 1);
    });
    expect(result.current.telegrams).toEqual([]);

    telegramResponses.push({ telegrams: [tg(10_000, 'g')] });
    await act(async () => {
      await result.current.fillForwardFrom(0);
    });
    expect(sources(result.current.telegrams)).toEqual(['1.2.g']);
    expect(result.current.bufferAnchor).toEqual({ direction: 'forward', ts: 0 });
    // Old rows and their coverage survived the retarget.
    expect(_idb.has(toEntry(tg(100_000, 'o')).id)).toBe(true);
    expect(_idb.has(toEntry(tg(120_000, 'n')).id)).toBe(true);
    const saved = savedCoverage();
    expect(saved.some(([s, e]) => s <= 100_000 && 120_000 <= e)).toBe(true);
    expect(saved.some(([s, e]) => s <= 10_000 && 10_000 <= e)).toBe(true);
  });

  it('clear resets the anchor timestamp and keeps its direction', async () => {
    const { result } = renderHook(() => useTelegramCache(10, false));
    await settle(result);
    act(() => {
      result.current.setBufferAnchor({ direction: 'forward', ts: 5000 });
      result.current.addLive(tg(5000, 'a'));
    });
    expect(result.current.bufferAnchor).toEqual({ direction: 'forward', ts: 5000 });

    await act(async () => {
      await result.current.clear();
    });
    expect(result.current.telegrams).toEqual([]);
    expect(result.current.bufferAnchor).toEqual({ direction: 'forward', ts: null });
    expect(_idb.size).toBe(0);
  });

  it('does not cover an unbuffered forward telegram until the IDB write succeeds', async () => {
    const { result } = renderHook(() => useTelegramCache(10, false));
    await settle(result);
    act(() => {
      result.current.setBufferAnchor({ direction: 'forward', ts: 0 });
      result.current.setBufferRangeMinutes(1);
      result.current.addLive(tg(0, 'edge'));
    });
    act(() => {
      result.current.addLive(tg(120_000, 'out'));
    });
    expect(sources(result.current.telegrams)).toEqual(['1.2.edge']);

    // Still inside the flush window: the miss must be a gap, not covered.
    telegramResponses.push({ telegrams: [tg(120_000, 'fromdb')] });
    const before = fetchCalls.filter(u => u.includes('/api/telegrams')).length;
    await act(async () => {
      await result.current.loadRange(120_000, 120_000, 'forward');
    });
    expect(fetchCalls.filter(u => u.includes('/api/telegrams')).length).toBeGreaterThan(before);
    expect(sources(result.current.telegrams)).toContain('1.2.fromdb');
  });

  it('leaves a forward miss uncovered when the IDB write fails', async () => {
    const { result } = renderHook(() => useTelegramCache(10, false));
    await settle(result);
    act(() => {
      result.current.setBufferAnchor({ direction: 'forward', ts: 0 });
      result.current.setBufferRangeMinutes(1);
      result.current.addLive(tg(0, 'edge'));
    });
    storeShouldFail = true;
    await act(async () => {
      for (let i = 0; i < 200; i++) result.current.addLive(tg(120_000 + i, `o${i}`));
      await new Promise(r => setTimeout(r, 20));
    });
    expect(_idb.has(toEntry(tg(120_000, 'o0')).id)).toBe(false);
    expect(localStorage.getItem(COVERAGE_STORAGE_KEY)).toBeNull();

    storeShouldFail = false;
    telegramResponses.push({ telegrams: [tg(120_000, 'fromdb')] });
    const before = fetchCalls.filter(u => u.includes('/api/telegrams')).length;
    await act(async () => {
      await result.current.loadRange(120_000, 120_000, 'forward');
    });
    expect(fetchCalls.filter(u => u.includes('/api/telegrams')).length).toBeGreaterThan(before);
    expect(sources(result.current.telegrams)).toContain('1.2.fromdb');
  });
});

describe('clampMonitorPageSize', () => {
  it('defaults, clamps, and rounds', () => {
    expect(clampMonitorPageSize(Number.NaN)).toBe(MONITOR_PAGE_SIZE_DEFAULT);
    expect(clampMonitorPageSize(MONITOR_PAGE_SIZE_MIN - 1)).toBe(MONITOR_PAGE_SIZE_MIN);
    expect(clampMonitorPageSize(MONITOR_PAGE_SIZE_MIN)).toBe(MONITOR_PAGE_SIZE_MIN);
    expect(clampMonitorPageSize(MONITOR_PAGE_SIZE_DEFAULT)).toBe(MONITOR_PAGE_SIZE_DEFAULT);
    expect(clampMonitorPageSize(MONITOR_PAGE_SIZE_MAX)).toBe(MONITOR_PAGE_SIZE_MAX);
    expect(clampMonitorPageSize(MONITOR_PAGE_SIZE_MAX + 1)).toBe(MONITOR_PAGE_SIZE_MAX);
    expect(clampMonitorPageSize(2500.4)).toBe(2500);
  });
});

describe('isSameMillisecondStall', () => {
  it('is true only when a full page sits on the cursor millisecond', () => {
    expect(isSameMillisecondStall(true, 5, [{ ts: 5 }, { ts: 5 }], true)).toBe(true);
    expect(isSameMillisecondStall(false, 5, [{ ts: 5 }, { ts: 5 }], true)).toBe(true);
    expect(isSameMillisecondStall(true, 4, [{ ts: 5 }, { ts: 5 }], true)).toBe(false);
    expect(isSameMillisecondStall(false, 6, [{ ts: 5 }, { ts: 5 }], true)).toBe(false);
    expect(isSameMillisecondStall(true, 5, [{ ts: 5 }, { ts: 6 }], true)).toBe(false);
    expect(isSameMillisecondStall(true, 5, [{ ts: 5 }], false)).toBe(false);
  });
});

/** In-memory /api/telegrams: filters by the requested window, order, and limit. */
const installTelegramStore = (rows: Telegram[]) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      fetchCalls.push(u);
      if (u.includes('/api/database/info')) return jsonRes({ retention_days: null });
      if (!u.includes('/api/telegrams')) return jsonRes({});
      const params = new URLSearchParams(u.split('?')[1]);
      const start = Date.parse(params.get('start_time')!);
      const end = Date.parse(params.get('end_time')!);
      const limit = Number(params.get('limit'));
      const asc = params.get('order') === 'asc';
      const inWindow = rows.filter(t => {
        const ts = new Date(t.timestamp).getTime();
        return ts >= start && ts <= end;
      });
      const ordered = asc ? inWindow : [...inWindow].reverse();
      const page = ordered.slice(0, limit);
      return jsonRes({
        telegrams: page,
        metadata: {
          limit_reached: inWindow.length > limit,
          total_count: inWindow.length,
        },
      });
    }),
  );
};

const telegramUrls = () => fetchCalls.filter(u => u.includes('/api/telegrams'));

describe('monitor paging', () => {
  it('requests the configured page size, clamped into range', async () => {
    const { result } = renderHook(() => useTelegramCache(1000, false, 10));
    await settle(result);
    telegramResponses.push({ telegrams: [tg(1000, 'a')] });
    await act(async () => {
      await result.current.loadRange(1000, 1000);
    });
    const params = new URLSearchParams(telegramUrls().at(-1)!.split('?')[1]);
    expect(params.get('limit')).toBe(String(MONITOR_PAGE_SIZE_MIN));

    const { result: high } = renderHook(() => useTelegramCache(20_000, false, 50_000));
    await settle(high);
    telegramResponses.push({ telegrams: [tg(2000, 'b')] });
    await act(async () => {
      await high.current.loadRange(2000, 2000);
    });
    const highParams = new URLSearchParams(telegramUrls().at(-1)!.split('?')[1]);
    expect(highParams.get('limit')).toBe(String(MONITOR_PAGE_SIZE_MAX));
  });

  it.each(['backward', 'forward'] as const)(
    'pages %s across distinct milliseconds by re-including the edge, without a same-ms refill',
    async (direction) => {
      const pageSize = 200;
      const count = 250;
      const origin = 1_000_000;
      const rows = Array.from({ length: count }, (_, i) => tg(origin + i, `n${i}`));
      installTelegramStore(rows);
      const { result } = renderHook(() => useTelegramCache(count + 10, false, pageSize));
      await settle(result);
      const before = telegramUrls().length;
      await act(async () => {
        await result.current.loadRange(origin, origin + count - 1, direction);
      });
      const urls = telegramUrls().slice(before);
      expect(urls.length).toBe(2);
      expect(urls.some(u => decodeURIComponent(u).includes('999Z'))).toBe(false);
      // First page uses the configured size. The last page is only the budget remainder.
      expect(new URLSearchParams(urls[0].split('?')[1]).get('limit')).toBe(String(pageSize));
      const edge = origin + (direction === 'forward' ? pageSize - 1 : count - pageSize);
      const second = new URLSearchParams(urls[1].split('?')[1]);
      const bound = direction === 'forward' ? second.get('start_time') : second.get('end_time');
      expect(Date.parse(bound!)).toBe(edge);
      const seen = result.current.telegrams.map(t => t.source_address);
      expect(seen).toHaveLength(count);
      expect(new Set(seen)).toEqual(new Set(rows.map(t => t.source_address)));
    },
  );

  it.each(['backward', 'forward'] as const)(
    'returns every same-millisecond row exactly once when paging %s below the row count',
    async (direction) => {
      const pageSize = 2000;
      const count = 5000;
      const sameMs = 1_700_000_000_000;
      const rows = Array.from({ length: count }, (_, i) => tg(sameMs, `s${i}`));
      installTelegramStore(rows);
      const { result } = renderHook(() => useTelegramCache(count + 1000, false, pageSize));
      await settle(result);
      const before = telegramUrls().length;
      await act(async () => {
        await result.current.loadRange(sameMs - 10_000, sameMs + 10_000, direction);
      });
      const urls = telegramUrls().slice(before);
      const fullMs = urls.filter(u => {
        const params = new URLSearchParams(u.split('?')[1]);
        return decodeURIComponent(params.get('end_time') ?? '').includes('999Z')
          && params.get('limit') === String(count);
      });
      expect(fullMs.length).toBeGreaterThan(0);
      expect(fullMs.every(u => new URLSearchParams(u.split('?')[1]).get('order') === (direction === 'forward' ? 'asc' : 'desc'))).toBe(true);
      const seen = result.current.telegrams.map(t => t.source_address);
      expect(seen).toHaveLength(count);
      expect(new Set(seen)).toEqual(new Set(rows.map(t => t.source_address)));
    },
  );
});

describe('shared load budget', () => {
  it('counts a new cached row and gives the database only the residual budget', async () => {
    const rows = [tg(100, 'a'), tg(200, 'b'), tg(300, 'c'), tg(400, 'd'), tg(500, 'e')];
    installTelegramStore(rows);
    const { result } = renderHook(() => useTelegramCache(4, false));
    await settle(result);

    await act(async () => {
      await result.current.loadRange(400, 500);
    });
    // Covered [400, 500] already holds d and e. This row is new to the buffer.
    seedIdb([tg(450, 'cached')]);

    const before = telegramUrls().length;
    await act(async () => {
      await result.current.loadRange(100, 500);
    });
    const urls = telegramUrls().slice(before);
    const params = new URLSearchParams(urls[0].split('?')[1]);
    // Backward anchor is the covered slice: 1 new cache row, then 3 from the DB.
    expect(params.get('limit')).toBe('3');
    expect(params.get('order')).toBe('desc');
    expect(Date.parse(params.get('end_time')!)).toBe(399);
    expect(urls).toHaveLength(1);
    const stored = [..._idb.values()].map(e => e.telegram.source_address);
    expect(stored).toEqual(expect.arrayContaining(['1.2.cached', '1.2.a', '1.2.b', '1.2.c']));
  });

  it('forward load keeps the oldest new cache rows and gives the database the rest', async () => {
    const rows = [tg(100, 'a'), tg(200, 'b'), tg(300, 'c'), tg(400, 'd'), tg(500, 'e')];
    installTelegramStore(rows);
    const { result } = renderHook(() => useTelegramCache(4, false));
    await settle(result);

    await act(async () => {
      await result.current.loadRange(100, 200, 'forward');
    });
    seedIdb([tg(150, 'cached')]);

    const before = telegramUrls().length;
    await act(async () => {
      await result.current.loadRange(100, 500, 'forward');
    });
    const params = new URLSearchParams(telegramUrls().slice(before)[0].split('?')[1]);
    expect(params.get('limit')).toBe('3');
    expect(params.get('order')).toBe('asc');
    expect(Date.parse(params.get('start_time')!)).toBe(201);
  });

  it('does not count rows already in the buffer toward the load budget', async () => {
    const rows = [tg(100, 'a'), tg(200, 'b'), tg(300, 'c'), tg(400, 'd'), tg(500, 'e')];
    installTelegramStore(rows);
    const { result } = renderHook(() => useTelegramCache(3, false));
    await settle(result);

    await act(async () => {
      await result.current.loadRange(400, 500);
    });
    expect(result.current.telegrams.map(t => t.source_address)).toEqual(['1.2.e', '1.2.d']);

    const before = telegramUrls().length;
    await act(async () => {
      await result.current.loadRange(100, 500);
    });
    const urls = telegramUrls().slice(before);
    // The two covered rows are duplicates. The older gap still gets the full budget.
    expect(urls).toHaveLength(1);
    expect(new URLSearchParams(urls[0].split('?')[1]).get('limit')).toBe('3');
    const stored = new Set([..._idb.values()].map(e => e.telegram.source_address));
    expect(stored).toEqual(new Set(['1.2.a', '1.2.b', '1.2.c', '1.2.d', '1.2.e']));
  });

  it('may exceed the budget to finish the millisecond already started', async () => {
    const sameMs = 5_000;
    const older = 4_000;
    // Oldest first so the mock's descending page is the newer millisecond.
    const rows = [
      ...Array.from({ length: 5 }, (_, i) => tg(older, `o${i}`)),
      ...Array.from({ length: 5 }, (_, i) => tg(sameMs, `s${i}`)),
    ];
    installTelegramStore(rows);
    const { result } = renderHook(() => useTelegramCache(2, false, 200));
    await settle(result);

    await act(async () => {
      await result.current.loadRange(older, sameMs);
    });

    const storedAtMs = [..._idb.values()].filter(e => e.ts === sameMs);
    expect(storedAtMs).toHaveLength(5);
    expect([..._idb.values()].filter(e => e.ts === older)).toHaveLength(0);
    // Eviction is unchanged: the buffer itself still stops at maxSize.
    expect(result.current.telegrams).toHaveLength(2);
    // The completion read uses the page size, which is larger than the budget.
    expect(telegramUrls().some(u => new URLSearchParams(u.split('?')[1]).get('limit') === '200')).toBe(true);
  });
});
