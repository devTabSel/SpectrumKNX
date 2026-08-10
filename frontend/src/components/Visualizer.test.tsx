import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Visualizer } from './Visualizer';

vi.mock('../hooks/useChartData', () => ({
  useChartData: () => ({
    buckets: [{
      unit: 'temp',
      isBinary: false,
      isEvents: false,
      timestamps: [1_700_000_000_000],
      series: [{ address: '1/1/1', name: 'Temp', data: [42], real: [true] }],
    }],
    minTime: 1_700_000_000_000,
    maxTime: 1_700_000_000_500,
    addressToUnit: { '1/1/1': 'temp' },
  }),
}));

vi.mock('./VisualizerSidebar', () => ({
  VisualizerSidebar: () => <div data-testid="sidebar" />,
}));

vi.mock('./MixedChart', () => ({
  MixedChart: ({ rightLabelTime }: { rightLabelTime?: number | null }) => <div data-testid="mixed-chart">{rightLabelTime ?? 'buffer'}</div>,
}));

vi.mock('./TimelineChart', () => ({
  TimelineChart: ({ rightLabelTime }: { rightLabelTime?: number | null }) => <div data-testid="timeline-chart">{rightLabelTime ?? 'buffer'}</div>,
}));

vi.mock('./EventDotsChart', () => ({
  EventDotsChart: ({ rightLabelTime }: { rightLabelTime?: number | null }) => <div data-testid="event-dots-chart">{rightLabelTime ?? 'buffer'}</div>,
}));

vi.mock('./TimeBrush', () => ({
  TimeBrush: ({ onToggleAutoFollowRight }: { onToggleAutoFollowRight?: () => void }) => (
    <button onClick={onToggleAutoFollowRight}>toggle follow</button>
  ),
}));

describe('Visualizer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-02T03:04:05.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes the live NOW timestamp to the charts when right-side follow is enabled', () => {
    const now = Date.now();
    render(
      <Visualizer
        telegrams={[]}
        selectedTargets={[]}
        onTargetsChange={() => {}}
        onClose={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'toggle follow' }));

    expect(screen.getByTestId('mixed-chart')).toHaveTextContent(String(now));
  });
});
