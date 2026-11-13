// Quick filter bar matching (#271, #309), shared by the table (which renders
// the bar) and its parents (which use quick-filter matches as Time-Delta-Context
// anchors, so context rows around them stay visible — #520).
import type { Telegram } from '../hooks/useWebSocket';
import { makeAddressPatternMatcher } from './addressPattern';
import { dptDescriptionLabel, dptKeyLabel } from './dpt';
import { makeValueMatcher } from './valuePattern';

/** TYPE bottom cell text — same mapping the telegram table renders. */
const directionLabel = (direction: string | null | undefined): string =>
  direction === 'Outgoing' ? 'Outgoing' : 'Incoming';

// A quick-filter cell's two input rows (#309). Most columns use both (address/DPT
// pattern + name on source/target/dpt; from/to on time/value; type + direction
// on TYPE). `delta` isn't matched through this pipeline at all — its two rows
// edit the Time-Delta-Context window instead.
export interface QuickCellValue {
  top: string;
  bottom: string;
}
/** Patterns per column id ('time', 'source', 'target', 'type', 'dpt', 'value'). */
export type QuickPatterns = Partial<Record<string, QuickCellValue>>;

/** Text matcher: `regex:…`, quoted wildcard lists (`"a*","b+"`), else substring. */
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

/** Optional per-column enable map; a column set to `false` is skipped. */
export type QuickFilterColumnEnabled = Partial<Record<string, boolean>>;

export const DEFAULT_QUICK_FILTER_COLUMN_ENABLED: Record<string, boolean> = {
  time: true,
  delta: true,
  source: true,
  target: true,
  type: true,
  dpt: true,
  value: true,
};

const colEnabled = (enabledColumns: QuickFilterColumnEnabled | undefined, id: string) =>
  enabledColumns?.[id] !== false;

/** Builds one combined predicate from all active quick-filter cells, so
 * patterns are compiled once per change rather than per telegram. */
export const compileQuickFilters = (
  patterns: QuickPatterns,
  enabledColumns?: QuickFilterColumnEnabled,
): ((t: Telegram) => boolean) => {
  const checks: ((t: Telegram) => boolean)[] = [];

  const time = patterns.time;
  if (colEnabled(enabledColumns, 'time') && (time?.top || time?.bottom)) {
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
  if (colEnabled(enabledColumns, 'source') && source?.top) {
    const m = makeAddressPatternMatcher(source.top);
    checks.push(t => m(t.source_address));
  }
  if (colEnabled(enabledColumns, 'source') && source?.bottom) {
    const m = makeTextMatcher(source.bottom);
    checks.push(t => m(t.source_name ?? ''));
  }

  const target = patterns.target;
  if (colEnabled(enabledColumns, 'target') && target?.top) {
    const m = makeAddressPatternMatcher(target.top);
    checks.push(t => m(t.target_address));
  }
  if (colEnabled(enabledColumns, 'target') && target?.bottom) {
    const m = makeTextMatcher(target.bottom);
    checks.push(t => m(t.target_name ?? ''));
  }

  const type = patterns.type;
  if (colEnabled(enabledColumns, 'type') && type?.top) {
    const m = makeTextMatcher(type.top);
    checks.push(t => m(t.simplified_type || t.telegram_type || ''));
  }
  if (colEnabled(enabledColumns, 'type') && type?.bottom) {
    const m = makeTextMatcher(type.bottom);
    checks.push(t => m(directionLabel(t.direction)));
  }

  const dpt = patterns.dpt;
  if (colEnabled(enabledColumns, 'dpt') && dpt?.top) {
    const m = makeAddressPatternMatcher(dpt.top);
    checks.push(t => {
      const label = dptKeyLabel(t.dpt_main, t.dpt_sub);
      return label != null && m(label);
    });
  }
  if (colEnabled(enabledColumns, 'dpt') && dpt?.bottom) {
    const m = makeTextMatcher(dpt.bottom);
    checks.push(t => m(dptDescriptionLabel(t.dpt_name, t.unit) ?? ''));
  }

  const value = patterns.value;
  if (colEnabled(enabledColumns, 'value') && (value?.top || value?.bottom)) {
    const m = makeValueMatcher(value.top ?? '', value.bottom ?? '');
    checks.push(m);
  }

  if (checks.length === 0) return () => true;
  return t => checks.every(check => check(t));
};

/** The effective quick-filter predicate, or null when the bar is closed, disabled or empty. */
export function activeQuickFilter(
  open: boolean,
  enabled: boolean,
  patterns: QuickPatterns,
  enabledColumns?: QuickFilterColumnEnabled,
): ((t: Telegram) => boolean) | null {
  if (!open || !enabled) return null;
  const hasPattern = Object.entries(patterns).some(([id, cell]) =>
    id !== 'delta' && colEnabled(enabledColumns, id) && (cell?.top || cell?.bottom));
  return hasPattern ? compileQuickFilters(patterns, enabledColumns) : null;
}
