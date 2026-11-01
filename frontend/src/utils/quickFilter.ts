// Quick filter bar matching (#271, #309), shared by the table (which renders
// the bar) and its parents (which use quick-filter matches as Time-Delta-Context
// anchors, so context rows around them stay visible — #520).
import type { Telegram } from '../hooks/useWebSocket';
import { dptKey } from '../types/filters';
import { makeAddressPatternMatcher } from './addressPattern';
import { makeValueMatcher } from './valuePattern';

export type QuickFilterColumnId = 'time' | 'delta' | 'source' | 'target' | 'type' | 'dpt' | 'value';
export type QuickFilterColumnEnabled = Record<QuickFilterColumnId, boolean>;

export const DEFAULT_QUICK_FILTER_COLUMN_ENABLED: QuickFilterColumnEnabled = {
  time: true,
  delta: true,
  source: true,
  target: true,
  type: true,
  dpt: true,
  value: true,
};

// A quick-filter cell's two input rows (#309). Source/target/DPT use an address
// pattern plus a name pattern. TYPE uses a type pattern and a direction pattern.
// Time and value use from/to. `delta` is not matched here — its rows edit the
// Time-Delta-Context window.
export interface QuickCellValue {
  top: string;
  bottom: string;
}
/** Patterns per column id ('time', 'source', 'target', 'type', 'dpt', 'value'). */
export type QuickPatterns = Partial<Record<string, QuickCellValue>>;

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `*` is any run of characters, `+` is one character, `\` escapes the next character. */
const compileWildcardPattern = (wildcardPattern: string): RegExp => {
  let regexBody = '';
  for (let i = 0; i < wildcardPattern.length; i++) {
    const ch = wildcardPattern[i];
    if (ch === '\\') {
      if (i + 1 < wildcardPattern.length) {
        regexBody += escapeRegex(wildcardPattern[i + 1]);
        i++;
      } else {
        regexBody += '\\\\';
      }
      continue;
    }
    if (ch === '*') {
      regexBody += '.*';
      continue;
    }
    if (ch === '+') {
      regexBody += '.';
      continue;
    }
    regexBody += escapeRegex(ch);
  }
  return new RegExp(`^${regexBody}$`, 'i');
};

/** `"a", "b*"` — a comma-separated list of quoted wildcard patterns. Null when the text is not that shape. */
const parseQuotedPatternList = (text: string): string[] | null => {
  const out: string[] = [];
  let i = 0;
  const len = text.length;
  const skipWs = () => {
    while (i < len && /\s/u.test(text[i])) i++;
  };
  skipWs();
  while (i < len) {
    if (text[i] !== '"') return null;
    i++;
    let token = '';
    let closed = false;
    while (i < len) {
      const ch = text[i];
      if (ch === '\\') {
        if (i + 1 < len) {
          token += text[i + 1];
          i += 2;
        } else {
          token += '\\';
          i++;
        }
        continue;
      }
      if (ch === '"') {
        i++;
        closed = true;
        break;
      }
      token += ch;
      i++;
    }
    if (!closed) return null;
    out.push(token);
    skipWs();
    if (i >= len) break;
    if (text[i] !== ',') return null;
    i++;
    skipWs();
  }
  return out.length > 0 ? out : null;
};

/**
 * Name and description matching. A bare value is a case-insensitive substring.
 * `"pat*", "a+b"` is a list of whole-string wildcards. `regex:` is a regular
 * expression; an invalid one falls back to the quoted-list or substring rules.
 */
export const makeTextMatcher = (pattern: string): ((s: string) => boolean) => {
  const trimmed = pattern.trim();
  if (trimmed.length === 0) return () => true;

  const literal = (needle: string) => {
    const lower = needle.toLowerCase();
    return (s: string) => s.toLowerCase().includes(lower);
  };
  const quoted = (patterns: string[]) => {
    const compiled = patterns.map(compileWildcardPattern);
    return (s: string) => compiled.some(re => re.test(s));
  };

  if (trimmed.toLowerCase().startsWith('regex:')) {
    const expr = trimmed.slice('regex:'.length);
    try {
      const re = new RegExp(expr, 'i');
      return s => re.test(s);
    } catch {
      const patterns = parseQuotedPatternList(expr);
      if (patterns) return quoted(patterns);
      return literal(expr);
    }
  }

  const patterns = parseQuotedPatternList(trimmed);
  if (patterns) return quoted(patterns);
  return literal(trimmed);
};

const textMatcherCache = new Map<string, (s: string) => boolean>();

/** Same grammar as {@link makeTextMatcher}, compiled once per pattern string. */
export const textMatcher = (pattern: string): ((s: string) => boolean) => {
  const cached = textMatcherCache.get(pattern);
  if (cached) return cached;
  const match = makeTextMatcher(pattern);
  textMatcherCache.set(pattern, match);
  if (textMatcherCache.size > 32) {
    const oldest = textMatcherCache.keys().next().value;
    if (oldest !== undefined) textMatcherCache.delete(oldest);
  }
  return match;
};

/**
 * True when the pattern is empty, or any value matches it.
 * Bare text is a case-insensitive substring, `"pat*", "a+b"` a quoted
 * whole-string wildcard list, and `regex:` a case-insensitive expression.
 */
export const matchesAnyText = (pattern: string, ...values: (string | number | null | undefined)[]): boolean => {
  if (pattern.trim().length === 0) return true;
  const match = textMatcher(pattern);
  return values.some(value => value != null && match(String(value)));
};

/** Plain substring search, so exact and prefix ranking still apply. */
export const isPlainTextSearch = (pattern: string): boolean => {
  const trimmed = pattern.trim();
  return trimmed.length === 0 || (!trimmed.toLowerCase().startsWith('regex:') && !trimmed.startsWith('"'));
};

/** Builds one combined predicate from all active quick-filter cells, so
 * patterns are compiled once per change rather than per telegram. */
export const compileQuickFilters = (
  patterns: QuickPatterns,
  enabledColumns: QuickFilterColumnEnabled = DEFAULT_QUICK_FILTER_COLUMN_ENABLED,
): ((t: Telegram) => boolean) => {
  const on = (id: QuickFilterColumnId) => enabledColumns[id] !== false;
  const checks: ((t: Telegram) => boolean)[] = [];

  const time = patterns.time;
  if (on('time') && (time?.top || time?.bottom)) {
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
  if (on('source') && source?.top) {
    const m = makeAddressPatternMatcher(source.top);
    checks.push(t => m(t.source_address));
  }
  if (on('source') && source?.bottom) {
    const m = makeTextMatcher(source.bottom);
    checks.push(t => m(t.source_name ?? ''));
  }

  const target = patterns.target;
  if (on('target') && target?.top) {
    const m = makeAddressPatternMatcher(target.top);
    checks.push(t => m(t.target_address));
  }
  if (on('target') && target?.bottom) {
    const m = makeTextMatcher(target.bottom);
    checks.push(t => m(t.target_name ?? ''));
  }

  const type = patterns.type;
  if (on('type') && type?.top) {
    const m = makeTextMatcher(type.top);
    checks.push(t => m(t.simplified_type || t.telegram_type || ''));
  }
  if (on('type') && type?.bottom) {
    const m = makeTextMatcher(type.bottom);
    checks.push(t => m(t.direction ?? ''));
  }

  const dpt = patterns.dpt;
  if (on('dpt') && dpt?.top) {
    const m = makeAddressPatternMatcher(dpt.top);
    checks.push(t => t.dpt_main != null && m(dptKey(t.dpt_main, t.dpt_sub)));
  }
  if (on('dpt') && dpt?.bottom) {
    const m = makeTextMatcher(dpt.bottom);
    checks.push(t => m(t.dpt_name ?? ''));
  }

  const value = patterns.value;
  if (on('value') && (value?.top || value?.bottom)) {
    const m = makeValueMatcher(value.top ?? '', value.bottom ?? '');
    checks.push(m);
  }

  if (checks.length === 0) return () => true;
  return t => checks.every(check => check(t));
};

/** The effective quick-filter predicate, or null when the bar is closed, disabled or empty. A column switched off in the header does not count. */
export function activeQuickFilter(
  open: boolean,
  enabled: boolean,
  patterns: QuickPatterns,
  columns: QuickFilterColumnEnabled = DEFAULT_QUICK_FILTER_COLUMN_ENABLED,
): ((t: Telegram) => boolean) | null {
  if (!open || !enabled) return null;
  const hasPattern = (Object.keys(DEFAULT_QUICK_FILTER_COLUMN_ENABLED) as QuickFilterColumnId[])
    .some(id => id !== 'delta' && columns[id] !== false && !!(patterns[id]?.top || patterns[id]?.bottom));
  return hasPattern ? compileQuickFilters(patterns, columns) : null;
}
