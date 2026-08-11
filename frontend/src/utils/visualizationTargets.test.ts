import { describe, expect, test } from 'vitest';
import { buildDeviceGaMap, expandVisualizationTargets } from './visualizationTargets';

describe('visualizationTargets', () => {
  test('maps devices to all connected group addresses from channels and KOs', () => {
    const map = buildDeviceGaMap([
      {
        type: 'Building',
        name: 'Main House',
        devices: [
          {
            address: '1.1.1',
            name: 'Push Button',
            channels: [
              {
                id: 'ch1',
                name: 'Channel 1',
                kos: [
                  {
                    group_addresses: [
                      { address: '1/1/1' },
                      { address: '1/1/2' },
                    ],
                  },
                ],
              },
            ],
            kos: [
              {
                group_addresses: [
                  { address: '1/1/3' },
                ],
              },
            ],
          },
        ],
        spaces: [],
      },
    ]);

    expect(map['1.1.1']).toEqual(['1/1/1', '1/1/2', '1/1/3']);
  });

  test('merges explicit GA flags and device-linked GA flags into the visualization target set', () => {
    const map = {
      '1.1.1': ['1/1/1', '1/1/2'],
      '2.2.2': ['2/2/1'],
    };

    expect(expandVisualizationTargets(['2/2/9', '1.1.1'], map)).toEqual(['2/2/9', '1/1/1', '1/1/2']);
    expect(Array.from(new Set(['9/9/9', ...expandVisualizationTargets(['2/2/9', '1.1.1'], map)])).sort()).toEqual([
      '1/1/1',
      '1/1/2',
      '2/2/9',
      '9/9/9',
    ].sort());
  });
});
