import type { TelegramEntry } from '../utils/telegramId';

/** Which end to keep when the buffer exceeds maxSize. */
export type EvictionMode = 'keepOldest' | 'keepNewest';

/**
 * In-memory telegram buffer with ring-buffer behavior, ported from the
 * Home Assistant knx-frontend Group Monitor (#246).
 *
 * - Chronological insertion with a fast-path append for live telegrams.
 * - Deduplicating `merge()` for historical loads.
 * - Directional overflow eviction (keep oldest or keep newest).
 * - Immutable `snapshot` for safe use as React state.
 */
export class TelegramBufferService {
  private _buffer: TelegramEntry[] = [];

  private _maxSize: number;

  private _eviction: EvictionMode = 'keepNewest';

  constructor(maxSize = 2000) {
    this._maxSize = maxSize;
  }

  get evictionMode(): EvictionMode {
    return this._eviction;
  }

  setEvictionMode(mode: EvictionMode): void {
    this._eviction = mode;
  }

  /**
   * Adds one or more entries, keeping the buffer sorted by timestamp.
   * Only sorts when the fast path (all newer than the current tail, and
   * themselves in order) does not apply.
   * @returns Entries removed due to buffer overflow (empty if none).
   */
  add(entries: TelegramEntry | TelegramEntry[]): TelegramEntry[] {
    const entryArray = Array.isArray(entries) ? entries : [entries];
    if (entryArray.length === 0) return [];

    const newAreSorted = entryArray.every((e, i) => i === 0 || entryArray[i - 1].ts <= e.ts);
    const lastTs = this._buffer.length > 0 ? this._buffer[this._buffer.length - 1].ts : -Infinity;

    this._buffer.push(...entryArray);
    if (!newAreSorted || entryArray[0].ts < lastTs) {
      this._buffer.sort((a, b) => a.ts - b.ts);
    }

    return this.evictOverflow();
  }

  /**
   * Adds multiple entries, skipping ids already present.
   * @returns The unique entries actually added and any overflow evictions.
   */
  merge(newEntries: TelegramEntry[]): { added: TelegramEntry[]; removed: TelegramEntry[] } {
    const existingIds = new Set(this._buffer.map(e => e.id));
    const unique = newEntries.filter(e => !existingIds.has(e.id));
    unique.sort((a, b) => a.ts - b.ts);
    return { added: unique, removed: this.add(unique) };
  }

  /**
   * Updates the maximum size, evicting per the current eviction mode.
   * @returns Entries removed by the size reduction (empty if none).
   */
  setMaxSize(size: number): TelegramEntry[] {
    this._maxSize = size;
    return this.evictOverflow();
  }

  /**
   * Drop entries outside `[minTs, maxTs]` (inclusive), then enforce maxSize.
   * @returns Entries removed.
   */
  trimToWindow(minTs: number, maxTs: number): TelegramEntry[] {
    if (this._buffer.length === 0) return [];
    const lo = Math.min(minTs, maxTs);
    const hi = Math.max(minTs, maxTs);
    const kept: TelegramEntry[] = [];
    const removed: TelegramEntry[] = [];
    for (const e of this._buffer) {
      if (e.ts < lo || e.ts > hi) removed.push(e);
      else kept.push(e);
    }
    this._buffer = kept;
    removed.push(...this.evictOverflow());
    return removed;
  }

  private evictOverflow(): TelegramEntry[] {
    if (this._buffer.length <= this._maxSize) return [];
    const excess = this._buffer.length - this._maxSize;
    if (this._eviction === 'keepOldest') {
      // Drop newest (end of oldest-first array).
      return this._buffer.splice(this._buffer.length - excess, excess);
    }
    // keepNewest: drop oldest (start).
    return this._buffer.splice(0, excess);
  }

  get maxSize(): number {
    return this._maxSize;
  }

  get length(): number {
    return this._buffer.length;
  }

  /** Timestamp of the oldest buffered entry, or null when empty. */
  get oldestTs(): number | null {
    return this._buffer.length > 0 ? this._buffer[0].ts : null;
  }

  /** Timestamp of the newest buffered entry, or null when empty. */
  get newestTs(): number | null {
    return this._buffer.length > 0 ? this._buffer[this._buffer.length - 1].ts : null;
  }

  get isEmpty(): boolean {
    return this._buffer.length === 0;
  }

  /** Immutable copy of the buffer, oldest first. */
  get snapshot(): readonly TelegramEntry[] {
    return [...this._buffer];
  }

  /** Removes everything and returns the removed entries. */
  clear(): TelegramEntry[] {
    const cleared = [...this._buffer];
    this._buffer.length = 0;
    return cleared;
  }

  has(id: string): boolean {
    return this._buffer.some(e => e.id === id);
  }
}
