import { render, screen, fireEvent } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { BufferStatusPill } from './BufferStatusPill';

const baseProps = {
  oldestMs: Date.parse('2026-03-01T10:00:00'),
  newestMs: Date.parse('2026-03-01T12:00:00'),
  readDirection: 'backward' as const,
  loadLimit: 1000,
  onLoadLimitChange: vi.fn(),
  filteredCount: 3,
  totalCount: 10,
  filterActive: true,
  onClear: vi.fn(),
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

test('renders controls in the planned order with LED→rate→count and noop export', () => {
  const { container } = render(<BufferStatusPill {...baseProps} />);
  const pill = container.querySelector('[data-buffer-status-pill]')!;
  const labels = [
    ...pill.querySelectorAll('button, input, [aria-label], [title]'),
  ].map(el => el.getAttribute('aria-label') || el.getAttribute('title') || '');

  expect(screen.queryByLabelText('Import (coming soon)')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Export (coming soon)')).toBeDisabled();
  expect(screen.getByLabelText('Load from oldest telegram in database')).toBeInTheDocument();
  expect(screen.getByLabelText('Load up to newest telegram in database')).toBeInTheDocument();
  expect(screen.getByLabelText('Oldest telegram in buffer')).toBeInTheDocument();
  expect(screen.getByLabelText('Newest telegram in buffer')).toBeInTheDocument();
  expect(screen.getByLabelText('Load limit')).toHaveValue('1000');
  expect(screen.getByLabelText('3 filtered of 10 in buffer')).toHaveTextContent('3 / 10');
  expect(screen.getByLabelText('Playing')).toBeInTheDocument();
  expect(screen.getByLabelText('WebSocket active')).toBeInTheDocument();
  expect(screen.getByText('1.5/s')).toBeInTheDocument();
  expect(screen.getByLabelText('Reading backward')).toBeInTheDocument();
  expect(screen.queryByLabelText('Reading forward')).not.toBeInTheDocument();

  // Rewind before oldest; fast-forward after newest, before play;
  // LED before rate title; count after rate cluster; export last.
  const rewindIdx = labels.findIndex(l => l.includes('Load from oldest'));
  const forwardIdx = labels.findIndex(l => l.includes('Load up to newest'));
  const newestIdx = labels.findIndex(l => l.includes('Newest'));
  const playIdx = labels.findIndex(l => l === 'Playing');
  const ledIdx = labels.findIndex(l => l.includes('WebSocket'));
  const rateIdx = labels.findIndex(l => l.includes('Cycle rate'));
  const countIdx = labels.findIndex(l => l.includes('filtered of'));
  const exportIdx = labels.findIndex(l => l.includes('Export'));
  const oldestIdx = labels.findIndex(l => l.includes('Oldest'));
  expect(rewindIdx).toBeGreaterThanOrEqual(0);
  expect(rewindIdx).toBeLessThan(oldestIdx);
  expect(forwardIdx).toBeGreaterThan(newestIdx);
  expect(forwardIdx).toBeLessThan(playIdx);
  expect(ledIdx).toBeGreaterThan(playIdx);
  expect(ledIdx).toBeLessThan(rateIdx);
  expect(countIdx).toBeGreaterThan(rateIdx);
  expect(exportIdx).toBeGreaterThan(countIdx);
});

test('rewind click asks to load from DB oldest', () => {
  const onLoadFromDbOldest = vi.fn();
  render(<BufferStatusPill {...baseProps} onLoadFromDbOldest={onLoadFromDbOldest} />);
  fireEvent.click(screen.getByLabelText('Load from oldest telegram in database'));
  expect(onLoadFromDbOldest).toHaveBeenCalledTimes(1);
});

test('fast-forward click asks to load from DB newest', () => {
  const onLoadFromDbNewest = vi.fn();
  render(<BufferStatusPill {...baseProps} onLoadFromDbNewest={onLoadFromDbNewest} />);
  fireEvent.click(screen.getByLabelText('Load up to newest telegram in database'));
  expect(onLoadFromDbNewest).toHaveBeenCalledTimes(1);
});

test('load limit and count are content-sized; count left, limit right', () => {
  render(<BufferStatusPill {...baseProps} />);
  const limit = screen.getByLabelText('Load limit') as HTMLInputElement;
  expect(limit).toHaveAttribute('type', 'text');
  expect(limit.style.textAlign).toBe('right');
  expect(limit.style.width).toBe('4ch');
  const count = screen.getByLabelText('3 filtered of 10 in buffer') as HTMLElement;
  expect(count.style.textAlign).toBe('left');
  expect(count.style.width).toBe('6ch');
});

test('forward read direction shows right chevron only', () => {
  render(<BufferStatusPill {...baseProps} readDirection="forward" />);
  expect(screen.getByLabelText('Reading forward')).toBeInTheDocument();
  expect(screen.queryByLabelText('Reading backward')).not.toBeInTheDocument();
});

test('clear ctrl-click asks for auto pause', () => {
  const onClear = vi.fn();
  render(<BufferStatusPill {...baseProps} onClear={onClear} />);
  fireEvent.click(screen.getByLabelText(/Clear \(also wipes/), { ctrlKey: true });
  expect(onClear).toHaveBeenCalledWith({ pauseAuto: true });
});

test('load limit commits on blur', () => {
  const onLoadLimitChange = vi.fn();
  render(<BufferStatusPill {...baseProps} onLoadLimitChange={onLoadLimitChange} />);
  const input = screen.getByLabelText('Load limit');
  fireEvent.change(input, { target: { value: '5000' } });
  fireEvent.blur(input);
  expect(onLoadLimitChange).toHaveBeenCalledWith(5000);
});
