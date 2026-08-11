import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ChartBucket } from '../hooks/useChartData';
import { MixedChart } from './MixedChart';

const { capturedOptions } = vi.hoisted(() => ({
  capturedOptions: [] as unknown[],
}));

vi.mock('uplot-react', () => ({
  default: ({ options }: { options: unknown }) => {
    capturedOptions.push(options);
    return <div data-testid="uplot-chart" />;
  },
}));

vi.mock('uplot', () => ({
  default: {
    sync: () => ({ key: 'sync-key' }),
    paths: {
      stepped: () => null,
    },
  },
}));

describe('MixedChart', () => {
  beforeEach(() => {
    capturedOptions.length = 0;
    class ResizeObserverMock {
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  });

  it('adds the right-side marker plugin when auto-follow is active', () => {
    const bucket: ChartBucket = {
      unit: '°C',
      isBinary: false,
      isEvents: false,
      timestamps: [1000, 2000],
      series: [
        {
          address: '1/1/1',
          name: 'Temperature',
          data: [21, 22],
          real: [true, true],
        },
      ],
    };

    const { rerender } = render(
      <MixedChart bucket={bucket} minTime={1000} maxTime={2000} stepped={false} showDots={false} showCurrentValueBand={false} />,
    );

    expect((capturedOptions.at(-1) as { plugins?: unknown[] } | undefined)?.plugins).toHaveLength(0);

    rerender(
      <MixedChart bucket={bucket} minTime={1000} maxTime={2000} stepped={false} showDots={false} showCurrentValueBand />,
    );

    expect((capturedOptions.at(-1) as { plugins?: unknown[] } | undefined)?.plugins).toHaveLength(1);
  });
});
