import type { TelegramEntry } from '../utils/telegramId';

/** Timestamps currently on screen. Entries inside it are not evicted to make room. */
export interface ProtectedSpan {
  startMs: number;
  endMs: number;
}

/**
 * In-memory telegram buffer with ring-buffer behavior, ported from the
 * Home Assistant knx-frontend Group Monitor (#246).
 *
 * - Chronological insertion with a fast-path append for live telegrams.
 * - Deduplicating `merge()` for historical loads.
 * - Automatic overflow eviction of the oldest entries, unless a protected
 *   time span is set: then entries outside that span go first, and a new
 *   telegram that would only fit by evicting the span is dropped.
 * - Immutable `snapshot` for safe use as React state.
 */
export class TelegramBufferService {
  private _buffer: TelegramEntry[] = [];

  private _maxSize: number;

  /** Null while the list follows the live edge: overflow drops the oldest. */
  private _protected: ProtectedSpan | null = null;

  constructor(maxSize = 2000) {
    this._maxSize = maxSize;
  }

  /** Keep this time span resident. Pass null while following the live edge. */
  setProtectedRange(span: ProtectedSpan | null): void {
    this._protected = span;
  }

  get protectedRange(): ProtectedSpan | null {
    return this._protected;
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

    return this.trim(new Set(entryArray.map(e => e.id)));
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
   * Updates the maximum size, evicting the oldest entries when shrinking.
   * @returns Entries removed by the size reduction (empty if none).
   */
  setMaxSize(size: number): TelegramEntry[] {
    this._maxSize = size;
    return this.trim(new Set());
  }

  /**
   * Drops entries for which `keep` is false.
   * @returns The entries that were removed.
   */
  retain(keep: (entry: TelegramEntry) => boolean): TelegramEntry[] {
    const removed: TelegramEntry[] = [];
    const kept: TelegramEntry[] = [];
    for (const entry of this._buffer) {
      if (keep(entry)) kept.push(entry);
      else removed.push(entry);
    }
    this._buffer = kept;
    return removed;
  }

  /**
   * Shrinks to `maxSize`. Without a protected span the oldest entries go.
   * With one, the oldest entries outside the span go first. Incoming entries
   * that still don't fit are dropped instead of the span.
   */
  private trim(incomingIds: ReadonlySet<string>): TelegramEntry[] {
    if (this._buffer.length <= this._maxSize) return [];
    const protect = this._protected;
    if (!protect) {
      return this._buffer.splice(0, this._buffer.length - this._maxSize);
    }

    const removed: TelegramEntry[] = [];
    const outside = (entry: TelegramEntry) => entry.ts < protect.startMs || entry.ts > protect.endMs;
    while (this._buffer.length > this._maxSize) {
      const idx = this._buffer.findIndex(outside);
      if (idx === -1) break;
      removed.push(this._buffer.splice(idx, 1)[0]);
    }
    while (this._buffer.length > this._maxSize) {
      const idx = this._buffer.findIndex(entry => incomingIds.has(entry.id));
      if (idx === -1) break;
      removed.push(this._buffer.splice(idx, 1)[0]);
    }
    return removed;
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
