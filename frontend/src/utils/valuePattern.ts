// VALUE column quick-filter matching for the telegram list (#309): binary
// (`0b…`), hex (`0x…`) and decimal digit patterns with `+` (any single digit)
// and `*` (any run of digits) wildcards, plus quoted-regex/literal text.
// Top QF row matches the formatted-value cell; bottom matches the raw-hex cell
// — never a joined composite of formatted + unit + hex.

export interface ValueMatchable {
  value_numeric: number | null;
  raw_hex?: string | null;
  value_formatted?: string | null;
  unit?: string | null;
}

type Matcher = (t: ValueMatchable) => boolean;
type TextField = 'formatted' | 'hex';

/** `+` -> exactly one digit of `digitClass`, `*` -> any run of that digit class. */
const wildcardToRegex = (pattern: string, digitClass: string): RegExp => {
  const body = pattern
    .split('')
    .map(ch => (ch === '+' ? `[${digitClass}]` : ch === '*' ? `[${digitClass}]*` : ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('');
  return new RegExp(`^${body}$`, 'i');
};

const hexMatcher = (pattern: string): Matcher => {
  const re = wildcardToRegex(pattern.slice(2), '0-9a-fA-F');
  return t => !!t.raw_hex && re.test(t.raw_hex.replace(/^0x/i, ''));
};

const binaryMatcher = (pattern: string): Matcher => {
  const re = wildcardToRegex(pattern.slice(2), '01');
  return t => {
    if (!t.raw_hex) return false;
    const bits = t.raw_hex
      .replace(/^0x/i, '')
      .split('')
      .map(c => parseInt(c, 16).toString(2).padStart(4, '0'))
      .join('');
    return re.test(bits) || re.test(bits.replace(/^0+(?=.)/, ''));
  };
};

const decimalWildcardMatcher = (pattern: string): Matcher => {
  const re = wildcardToRegex(pattern, '0-9');
  return t => t.value_numeric != null && re.test(String(t.value_numeric));
};

const isPlainNumber = (s: string): boolean => /^-?\d+(\.\d+)?$/.test(s);

const valueDisplayText = (t: ValueMatchable): string =>
  t.value_formatted ?? (t.value_numeric != null ? String(t.value_numeric) : '');

const textFieldValue = (t: ValueMatchable, field: TextField): string =>
  field === 'hex' ? (t.raw_hex ?? '') : valueDisplayText(t);

const regexOrLiteralMatcher = (pattern: string, field: TextField): Matcher => {
  let re: RegExp;
  try {
    re = new RegExp(pattern, 'i');
  } catch {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, ch => (ch === '*' ? '.*' : ch === '+' ? '.' : `\\${ch}`));
    re = new RegExp(`^${escaped}$`, 'i');
  }
  return t => re.test(textFieldValue(t, field));
};

/** Parses one VALUE cell entry (a single row's text) into a matcher. */
function parseValueToken(token: string, textField: TextField): Matcher {
  if (token.startsWith('"') && token.endsWith('"') && token.length >= 2) {
    return regexOrLiteralMatcher(token.slice(1, -1), textField);
  }
  if (/^0x/i.test(token)) return hexMatcher(token);
  if (/^0b/i.test(token)) return binaryMatcher(token);
  if (/^[\d+*]+$/.test(token) && /\d/.test(token)) return decimalWildcardMatcher(token);
  return regexOrLiteralMatcher(token, textField);
}

/**
 * Builds a matcher from the VALUE cell's two rows. When both rows are plain
 * numbers (no wildcards), they form a numeric range against `value_numeric`;
 * otherwise each non-empty row is parsed as its own pattern and ORed —
 * top against the formatted-value cell, bottom against raw hex.
 */
export function makeValueMatcher(top: string, bottom: string): Matcher {
  const from = top.trim();
  const to = bottom.trim();
  if (from && to && isPlainNumber(from) && isPlainNumber(to)) {
    const lo = Math.min(Number(from), Number(to));
    const hi = Math.max(Number(from), Number(to));
    return t => t.value_numeric != null && t.value_numeric >= lo && t.value_numeric <= hi;
  }
  const matchers: Matcher[] = [];
  if (from) matchers.push(parseValueToken(from, 'formatted'));
  if (to) matchers.push(parseValueToken(to, 'hex'));
  if (matchers.length === 0) return () => true;
  return t => matchers.some(m => m(t));
}
