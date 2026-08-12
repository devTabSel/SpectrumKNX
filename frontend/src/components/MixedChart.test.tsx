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
    rangeNum: (min: number, max: number, mult: number) => {
      const pad = (max - min) * mult || 1;
      return [min - pad, max + pad];
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

  it('extends the Y-scale to cover the telegram just before the visible window (#391)', () => {
    const bucket: ChartBucket = {
      unit: '°C',
      isBinary: false,
      isEvents: false,
      timestamps: [500, 2500],
      series: [
        {
          address: '1/1/1',
          name: 'Temperature',
          data: [100, 22],
          real: [true, true],
        },
      ],
    };

    render(
      <MixedChart bucket={bucket} minTime={1500} maxTime={3000} stepped={false} showDots={false} showCurrentValueBand={false} />,
    );

    const options = capturedOptions.at(-1) as {
      scales: { y: { range: (u: unknown) => [number, number] } };
    };
    // The visible window (1500-3000ms) starts between the two data points —
    // the 500ms telegram (value 100) is what's actually held across the left
    // edge, even though it lies strictly before the window.
    const fakeUplot = {
      data: [[0.5, 2.5], [100, 22]],
      scales: { x: { min: 1.5, max: 3 } },
    };
    const [, max] = options.scales.y.range(fakeUplot);

    // The visible window only spans values 21-22, but the held-over value
    // (100) from the telegram just before it must still be included.
    expect(max).toBeGreaterThan(90);
  });

  it('does not force the Y-scale down to zero for a percentage unit, so the line uses the full chart area (#391)', () => {
    const bucket: ChartBucket = {
      unit: '%',
      isBinary: false,
      isEvents: false,
      timestamps: [1000, 2000],
      series: [
        {
          address: '1/1/1',
          name: 'Fan speed',
          data: [60, 65],
          real: [true, true],
        },
      ],
    };

    render(
      <MixedChart bucket={bucket} minTime={1000} maxTime={2000} stepped={false} showDots={false} showCurrentValueBand={false} />,
    );

    const options = capturedOptions.at(-1) as {
      scales: { y: { range: (u: unknown) => [number, number] } };
    };
    const fakeUplot = {
      data: [[1, 2], [60, 65]],
      scales: { x: { min: 1, max: 2 } },
    };
    const [min] = options.scales.y.range(fakeUplot);

    // A forced zero floor would waste most of the chart's vertical space for
    // values clustered around 60-65%; the scale must instead tightly fit them.
    expect(min).toBeGreaterThan(0);
  });
});
