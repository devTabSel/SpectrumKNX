import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type { Telegram } from './useWebSocket';
import { apiUrl } from '../utils/basePath';
import { toEntry, telegramTs, type TelegramEntry } from '../utils/telegramId';
import { tagListEdge } from '../utils/listEdge';
import { TelegramBufferService, type EvictionMode } from '../services/telegram-buffer-service';
import {
  TelegramCacheService,
  MAX_CACHE_SIZE,
  capCachedEntries,
} from '../services/telegram-cache-service';
import {
  TelegramCoverageService,
  loadCoverageIntervals,
  saveCoverageIntervals,
} from '../services/telegram-coverage-service';

/** How often the pending live batch is flushed to IndexedDB. */
const FLUSH_INTERVAL_MS = 2000;
/** Flush early once this many live telegrams are pending. */
const FLUSH_BATCH_SIZE = 200;
/** Cache size enforcement cadence (in flush ticks: 30 × 2 s = every minute). */
const EVICT_EVERY_TICKS = 30;
/**
 * Rows fetched per backend request while the Monitor fills a gap (#284).
 * History loads page in chunks of this size and paint after every chunk.
 * The settings field "Seitengröße Monitor-Laden" overrides it (clamped).
 * History search is not paged and does not use this value.
 */
export const MONITOR_PAGE_SIZE_DEFAULT = 2000;
export const MONITOR_PAGE_SIZE_MIN = 200;
export const MONITOR_PAGE_SIZE_MAX = 10_000;

/** Clamp a Monitor DB page size into `[MIN, MAX]`. Non-finite values use the default. */
export function clampMonitorPageSize(value: number): number {
  if (!Number.isFinite(value)) return MONITOR_PAGE_SIZE_DEFAULT;
  return Math.min(MONITOR_PAGE_SIZE_MAX, Math.max(MONITOR_PAGE_SIZE_MIN, Math.round(value)));
}

/**
 * A full page whose rows all share the cursor millisecond. Moving the cursor
 * onto that timestamp would repeat the page; stepping past it would drop the
 * rest of the millisecond.
 */
export function isSameMillisecondStall(
  forward: boolean,
  cursor: number,
  entries: readonly { ts: number }[],
  limitReached: boolean,
): boolean {
  if (!limitReached || entries.length === 0) return false;
  const edgeTs = entries[entries.length - 1].ts;
  for (const entry of entries) {
    if (entry.ts !== edgeTs) return false;
  }
  return forward ? edgeTs <= cursor : edgeTs >= cursor;
}

/**
 * Inclusive ISO-8601 bounds of the millisecond `ms`, through its last
 * microsecond (`edgeMs` .. `edgeMs+0.999`).
 */
function millisecondBoundsIso(ms: number): { startIso: string; endIso: string } {
  const startIso = new Date(ms).toISOString();
  return { startIso, endIso: startIso.replace(/Z$/, '999Z') };
}

/** Gap / loadRange paging direction. Default remains backward (newest-first). */
export type FillDirection = 'backward' | 'forward';

/**
 * Where the in-memory window is measured from. Not the table scroll anchor
 * and not the paging edge of a history load.
 */
export interface BufferAnchor {
  direction: 'forward' | 'backward';
  /**
   * Explicit instant. `null` means the matching buffer edge: oldest when
   * forward, newest when backward.
   */
  ts: number | null;
}

function rangeMsOf(minutes: number): number {
  const mins = Number.isFinite(minutes) ? minutes : 1;
  return Math.max(1, mins) * 60_000;
}

/**
 * Timestamp a trim is measured from. An explicit `ts` applies only when the
 * anchor direction matches the trim; otherwise the buffer edge for `direction`
 * is used.
 */
function anchorOrigin(
  anchor: BufferAnchor,
  direction: 'forward' | 'backward',
  oldestTs: number | null,
  newestTs: number | null,
): number | null {
  if (anchor.direction === direction && anchor.ts != null) return anchor.ts;
  return direction === 'forward' ? oldestTs : newestTs;
}

function evictionFor(direction: 'forward' | 'backward'): EvictionMode {
  return direction === 'forward' ? 'keepOldest' : 'keepNewest';
}

/**
 * Full-buffer early-break decision for gap paging (#313).
 * Overflow always evicts the oldest rows, so:
 * - backward below `oldestTs` → stop (discardable)
 * - forward below `oldestTs` → skip ahead to `oldestTs` (leave the older
 *   remainder uncovered; rows above the window are kept)
 * - forward above `newestTs` → keep paging (those rows stick)
 */
export type FullBufferPagingAction =
  | { action: 'continue' }
  | { action: 'break' }
  | { action: 'skip'; cursor: number };

/**
 * Covered slices and gaps of `[startMs, endMs]`, in read order.
 * Backward starts at `endMs` (the new edge); forward starts at `startMs`.
 * Cache slices are the complement of `gaps` and stay covered even when a
 * budget cap does not copy every cached row into the buffer.
 */
export function budgetSegments(
  startMs: number,
  endMs: number,
  gaps: readonly (readonly [number, number])[],
  direction: FillDirection,
): { kind: 'cache' | 'gap'; start: number; end: number }[] {
  const parts: { kind: 'cache' | 'gap'; start: number; end: number }[] = [];
  let cursor = startMs;
  for (const [gs, ge] of gaps) {
    if (gs > cursor) parts.push({ kind: 'cache', start: cursor, end: gs - 1 });
    parts.push({ kind: 'gap', start: gs, end: ge });
    cursor = ge + 1;
  }
  if (cursor <= endMs) parts.push({ kind: 'cache', start: cursor, end: endMs });
  return direction === 'backward' ? parts.reverse() : parts;
}

export function resolveFullBufferPaging(opts: {
  forward: boolean;
  bufferFull: boolean;
  cursor: number;
  oldestTs: number | null;
}): FullBufferPagingAction {
  if (!opts.bufferFull || opts.oldestTs === null) return { action: 'continue' };
  if (opts.cursor >= opts.oldestTs) return { action: 'continue' };
  if (opts.forward) return { action: 'skip', cursor: opts.oldestTs };
  return { action: 'break' };
}

export interface TelegramCache {
  /** Current buffer contents, newest first. Frozen while paused. */
  telegrams: Telegram[];
  /**
   * Full buffer, newest first, including telegrams ingested while the
   * published snapshot is frozen. GA read phase follows this buffer
   * (published list plus pause backlog).
   */
  ingested: Telegram[];
  /** Ingest a live telegram from the WebSocket. */
  addLive: (t: Telegram) => void;
  /** Reflect the WS connection so offline windows become coverage gaps. */
  setConnected: (connected: boolean) => void;
  /** Freeze/unfreeze the published snapshot; ingestion continues while paused. */
  setPaused: (paused: boolean) => void;
  /** Telegrams ingested since the snapshot was frozen. */
  pausedCount: number;
  /**
   * Pause backlog as telegrams (newest first). Stable array, mutated in place —
   * do not copy it into React state. `pausedCount` is what changes per arrival.
   * Shorter than `pausedCount` once the buffer evicts older paused rows.
   */
  pausedTelegrams: Telegram[];
  /**
   * Reveal the oldest `n` of the paused backlog while staying paused: the
   * published snapshot grows by those rows and `pausedCount` shrinks by `n`.
   * Returns the backlog still hidden. No-op (returns current backlog) when not
   * paused or `n <= 0`.
   */
  revealPaused: (n: number) => number;
  /**
   * Load a time range. IndexedDB and the database together contribute at most
   * `maxSize` new buffer rows (a finished millisecond may run past that).
   * `direction` selects the paging edge: backward reads from `endMs`, forward
   * from `startMs`. Default is backward (newest-first).
   */
  loadRange: (startMs: number, endMs: number, direction?: FillDirection) => Promise<void>;
  /**
   * Fill the buffer ascending from `startMs` toward now / the existing buffer
   * (oldest-first). Shares the same `maxSize` budget as `loadRange`. Used by
   * the oldest datetime field and goto-older.
   */
  fillForwardFrom: (startMs: number) => Promise<void>;
  /**
   * Fill newest-first from `endMs` backward to cover `[endMs, now]` (or the
   * existing newest). Used by the newest datetime field.
   */
  fillBackwardTo: (endMs: number) => Promise<void>;
  /** Oldest timestamp currently in the in-memory buffer, or null when empty. */
  oldestTs: number | null;
  /** Newest timestamp currently in the in-memory buffer, or null when empty. */
  newestTs: number | null;
  /** True while any backend history fetch is in flight (#222). */
  isLoading: boolean;
  /** Last background load failure, cleared by the next successful load. */
  loadError: string | null;
  /** Wipe buffer, persistent cache and coverage. */
  clear: () => Promise<void>;
  /** Abort in-flight history loads without wiping the buffer. */
  cancelLoad: () => void;
  /** keepOldest = forward read; keepNewest = backward read. */
  setEvictionMode: (mode: EvictionMode) => void;
  /**
   * Trim and forward-admission anchor. `ts === null` uses the buffer edge
   * (oldest forward, newest backward). Backward live moves `ts` to the newest
   * telegram; an explicit forward `ts` stays put.
   */
  bufferAnchor: BufferAnchor;
  /** Rewind, fast-forward and goto. Also selects the overflow end. */
  setBufferAnchor: (anchor: BufferAnchor) => void;
  /**
   * Read-direction change without a timestamp. Keeps `ts` when the direction
   * is unchanged; otherwise clears it so the buffer edge is used.
   */
  adoptAnchorDirection: (direction: 'forward' | 'backward') => void;
  /** Minute window used when deciding whether a forward live telegram fits. */
  setBufferRangeMinutes: (minutes: number) => void;
  /**
   * Drop telegrams outside `[minTs, maxTs]` and enforce maxSize with the
   * current eviction mode. Publishes when anything changed.
   */
  trimToTimeWindow: (minTs: number, maxTs: number) => void;
  /**
   * Trim to `[x, x + range]` (forward) or `[y - range, y]` (backward).
   * `x` / `y` is the buffer anchor when one is set, otherwise the buffer edge.
   */
  enforceTimeWindow: (direction: 'forward' | 'backward', rangeMinutes: number) => void;
}

interface FetchResult {
  entries: TelegramEntry[];
  limitReached: boolean;
  /** Rows matching the window before the limit, when the backend reports it. */
  totalCount: number;
}

/**
 * Fetches a time range from the backend, unfiltered.
 * backward → newest first (`order=desc`); forward → oldest first (`order=asc`).
 */
async function fetchRange(
  startMs: number,
  endMs: number,
  limit: number,
  direction: FillDirection = 'backward',
  isoBounds?: { startIso: string; endIso: string },
): Promise<FetchResult> {
  const params = new URLSearchParams({
    limit: String(limit),
    start_time: isoBounds?.startIso ?? new Date(startMs).toISOString(),
    end_time: isoBounds?.endIso ?? new Date(endMs).toISOString(),
    order: direction === 'forward' ? 'asc' : 'desc',
  });
  const res = await fetch(apiUrl(`/api/telegrams?${params}`));
  if (!res.ok) throw new Error(`Server error: ${res.status}`);
  const data = await res.json();
  const telegrams = (data.telegrams || []) as Telegram[];
  const reported = data.metadata?.total_count;
  return {
    entries: telegrams.map(toEntry),
    limitReached: data.metadata?.limit_reached ?? false,
    totalCount: typeof reported === 'number' ? reported : telegrams.length,
  };
}

/**
 * Every row in one millisecond. Probes the exact window, then repeats with
 * `limit = total_count` when the probe was short.
 *
 * Callers add the extra rows (beyond the page already counted) to `fetched`.
 * That can exceed the load budget; the overage is only for finishing this
 * single millisecond, so the cursor can move past it without dropping rows.
 */
async function fetchWholeMillisecond(
  edgeTs: number,
  direction: FillDirection,
  probeLimit: number,
): Promise<FetchResult> {
  const bounds = millisecondBoundsIso(edgeTs);
  const probe = await fetchRange(edgeTs, edgeTs, Math.max(1, probeLimit), direction, bounds);
  if (probe.totalCount > probe.entries.length) {
    return fetchRange(edgeTs, edgeTs, probe.totalCount, direction, bounds);
  }
  return probe;
}

/**
 * Composes the buffer, IndexedDB cache and coverage services (#246) into the
 * Group Monitor's telegram state:
 *
 * - On mount, cached telegrams and coverage gaps up to "now" share one
 *   `maxSize` budget, newest-first (#211, #222).
 * - Live telegrams extend the open coverage interval and are flushed to
 *   IndexedDB in batches, including rows the forward window does not keep.
 * - Disconnect/close windows become gaps that are re-fetched on reconnect.
 *
 * The persistent cache is advisory: every IDB/backend failure degrades to
 * live-only behavior identical to the pre-cache app.
 *
 * `restoreFromCache` (default on) controls the startup restore only: when off,
 * the buffer starts empty and only live telegrams and explicit `loadRange`
 * calls (the history loader) populate it. Live telegrams are still flushed to
 * the cache, so re-enabling the setting restores them on the next reload.
 */
export function useTelegramCache(
  maxSize: number,
  restoreFromCache = true,
  monitorPageSize = MONITOR_PAGE_SIZE_DEFAULT,
): TelegramCache {
  const chunkSize = clampMonitorPageSize(monitorPageSize);
  const bufferRef = useRef<TelegramBufferService | null>(null);
  bufferRef.current ??= new TelegramBufferService(maxSize);
  const cacheRef = useRef<TelegramCacheService | null>(null);
  cacheRef.current ??= new TelegramCacheService();
  const coverageRef = useRef<TelegramCoverageService | null>(null);
  coverageRef.current ??= new TelegramCoverageService();

  /** Ids currently in the buffer — O(1) dedup for the live path. */
  const idsRef = useRef<Set<string>>(new Set());
  /** Live telegrams awaiting the next IDB flush. */
  const pendingRef = useRef<TelegramEntry[]>([]);
  const connectedRef = useRef(false);
  const pausedRef = useRef(false);
  /** Bumped by clear() to invalidate any background load still in flight (#339). */
  const loadGenerationRef = useRef(0);
  /** Number of in-flight IDB store() calls — coverage saves are deferred while > 0 (#317). */
  const pendingStoreCountRef = useRef(0);

  const [telegrams, setTelegrams] = useState<Telegram[]>([]);
  /** Mirrors `telegrams` for prepends that must not wait on the next render. */
  const telegramsRef = useRef<Telegram[]>([]);
  /**
   * Oldest published rows the buffer has evicted since the last publish, while
   * paused. Applied as a tail drop on the next reveal so the list stays the
   * buffer minus the still-hidden newest entries.
   */
  const pendingDropRef = useRef(0);
  /**
   * A history merge or resize called `publish` while paused. The backlog
   * prepend no longer describes the buffer, so the next reveal or resume
   * copies the snapshot once.
   */
  const structuralWhilePausedRef = useRef(false);
  const [pausedCount, setPausedCount] = useState(0);
  /**
   * Newest-first pause backlog. One array for the life of the hook: arrivals
   * unshift a single telegram, reveals drop the tail. Never a snapshot copy.
   */
  const pausedBacklogRef = useRef<Telegram[]>([]);
  /** Mirrors `pausedCount` for synchronous reads (addLive / revealPaused). */
  const pausedCountRef = useRef(0);
  /**
   * Trim / admission anchor. The ref is what addLive and enforceTimeWindow
   * read; state publishes it to the monitor.
   */
  const [bufferAnchor, setAnchorState] = useState<BufferAnchor>({ direction: 'backward', ts: null });
  const anchorRef = useRef(bufferAnchor);
  /** Last minute window announced by the monitor. Forward admission uses it. */
  const rangeMinutesRef = useRef(60);
  const [activeLoads, setActiveLoads] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);

  /**
   * Sets the hidden-count and trims the backlog tail to match. Does not read
   * the buffer snapshot — callers that received a new telegram unshift it first.
   */
  const updatePausedCount = useCallback((next: number) => {
    const n = Math.max(0, next);
    pausedCountRef.current = n;
    const list = pausedBacklogRef.current;
    if (n <= 0) list.length = 0;
    else if (list.length > n) list.length = n;
    setPausedCount(n);
  }, []);

  const commitTelegrams = useCallback((next: Telegram[]) => {
    telegramsRef.current = next;
    setTelegrams(next);
  }, []);

  /**
   * Full newest-first copy of the buffer, minus its newest `hidden` entries.
   * History loads, resizes, and a pause that merged other rows use this.
   * Live appends and pause portions do not.
   */
  const publishFromBuffer = useCallback((hidden: number) => {
    const snap = bufferRef.current!.snapshot;
    const visible = Math.max(0, snap.length - Math.max(0, hidden));
    pendingDropRef.current = 0;
    commitTelegrams(snap.slice(0, visible).map(e => e.telegram).reverse());
  }, [commitTelegrams]);

  /**
   * Prepends `head` (newest first) onto the published list and drops `drop`
   * oldest rows. No-op when both are empty, so a resume after the last
   * portion does not publish the buffer again.
   */
  const publishPrepend = useCallback((head: readonly Telegram[], drop: number) => {
    if (head.length === 0 && drop <= 0) return;
    const prev = telegramsRef.current;
    const removed = Math.min(Math.max(0, drop), prev.length);
    const keep = prev.length - removed;
    const next = head.length === 0
      ? prev.slice(0, keep)
      : removed === 0
        ? head.concat(prev)
        : head.concat(prev.slice(0, keep));
    pendingDropRef.current = 0;
    commitTelegrams(tagListEdge(next, prev, 0, head.length, keep));
  }, [commitTelegrams]);

  /** Publishes the buffer as a newest-first snapshot unless frozen by pause. */
  const publish = useCallback(() => {
    if (pausedRef.current) {
      structuralWhilePausedRef.current = true;
      return;
    }
    publishFromBuffer(0);
  }, [publishFromBuffer]);

  const trackRemoved = useCallback((removed: TelegramEntry[]) => {
    for (const e of removed) idsRef.current.delete(e.id);
  }, []);

  /**
   * Merges entries into the buffer. Returns how many ids were new.
   * `consumed` remembers those ids for the rest of the load, including rows
   * that eviction drops immediately, so a later cache slice cannot count them
   * again.
   */
  const mergeIntoBuffer = useCallback(
    (entries: TelegramEntry[], consumed?: Set<string>): number => {
      const { added, removed } = bufferRef.current!.merge(entries);
      for (const e of added) {
        idsRef.current.add(e.id);
        consumed?.add(e.id);
      }
      trackRemoved(removed);
      return added.length;
    },
    [trackRemoved],
  );

  const saveCoverage = useCallback(() => {
    // Defer saving while IDB writes are in flight so a crash between the
    // coverage save and the IDB commit can't leave orphaned coverage (#317).
    if (pendingStoreCountRef.current > 0) return;
    saveCoverageIntervals(coverageRef.current!.covered);
  }, []);

  /**
   * Re-reads one millisecond a full page could not finish, merges and stores it.
   * `aborted` means a clear/cancel invalidated the load; do not advance.
   */
  const loadCompleteMillisecond = useCallback(
    async (edgeTs: number, direction: FillDirection, gen: number, consumed?: Set<string>) => {
      const full = await fetchWholeMillisecond(edgeTs, direction, chunkSize);
      if (loadGenerationRef.current !== gen) {
        return { entries: [] as TelegramEntry[], stored: false, aborted: true, added: 0 };
      }
      const added = mergeIntoBuffer(full.entries, consumed);
      if (added > 0) publish();
      pendingStoreCountRef.current++;
      const stored = await cacheRef.current!.store(full.entries).then(
        () => { pendingStoreCountRef.current--; return true; },
        () => { pendingStoreCountRef.current--; return false; },
      );
      return { entries: full.entries, stored, aborted: false, added };
    },
    [chunkSize, mergeIntoBuffer, publish],
  );

  /**
   * Progressively fills one uncovered sub-range, publishing after every chunk
   * so the UI builds as data streams in (#284). Pages in `chunkSize` requests
   * until the gap is exhausted or `budget` new rows have been merged.
   * Rows already in the buffer do not count.
   *
   * - `backward` (default): newest-first; budget cut-off leaves the older remainder
   * - `forward`: oldest-first; budget cut-off leaves the newer remainder
   *
   * A full page that sits entirely on the cursor's millisecond is re-read in
   * full (see `fetchWholeMillisecond`) before the cursor steps past it. The
   * extra rows count toward `fetched` and may exceed `budget`; that overage
   * is only allowed to finish the one millisecond.
   *
   * When `skipBufferFullBreak` is true (user-initiated loads), the full-buffer
   * early break (#313) is disabled so the entire requested range is fetched and
   * persisted to IDB, even if the in-memory buffer evicts entries (#317).
   */
  const fetchGapProgressive = useCallback(
    async (
      gapStart: number,
      gapEnd: number,
      budget: number,
      skipBufferFullBreak = false,
      direction: FillDirection = 'backward',
      consumed?: Set<string>,
    ): Promise<number> => {
      const gen = loadGenerationRef.current;
      const forward = direction === 'forward';
      let cursor = forward ? gapStart : gapEnd;
      let fetched = 0;
      while ((forward ? cursor <= gapEnd : cursor >= gapStart) && fetched < budget) {
        // Once the buffer is full, overflow drops the oldest rows. Backward
        // paging below oldestTs would only fetch discardable chunks — stop.
        // Forward paging below oldestTs skips ahead (leave that remainder
        // uncovered); paging above newestTs is kept, so it continues (#313).
        // User-initiated loads bypass this (#317).
        if (!skipBufferFullBreak) {
          const buf = bufferRef.current!;
          const decision = resolveFullBufferPaging({
            forward,
            bufferFull: buf.length >= maxSize,
            cursor,
            oldestTs: buf.oldestTs,
          });
          if (decision.action === 'break') break;
          if (decision.action === 'skip') {
            cursor = decision.cursor;
            continue;
          }
        }
        const limit = Math.min(chunkSize, budget - fetched);
        const windowStart = forward ? cursor : gapStart;
        const windowEnd = forward ? gapEnd : cursor;
        const { entries, limitReached } = await fetchRange(windowStart, windowEnd, limit, direction);
        // A buffer clear during the fetch invalidates this load: drop the chunk
        // and stop paging, so a late arrival can't repopulate the cleared buffer
        // and leave a gap between it and newer telegrams (#339).
        if (loadGenerationRef.current !== gen) return fetched;
        if (entries.length === 0) {
          // Nothing left in this window — the rest is covered-but-empty.
          if (forward) coverageRef.current!.addCovered(cursor, gapEnd);
          else coverageRef.current!.addCovered(gapStart, cursor);
          break;
        }
        const added = mergeIntoBuffer(entries, consumed);
        if (added > 0) publish();
        // Mark the range covered only once its rows are actually persisted. If
        // the cache write fails (e.g. IndexedDB quota), leaving coverage claiming
        // a range the cache can't serve surfaces later as a permanent gap (#317).
        pendingStoreCountRef.current++;
        const stored = await cacheRef.current!.store(entries).then(
          () => { pendingStoreCountRef.current--; return true; },
          () => { pendingStoreCountRef.current--; return false; },
        );
        fetched += added;
        // Desc: newest-first → last is oldest. Asc: oldest-first → last is newest.
        const edgeTs = entries[entries.length - 1].ts;
        if (isSameMillisecondStall(forward, cursor, entries, limitReached)) {
          // Do not mark this millisecond covered from the short page — coverage
          // is time-based and would hide the rows the page did not include.
          const full = await loadCompleteMillisecond(edgeTs, direction, gen, consumed);
          if (full.aborted) return fetched;
          fetched += full.added;
          if (full.stored) coverageRef.current!.addCovered(edgeTs, edgeTs);
          cursor = forward ? edgeTs + 1 : edgeTs - 1;
          continue;
        }
        if (stored) {
          const allOnEdge = entries.every(e => e.ts === edgeTs);
          // More pages remain and this one is a single millisecond we have not
          // finished. Cover only the empty lead-in; the next iteration re-reads
          // the millisecond and marks it once every row is stored.
          const deferMs = limitReached && allOnEdge && fetched < budget;
          if (deferMs && forward && cursor < edgeTs) {
            coverageRef.current!.addCovered(cursor, edgeTs - 1);
          } else if (deferMs && !forward && edgeTs < cursor) {
            coverageRef.current!.addCovered(edgeTs + 1, cursor);
          } else if (forward) {
            coverageRef.current!.addCovered(cursor, edgeTs);
          } else {
            coverageRef.current!.addCovered(edgeTs, cursor);
          }
        }
        if (!limitReached) {
          // The whole remaining window came back — the gap is fully covered.
          if (stored) {
            if (forward) coverageRef.current!.addCovered(cursor, gapEnd);
            else coverageRef.current!.addCovered(gapStart, cursor);
          }
          break;
        }
        // Advance the cursor. Re-including `edgeTs` (dedup handles the repeat)
        // avoids dropping siblings that share that millisecond. A page that is
        // entirely that millisecond is handled above, before this step.
        if (forward) {
          cursor = edgeTs > cursor ? edgeTs : cursor + 1;
        } else {
          cursor = edgeTs < cursor ? edgeTs : cursor - 1;
        }
      }
      return fetched;
    },
    [mergeIntoBuffer, publish, maxSize, chunkSize, loadCompleteMillisecond],
  );

  /**
   * Fills the uncovered sub-ranges of [startMs, endMs] in `direction`, chunk by
   * chunk, up to `budget` new rows. The far-side remainder of the gap where
   * the budget runs out stays uncovered for on-demand loading (#284).
   *
   * `skipBufferFullBreak` is forwarded to `fetchGapProgressive` (#317).
   */
  const fillGapsBudgeted = useCallback(
    async (
      startMs: number,
      endMs: number,
      budget: number,
      skipBufferFullBreak = false,
      direction: FillDirection = 'backward',
    ) => {
      const gen = loadGenerationRef.current;
      const gaps = coverageRef.current!.gaps(startMs, endMs);
      let remaining = budget;
      if (direction === 'forward') {
        for (let i = 0; i < gaps.length && remaining > 0; i++) {
          remaining -= await fetchGapProgressive(
            gaps[i][0], gaps[i][1], remaining, skipBufferFullBreak, direction,
          );
          if (loadGenerationRef.current !== gen) return;
        }
      } else {
        for (let i = gaps.length - 1; i >= 0 && remaining > 0; i--) {
          remaining -= await fetchGapProgressive(
            gaps[i][0], gaps[i][1], remaining, skipBufferFullBreak, direction,
          );
          // A buffer clear invalidated this load — don't start further gaps (#339).
          if (loadGenerationRef.current !== gen) return;
        }
      }
      saveCoverage();
    },
    [fetchGapProgressive, saveCoverage],
  );

  /** Fills every uncovered sub-range of [startMs, endMs], bounded by the buffer size.
   *  `skipBufferFullBreak` is forwarded to `fetchGapProgressive` (#317). */
  const fillGaps = useCallback(
    (startMs: number, endMs: number, skipBufferFullBreak = false, direction: FillDirection = 'backward') =>
      fillGapsBudgeted(startMs, endMs, maxSize, skipBufferFullBreak, direction),
    [fillGapsBudgeted, maxSize],
  );

  /** Wraps a background load with the shared loading/error state. */
  const runLoad = useCallback(
    async (work: () => Promise<void>) => {
      setActiveLoads(n => n + 1);
      try {
        await work();
        setLoadError(null);
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'History load failed');
      } finally {
        setActiveLoads(n => n - 1);
      }
    },
    [],
  );

  /**
   * One range load. Walks `[startMs, endMs]` from the anchor in `direction`
   * and admits at most `budget` rows that are new to the buffer, counting
   * IndexedDB and the database together. Finishing a millisecond the database
   * page could not split may run past `budget`.
   *
   * Covered slices are served from IDB and are not requested again. When the
   * cap stops inside a covered slice, the unread tail stays covered: it remains
   * in IDB, is not copied into the buffer, and the database does not fetch it.
   * After a gap is fully resolved, IDB-only rows in that gap still fill any
   * residual budget, so a cache hit paints when the database returns nothing.
   */
  const loadBudgeted = useCallback(
    async (
      startMs: number,
      endMs: number,
      direction: FillDirection,
      budget: number,
      skipBufferFullBreak: boolean,
      preloaded?: readonly TelegramEntry[],
    ) => {
      if (budget <= 0 || endMs < startMs) return;
      const gen = loadGenerationRef.current;
      const cached = preloaded !== undefined
        ? preloaded.filter(e => e.ts >= startMs && e.ts <= endMs)
        : await cacheRef.current!.loadRange(startMs, endMs).catch(() => [] as TelegramEntry[]);
      // A buffer clear during the cache read invalidates this load (#339).
      if (loadGenerationRef.current !== gen) return;

      const consumed = new Set<string>();
      const segments = budgetSegments(
        startMs,
        endMs,
        coverageRef.current!.gaps(startMs, endMs),
        direction,
      );
      let remaining = budget;
      for (const seg of segments) {
        if (remaining <= 0) break;
        if (loadGenerationRef.current !== gen) return;
        const inSeg = (rows: readonly TelegramEntry[]) => rows.filter(e =>
          e.ts >= seg.start && e.ts <= seg.end && !idsRef.current.has(e.id) && !consumed.has(e.id),
        );
        if (seg.kind === 'cache') {
          const capped = capCachedEntries(inSeg(cached), direction, remaining);
          const added = mergeIntoBuffer(capped.entries, consumed);
          if (added > 0) publish();
          remaining -= added;
          // The far side of this slice stays covered and out of the buffer.
          if (capped.truncated) break;
          continue;
        }
        const fetched = await fetchGapProgressive(
          seg.start, seg.end, remaining, skipBufferFullBreak, direction, consumed,
        );
        if (loadGenerationRef.current !== gen) return;
        remaining -= fetched;
        if (remaining <= 0) break;
        if (!coverageRef.current!.isCovered(seg.start, seg.end)) {
          // Paging stopped before the gap was finished. Leave its far side
          // unloaded; a full buffer must not keep walking into older slices.
          if (!skipBufferFullBreak && bufferRef.current!.length >= maxSize) break;
          continue;
        }
        const capped = capCachedEntries(inSeg(cached), direction, remaining);
        const added = mergeIntoBuffer(capped.entries, consumed);
        if (added > 0) publish();
        remaining -= added;
        if (capped.truncated) break;
      }
      saveCoverage();
    },
    [mergeIntoBuffer, publish, fetchGapProgressive, saveCoverage, maxSize],
  );

  const loadRange = useCallback(
    (startMs: number, endMs: number, direction: FillDirection = 'backward') =>
      runLoad(() => loadBudgeted(startMs, endMs, direction, maxSize, /* skipBufferFullBreak */ true)),
    [runLoad, loadBudgeted, maxSize],
  );

  /**
   * Pages oldest-first from `startMs` toward the existing buffer edge (or now
   * when the buffer is empty). IDB and the database share `maxSize`.
   */
  const fillForwardFrom = useCallback(
    (startMs: number) =>
      runLoad(() => {
        const now = Date.now();
        // Cap the forward fill at the prior buffer edge so we only close the
        // older hole; when the buffer is empty, fill up to now.
        const connectTs = bufferRef.current!.oldestTs;
        const endMs = connectTs != null ? Math.min(connectTs, now) : now;
        if (startMs > endMs) return Promise.resolve();
        return loadBudgeted(startMs, endMs, 'forward', maxSize, /* skipBufferFullBreak */ true);
      }),
    [runLoad, loadBudgeted, maxSize],
  );

  /** Newest-first fill covering `[endMs, now]` (backward toward older history). */
  const fillBackwardTo = useCallback(
    (endMs: number) => {
      const now = Date.now();
      const start = Math.min(endMs, now);
      const end = Math.max(endMs, now);
      // When the user picks a past instant as the newest bound, page that
      // window newest-first so the buffer reaches back to it.
      return loadRange(start, end);
    },
    [loadRange],
  );

  // ── Startup: restore cache + coverage, then fill gaps up to now ─────────────
  useEffect(() => {
    // When restore is disabled the view starts empty; only live telegrams and
    // manual history loads populate it (the setting is read once, at mount).
    if (!restoreFromCache) return;
    let cancelled = false;
    void runLoad(async () => {
      const gen = loadGenerationRef.current;
      const coverage = coverageRef.current!;
      for (const [s, e] of loadCoverageIntervals()) coverage.addCovered(s, e);

      // Clamp everything to the backend's retention window when known.
      try {
        const res = await fetch(apiUrl('/api/database/info'));
        const info = await res.json();
        if (info.retention_days != null) {
          const minMs = Date.now() - (info.retention_days + 1) * 86_400_000;
          coverage.trim(minMs);
          cacheRef.current!.evictBefore(minMs).catch(() => {});
        }
      } catch {
        // Retention unknown — keep coverage as persisted.
      }
      if (cancelled) return;

      const cached = await cacheRef.current!.loadAll().catch(() => [] as TelegramEntry[]);
      if (cancelled || loadGenerationRef.current !== gen) return;
      // Startup shares the buffer budget with every other load: IDB and the
      // database together admit at most `maxSize` new rows, newest-first.
      // The unread cached tail stays in IDB (and stays covered) for a later load.
      const coveredStart = coverage.covered[0]?.[0];
      const oldestCached = cached.length > 0 ? cached[cached.length - 1].ts : undefined;
      const start = Math.min(coveredStart ?? Infinity, oldestCached ?? Infinity);
      if (Number.isFinite(start)) {
        await loadBudgeted(start, Date.now(), 'backward', maxSize, /* skipBufferFullBreak */ false, cached);
      }
    });
    return () => {
      cancelled = true;
    };
    // Startup restore runs exactly once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Periodic flush: IDB batch, coverage save, size eviction ─────────────────
  useEffect(() => {
    let ticks = 0;

    const flush = () => {
      const pending = pendingRef.current;
      if (pending.length > 0) {
        pendingRef.current = [];
        pendingStoreCountRef.current++;
        cacheRef.current!.store(pending).then(
          () => { pendingStoreCountRef.current--; saveCoverage(); },
          () => { pendingStoreCountRef.current--; },
        );
      }
      // A quiet-but-connected stream still covers the elapsed time.
      if (connectedRef.current) coverageRef.current!.extendLive(Date.now());
      saveCoverage();
    };

    const interval = setInterval(() => {
      flush();
      if (++ticks % EVICT_EVERY_TICKS === 0) {
        void cacheRef.current!
          .evictToSize(MAX_CACHE_SIZE)
          .then(oldestSurviving => {
            if (oldestSurviving !== null) {
              coverageRef.current!.trim(oldestSurviving);
              saveCoverage();
            }
          })
          .catch(() => {});
      }
    }, FLUSH_INTERVAL_MS);

    window.addEventListener('pagehide', flush);
    return () => {
      clearInterval(interval);
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [saveCoverage]);

  // Shrink/grow the buffer when the configured load limit changes.
  useEffect(() => {
    const removed = bufferRef.current!.setMaxSize(maxSize);
    if (removed.length > 0) {
      trackRemoved(removed);
      publish();
    }
  }, [maxSize, trackRemoved, publish]);

  /**
   * Remember a live telegram for IndexedDB and extend coverage. Rows that never
   * enter the buffer still take this path so a discard cannot drop them or
   * leave coverage claiming a range the cache does not hold. Coverage is
   * persisted only after the store succeeds (see the flush effect).
   */
  const queueLivePersist = useCallback((entry: TelegramEntry) => {
    coverageRef.current!.extendLive(entry.ts);
    pendingRef.current.push(entry);
    if (pendingRef.current.length >= FLUSH_BATCH_SIZE) {
      const batch = pendingRef.current;
      pendingRef.current = [];
      pendingStoreCountRef.current++;
      cacheRef.current!.store(batch).then(
        () => { pendingStoreCountRef.current--; saveCoverage(); },
        () => { pendingStoreCountRef.current--; },
      );
    }
  }, [saveCoverage]);

  /** Backward live: y follows the newest buffered telegram and never moves back. */
  const slideBackwardAnchor = useCallback((newest: number) => {
    const cur = anchorRef.current;
    if (cur.direction !== 'backward') return;
    if (cur.ts != null && newest <= cur.ts) return;
    const next: BufferAnchor = { direction: 'backward', ts: newest };
    anchorRef.current = next;
    setAnchorState(next);
  }, []);

  const setBufferAnchor = useCallback((next: BufferAnchor) => {
    const ts = next.ts == null || !Number.isFinite(next.ts) ? null : next.ts;
    const normalized: BufferAnchor = { direction: next.direction, ts };
    bufferRef.current!.setEvictionMode(evictionFor(normalized.direction));
    const cur = anchorRef.current;
    if (cur.direction === normalized.direction && cur.ts === normalized.ts) return;
    anchorRef.current = normalized;
    setAnchorState(normalized);
  }, []);

  const adoptAnchorDirection = useCallback((direction: 'forward' | 'backward') => {
    bufferRef.current!.setEvictionMode(evictionFor(direction));
    const cur = anchorRef.current;
    if (cur.direction === direction) return;
    const next: BufferAnchor = { direction, ts: null };
    anchorRef.current = next;
    setAnchorState(next);
  }, []);

  const setBufferRangeMinutes = useCallback((minutes: number) => {
    if (!Number.isFinite(minutes)) return;
    rangeMinutesRef.current = minutes;
  }, []);

  const addLive = useCallback(
    (t: Telegram) => {
      const entry = toEntry(t);
      // A gap fetch racing the live stream may already have delivered this row.
      if (idsRef.current.has(entry.id)) return;
      const buf = bufferRef.current!;
      const anchor = anchorRef.current;
      // Forward has no live follow. The row always goes to IndexedDB. It enters
      // the buffer only inside [x, x + range] while loadLimit still has room.
      // Otherwise the buffer and x stay as they are.
      if (anchor.direction === 'forward') {
        const rangeMs = rangeMsOf(rangeMinutesRef.current);
        const x = anchor.ts != null ? anchor.ts : buf.oldestTs;
        const inWindow = x == null || (entry.ts >= x && entry.ts <= x + rangeMs);
        if (!inWindow || buf.length >= buf.maxSize) {
          queueLivePersist(entry);
          return;
        }
      }
      const removed = buf.add(entry);
      trackRemoved(removed);
      // Overflow dropped this row immediately. Do not publish it, but do not
      // drop it from IndexedDB or coverage either.
      if (removed.some(e => e.id === entry.id)) {
        queueLivePersist(entry);
        return;
      }
      idsRef.current.add(entry.id);
      queueLivePersist(entry);
      if (anchorRef.current.direction === 'backward') {
        const newest = buf.newestTs;
        if (newest != null) slideBackwardAnchor(newest);
      }
      if (pausedRef.current) {
        if (!structuralWhilePausedRef.current) {
          const room = telegramsRef.current.length - pendingDropRef.current;
          pendingDropRef.current += Math.min(removed.length, Math.max(0, room));
        }
        const list = pausedBacklogRef.current;
        list.unshift(entry.telegram);
        const cap = bufferRef.current!.length;
        if (list.length > cap) list.length = cap;
        updatePausedCount(pausedCountRef.current + 1);
      } else {
        const head = telegramsRef.current[0];
        const inOrder = head === undefined || entry.ts >= telegramTs(head);
        if (inOrder) publishPrepend([entry.telegram], removed.length);
        else publish();
      }
    },
    [trackRemoved, publish, publishPrepend, queueLivePersist, slideBackwardAnchor, updatePausedCount],
  );

  const setConnected = useCallback(
    (connected: boolean) => {
      if (connectedRef.current === connected) return;
      connectedRef.current = connected;
      const coverage = coverageRef.current!;
      if (connected) {
        // Anchor the live interval at the (re)connect instant and pull in
        // whatever happened while the stream was down.
        const now = Date.now();
        coverage.extendLive(now);
        const coveredStart = coverage.covered[0]?.[0];
        if (coveredStart !== undefined) void runLoad(() => fillGaps(coveredStart, now));
      } else {
        // Everything up to this instant was seen; afterwards is a gap.
        coverage.extendLive(Date.now());
        coverage.closeLive();
        saveCoverage();
      }
    },
    [runLoad, fillGaps, saveCoverage],
  );

  const setPaused = useCallback(
    (paused: boolean) => {
      if (pausedRef.current === paused) return;
      pausedRef.current = paused;
      if (paused) {
        structuralWhilePausedRef.current = false;
        pendingDropRef.current = 0;
        updatePausedCount(0);
        return;
      }
      const diverged = structuralWhilePausedRef.current;
      const head = pausedBacklogRef.current.slice();
      const drop = pendingDropRef.current;
      structuralWhilePausedRef.current = false;
      pendingDropRef.current = 0;
      updatePausedCount(0);
      // The last portion already published the full buffer. Copying it again
      // is the stall at the end of a metered flush.
      if (diverged) publishFromBuffer(0);
      else publishPrepend(head, drop);
    },
    [publishFromBuffer, publishPrepend, updatePausedCount],
  );

  const revealPaused = useCallback(
    (n: number): number => {
      const backlog = pausedCountRef.current;
      if (!pausedRef.current || n <= 0 || backlog <= 0) return backlog;
      const hidden = Math.max(0, backlog - Math.floor(n));
      if (structuralWhilePausedRef.current) {
        updatePausedCount(hidden);
        publishFromBuffer(hidden);
        return hidden;
      }
      const list = pausedBacklogRef.current;
      const fromList = Math.max(0, list.length - hidden);
      const revealed = fromList === 0 ? [] : list.slice(list.length - fromList);
      const drop = pendingDropRef.current;
      pendingDropRef.current = 0;
      updatePausedCount(hidden);
      publishPrepend(revealed, drop);
      return hidden;
    },
    [publishFromBuffer, publishPrepend, updatePausedCount],
  );

  const clear = useCallback(async () => {
    // Invalidate any in-flight background load so a late-arriving history chunk
    // can't repopulate the buffer we're about to wipe (#339).
    loadGenerationRef.current++;
    setActiveLoads(0);
    trackRemoved(bufferRef.current!.clear());
    pendingRef.current = [];
    coverageRef.current!.clear();
    saveCoverage();
    // Drop the pause-backlog counter too — cleared telegrams must not keep the
    // jump-to-live pill alive with a count that can never appear in the list.
    updatePausedCount(0);
    telegramsRef.current = [];
    pendingDropRef.current = 0;
    structuralWhilePausedRef.current = false;
    setTelegrams([]);
    await cacheRef.current!.clear().catch(() => {});
  }, [trackRemoved, saveCoverage, updatePausedCount]);

  const cancelLoad = useCallback(() => {
    loadGenerationRef.current++;
    setActiveLoads(0);
    setLoadError(null);
  }, []);

  const setEvictionMode = useCallback((mode: EvictionMode) => {
    bufferRef.current!.setEvictionMode(mode);
  }, []);

  const trimToTimeWindow = useCallback((minTs: number, maxTs: number) => {
    const removed = bufferRef.current!.trimToWindow(minTs, maxTs);
    if (removed.length === 0) return;
    trackRemoved(removed);
    if (pausedRef.current) {
      structuralWhilePausedRef.current = true;
      const list = pausedBacklogRef.current;
      if (list.length > 0) {
        const gone = new Set(removed.map(e => e.id));
        const next = list.filter(t => !gone.has(toEntry(t).id));
        list.length = 0;
        list.push(...next);
        updatePausedCount(list.length);
      }
      return;
    }
    publish();
  }, [trackRemoved, publish, updatePausedCount]);

  const enforceTimeWindow = useCallback((direction: 'forward' | 'backward', rangeMinutes: number) => {
    rangeMinutesRef.current = rangeMinutes;
    const buf = bufferRef.current!;
    const origin = anchorOrigin(anchorRef.current, direction, buf.oldestTs, buf.newestTs);
    if (origin == null) return;
    const rangeMs = rangeMsOf(rangeMinutes);
    if (direction === 'forward') trimToTimeWindow(origin, origin + rangeMs);
    else trimToTimeWindow(origin - rangeMs, origin);
  }, [trimToTimeWindow]);

  // Appended in place. `pausedCount` is the render signal — copying this array
  // into React state on every telegram is what made the newer pill stall.
  // eslint-disable-next-line react-hooks/refs
  const pausedTelegrams = pausedBacklogRef.current;

  // Full buffer for GA read phase. While playing this is the published list.
  // While paused it is the in-place backlog plus that list, allocated only when
  // one of those two changes — not a second snapshot on every live telegram.
  /* eslint-disable react-hooks/refs -- backlog is mutated in place; pausedCount is the render signal */
  const ingested = useMemo(() => {
    if (pausedCount <= 0) return telegrams;
    const backlog = pausedBacklogRef.current;
    return backlog.length === 0 ? telegrams : backlog.concat(telegrams);
  }, [pausedCount, telegrams]);
  /* eslint-enable react-hooks/refs */

  // Published list is newest-first; buffer bounds follow that order.
  const oldestTs = telegrams.length > 0
    ? telegramTs(telegrams[telegrams.length - 1])
    : null;
  const newestTs = telegrams.length > 0
    ? telegramTs(telegrams[0])
    : null;

  /* eslint-disable react-hooks/refs -- pausedTelegrams is the stable backlog above */
  return {
    telegrams,
    ingested,
    addLive,
    setConnected,
    setPaused,
    pausedCount,
    pausedTelegrams,
    revealPaused,
    loadRange,
    fillForwardFrom,
    fillBackwardTo,
    oldestTs,
    newestTs,
    isLoading: activeLoads > 0,
    loadError,
    clear,
    cancelLoad,
    setEvictionMode,
    bufferAnchor,
    setBufferAnchor,
    adoptAnchorDirection,
    setBufferRangeMinutes,
    trimToTimeWindow,
    enforceTimeWindow,
  };
  /* eslint-enable react-hooks/refs */
}
