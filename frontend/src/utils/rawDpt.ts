/**
 * Client-side decoding of raw KNX payload bytes for group addresses that have
 * no datatype in the ETS project (#315).
 *
 * Such telegrams reach the frontend as an array of payload bytes in
 * `value_json` (e.g. `[0x0c, 0x1a]`) with no decoded numeric value, so the
 * visualization can't plot them. Letting the user pick a datatype lets us
 * interpret those bytes into a number here, without a project re-import.
 *
 * Only the datatypes that decode to a single plottable number are offered.
 */

export interface RawDptOption {
  /** Stable key persisted per group address. */
  key: string;
  /** Dropdown label. */
  label: string;
  /** Physical unit for bucketing/axis, or '' when dimensionless. */
  unit: string;
  /** Expected payload width in bytes; a mismatch decodes to null. */
  bytes: number;
}

/** Datatypes offered for an untyped GA, in menu order. */
export const RAW_DPT_OPTIONS: RawDptOption[] = [
  { key: '5', label: '5 · 8-bit unsigned (0–255)', unit: '', bytes: 1 },
  { key: '5.001', label: '5.001 · Percent (0–100%)', unit: '%', bytes: 1 },
  { key: '5.004', label: '5.004 · Percent (0–255%)', unit: '%', bytes: 1 },
  { key: '6', label: '6 · 8-bit signed (−128–127)', unit: '', bytes: 1 },
  { key: '7', label: '7 · 2-byte unsigned', unit: '', bytes: 2 },
  { key: '8', label: '8 · 2-byte signed', unit: '', bytes: 2 },
  { key: '9', label: '9 · 2-byte float', unit: '', bytes: 2 },
  { key: '12', label: '12 · 4-byte unsigned', unit: '', bytes: 4 },
  { key: '13', label: '13 · 4-byte signed', unit: '', bytes: 4 },
  { key: '14', label: '14 · 4-byte float', unit: '', bytes: 4 },
];

const OPTION_BY_KEY = new Map(RAW_DPT_OPTIONS.map(o => [o.key, o]));

/** Resolve a project subtype key (e.g. 9.004) to a RAW_DPT_OPTIONS entry. */
function resolveRawOption(key: string): RawDptOption | undefined {
  const direct = OPTION_BY_KEY.get(key);
  if (direct) return direct;
  // Subtypes share the main-number codec (9.004 illuminance → DPT 9 float).
  const main = key.trim().match(/^(\d+)(?:\.\d+)?$/)?.[1];
  return main ? OPTION_BY_KEY.get(main) : undefined;
}

/** The physical unit a decoded value should be bucketed/labelled under. */
export const rawDptUnit = (key: string): string => resolveRawOption(key)?.unit ?? '';

/**
 * Decodes the KNX 2-byte float (DPT 9) format from two bytes.
 * Layout SEEEEMMM MMMMMMMM; value = (0.01 · M) · 2^E with M signed via S
 * (matches xknx DPT2ByteFloat / DPTLux).
 * 0x7FFF is reserved as invalid and returns null.
 */
const decodeKnxFloat16 = (b0: number, b1: number): number | null => {
  if (b0 === 0x7f && b1 === 0xff) return null;
  const data = ((b0 << 8) | b1) & 0xffff;
  const exponent = (data >> 11) & 0x0f;
  let mantissa = data & 0x07ff;
  if (data & 0x8000) mantissa -= 2048;
  // Same arithmetic as xknx: (mantissa << exponent) / 100
  return (mantissa * 2 ** exponent) / 100;
};

/**
 * Decodes raw payload bytes into a plottable number for the chosen datatype,
 * or null when the datatype is unknown or the width does not match.
 * Accepts bare mains (`9`) and subtypes (`9.004`).
 */
export function decodeRawDpt(bytes: readonly number[], key: string): number | null {
  const opt = resolveRawOption(key);
  if (!opt || bytes.length !== opt.bytes) return null;
  if (bytes.some(b => !Number.isInteger(b) || b < 0 || b > 255)) return null;

  const view = new DataView(new Uint8Array(bytes).buffer);
  switch (opt.key) {
    case '5':
      return view.getUint8(0);
    case '5.001':
      return (view.getUint8(0) * 100) / 255;
    case '5.004':
      return view.getUint8(0); // percent on a 0–255 scale: the raw byte is the value
    case '6':
      return view.getInt8(0);
    case '7':
      return view.getUint16(0, false);
    case '8':
      return view.getInt16(0, false);
    case '9':
      return decodeKnxFloat16(bytes[0], bytes[1]);
    case '12':
      return view.getUint32(0, false);
    case '13':
      return view.getInt32(0, false);
    case '14':
      return view.getFloat32(0, false);
    default:
      return null;
  }
}
