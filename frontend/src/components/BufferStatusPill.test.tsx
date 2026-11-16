import { render, screen, fireEvent } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import {
  BufferStatusPill,
  formatRangeMinutes,
  rangeValueToMinutes,
  sanitizeRangeInput,
} from './BufferStatusPill';

const baseProps = {
  oldestMs: Date.parse('2026-03-01T10:00:00'),
  newestMs: Date.parse('2026-03-01T12:00:00'),
  readDirection: 'backward' as const,
  onReadDirectionChange: vi.fn(),
  loadLimit: 1000,
  rangeMinutes: 60,
  onRangeMinutesChange: vi.fn(),
  filteredCount: 3,
  totalCount: 10,
  filterActive: true,
  onClear: vi.fn(),
  onCancelLoad: vi.fn(),
  pauseTitle: 'Playing',
  pauseColor: 'green',
  pauseMode: 'playing' as const,
  pauseDisabled: false,
  onTogglePause: vi.fn(),
  busRate: 1.5,
  rateMode: 's' as const,
  onCycleRateMode: vi.fn(),
  wsConnected: true,
  isHistoryLoading: false,
  historyLoadError: null,
  onOldestCommit: vi.fn(),
  onNewestCommit: vi.fn(),
  onLoadFromDbOldest: vi.fn(),
  onLoadFromDbNewest: vi.fn(),
};

test('formatRangeMinutes / rangeValueToMinutes round-trip s/m/h', () => {
  expect(formatRangeMinutes(60, 'm')).toBe('60');
  expect(formatRangeMinutes(60, 's')).toBe('3600');
  expect(formatRangeMinutes(60, 'h')).toBe('1');
  expect(formatRangeMinutes(90, 'h')).toBe('1.5');
  expect(rangeValueToMinutes('3600', 's')).toBe(60);
  expect(rangeValueToMinutes('1.5', 'h')).toBe(90);
  expect(rangeValueToMinutes('45', 'm')).toBe(45);
  expect(sanitizeRangeInput('1.5')).toBe('1.5');
  expect(sanitizeRangeInput('0')).toBe('');
});

test('renders range like SecondsField with clickable unit; count has no spaces', () => {
  render(<BufferStatusPill {...baseProps} />);
  const range = screen.getByLabelText('Buffer range');
  expect(range).toHaveValue('60');
  expect(range.title).toBe('10/1000');
  expect(screen.getByRole('button', { name: 'Cycle range unit (s / m / h)' })).toHaveTextContent('m');
  expect(screen.getByLabelText('3 filtered of 10 in buffer')).toHaveTextContent('3/10');
  expect(screen.queryByLabelText('Load limit')).not.toBeInTheDocument();
  expect(screen.queryByText(/History: loading/)).not.toBeInTheDocument();
});

test('clicking range unit cycles s → m → h and keeps duration', () => {
  render(<BufferStatusPill {...baseProps} />);
  const unit = screen.getByRole('button', { name: 'Cycle range unit (s / m / h)' });
  const range = screen.getByLabelText('Buffer range');
  expect(unit).toHaveTextContent('m');
  expect(range).toHaveValue('60');

  fireEvent.click(unit); // m → h
  expect(unit).toHaveTextContent('h');
  expect(range).toHaveValue('1');

  fireEvent.click(unit); // h → s
  expect(unit).toHaveTextContent('s');
  expect(range).toHaveValue('3600');

  fireEvent.click(unit); // s → m
  expect(unit).toHaveTextContent('m');
  expect(range).toHaveValue('60');
});

test('range commit converts unit to minutes on blur and Enter', () => {
  const onRangeMinutesChange = vi.fn();
  render(<BufferStatusPill {...baseProps} onRangeMinutesChange={onRangeMinutesChange} />);
  const unit = screen.getByRole('button', { name: 'Cycle range unit (s / m / h)' });
  fireEvent.click(unit); // → h
  const input = screen.getByLabelText('Buffer range');
  fireEvent.change(input, { target: { value: '2' } });
  fireEvent.blur(input);
  expect(onRangeMinutesChange).toHaveBeenCalledWith(120);

  onRangeMinutesChange.mockClear();
  fireEvent.change(input, { target: { value: '3' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onRangeMinutesChange).toHaveBeenCalledWith(180);
});

test('range: forward = value+unit left / icon right; backward = icon left / value+unit right', () => {
  const { rerender } = render(
    <BufferStatusPill {...baseProps} totalCount={1000} loadLimit={1000} filterActive={false} />,
  );
  const field = screen.getByLabelText('Buffer range').closest('[data-seconds-field]') as HTMLElement;
  const clear = screen.getByLabelText(/Clear \(also wipes/);
  expect(field.contains(clear)).toBe(true);
  expect(clear.style.color).toBe('var(--warning-text)');
  // Backward: icon left, value+unit right.
  expect(field.firstElementChild).toBe(clear);
  const cluster = field.querySelector('[data-seconds-value-unit]') as HTMLElement;
  expect(cluster.contains(screen.getByLabelText('Buffer range'))).toBe(true);
  expect(cluster.contains(screen.getByRole('button', { name: 'Cycle range unit (s / m / h)' }))).toBe(true);
  expect(cluster.style.justifyContent).toBe('flex-end');
  expect(field.style.justifyContent).toBe('space-between');

  rerender(<BufferStatusPill {...baseProps} readDirection="forward" />);
  const fieldFwd = screen.getByLabelText('Buffer range').closest('[data-seconds-field]') as HTMLElement;
  const clearFwd = screen.getByLabelText(/Clear \(also wipes/);
  expect(fieldFwd.contains(clearFwd)).toBe(true);
  expect(fieldFwd.lastElementChild).toBe(clearFwd);
  const clusterFwd = fieldFwd.querySelector('[data-seconds-value-unit]') as HTMLElement;
  expect(clusterFwd.style.justifyContent).toBe('flex-start');
});

test('loading shows cancel spinner inside range instead of clear', () => {
  const onCancelLoad = vi.fn();
  render(<BufferStatusPill {...baseProps} isHistoryLoading onCancelLoad={onCancelLoad} />);
  const field = screen.getByLabelText('Buffer range').closest('[data-seconds-field]')!;
  expect(screen.queryByLabelText(/Clear \(also wipes/)).not.toBeInTheDocument();
  const cancel = screen.getByLabelText('Cancel loading');
  expect(field.contains(cancel)).toBe(true);
  fireEvent.click(cancel);
  expect(onCancelLoad).toHaveBeenCalledTimes(1);
});

test('direction chevron asks to switch', () => {
  const onReadDirectionChange = vi.fn();
  render(<BufferStatusPill {...baseProps} onReadDirectionChange={onReadDirectionChange} />);
  fireEvent.click(screen.getByLabelText('Reading backward'));
  expect(onReadDirectionChange).toHaveBeenCalledWith('forward');
});

test('rewind and fast-forward call load handlers', () => {
  const onLoadFromDbOldest = vi.fn();
  const onLoadFromDbNewest = vi.fn();
  render(
    <BufferStatusPill
      {...baseProps}
      onLoadFromDbOldest={onLoadFromDbOldest}
      onLoadFromDbNewest={onLoadFromDbNewest}
    />,
  );
  fireEvent.click(screen.getByLabelText('Load from oldest telegram in database'));
  fireEvent.click(screen.getByLabelText('Load up to newest telegram in database'));
  expect(onLoadFromDbOldest).toHaveBeenCalledTimes(1);
  expect(onLoadFromDbNewest).toHaveBeenCalledTimes(1);
});

test('forward shows a disabled Stop and no play control', () => {
  const onTogglePause = vi.fn();
  render(
    <BufferStatusPill
      {...baseProps}
      readDirection="forward"
      pauseMode="playing"
      pauseTitle="Playing"
      onTogglePause={onTogglePause}
    />,
  );
  const stop = screen.getByRole('button', { name: 'Stop' });
  expect(stop).toBeDisabled();
  expect(stop).toHaveAttribute('title', 'Kein Live in Leserichtung vorwärts');
  expect(screen.queryByRole('button', { name: 'Playing' })).not.toBeInTheDocument();
  fireEvent.click(stop);
  expect(onTogglePause).not.toHaveBeenCalled();
});

test('offline and reconnect backfill replace the pause control', () => {
  const { rerender } = render(<BufferStatusPill {...baseProps} wsConnected={false} />);
  const offline = screen.getByRole('button', { name: 'Offline' });
  expect(offline).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Playing' })).not.toBeInTheDocument();

  rerender(<BufferStatusPill {...baseProps} wsConnected fillingGaps />);
  expect(screen.getByRole('button', { name: 'Lädt nach' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Playing' })).not.toBeInTheDocument();

  rerender(
    <BufferStatusPill {...baseProps} wsConnected={false} fillingGaps readDirection="forward" />,
  );
  expect(screen.getByRole('button', { name: 'Offline' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Lädt nach' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
});

test('clear ctrl-click asks for auto pause', () => {
  const onClear = vi.fn();
  render(<BufferStatusPill {...baseProps} onClear={onClear} />);
  fireEvent.click(screen.getByLabelText(/Clear \(also wipes/), { ctrlKey: true });
  expect(onClear).toHaveBeenCalledWith({ pauseAuto: true });
});
