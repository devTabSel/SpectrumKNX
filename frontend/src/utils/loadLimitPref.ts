import { getPref } from './prefs';

/** Legacy single limit. Seeds both views until each has its own value. */
export const LEGACY_LOAD_LIMIT_PREF = 'loadLimit';
export const MONITOR_LOAD_LIMIT_PREF = 'monitorLoadLimit';
export const HISTORY_LOAD_LIMIT_PREF = 'historyLoadLimit';

export type LoadLimitPref = typeof MONITOR_LOAD_LIMIT_PREF | typeof HISTORY_LOAD_LIMIT_PREF;

const DEFAULT_LOAD_LIMIT = 100_000;

function positiveInt(raw: string | null): number | null {
  if (raw == null || raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.floor(n);
}

/**
 * Monitor and history keep separate limits. A missing key starts from the
 * legacy `loadLimit` preference, then the built-in default.
 */
export function readLoadLimit(key: LoadLimitPref, fallback = DEFAULT_LOAD_LIMIT): number {
  return positiveInt(getPref(key))
    ?? positiveInt(getPref(LEGACY_LOAD_LIMIT_PREF))
    ?? fallback;
}
