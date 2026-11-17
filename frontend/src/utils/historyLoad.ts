import type { Telegram } from '../hooks/useWebSocket';
import { effectiveDeltaContext, type ActiveFilters } from '../types/filters';
import { anchorKey } from './anchorKey';
import { apiUrl } from './basePath';

export interface HistoryMetadata {
  total_count: number;
  limit_reached: boolean;
}

/** The time window a history load was made with — kept for share links (#150). */
export type LoadedRange =
  | { kind: 'relative'; seconds: number }
  | { kind: 'absolute'; startTime: string; endTime: string };

/** Appends active filter state as query params to a base URL string. */
export function applyFilterParams(url: string, filters?: ActiveFilters): string {
  if (!filters) return url;
  const params: string[] = [];
  if (filters.sources.length > 0) params.push(`source_address=${encodeURIComponent(filters.sources.join(','))}`);
  if (filters.targets.length > 0) params.push(`target_address=${encodeURIComponent(filters.targets.join(','))}`);
  if (filters.types.length > 0) params.push(`telegram_type=${encodeURIComponent(filters.types.join(','))}`);
  if (filters.dpts.length > 0) params.push(`dpt_main=${encodeURIComponent(filters.dpts.join(','))}`);
  const { before, after } = effectiveDeltaContext(filters);
  if (before > 0) params.push(`delta_before_ms=${before}`);
  if (after > 0) params.push(`delta_after_ms=${after}`);
  if (params.length === 0) return url;
  return url + (url.includes('?') ? '&' : '?') + params.join('&');
}

/** Converts local datetime-local string to UTC ISO string, returns empty string if invalid. */
function localToUtcIso(localStr: string): string {
  if (!localStr) return '';
  const d = new Date(localStr);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

/** Converts local datetime-local string to epoch milliseconds, returns fallback if invalid. */
function localToEpochMs(localStr: string, fallback: number): number {
  if (!localStr) return fallback;
  const d = new Date(localStr);
  return isNaN(d.getTime()) ? fallback : d.getTime();
}

/** Builds the /api/telegrams URL for a range. Times use the loader's
 * datetime-local format ("YYYY-MM-DDTHH:MM", interpreted in the local timezone).
 * Backward reads newest-first (`order=desc`); forward reads oldest-first (`order=asc`). */
export function buildHistoryUrl(
  range: LoadedRange,
  limit: number,
  order: 'asc' | 'desc' = 'desc',
): string {
  let url = apiUrl(`/api/telegrams?limit=${limit}&order=${order}`);
  if (range.kind === 'relative') {
    const start = new Date(Date.now() - range.seconds * 1000).toISOString();
    url += `&start_time=${encodeURIComponent(start)}`;
  } else {
    const startUtc = localToUtcIso(range.startTime);
    if (startUtc) url += `&start_time=${encodeURIComponent(startUtc)}`;
    const endUtc = localToUtcIso(range.endTime);
    if (endUtc) url += `&end_time=${encodeURIComponent(endUtc)}`;
  }
  return url;
}

/** Resolves a LoadedRange to concrete epoch-ms bounds (open ends → 0 / now). */
export function rangeToMs(range: LoadedRange, nowMs = Date.now()): { startMs: number; endMs: number } {
  if (range.kind === 'relative') {
    return { startMs: nowMs - range.seconds * 1000, endMs: nowMs };
  }
  return {
    startMs: localToEpochMs(range.startTime, 0),
    endMs: localToEpochMs(range.endTime, nowMs),
  };
}

/** Local datetime-local value ("YYYY-MM-DDTHH:mm:ss") for an epoch instant. */
export function msToLocalInput(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function isAbortError(err: unknown): boolean {
  return (err instanceof DOMException && err.name === 'AbortError')
    || (err instanceof Error && err.name === 'AbortError');
}

/** First row wins. History has no id, so the timestamp is the identity. */
export function dedupeByTimestamp(rows: readonly Telegram[]): Telegram[] {
  const seen = new Set<string>();
  const out: Telegram[] = [];
  for (const row of rows) {
    if (seen.has(row.timestamp)) continue;
    seen.add(row.timestamp);
    out.push(row);
  }
  return out;
}

function inWindow(row: Telegram, startMs: number, endMs: number): boolean {
  const ms = Date.parse(row.timestamp);
  return Number.isFinite(ms) && ms >= startMs && ms <= endMs;
}

/**
 * Keep at most `limit` rows, preferring the anchor side.
 * Backward keeps the newest, forward the oldest.
 */
export function capHistory(
  rows: readonly Telegram[],
  limit: number,
  direction: 'forward' | 'backward',
): Telegram[] {
  if (rows.length <= limit) return rows as Telegram[];
  const sorted = [...rows].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  return direction === 'forward' ? sorted.slice(0, limit) : sorted.slice(sorted.length - limit);
}

/**
 * Range change: drop locally held rows outside the new window, add the fetch, dedupe.
 * Fetched rows stay even when the delta window put them just outside the bounds —
 * that stock is what a later quick-filter context reads. One query, no second page.
 */
export function mergeHistoryWindow(
  previous: readonly Telegram[],
  fetched: readonly Telegram[],
  startMs: number,
  endMs: number,
  limit: number,
  direction: 'forward' | 'backward',
): Telegram[] {
  const kept = previous.filter(row => inWindow(row, startMs, endMs));
  return capHistory(dedupeByTimestamp([...kept, ...fetched]), limit, direction);
}

/** Refresh replaces the loaded set. Rows the new query did not return are gone. */
export function replaceHistoryWindow(
  fetched: readonly Telegram[],
  limit: number,
  direction: 'forward' | 'backward',
): Telegram[] {
  return capHistory(dedupeByTimestamp(fetched), limit, direction);
}

/** Jump targets that are no longer in the loaded set are dropped, not refetched. */
export function retainLoadedJumpTargets(keys: readonly string[], loaded: readonly Telegram[]): string[] {
  const have = new Set(loaded.map(anchorKey));
  return keys.filter(key => have.has(key));
}

/**
 * Fetches history telegrams for a range with server-side filters applied.
 * All active filters combine with AND (#275), so a single query suffices.
 * `signal` aborts the request; the caller keeps its previous list.
 */
export async function loadHistoryTelegrams(
  range: LoadedRange,
  limit: number,
  filters?: ActiveFilters,
  signal?: AbortSignal,
  order: 'asc' | 'desc' = 'desc',
): Promise<{ telegrams: Telegram[]; metadata: HistoryMetadata }> {
  const baseUrl = buildHistoryUrl(range, limit, order);
  const res = await fetch(applyFilterParams(baseUrl, filters), { signal });
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (!res.ok) throw new Error(`Server error: ${res.status}`);
  const data = await res.json();
  return {
    telegrams: data.telegrams || [],
    metadata: data.metadata || { total_count: 0, limit_reached: false },
  };
}
