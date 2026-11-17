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

test('history range controls have no reading-direction icons', async () => {
  renderSearch();
  await waitFor(() => expect(screen.getByLabelText('History range')).toBeInTheDocument());
  expect(screen.queryByRole('button', { name: /Reading backward|Reading forward/ })).not.toBeInTheDocument();
  expect(screen.getByLabelText('History load limit')).toHaveValue('1000');
  expect(screen.queryByRole('button', { name: 'Load history' })).not.toBeInTheDocument();
});
