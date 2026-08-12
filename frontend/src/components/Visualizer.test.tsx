import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { Visualizer } from './Visualizer';
import { useChartData } from '../hooks/useChartData';

vi.mock('../hooks/useChartData', () => ({
  useChartData: vi.fn(() => ({
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
  })),
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
  TimeBrush: ({ disabled }: { disabled?: boolean }) => <div data-testid="time-brush" data-disabled={disabled ? 'true' : 'false'} />,
}));

describe('Visualizer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-02T03:04:05.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the live NOW label in the header while auto-follow is active', () => {
    const now = Date.now();
    render(
      <Visualizer
        telegrams={[]}
        selectedTargets={[]}
        onTargetsChange={() => {}}
        onClose={() => {}}
        listFollow={true}
        pendingLiveCount={0}
      />,
    );

    const expected = new Date(now).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

    expect(screen.getByTitle('Current NOW time')).toHaveTextContent(expected);
    expect(screen.getByTestId('mixed-chart')).toBeInTheDocument();
  });

  it('never shows a date in the NOW label, even across a multi-day range', () => {
    vi.mocked(useChartData).mockReturnValueOnce({
      buckets: [{
        unit: 'temp',
        isBinary: false,
        isEvents: false,
        timestamps: [1_700_000_000_000],
        series: [{ address: '1/1/1', name: 'Temp', data: [42], real: [true] }],
      }],
      minTime: 1_700_000_000_000,
      maxTime: 1_700_000_000_000 + 3 * 24 * 60 * 60 * 1000,
      addressToUnit: { '1/1/1': 'temp' },
    });

    const now = Date.now();
    render(
      <Visualizer
        telegrams={[]}
        selectedTargets={['1/1/1']}
        onTargetsChange={() => {}}
        onClose={() => {}}
        listFollow={true}
        pendingLiveCount={0}
      />,
    );

    const expected = new Date(now).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

    expect(screen.getByTitle('Current NOW time').textContent).toBe(expected);
  });

  it('keeps the NOW label updating in real time while auto-follow stays active', () => {
    render(
      <Visualizer
        telegrams={[]}
        selectedTargets={[]}
        onTargetsChange={() => {}}
        onClose={() => {}}
        listFollow={true}
        pendingLiveCount={0}
      />,
    );

    const initial = new Date(Date.now()).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    expect(screen.getByTitle('Current NOW time')).toHaveTextContent(initial);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    const next = new Date(Date.now()).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    expect(screen.getByTitle('Current NOW time')).toHaveTextContent(next);
  });

  it('does not pause auto-follow for a click on the empty panel background', () => {
    const onListFollowChange = vi.fn();
    render(
      <Visualizer
        telegrams={[]}
        selectedTargets={[]}
        onTargetsChange={() => {}}
        onClose={() => {}}
        listFollow={true}
        onListFollowChange={onListFollowChange}
        pendingLiveCount={0}
      />,
    );

    const chartArea = screen.getByTestId('visualization-chart-area');
    fireEvent.click(chartArea, { detail: 1 });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(onListFollowChange).not.toHaveBeenCalled();
  });

  it('does not pause auto-follow for a double-click on the chart area', () => {
    const onListFollowChange = vi.fn();
    render(
      <Visualizer
        telegrams={[]}
        selectedTargets={[]}
        onTargetsChange={() => {}}
        onClose={() => {}}
        listFollow={true}
        onListFollowChange={onListFollowChange}
        pendingLiveCount={0}
      />,
    );

    const chartArea = screen.getByTestId('visualization-chart-area');
    fireEvent.click(chartArea, { detail: 1 });
    fireEvent.click(chartArea, { detail: 2 });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(onListFollowChange).not.toHaveBeenCalled();
  });

  it('renders the chart area without the legacy targets sidebar', () => {
    render(
      <Visualizer
        telegrams={[]}
        selectedTargets={['1/1/1']}
        onTargetsChange={() => {}}
        onClose={() => {}}
        listFollow={true}
        pendingLiveCount={0}
      />,
    );

    expect(screen.getByTestId('visualization-chart-area')).toBeInTheDocument();
    expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument();
  });

  it('still shows the pan & zoom ruler for a single telegram (degenerate time range), but disables zooming', () => {
    vi.mocked(useChartData).mockReturnValueOnce({
      buckets: [{
        unit: 'temp',
        isBinary: false,
        isEvents: false,
        timestamps: [1_700_000_000_000],
        series: [{ address: '1/1/1', name: 'Temp', data: [42], real: [true] }],
      }],
      minTime: 1_700_000_000_000,
      maxTime: 1_700_000_000_000,
      addressToUnit: { '1/1/1': 'temp' },
    });

    render(
      <Visualizer
        telegrams={[]}
        selectedTargets={['1/1/1']}
        onTargetsChange={() => {}}
        onClose={() => {}}
        listFollow={true}
        pendingLiveCount={0}
      />,
    );

    const ruler = screen.getByTestId('time-brush');
    expect(ruler).toBeInTheDocument();
    expect(ruler).toHaveAttribute('data-disabled', 'true');
  });

  it('keeps zooming enabled on the ruler for a real (non-degenerate) time range', () => {
    render(
      <Visualizer
        telegrams={[]}
        selectedTargets={['1/1/1']}
        onTargetsChange={() => {}}
        onClose={() => {}}
        listFollow={true}
        pendingLiveCount={0}
      />,
    );

    expect(screen.getByTestId('time-brush')).toHaveAttribute('data-disabled', 'false');
  });
});
