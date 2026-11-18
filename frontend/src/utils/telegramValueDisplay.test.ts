import { describe, expect, test } from 'vitest';
import { buildValueDisplayModes } from './dptValues';
import {
  decodeNumericWithDpt,
  enrichTelegramValueDisplay,
  payloadFitsDpt,
} from './telegramValueDisplay';

// Undecoded DPT-9 payload as stored when dpt_main is null (user-visible dump).
const LUX_BYTES = [46, 118];

describe('decodeNumericWithDpt', () => {
  test('decodes DPT 9.004 lux bytes to xknx value', () => {
    // [46, 118] = 0x2E76 → 529.28 lx (xknx DPTLux)
    expect(decodeNumericWithDpt(LUX_BYTES, '9.004')).toBeCloseTo(529.28, 6);
  });

  test('decodes known illuminance float bytes', () => {
    // 0x04A5 → 11.89 lx
    expect(decodeNumericWithDpt([4, 165], '9.004')).toBeCloseTo(11.89, 6);
  });
});

describe('payloadFitsDpt / enrichTelegramValueDisplay', () => {
  test('raw lux bytes + 9.004 → decoded with unit (not [46, 118])', () => {
    const enriched = enrichTelegramValueDisplay(
      {
        value_json: LUX_BYTES,
        value_formatted: '[46, 118]',
        value_numeric: null,
        raw_hex: null,
        unit: null,
      },
      '9.004',
    );
    expect(enriched.allowDecoded).toBe(true);
    expect(enriched.dptKey).toBe('9.004');
    expect(enriched.value.value_numeric).toBeCloseTo(529.28, 2);
    expect(enriched.value.unit).toBe('lx');
    expect(enriched.value.value_formatted).not.toMatch(/\[/);
  });

  test('no DPT → no decoded facet; hex still present', () => {
    const enriched = enrichTelegramValueDisplay(
      {
        value_json: LUX_BYTES,
        value_formatted: '[46, 118]',
        value_numeric: null,
      },
      null,
    );
    expect(enriched.allowDecoded).toBe(false);
    const modes = buildValueDisplayModes(enriched.value, enriched.dptKey, {
      allowDecoded: enriched.allowDecoded,
    });
    expect(modes.map(m => m.mode)).toEqual(['decimal', 'hex']);
    expect(modes.find(m => m.mode === 'hex')?.label).toMatch(/^0x/i);
    expect(modes.some(m => m.mode === 'decoded')).toBe(false);
  });

  test('mismatched width → no decoded; hex kept', () => {
    // DPT 5 expects 1 byte; two-byte lux payload does not fit.
    expect(payloadFitsDpt({ value_json: LUX_BYTES }, '5.001')).toBe(false);
    const enriched = enrichTelegramValueDisplay(
      { value_json: LUX_BYTES, value_formatted: '[46, 118]' },
      '5.001',
    );
    expect(enriched.allowDecoded).toBe(false);
    const modes = buildValueDisplayModes(enriched.value, '5.001', { allowDecoded: false });
    expect(modes.map(m => m.mode)).toContain('hex');
    expect(modes.map(m => m.mode)).not.toContain('decoded');
    expect(modes.map(m => m.mode)).not.toContain('bin'); // 5.x is not ≤4-bit
  });

  test('≤4-bit DPT without fit still allows bin when bits readable', () => {
    const modes = buildValueDisplayModes(
      { value_numeric: 1, value_formatted: null, raw_hex: '0x01' },
      '1.001',
      { allowDecoded: false },
    );
    expect(modes.map(m => m.mode)).toEqual(expect.arrayContaining(['hex', 'bin']));
    expect(modes.map(m => m.mode)).not.toContain('decoded');
  });

  test('DPT 16 raw bytes → decoded characters + hex (no decimal)', () => {
    const bytes = Array.from('Hi'.padEnd(14, '\0'), ch => ch.charCodeAt(0));
    const enriched = enrichTelegramValueDisplay(
      {
        value_json: bytes,
        value_formatted: `[${bytes.join(', ')}]`,
        value_numeric: null,
      },
      '16.000',
    );
    expect(enriched.allowDecoded).toBe(true);
    expect(enriched.value.value_formatted).toBe('Hi'.padEnd(14, ' '));
    const modes = buildValueDisplayModes(enriched.value, enriched.dptKey, {
      allowDecoded: enriched.allowDecoded,
    });
    expect(modes.map(m => m.mode)).toEqual(['decoded', 'hex']);
    expect(modes.find(m => m.mode === 'decoded')?.label).toBe('Hi'.padEnd(14, ' '));
  });

  test('DPT 4 / 16.001 / 28 character decode facets', () => {
    const dpt4 = enrichTelegramValueDisplay(
      { value_json: [0x41], value_formatted: '[65]' },
      '4.001',
    );
    expect(dpt4.value.value_formatted).toBe('A');
    expect(
      buildValueDisplayModes(dpt4.value, '4.001', { allowDecoded: true }).map(m => m.mode),
    ).toEqual(['decoded', 'hex']);

    const latin = Array.from('Ä'.padEnd(14, '\0'), ch => ch.charCodeAt(0));
    const dpt16 = enrichTelegramValueDisplay(
      { value_json: latin, value_formatted: null },
      '16.001',
    );
    expect(dpt16.value.value_formatted).toBe('Ä'.padEnd(14, ' '));
    expect(dpt16.value.unit).toBeNull();
    expect(
      buildValueDisplayModes(dpt16.value, '16.001', { allowDecoded: true })
        .find(m => m.mode === 'decoded')?.unit,
    ).toBeUndefined();

    const noted = enrichTelegramValueDisplay(
      { value_formatted: 'Hallo', value_numeric: null, unit: 'latin-1' },
      '16.001',
    );
    expect(noted.value.unit).toBeNull();
    expect(
      buildValueDisplayModes(noted.value, '16.001').find(m => m.mode === 'decoded')?.unit,
    ).toBeUndefined();

    const utf8 = Array.from(new TextEncoder().encode('Café'));
    const dpt28 = enrichTelegramValueDisplay(
      { value_json: utf8, value_formatted: null },
      '28.001',
    );
    expect(dpt28.value.value_formatted).toBe('Café');
    expect(
      buildValueDisplayModes(dpt28.value, '28.001', { allowDecoded: true }).map(m => m.mode),
    ).toEqual(['decoded', 'hex']);
  });
});
