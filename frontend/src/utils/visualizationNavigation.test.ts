import { beforeEach, expect, test } from 'vitest';
import { makeTelegram } from '../test/telegramFactory';
import { clearSeriesHidden, setSeriesHidden } from './legendVisibility';
import { findNearestVisibleVisualizationTelegram, findPreviousVisibleVisualizationTelegrams } from './visualizationNavigation';

beforeEach(() => {
  clearSeriesHidden(['1/1/1', '1/1/2', '1/1/3']);
});

test('finds the nearest telegram only among selected and visible chart targets', () => {
  const telegrams = [
    makeTelegram({ timestamp: '2024-01-01T10:00:00.000Z', target_address: '1/1/1', raw_hex: '0x01' }),
    makeTelegram({ timestamp: '2024-01-01T10:00:02.000Z', target_address: '1/1/2', raw_hex: '0x02' }),
    makeTelegram({ timestamp: '2024-01-01T10:00:01.000Z', target_address: '9/9/9', raw_hex: '0x09' }),
  ];

  const nearest = findNearestVisibleVisualizationTelegram(
    telegrams,
    ['1/1/1', '1/1/2'],
    new Date('2024-01-01T10:00:01.600Z').getTime(),
  );

  expect(nearest?.target_address).toBe('1/1/2');
});

test('ignores hidden chart targets when resolving a visualization navigation click', () => {
  const telegrams = [
    makeTelegram({ timestamp: '2024-01-01T10:00:00.000Z', target_address: '1/1/1', raw_hex: '0x01' }),
    makeTelegram({ timestamp: '2024-01-01T10:00:00.100Z', target_address: '1/1/2', raw_hex: '0x02' }),
  ];
  setSeriesHidden('1/1/2', true);

  const nearest = findNearestVisibleVisualizationTelegram(
    telegrams,
    ['1/1/1', '1/1/2'],
    new Date('2024-01-01T10:00:00.090Z').getTime(),
  );

  expect(nearest?.target_address).toBe('1/1/1');
});

test('finds the immediately preceding telegram for each visible target', () => {
  const telegrams = [
    makeTelegram({ timestamp: '2024-01-01T10:00:00.000Z', target_address: '1/1/1', raw_hex: '0x01' }),
    makeTelegram({ timestamp: '2024-01-01T10:00:02.000Z', target_address: '1/1/1', raw_hex: '0x01' }),
    makeTelegram({ timestamp: '2024-01-01T10:00:01.000Z', target_address: '1/1/2', raw_hex: '0x02' }),
    makeTelegram({ timestamp: '2024-01-01T10:00:03.000Z', target_address: '1/1/2', raw_hex: '0x02' }),
    makeTelegram({ timestamp: '2024-01-01T10:00:04.000Z', target_address: '9/9/9', raw_hex: '0x09' }),
  ];

  const previous = findPreviousVisibleVisualizationTelegrams(
    telegrams,
    ['1/1/1', '1/1/2', '9/9/9'],
    new Date('2024-01-01T10:00:02.500Z').getTime(),
  );

  expect(previous.map(item => ({ address: item.telegram.target_address, timestamp: item.telegram.timestamp }))).toEqual([
    { address: '1/1/1', timestamp: '2024-01-01T10:00:02.000Z' },
    { address: '1/1/2', timestamp: '2024-01-01T10:00:01.000Z' },
  ]);
});