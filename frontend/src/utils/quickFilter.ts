import type { Telegram } from '../hooks/useWebSocket';
import { dptKey } from '../types/filters';
import { makeAddressPatternMatcher } from './addressPattern';
import { makeValueMatcher } from './valuePattern';

export type ColId = 'time' | 'delta' | 'source' | 'target' | 'type' | 'dpt' | 'value';
export type QuickFilterColumnEnabled = Record<ColId, boolean>;

export interface QuickCellValue {
  top: string;
  bottom: string;
}

export const DEFAULT_QUICK_FILTER_COLUMN_ENABLED: QuickFilterColumnEnabled = {
  time: true,
  delta: true,
  source: true,
  target: true,
  type: true,
  dpt: true,
  value: true,
};

const makeTextMatcher = (pattern: string): ((s: string) => boolean) => {
  try {
    const re = new RegExp(pattern, 'i');
    return s => re.test(s);
  } catch {
    const lower = pattern.toLowerCase();
    return s => s.toLowerCase().includes(lower);
  }
};

export const compileQuickFilters = (
  patterns: Partial<Record<ColId, QuickCellValue>>,
  enabledColumns: Record<ColId, boolean>,
): ((t: Telegram) => boolean) => {
  const checks: ((t: Telegram) => boolean)[] = [];

  const time = patterns.time;
  if (enabledColumns.time !== false && (time?.top || time?.bottom)) {
    const from = time.top ? new Date(time.top).getTime() : null;
    const to = time.bottom ? new Date(time.bottom).getTime() : null;
    checks.push(t => {
      const ts = new Date(t.timestamp).getTime();
      if (from != null && !Number.isNaN(from) && ts < from) return false;
      if (to != null && !Number.isNaN(to) && ts > to) return false;
      return true;
    });
  }

  const source = patterns.source;
  if (enabledColumns.source !== false && source?.top) {
    const m = makeAddressPatternMatcher(source.top);
    checks.push(t => m(t.source_address));
  }
  if (enabledColumns.source !== false && source?.bottom) {
    const m = makeTextMatcher(source.bottom);
    checks.push(t => m(t.source_name ?? ''));
  }

  const target = patterns.target;
  if (enabledColumns.target !== false && target?.top) {
    const m = makeAddressPatternMatcher(target.top);
    checks.push(t => m(t.target_address));
  }
  if (enabledColumns.target !== false && target?.bottom) {
    const m = makeTextMatcher(target.bottom);
    checks.push(t => m(t.target_name ?? ''));
  }

  const type = patterns.type;
  if (enabledColumns.type !== false && type?.top) {
    const values = type.top.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    if (values.length > 0) {
      checks.push(t => {
        const typeVal = (t.simplified_type || t.telegram_type || '').toLowerCase();
        const dirVal = (t.direction ?? '').toLowerCase();
        return values.some(v => v === typeVal || v === dirVal);
      });
    }
  }

  const dpt = patterns.dpt;
  if (enabledColumns.dpt !== false && dpt?.top) {
    const m = makeAddressPatternMatcher(dpt.top);
    checks.push(t => t.dpt_main != null && m(dptKey(t.dpt_main, t.dpt_sub)));
  }
  if (enabledColumns.dpt !== false && dpt?.bottom) {
    const m = makeTextMatcher(dpt.bottom);
    checks.push(t => m(t.dpt_name ?? ''));
  }

  const value = patterns.value;
  if (enabledColumns.value !== false && (value?.top || value?.bottom)) {
    const m = makeValueMatcher(value.top ?? '', value.bottom ?? '');
    checks.push(m);
  }

  if (checks.length === 0) return () => true;
  return t => checks.every(check => check(t));
};