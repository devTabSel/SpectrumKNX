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

export const makeTextMatcher = (pattern: string): ((s: string) => boolean) => {
  const trimmed = pattern.trim();
  if (trimmed.length === 0) return () => true;

  const makeLiteralSubstringMatcher = (needle: string) => {
    const lower = needle.toLowerCase();
    return (s: string) => s.toLowerCase().includes(lower);
  };

  const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

  const makeQuotedPatternMatcher = (patterns: string[]) => {
    const compiled = patterns.map(compileWildcardPattern);
    return (s: string) => compiled.some(re => re.test(s));
  };

  if (trimmed.toLowerCase().startsWith('regex:')) {
    const expr = trimmed.slice('regex:'.length);
    try {
      const re = new RegExp(expr, 'i');
      return s => re.test(s);
    } catch {
      const quotedPatterns = parseQuotedPatternList(expr);
      if (quotedPatterns) return makeQuotedPatternMatcher(quotedPatterns);
      return makeLiteralSubstringMatcher(expr);
    }
  }

  const quotedPatterns = parseQuotedPatternList(trimmed);
  if (quotedPatterns) return makeQuotedPatternMatcher(quotedPatterns);
  return makeLiteralSubstringMatcher(trimmed);
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
    const m = makeTextMatcher(type.top);
    checks.push(t => m(t.simplified_type || t.telegram_type || ''));
  }
  if (enabledColumns.type !== false && type?.bottom) {
    const m = makeTextMatcher(type.bottom);
    checks.push(t => m(t.direction ?? ''));
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