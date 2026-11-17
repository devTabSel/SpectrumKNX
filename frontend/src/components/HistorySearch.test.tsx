import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { expect, test, vi, beforeEach } from 'vitest';
import { HistorySearch } from './HistorySearch';
import { DEFAULT_FILTERS, type ActiveFilters, type FilterOptions } from '../types/filters';
import { makeTelegram } from '../test/telegramFactory';
import { loadHistoryTelegrams } from '../utils/historyLoad';

vi.mock('../utils/historyLoad', async importOriginal => ({
  ...(await importOriginal<typeof import('../utils/historyLoad')>()),
  loadHistoryTelegrams: vi.fn(),
}));

const OPTIONS: FilterOptions = {
  sources: [], targets: [], types: ['Write', 'Read', 'Response'], dpts: [],
  ga_group_names: {}, pa_line_names: {},
};

const LOADED = [
  makeTelegram({ timestamp: '2024-01-01T10:00:03.000Z', target_address: '1/2/3' }),
  makeTelegram({ timestamp: '2024-01-01T10:00:02.000Z', target_address: '4/5/6' }),
  makeTelegram({ timestamp: '2024-01-01T10:00:01.000Z', target_address: '4/5/6' }),
];

const FILTERED: ActiveFilters = { ...DEFAULT_FILTERS, targets: ['1/2/3'] };

beforeEach(() => {
  vi.mocked(loadHistoryTelegrams).mockReset().mockResolvedValue({
    telegrams: LOADED, metadata: { total_count: LOADED.length, limit_reached: false },
  });
});

const renderSearch = (props: Partial<React.ComponentProps<typeof HistorySearch>> = {}) => {
  const base: React.ComponentProps<typeof HistorySearch> = {
    visibleColumns: { time: true, target: true },
    loadLimit: 1000,
    filterOptions: OPTIONS,
    activeFilters: FILTERED,
    onFiltersChange: vi.fn(),
    onOpenSettings: vi.fn(),
    projectLoaded: true,
    selectedVisualizationTargets: [],
    onVisualizationTargetsChange: vi.fn(),
    // Auto-loads on mount, unfiltered, so all three telegrams are in memory.
    initialView: { plot: [], filters: DEFAULT_FILTERS, range: { kind: 'relative', seconds: 3600 }, embed: false },
    ...props,
  };
  const utils = render(<HistorySearch {...base} />);
  return { ...utils, rerenderWith: (next: typeof props) => utils.rerender(<HistorySearch {...base} {...next} />) };
};

test('the history counter shows only y until the quick filter is on', async () => {
  renderSearch({
    filtersEnabled: true,
    initialView: { plot: [], filters: FILTERED, range: { kind: 'relative', seconds: 3600 }, embed: false },
  });
  // Side panel is active, quick filter is not: the badge is y, not x / y.
  await waitFor(() => expect(screen.getByText(/telegrams$/).textContent).toBe('1 telegrams'));
  expect(screen.getByText(/telegrams$/).textContent).not.toContain('/');
});

test('the switch in the filter pane reports the change (#436)', async () => {
  const onFiltersEnabledChange = vi.fn();
  renderSearch({ filtersEnabled: true, onFiltersEnabledChange });
  await waitFor(() => expect(screen.getByText(/telegrams$/)).toBeInTheDocument());

  fireEvent.click(screen.getByTitle('Disable all filters (keeps them)'));
  expect(onFiltersEnabledChange).toHaveBeenCalledWith(false);
});

test('loosening or tightening the side panel waits for the refresh icon', async () => {
  const view = { plot: [], filters: FILTERED, range: { kind: 'relative' as const, seconds: 3600 }, embed: false };
  const { rerenderWith } = renderSearch({
    filtersEnabled: true,
    activeFilters: FILTERED,
    initialView: view,
  });
  await waitFor(() => expect(screen.getByText(/telegrams$/).textContent).toBe('1 telegrams'));
  const refresh = () => screen.getByRole('button', { name: 'Reload history' });
  expect(refresh()).toHaveAttribute('data-sp-pending', 'false');

  rerenderWith({ filtersEnabled: false, activeFilters: FILTERED, initialView: view });
  expect(screen.getByText(/telegrams$/).textContent).toBe('1 telegrams');
  expect(refresh()).toHaveAttribute('data-sp-pending', 'true');
  expect(refresh()).toHaveAttribute('title', expect.stringMatching(/Side panel changed/));
  expect(refresh().querySelector('[data-sp-pending-dot]')).not.toBeNull();

  rerenderWith({
    filtersEnabled: true,
    activeFilters: { ...FILTERED, targets: ['1/2/3', '4/5/6'] },
    initialView: view,
  });
  expect(screen.getByText(/telegrams$/).textContent).toBe('1 telegrams');
  expect(refresh()).toHaveAttribute('data-sp-pending', 'true');
});

test('cancelling a reload keeps the previous list', async () => {
  let calls = 0;
  vi.mocked(loadHistoryTelegrams).mockImplementation((_range, _limit, _filters, signal) => {
    calls += 1;
    if (calls === 1) {
      return Promise.resolve({ telegrams: LOADED, metadata: { total_count: LOADED.length, limit_reached: false } });
    }
    return new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => {
        reject(new DOMException('Aborted', 'AbortError'));
      });
    });
  });
  renderSearch({
    initialView: { plot: [], filters: DEFAULT_FILTERS, range: { kind: 'relative', seconds: 3600 }, embed: false },
  });
  await waitFor(() => expect(screen.getByText(/telegrams$/).textContent).toBe('3 telegrams'));

  fireEvent.click(screen.getByRole('button', { name: 'Reload history' }));
  const cancel = await screen.findByRole('button', { name: 'Cancel loading' });
  fireEvent.click(cancel);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Reload history' })).toBeInTheDocument());
  expect(screen.getByText(/telegrams$/).textContent).toBe('3 telegrams');
});

const timeInput = (label: 'Oldest telegram in history' | 'Newest telegram in history') =>
  screen.getByLabelText(label) as HTMLInputElement;

const parsedInput = (label: 'Oldest telegram in history' | 'Newest telegram in history') =>
  new Date(timeInput(label).value).getTime();

test('history range controls show the monitor reading-direction icons', async () => {
  renderSearch();
  await waitFor(() => expect(screen.getByLabelText('History range')).toBeInTheDocument());
  expect(screen.getByRole('button', { name: 'Reading backward' })).toBeInTheDocument();
  expect(screen.getByLabelText('History load limit')).toHaveValue('1000');
  expect(screen.queryByRole('button', { name: 'Load history' })).not.toBeInTheDocument();
});

test('reading direction reloads from that anchor, and a range edit keeps it', async () => {
  renderSearch();
  await waitFor(() => expect(screen.getByText(/telegrams$/)).toBeInTheDocument());
  const oldestBefore = timeInput('Oldest telegram in history').value;
  const newestBefore = timeInput('Newest telegram in history').value;

  fireEvent.click(screen.getByRole('button', { name: 'Reading backward' }));
  await waitFor(() => expect(vi.mocked(loadHistoryTelegrams).mock.calls.length).toBeGreaterThan(1));
  const forward = vi.mocked(loadHistoryTelegrams).mock.calls.at(-1)!;
  expect(forward[4]).toBe('asc');
  expect(screen.getByRole('button', { name: 'Reading forward' })).toBeInTheDocument();
  // Forward keeps the oldest edge, so the same span does not move the window.
  expect(timeInput('Oldest telegram in history').value).toBe(oldestBefore);
  expect(timeInput('Newest telegram in history').value).toBe(newestBefore);

  const oldestHeld = parsedInput('Oldest telegram in history');
  fireEvent.change(screen.getByLabelText('History range'), { target: { value: '15' } });
  fireEvent.blur(screen.getByLabelText('History range'));
  await waitFor(() => expect(vi.mocked(loadHistoryTelegrams).mock.calls.length).toBeGreaterThan(2));
  const widened = vi.mocked(loadHistoryTelegrams).mock.calls.at(-1)!;
  expect(widened[4]).toBe('asc');
  expect(parsedInput('Oldest telegram in history')).toBe(oldestHeld);
  expect(parsedInput('Newest telegram in history') - parsedInput('Oldest telegram in history')).toBe(15 * 60_000);

  fireEvent.click(screen.getByRole('button', { name: 'Reading forward' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Reading backward' })).toBeInTheDocument());
  const back = vi.mocked(loadHistoryTelegrams).mock.calls.at(-1)!;
  expect(back[4]).toBe('desc');

  const newestHeld = parsedInput('Newest telegram in history');
  fireEvent.change(screen.getByLabelText('History range'), { target: { value: '5' } });
  fireEvent.blur(screen.getByLabelText('History range'));
  await waitFor(() => {
    const last = vi.mocked(loadHistoryTelegrams).mock.calls.at(-1)!;
    expect(last[4]).toBe('desc');
    expect(last).not.toBe(back);
  });
  expect(parsedInput('Newest telegram in history')).toBe(newestHeld);
  expect(parsedInput('Newest telegram in history') - parsedInput('Oldest telegram in history')).toBe(5 * 60_000);
});

test('a context-window edit stays pending until refresh', async () => {
  const filters = { ...DEFAULT_FILTERS, targets: ['1/2/3'] as string[] };
  const view = { plot: [], filters, range: { kind: 'relative' as const, seconds: 3600 }, embed: false };
  const { rerenderWith } = renderSearch({
    filtersEnabled: true,
    activeFilters: filters,
    initialView: view,
  });
  await waitFor(() => expect(screen.getByText(/telegrams$/).textContent).toBe('1 telegrams'));
  const refresh = () => screen.getByRole('button', { name: 'Reload history' });
  expect(refresh()).toHaveAttribute('data-sp-pending', 'false');

  rerenderWith({
    filtersEnabled: true,
    activeFilters: { ...filters, deltaBeforeMs: 400, deltaAfterMs: 100 },
    initialView: view,
  });
  expect(screen.getByText(/telegrams$/).textContent).toBe('1 telegrams');
  expect(refresh()).toHaveAttribute('data-sp-pending', 'true');
  expect(refresh()).toHaveAttribute('title', expect.stringMatching(/Side panel changed/));
});
