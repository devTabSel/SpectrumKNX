import { render, screen, fireEvent } from '@testing-library/react';
import { format } from 'date-fns';
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
  onScrollToTime: vi.fn(),
  onCommitOutside: vi.fn(),
  onLoadFromDbOldest: vi.fn(),
  onLoadFromDbNewest: vi.fn(),
};

test('formatRangeMinutes / rangeValueToMinutes round-trip s/m/h', () => {
  expect(formatRangeMinutes(60, 'm')).toBe('60');
  expect(formatRangeMinutes(60, 's')).toBe('3600');
  expect(formatRangeMinutes(60, 'h')).toBe('1');
  expect(formatRangeMinutes(90, 'h')).toBe('1.5');
  expect(formatRangeMinutes(1440, 'd')).toBe('1');
  expect(rangeValueToMinutes('3600', 's')).toBe(60);
  expect(rangeValueToMinutes('1.5', 'h')).toBe(90);
  expect(rangeValueToMinutes('1', 'd')).toBe(1440);
  expect(rangeValueToMinutes('45', 'm')).toBe(45);
  expect(sanitizeRangeInput('1.5')).toBe('1.5');
  expect(sanitizeRangeInput('0')).toBe('');
});

test('renders range like DurationField with clickable unit; filtered count is x / y', () => {
  render(<BufferStatusPill {...baseProps} />);
  const range = screen.getByLabelText('Buffer range');
  expect(range).toHaveValue('60');
  expect(range.title).toBe('10/1000');
  expect(screen.getByRole('button', { name: 'Cycle range unit (s / m / h / d)' })).toHaveTextContent('m');
  const count = screen.getByLabelText('3 quick-filtered of 10');
  expect(count).toHaveTextContent('3 / 10');
  expect(count).toHaveAttribute('title', '3 quick-filtered of 10');
  const limitInput = screen.getByLabelText('Load limit');
  expect(limitInput).toHaveValue('1000');
  expect(limitInput).toHaveClass('glass-input');
  const shell = range.closest('[data-duration-field]') as HTMLElement;
  const chevron = shell.querySelector('[data-duration-chevron]') as HTMLElement;
  const unit = screen.getByRole('button', { name: 'Cycle range unit (s / m / h / d)' });
  expect(chevron.tagName).toBe('SPAN');
  expect(chevron.hasAttribute('tabindex')).toBe(false);
  expect(unit.compareDocumentPosition(chevron) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.focus(range);
  expect(screen.getByRole('option', { name: '15 m' })).toBeInTheDocument();
  expect(screen.getByRole('option', { name: '1 d' })).toBeInTheDocument();
  expect(screen.queryByText(/History: loading/)).not.toBeInTheDocument();
});

test('count shows only y when the quick filter is off', () => {
  render(<BufferStatusPill {...baseProps} filterActive={false} />);
  const count = screen.getByLabelText('10 in buffer and backlog');
  expect(count).toHaveTextContent('10');
  expect(count).toHaveAttribute('title', '10 in buffer and backlog');
  expect(count.textContent).not.toContain('/');
});

test('range tooltip stays on the raw buffer and backlog while the count shows y', () => {
  render(
    <BufferStatusPill
      {...baseProps}
      filteredCount={2}
      totalCount={4}
      unfilteredCount={10}
      filterActive={false}
    />,
  );
  expect(screen.getByLabelText('Buffer range').title).toBe('10/1000');
  const count = screen.getByLabelText('4 in buffer and backlog');
  expect(count).toHaveTextContent('4');
  expect(count.textContent).not.toContain('/');
  expect(screen.getByRole('button', { name: /Clear \(also wipes/ })).toBeEnabled();
});

test('clicking range unit cycles s → m → h → d and keeps duration', () => {
  render(<BufferStatusPill {...baseProps} />);
  const unit = screen.getByRole('button', { name: 'Cycle range unit (s / m / h / d)' });
  const range = screen.getByLabelText('Buffer range');
  expect(unit).toHaveTextContent('m');
  expect(range).toHaveValue('60');

  fireEvent.click(unit); // m → h
  expect(unit).toHaveTextContent('h');
  expect(range).toHaveValue('1');

  fireEvent.click(unit); // h → d
  expect(unit).toHaveTextContent('d');
  expect(range).toHaveValue('0.04');

  fireEvent.click(unit); // d → s
  expect(unit).toHaveTextContent('s');
  expect(range).toHaveValue('3600');

  fireEvent.click(unit); // s → m
  expect(unit).toHaveTextContent('m');
  expect(range).toHaveValue('60');
});

test('range commit converts unit to minutes on blur and Enter', () => {
  const onRangeMinutesChange = vi.fn();
  render(<BufferStatusPill {...baseProps} onRangeMinutesChange={onRangeMinutesChange} />);
  const unit = screen.getByRole('button', { name: 'Cycle range unit (s / m / h / d)' });
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

test('range blur adopts a typed unit suffix', () => {
  const onRangeMinutesChange = vi.fn();
  render(<BufferStatusPill {...baseProps} onRangeMinutesChange={onRangeMinutesChange} />);
  const unit = screen.getByRole('button', { name: 'Cycle range unit (s / m / h / d)' });
  const input = screen.getByLabelText('Buffer range');
  expect(unit).toHaveTextContent('m');
  fireEvent.change(input, { target: { value: '2 h' } });
  fireEvent.blur(input);
  expect(onRangeMinutesChange).toHaveBeenCalledWith(120);
  expect(unit).toHaveTextContent('h');
  expect(input).toHaveValue('2');
});

test('range stays next to the direction chevron; clear sits between range and limit', () => {
  const { rerender } = render(
    <BufferStatusPill {...baseProps} totalCount={1000} loadLimit={1000} filterActive={false} />,
  );
  // Backward default: limit → clear → range → chevron
  const field = screen.getByLabelText('Buffer range').closest('[data-duration-field]') as HTMLElement;
  const clear = screen.getByLabelText(/Clear \(also wipes/);
  const limit = screen.getByLabelText('Load limit');
  const chevron = screen.getByLabelText('Reading backward');
  expect(chevron.style.border).toBe('1px solid var(--border-color)');
  expect(field.contains(clear)).toBe(false);
  expect(clear.style.color).toBe('var(--text-dim)');
  expect(limit.compareDocumentPosition(clear) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(clear.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(field.compareDocumentPosition(chevron) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const play = screen.getByRole('button', { name: 'Playing' });
  const newestBack = screen.getByLabelText('Newest telegram in buffer');
  expect(chevron.compareDocumentPosition(play) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(play.compareDocumentPosition(newestBack) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.queryByText('/')).not.toBeInTheDocument();

  // Forward: chevron → range → clear → limit
  rerender(<BufferStatusPill {...baseProps} readDirection="forward" />);
  const fieldFwd = screen.getByLabelText('Buffer range').closest('[data-duration-field]') as HTMLElement;
  const clearFwd = screen.getByLabelText(/Clear \(also wipes/);
  const limitFwd = screen.getByLabelText('Load limit');
  const chevronFwd = screen.getByLabelText('Reading forward');
  expect(chevronFwd.compareDocumentPosition(fieldFwd) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(fieldFwd.compareDocumentPosition(clearFwd) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(clearFwd.compareDocumentPosition(limitFwd) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const playFwd = screen.getByRole('button', { name: 'Play' });
  const newest = screen.getByLabelText('Newest telegram in buffer');
  expect(limitFwd.compareDocumentPosition(playFwd) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(playFwd.compareDocumentPosition(newest) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('loading shows cancel spinner between range and load limit', () => {
  const onCancelLoad = vi.fn();
  render(<BufferStatusPill {...baseProps} isHistoryLoading onCancelLoad={onCancelLoad} />);
  const field = screen.getByLabelText('Buffer range').closest('[data-duration-field]')!;
  const limit = screen.getByLabelText('Load limit');
  expect(screen.queryByLabelText(/Clear \(also wipes/)).not.toBeInTheDocument();
  const cancel = screen.getByLabelText('Cancel loading');
  expect(field.contains(cancel)).toBe(false);
  // Backward: limit → cancel → range
  expect(limit.compareDocumentPosition(cancel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(cancel.compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

test('forward shows a blue Play that asks to put now on the right anchor', () => {
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
  const play = screen.getByRole('button', { name: 'Play' });
  expect(play).toBeEnabled();
  expect(play).toHaveStyle({ color: 'var(--accent-primary)' });
  expect(play).toHaveAttribute('title', 'Jetzt auf die Gegenseite');
  expect(play.querySelector('.lucide-play')).not.toBeNull();
  expect(screen.queryByRole('button', { name: 'Playing' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
  fireEvent.click(play);
  expect(onTogglePause).toHaveBeenCalledTimes(1);
});

test('offline keeps the live control; only the websocket LED is red', () => {
  const { rerender } = render(<BufferStatusPill {...baseProps} wsConnected={false} />);
  const play = screen.getByRole('button', { name: 'Playing' });
  expect(play).toBeEnabled();
  expect(screen.getByLabelText('WebSocket offline')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Offline' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Lädt nach' })).not.toBeInTheDocument();

  rerender(<BufferStatusPill {...baseProps} wsConnected={false} readDirection="forward" />);
  const forwardPlay = screen.getByRole('button', { name: 'Play' });
  expect(forwardPlay).toBeEnabled();
  expect(forwardPlay).toHaveStyle({ color: 'var(--accent-primary)' });
  expect(screen.getByLabelText('WebSocket offline')).toBeInTheDocument();
});

test('manual pause is purple and auto pause is the dim pause icon', () => {
  const { rerender } = render(
    <BufferStatusPill
      {...baseProps}
      pauseMode="manual"
      pauseTitle="Paused manually"
      pauseColor="var(--accent-primary)"
    />,
  );
  expect(screen.getByRole('button', { name: 'Paused manually' }).style.color).toBe('var(--accent-primary)');

  rerender(
    <BufferStatusPill
      {...baseProps}
      pauseMode="auto"
      pauseTitle="Paused automatically"
      pauseColor="var(--text-dim)"
    />,
  );
  const auto = screen.getByRole('button', { name: 'Paused automatically' });
  expect(auto.style.color).toBe('var(--text-dim)');
  expect(auto.querySelector('svg')).toBeTruthy();
});

test('a fixed past anchor shows the auto-pause icon and stays clickable', () => {
  const onTogglePause = vi.fn();
  render(
    <BufferStatusPill
      {...baseProps}
      pauseMode="playing"
      pauseTitle="Playing"
      pauseColor="var(--success)"
      fixedAnchor
      onTogglePause={onTogglePause}
    />,
  );
  const parked = screen.getByRole('button', { name: 'Paused automatically' });
  expect(parked).toBeEnabled();
  expect(parked.style.color).toBe('var(--text-dim)');
  expect(screen.queryByRole('button', { name: 'Playing' })).not.toBeInTheDocument();
  fireEvent.click(parked);
  expect(onTogglePause).toHaveBeenCalledTimes(1);
});

test('clear is disabled when the buffer is empty and ignores ctrl-click', () => {
  const onClear = vi.fn();
  const { rerender } = render(
    <BufferStatusPill {...baseProps} onClear={onClear} totalCount={0} filteredCount={0} filterActive={false} />,
  );
  const empty = screen.getByRole('button', { name: /Clear \(also wipes/ });
  expect(empty).toBeDisabled();
  fireEvent.click(empty);
  expect(onClear).not.toHaveBeenCalled();

  rerender(<BufferStatusPill {...baseProps} onClear={onClear} />);
  fireEvent.click(screen.getByRole('button', { name: /Clear \(also wipes/ }), { ctrlKey: true, metaKey: true });
  expect(onClear).toHaveBeenCalledTimes(1);
});

test('clear turns orange for range and loadlimit, and names every end reason', () => {
  const { rerender } = render(<BufferStatusPill {...baseProps} readingEnd="range" />);
  let clear = screen.getByRole('button', { name: /Clear \(also wipes/ });
  expect(clear.style.color).toBe('var(--warning-text)');
  expect(clear).toHaveAttribute('title', expect.stringMatching(/end of range/i));
  const rangeShell = screen.getByLabelText('Buffer range').closest('[data-duration-field]') as HTMLElement;
  expect(rangeShell.style.color).toBe('var(--warning-text)');
  expect(screen.getByLabelText('Buffer range')).toHaveStyle({ color: 'var(--warning-text)' });
  expect(screen.getByRole('button', { name: 'Cycle range unit (s / m / h / d)' })).toHaveStyle({
    color: 'var(--accent-primary)',
  });
  expect(screen.getByLabelText('Load limit').style.color).toBe('');

  rerender(<BufferStatusPill {...baseProps} readingEnd="loadlimit" />);
  clear = screen.getByRole('button', { name: /Clear \(also wipes/ });
  expect(clear.style.color).toBe('var(--warning-text)');
  expect(clear.title).toMatch(/end of loadlimit/i);
  expect(screen.getByLabelText('Load limit').style.color).toBe('var(--warning-text)');
  expect(
    (screen.getByLabelText('Buffer range').closest('[data-duration-field]') as HTMLElement).style.color,
  ).toBe('');

  rerender(<BufferStatusPill {...baseProps} readingEnd="data" />);
  clear = screen.getByRole('button', { name: /Clear \(also wipes/ });
  expect(clear.title).toMatch(/end of data/i);
  expect(clear.style.color).toBe('var(--text-dim)');
  expect(screen.getByLabelText('Load limit').style.color).toBe('');

  rerender(<BufferStatusPill {...baseProps} totalCount={1000} loadLimit={1000} readingEnd="loading" />);
  clear = screen.getByRole('button', { name: /Clear \(also wipes/ });
  expect(clear.style.color).toBe('var(--text-dim)');
});

function beginEdgeEdit(label: string) {
  fireEvent.click(screen.getByLabelText(label));
  return screen.getByLabelText(label) as HTMLInputElement;
}

test('oldest and newest scroll inside the buffer and load outside on Enter, blur and Ctrl-goto', () => {
  const onScrollToTime = vi.fn();
  const onCommitOutside = vi.fn();
  render(
    <BufferStatusPill
      {...baseProps}
      onScrollToTime={onScrollToTime}
      onCommitOutside={onCommitOutside}
    />,
  );
  const oldestText = format(baseProps.oldestMs!, 'yyyy-MM-dd HH:mm:ss.SS');
  // Same calendar day as newest → field shows time-only; freehand edits are time strings.
  const nextOldest = '11:00:00.00';

  let oldest = beginEdgeEdit('Oldest telegram in buffer');
  expect(oldest.value).toBe('10:00:00.00');
  fireEvent.change(oldest, { target: { value: nextOldest } });
  fireEvent.keyDown(oldest, { key: 'Enter' });
  expect(onScrollToTime).toHaveBeenCalledWith(new Date(2026, 2, 1, 11, 0, 0, 0).getTime());
  expect(onCommitOutside).not.toHaveBeenCalled();

  onScrollToTime.mockClear();
  oldest = beginEdgeEdit('Oldest telegram in buffer');
  fireEvent.change(oldest, { target: { value: '11:30:00.00' } });
  fireEvent.blur(oldest);
  expect(onScrollToTime).toHaveBeenCalledWith(new Date(2026, 2, 1, 11, 30, 0, 0).getTime());

  onScrollToTime.mockClear();
  oldest = beginEdgeEdit('Oldest telegram in buffer');
  fireEvent.change(oldest, { target: { value: '11:45:00.00' } });
  fireEvent.keyDown(oldest, { key: 'Escape' });
  expect(onScrollToTime).not.toHaveBeenCalled();
  expect(onCommitOutside).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Oldest telegram in buffer')).toHaveAttribute('title', oldestText);

  // The goto icon of the buffer edge only scrolls.
  fireEvent.click(screen.getByRole('button', { name: 'Go to oldest time' }));
  expect(onScrollToTime).toHaveBeenCalledWith(baseProps.oldestMs);
  expect(onCommitOutside).not.toHaveBeenCalled();

  onScrollToTime.mockClear();
  oldest = beginEdgeEdit('Oldest telegram in buffer');
  fireEvent.change(oldest, { target: { value: '09:00:00.00' } });
  const oldestGoto = screen.getByRole('button', { name: 'Go to oldest time' });
  expect(oldestGoto).toHaveAttribute('title', 'Ctrl-Klick lädt nach');
  expect(oldestGoto).toHaveStyle({ color: 'var(--warning-text)' });
  fireEvent.click(oldestGoto);
  expect(onCommitOutside).not.toHaveBeenCalled();
  fireEvent.click(oldestGoto, { ctrlKey: true });
  expect(onCommitOutside).toHaveBeenCalledWith(new Date(2026, 2, 1, 9, 0, 0, 0).getTime());

  onCommitOutside.mockClear();
  const newest = beginEdgeEdit('Newest telegram in buffer');
  expect(newest.value).toBe('12:00:00.00');
  fireEvent.change(newest, { target: { value: '13:00:00.00' } });
  fireEvent.keyDown(newest, { key: 'Enter' });
  expect(onCommitOutside).toHaveBeenCalledWith(new Date(2026, 2, 1, 13, 0, 0, 0).getTime());
  expect(onScrollToTime).not.toHaveBeenCalled();
});

test('idle edge times are single-line; date only when if-differs vs the other edge', () => {
  const { rerender } = render(<BufferStatusPill {...baseProps} />);
  const oldest = screen.getByLabelText('Oldest telegram in buffer');
  expect(oldest.tagName).toBe('BUTTON');
  expect(oldest.style.flexDirection).toBe('row');
  // Same calendar day as newest → time only.
  expect(oldest.querySelector('.tt-time')).toHaveTextContent('10:00:00.00');
  expect(oldest.querySelector('.tt-time-date')).toBeNull();

  const otherDayNewest = Date.parse('2026-03-02T12:00:00');
  rerender(<BufferStatusPill {...baseProps} newestMs={otherDayNewest} />);
  const oldestDiff = screen.getByLabelText('Oldest telegram in buffer');
  expect(oldestDiff.querySelector('.tt-time')).toHaveTextContent('10:00:00.00');
  expect(oldestDiff.querySelector('.tt-time-date')).toHaveTextContent('2026-03-01');
});

test('edge goto uses the telegram ms, not the second-truncated display', () => {
  const onScrollToTime = vi.fn();
  const oldestMs = Date.parse('2026-03-01T10:00:00') + 437;
  const newestMs = Date.parse('2026-03-01T12:00:00') + 812;
  render(
    <BufferStatusPill
      {...baseProps}
      oldestMs={oldestMs}
      newestMs={newestMs}
      readDirection="forward"
      onScrollToTime={onScrollToTime}
    />,
  );
  const oldestGoto = screen.getByRole('button', { name: 'Go to oldest time' });
  expect(oldestGoto).toHaveAttribute('title', 'Go to oldest time');
  expect(oldestGoto).toHaveStyle({ color: 'var(--text-dim)' });
  expect(oldestGoto.querySelector('.lucide-arrow-right-from-line')).toBeNull();
  fireEvent.click(oldestGoto);
  expect(onScrollToTime).toHaveBeenCalledWith(oldestMs);

  const newestGoto = screen.getByRole('button', { name: 'Go to newest time' });
  expect(newestGoto).toHaveAttribute('title', 'Go to newest time');
  fireEvent.click(newestGoto);
  expect(onScrollToTime).toHaveBeenCalledWith(newestMs);
});

test('outside edge goto shows the load glyph for the active read direction', () => {
  const { rerender } = render(<BufferStatusPill {...baseProps} readDirection="forward" />);
  let oldest = beginEdgeEdit('Oldest telegram in buffer');
  fireEvent.change(oldest, { target: { value: '09:00:00.00' } });
  let goto = screen.getByRole('button', { name: 'Go to oldest time' });
  expect(goto).toHaveStyle({ color: 'var(--warning-text)' });
  expect(goto.querySelector('.lucide-arrow-right-from-line')).toBeTruthy();

  rerender(<BufferStatusPill {...baseProps} readDirection="backward" />);
  oldest = beginEdgeEdit('Oldest telegram in buffer');
  fireEvent.change(oldest, { target: { value: '09:00:00.00' } });
  goto = screen.getByRole('button', { name: 'Go to oldest time' });
  expect(goto.querySelector('.lucide-arrow-left-from-line')).toBeTruthy();
});

test('goto icon updates while the draft is still uncommitted', () => {
  render(<BufferStatusPill {...baseProps} readDirection="forward" />);
  const goto = screen.getByRole('button', { name: 'Go to oldest time' });
  expect(goto).toHaveAttribute('title', 'Go to oldest time');

  const oldest = beginEdgeEdit('Oldest telegram in buffer');
  fireEvent.change(oldest, { target: { value: '09:00:00.00' } });
  expect(goto).toHaveAttribute('title', 'Ctrl-Klick lädt nach');
  expect(goto).toHaveStyle({ color: 'var(--warning-text)' });
  expect(goto.querySelector('.lucide-arrow-right-from-line')).toBeTruthy();
});
