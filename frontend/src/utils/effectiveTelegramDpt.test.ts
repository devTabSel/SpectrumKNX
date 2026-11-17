import { describe, expect, test } from 'vitest';
import { effectiveTelegramDpt, projectDptByAddress } from './effectiveTelegramDpt';

const baseTg = {
  dpt: null as string | null,
  dpt_main: null as number | null,
  dpt_sub: null as number | null,
  dpt_name: null as string | null,
  unit: null as string | null,
  target_address: '1/2/3',
};

describe('projectDptByAddress', () => {
  test('indexes targets with main', () => {
    const map = projectDptByAddress([
      { address: '1/2/3', main: 9, sub: 4, label: '9.004 - Illuminance' },
      { address: '9/9/9', name: 'no dpt' },
    ]);
    expect(map.get('1/2/3')).toEqual({ main: 9, sub: 4, label: '9.004 - Illuminance' });
    expect(map.has('9/9/9')).toBe(false);
  });
});

describe('effectiveTelegramDpt', () => {
  test('prefers telegram DPT over project', () => {
    const map = projectDptByAddress([{ address: '1/2/3', main: 9, sub: 4 }]);
    const eff = effectiveTelegramDpt({
      ...baseTg,
      dpt_main: 1,
      dpt_sub: 1,
      dpt_name: '1.001 - Switch',
      unit: null,
    }, map);
    expect(eff?.key).toBe('1.001');
    expect(eff?.fromProject).toBe(false);
  });

  test('falls back to project GA map', () => {
    const map = projectDptByAddress([{ address: '1/2/3', main: 9, sub: 4 }]);
    const eff = effectiveTelegramDpt(baseTg, map);
    expect(eff).toMatchObject({
      key: '9.004',
      main: 9,
      sub: 4,
      unit: 'lx',
      fromProject: true,
    });
  });

  test('null when neither telegram nor project has DPT', () => {
    expect(effectiveTelegramDpt(baseTg, new Map())).toBeNull();
  });
});
