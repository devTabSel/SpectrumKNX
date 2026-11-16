import { render, screen, fireEvent } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { HistoryLoader } from './HistoryLoader';

const timeRange = {
  relValue: 1,
  relUnit: 'hours' as const,
  startTime: '2026-01-01T00:00',
  endTime: '2026-01-02T00:00',
};

test('history from/to commit on Enter and blur, and Escape restores the focused value', () => {
  const onTimeRangeChange = vi.fn();
  render(
    <HistoryLoader
      onClose={() => {}}
      limit={10}
      timeRange={timeRange}
      onTimeRangeChange={onTimeRangeChange}
    />,
  );
  const from = screen.getByLabelText('History from') as HTMLInputElement;
  fireEvent.focus(from);
  fireEvent.change(from, { target: { value: '2026-03-01T08:30' } });
  fireEvent.keyDown(from, { key: 'Enter' });
  expect(onTimeRangeChange).toHaveBeenCalledWith(expect.objectContaining({ startTime: '2026-03-01T08:30' }));

  onTimeRangeChange.mockClear();
  fireEvent.focus(from);
  fireEvent.change(from, { target: { value: '2026-04-01T09:00' } });
  fireEvent.keyDown(from, { key: 'Escape' });
  const last = onTimeRangeChange.mock.calls.at(-1)?.[0] as { startTime: string };
  expect(last.startTime).not.toBe('2026-04-01T09:00');
  expect(from.value).toBe(last.startTime);
});
