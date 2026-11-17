/** Duration units for the history/monitor range field. `d` is days. */
export type RangeUnit = 's' | 'm' | 'h' | 'd';

export const RANGE_UNITS: RangeUnit[] = ['s', 'm', 'h', 'd'];

export interface RangePreset {
  label: string;
  /** Duration in milliseconds. */
  ms: number;
}

/** Common ranges offered in the range Werthilfe. */
export const RANGE_PRESETS: RangePreset[] = [
  { label: '30 s', ms: 30_000 },
  { label: '1 m', ms: 60_000 },
  { label: '5 m', ms: 5 * 60_000 },
  { label: '15 m', ms: 15 * 60_000 },
  { label: '1 h', ms: 3_600_000 },
  { label: '6 h', ms: 6 * 3_600_000 },
  { label: '12 h', ms: 12 * 3_600_000 },
  { label: '1 d', ms: 86_400_000 },
  { label: '7 d', ms: 7 * 86_400_000 },
];

const UNIT_MS: Record<RangeUnit, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

export function rangeUnitMs(unit: RangeUnit): number {
  return UNIT_MS[unit];
}

/**
 * Anchor of the current reading direction stays fixed.
 * Backward keeps newest and sets oldest = anchor − range.
 * Forward keeps oldest and sets newest = anchor + range.
 */
export function windowFromRange(
  direction: 'forward' | 'backward',
  anchorMs: number,
  rangeMs: number,
): { startMs: number; endMs: number } {
  const span = Math.max(0, rangeMs);
  if (direction === 'forward') return { startMs: anchorMs, endMs: anchorMs + span };
  return { startMs: anchorMs - span, endMs: anchorMs };
}

/** "30 s" / "1,5 h" → value + unit. A bare number is not a preset. */
export function parseRangePreset(raw: string): { value: number; unit: RangeUnit } | null {
  const match = raw.trim().match(/^(\d+(?:[.,]\d+)?)\s*([smhd])$/i);
  if (!match) return null;
  const value = Number(match[1].replace(',', '.'));
  if (!Number.isFinite(value) || value <= 0) return null;
  return { value, unit: match[2].toLowerCase() as RangeUnit };
}

/** Exact millisecond duration of a typed range. Null when the text is not a positive number. */
export function rangeValueToMs(raw: string, unit: RangeUnit): number | null {
  const preset = parseRangePreset(raw);
  if (preset) return Math.max(1, Math.round(preset.value * UNIT_MS[preset.unit]));
  const n = Number(raw.trim().replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(1, Math.round(n * UNIT_MS[unit]));
}

/** Format a millisecond duration in `unit` (trailing zeros dropped, up to 2 decimals). */
export function formatRangeMs(ms: number, unit: RangeUnit): string {
  const n = ms / UNIT_MS[unit];
  if (!Number.isFinite(n) || n <= 0) return '';
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

export function nextRangeUnit(unit: RangeUnit): RangeUnit {
  const idx = RANGE_UNITS.indexOf(unit);
  return RANGE_UNITS[(idx + 1) % RANGE_UNITS.length];
}
