/**
 * Persistent telegram cache backed by IndexedDB (via idb-keyval), ported from
 * the Home Assistant knx-frontend Group Monitor (#246).
 *
 * Each entry is keyed by the telegram's stable client-side id (see
 * `utils/telegramId.ts`) and stores the epoch-ms timestamp alongside the raw
 * telegram so old entries can be evicted without deserialising the payload.
 *
 * The cache is purely advisory: callers should catch errors and fall back to a
 * backend query — a miss or storage failure must never break the app.
 */

import { clear, createStore, delMany, entries, setMany } from 'idb-keyval';
import type { Telegram } from '../hooks/useWebSocket';
import type { TelegramEntry } from '../utils/telegramId';

/** Read direction for a capped cache load. Backward keeps the newest rows. */
export type CacheReadDirection = 'backward' | 'forward';

/**
 * Keeps at most `limit` entries from the anchor in `direction`.
 * Backward keeps the newest, forward the oldest. Every row that shares the
 * millisecond of the cut is kept too, so a millisecond is never split; that
 * tail may be longer than `limit`. The returned list is newest first.
 * `truncated` is true when in-range rows were left out.
 */
export function capCachedEntries(
  entries: readonly TelegramEntry[],
  direction: CacheReadDirection,
  limit: number,
): { entries: TelegramEntry[]; truncated: boolean } {
  const cap = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : entries.length;
  if (cap <= 0) return { entries: [], truncated: entries.length > 0 };
  const readOrder = [...entries].sort((a, b) => (direction === 'forward' ? a.ts - b.ts : b.ts - a.ts));
  if (readOrder.length <= cap) {
    readOrder.sort((a, b) => b.ts - a.ts);
    return { entries: readOrder, truncated: false };
  }
  let end = cap;
  const edgeTs = readOrder[cap - 1].ts;
  while (end < readOrder.length && readOrder[end].ts === edgeTs) end++;
  const kept = readOrder.slice(0, end);
  kept.sort((a, b) => b.ts - a.ts);
  return { entries: kept, truncated: end < readOrder.length };
}

/** Maximum number of telegrams kept in the persistent cache. */
export const MAX_CACHE_SIZE = 100_000;

/** IDB store name — kept stable; changing it orphans existing data. */
const IDB_STORE = createStore('spectrum-knx-bus-monitor', 'telegrams');

/** Shape of each entry stored in IndexedDB. */
interface CachedEntry {
  ts: number; // epoch milliseconds — used for eviction ordering
  telegram: Telegram;
}

export class TelegramCacheService {
  /**
   * Persists a batch of telegrams. Existing entries with the same id are
   * overwritten (idempotent, matches the buffer's dedup behavior).
   */
  async store(batch: TelegramEntry[]): Promise<void> {
    if (batch.length === 0) return;
    const pairs: [string, CachedEntry][] = batch.map(({ id, ts, telegram }) => [id, { ts, telegram }]);
    await setMany(pairs, IDB_STORE);
  }

  /**
   * Returns cached entries whose timestamp falls within [startMs, endMs],
   * newest first.
   *
   * Without `limit`, every match is returned. With `limit`, the result is
   * capped from the anchor in `direction` (see `capCachedEntries`).
   */
  async loadRange(
    startMs: number,
    endMs: number,
    direction: CacheReadDirection = 'backward',
    limit?: number,
  ): Promise<TelegramEntry[]> {
    const all = await entries<string, CachedEntry>(IDB_STORE);
    const inRange = all
      .filter(([, entry]) => entry.ts >= startMs && entry.ts <= endMs)
      .map(([id, entry]) => ({ id, ts: entry.ts, telegram: entry.telegram }));
    if (limit == null || !Number.isFinite(limit)) {
      inRange.sort((a, b) => b.ts - a.ts);
      return inRange;
    }
    return capCachedEntries(inRange, direction, limit).entries;
  }

  /** Returns all cached entries, newest first. */
  async loadAll(): Promise<TelegramEntry[]> {
    const all = await entries<string, CachedEntry>(IDB_STORE);
    return all
      .map(([id, entry]) => ({ id, ts: entry.ts, telegram: entry.telegram }))
      .sort((a, b) => b.ts - a.ts);
  }

  /** Deletes all entries whose timestamp is strictly before `minMs`. */
  async evictBefore(minMs: number): Promise<void> {
    const all = await entries<string, CachedEntry>(IDB_STORE);
    const stale = all.filter(([, entry]) => entry.ts < minMs).map(([id]) => id);
    if (stale.length > 0) await delMany(stale, IDB_STORE);
  }

  /**
   * Trims the cache to at most `maxCount` entries by deleting the oldest.
   * Returns the timestamp of the oldest surviving entry so the caller can trim
   * coverage accordingly, or `null` if no eviction was needed.
   */
  async evictToSize(maxCount: number): Promise<number | null> {
    const all = await entries<string, CachedEntry>(IDB_STORE);
    if (all.length <= maxCount) return null;
    all.sort((a, b) => a[1].ts - b[1].ts);
    const toEvict = all.slice(0, all.length - maxCount);
    await delMany(
      toEvict.map(([id]) => id),
      IDB_STORE,
    );
    // First surviving entry after eviction.
    return all[all.length - maxCount][1].ts;
  }

  /** Returns the total number of entries in the cache. */
  async count(): Promise<number> {
    const all = await entries(IDB_STORE);
    return all.length;
  }

  /** Wipes all entries from the cache. */
  async clear(): Promise<void> {
    await clear(IDB_STORE);
  }
}
