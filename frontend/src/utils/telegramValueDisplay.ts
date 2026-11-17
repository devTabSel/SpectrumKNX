import type { BusValueView } from './dptValues';
import { discreteDptBitWidth } from './dptValues';
import { decodeRawDpt, RAW_DPT_OPTIONS } from './rawDpt';
import {
  decodeTextDptPayload,
  isTextDptMain,
  parseDptKey,
} from './knxSend';
import { dptUnit } from './dpt';

const RAW_OPTION_KEYS = new Set(RAW_DPT_OPTIONS.map(o => o.key));

/** Raw payload bytes from value_json list or raw_hex / raw_data. */
export function rawPayloadBytes(value: BusValueView & { raw_data?: string | null }): number[] | null {
  const j = value.value_json as unknown;
  if (Array.isArray(j) && j.length > 0 && j.every(b => typeof b === 'number' && Number.isInteger(b))) {
    return j as number[];
  }
  const hex = (value.raw_hex ?? value.raw_data ?? '').trim().replace(/^0x/i, '');
  if (/^[0-9a-fA-F]+$/.test(hex) && hex.length % 2 === 0 && hex.length > 0) {
    const out: number[] = [];
    for (let i = 0; i < hex.length; i += 2) {
      out.push(Number.parseInt(hex.slice(i, i + 2), 16));
    }
    return out;
  }
  return null;
}

/** True when the display string is a leftover undecoded byte-list dump. */
export function isRawListFormatted(text: string | null | undefined): boolean {
  const f = (text ?? '').trim();
  return /^\[\s*-?\d+(\s*,\s*-?\d+)*\s*\]$/.test(f);
}

export function hexFromBytes(bytes: readonly number[]): string {
  return `0x${bytes.map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/** Decode raw bytes with a project/telegram DPT key (subtype or bare main). */
export function decodeNumericWithDpt(
  bytes: readonly number[],
  dptKey: string,
): number | null {
  const parsed = parseDptKey(dptKey);
  if (!parsed) return null;
  const keys: string[] = [];
  if (RAW_OPTION_KEYS.has(dptKey)) keys.push(dptKey);
  const mainKey = String(parsed.main);
  if (RAW_OPTION_KEYS.has(mainKey) && !keys.includes(mainKey)) keys.push(mainKey);
  for (const k of keys) {
    const n = decodeRawDpt(bytes, k);
    if (n != null) return n;
  }
  return null;
}

/**
 * Whether the telegram payload can be shown as DPT-decoded (not a raw dump).
 */
export function payloadFitsDpt(
  value: BusValueView,
  dptKey: string | null | undefined,
): boolean {
  if (!dptKey?.trim()) return false;

  if (isRawListFormatted(value.value_formatted) || Array.isArray(value.value_json)) {
    const bytes = rawPayloadBytes(value);
    if (!bytes) return false;
    if (discreteDptBitWidth(dptKey) != null) return bytes.length <= 1;
    const parsed = parseDptKey(dptKey);
    if (isTextDptMain(parsed?.main)) return decodeTextDptPayload(bytes, dptKey) != null;
    return decodeNumericWithDpt(bytes, dptKey) != null;
  }

  if (value.value_numeric != null && Number.isFinite(value.value_numeric)) return true;
  const formatted = (value.value_formatted ?? '').trim();
  if (formatted && formatted !== '—' && !isRawListFormatted(formatted)) return true;

  const bytes = rawPayloadBytes(value);
  if (!bytes) return false;
  if (discreteDptBitWidth(dptKey) != null) return bytes.length <= 1;
  const parsed = parseDptKey(dptKey);
  if (isTextDptMain(parsed?.main)) return decodeTextDptPayload(bytes, dptKey) != null;
  return decodeNumericWithDpt(bytes, dptKey) != null;
}

export interface DisplayValueEnrichment {
  value: BusValueView;
  dptKey: string | null;
  /** When false, buildValueDisplayModes must omit decoded. */
  allowDecoded: boolean;
}

/**
 * Prepare a telegram value for VALUE-cell facets: project-decode raw bytes when
 * the DPT fits; otherwise strip fake decoded dumps and keep decimal/hex/(bin).
 */
export function enrichTelegramValueDisplay(
  value: BusValueView & { raw_data?: string | null },
  dptKey: string | null | undefined,
): DisplayValueEnrichment {
  const key = dptKey?.trim() || null;
  const withHex = ensureRawHex(value);

  if (!key) {
    return { value: stripFakeDecoded(withHex), dptKey: null, allowDecoded: false };
  }

  if (!payloadFitsDpt(withHex, key)) {
    return { value: stripFakeDecoded(withHex), dptKey: key, allowDecoded: false };
  }

  if (
    !isRawListFormatted(withHex.value_formatted)
    && !Array.isArray(withHex.value_json)
    && (withHex.value_numeric != null || (withHex.value_formatted ?? '').trim())
  ) {
    const unit = (withHex.unit ?? '').trim() || dptUnit(key);
    return {
      value: unit && !(withHex.unit ?? '').trim() ? { ...withHex, unit } : withHex,
      dptKey: key,
      allowDecoded: true,
    };
  }

  const bytes = rawPayloadBytes(withHex);
  if (bytes) {
    const textDecoded = decodeTextDptPayload(bytes, key);
    if (textDecoded != null) {
      return {
        value: {
          ...withHex,
          value_formatted: textDecoded,
          value_numeric: null,
          unit: null,
          raw_hex: withHex.raw_hex || hexFromBytes(bytes),
        },
        dptKey: key,
        allowDecoded: true,
      };
    }

    const n = decodeNumericWithDpt(bytes, key);
    if (n != null) {
      const text = formatDecodedNumber(n);
      const unit = (withHex.unit ?? '').trim() || dptUnit(key);
      return {
        value: {
          ...withHex,
          value_numeric: n,
          value_formatted: text,
          unit: unit || null,
          raw_hex: withHex.raw_hex || hexFromBytes(bytes),
        },
        dptKey: key,
        allowDecoded: true,
      };
    }
  }

  // Discrete ≤4-bit with fitting short payload — keep value, allow decoded via dptKey.
  return { value: stripFakeDecoded(withHex), dptKey: key, allowDecoded: true };
}

function formatDecodedNumber(n: number): string {
  if (Number.isInteger(n)) return String(n);
  // Trim float noise similar to backend format_value_nicely `:g`
  return String(Number.parseFloat(n.toPrecision(6)));
}

function ensureRawHex(value: BusValueView): BusValueView {
  if (value.raw_hex) return value;
  const bytes = rawPayloadBytes(value);
  return bytes ? { ...value, raw_hex: hexFromBytes(bytes) } : value;
}

function stripFakeDecoded(value: BusValueView): BusValueView {
  if (!isRawListFormatted(value.value_formatted) && !Array.isArray(value.value_json)) {
    return value;
  }
  return {
    ...value,
    value_formatted: isRawListFormatted(value.value_formatted) ? null : value.value_formatted,
  };
}
