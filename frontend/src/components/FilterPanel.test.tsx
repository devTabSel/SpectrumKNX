import { useState } from 'react';
import { render, renderHook, screen, fireEvent, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { FilterPanel } from './FilterPanel';
import { DEFAULT_FILTERS, type FilterOptions } from '../types/filters';
import { reloadFilterBranches, resetFilterBranches } from '../utils/filterBranchExpansion';
import { resetTargetColors, setTargetColor, TARGET_COLORS, useTargetColors } from '../utils/targetColors';
import { readPanelScroll, writePanelScroll } from '../hooks/usePersistedScroll';
import { resetWritePanelRows } from '../utils/writePanelRows';

beforeEach(() => {
  resetFilterBranches();
  resetWritePanelRows();
});

const EMPTY_OPTIONS: FilterOptions = {
  sources: [], targets: [], types: ['Write', 'Read', 'Response'], dpts: [],
  ga_group_names: {}, pa_line_names: {},
};

test('shows the no-project notice and CTA when no project is loaded', () => {
  const onUploadProject = vi.fn();
  render(
    <FilterPanel
      options={EMPTY_OPTIONS}
      activeFilters={DEFAULT_FILTERS}
      onFiltersChange={() => {}}
      projectLoaded={false}
      onUploadProject={onUploadProject}
    />
  );

  expect(screen.getByText(/No ETS project loaded/i)).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /Upload ETS project/i }));
  expect(onUploadProject).toHaveBeenCalledTimes(1);
});

test('hides the notice while project status is unknown', () => {
  render(
    <FilterPanel
      options={EMPTY_OPTIONS}
      activeFilters={DEFAULT_FILTERS}
      onFiltersChange={() => {}}
    />
  );
  expect(screen.queryByText(/No ETS project loaded/i)).not.toBeInTheDocument();
});

test('toggles the direction filter (#194)', () => {
  const onFiltersChange = vi.fn();
  render(
    <FilterPanel
      options={EMPTY_OPTIONS}
      activeFilters={DEFAULT_FILTERS}
      onFiltersChange={onFiltersChange}
      counts={{ sources: {}, targets: {}, types: {}, directions: { Incoming: 7, Outgoing: 2 }, dpts: {} }}
      projectLoaded={true}
    />
  );

  expect(screen.getByText('Direction')).toBeInTheDocument();
  const direction = screen.getByRole('button', { name: /^Direction/ });
  expect(within(direction).getByTitle('Directions in the buffer')).toHaveTextContent('2');
  expect(within(direction).getByTitle('Telegrams')).toHaveTextContent('9');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Outgoing' }));
  expect(onFiltersChange).toHaveBeenCalledWith({ ...DEFAULT_FILTERS, directions: ['Outgoing'] });
});

// ── Quick actions on active filter rows (#214) ───────────────────────────────

const GA_OPTIONS: FilterOptions = {
  ...EMPTY_OPTIONS,
  sources: [{ address: '1.2.3', name: 'Taster EG' }],
  targets: [{ address: '0/1/2', name: 'Licht Küche', main: 1, sub: 1 }],
};
const ACTIVE = { ...DEFAULT_FILTERS, sources: ['1.2.3'], targets: ['0/1/2'] };

test('active target rows offer send-to-GA and last-seen actions (#214)', () => {
  const onQuickLastSeen = vi.fn();
  render(
    <FilterPanel
      options={GA_OPTIONS}
      activeFilters={ACTIVE}
      onFiltersChange={() => {}}
      projectLoaded={true}
      writeEnabled={true}
      onQuickLastSeen={onQuickLastSeen}
    />
  );

  fireEvent.click(screen.getByRole('button', { name: /^Focus/ }));
  // Every project GA offers send. Last seen toggles on its own and does not filter.
  expect(screen.getAllByRole('button', { name: 'Send to this GA' })).toHaveLength(1);
  const gaSeen = screen.getByRole('button', { name: 'Toggle last seen values' });
  fireEvent.click(gaSeen);
  expect(gaSeen).toHaveAttribute('aria-pressed', 'true');
  expect(onQuickLastSeen).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Sources' }));
  expect(screen.queryByRole('button', { name: 'Send to this GA' })).not.toBeInTheDocument();
  const deviceSeen = screen.getByRole('button', { name: 'Toggle last seen values' });
  fireEvent.click(deviceSeen);
  expect(deviceSeen).toHaveAttribute('aria-pressed', 'true');
  expect(onQuickLastSeen).not.toHaveBeenCalled();
});

test('hides the send action on active rows when writes are disabled', () => {
  render(
    <FilterPanel
      options={GA_OPTIONS}
      activeFilters={ACTIVE}
      onFiltersChange={() => {}}
      projectLoaded={true}
      writeEnabled={false}
      onQuickLastSeen={() => {}}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: /^Focus/ }));
  expect(screen.queryByRole('button', { name: 'Send to this GA' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Toggle last seen values' })).toBeInTheDocument();
});

test('ctrl-click on send adds and removes the group address in the send panel', () => {
  localStorage.removeItem('spectrumknx-write-panel-rows');
  render(
    <FilterPanel
      options={GA_OPTIONS}
      activeFilters={ACTIVE}
      onFiltersChange={() => {}}
      projectLoaded={true}
      writeEnabled={true}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: /^Focus/ }));
  const send = screen.getByRole('button', { name: 'Send to this GA' });
  expect(send).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(send, { ctrlKey: true });
  expect(send).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(send, { ctrlKey: true });
  expect(send).toHaveAttribute('aria-pressed', 'false');
});

// ── Edit ↔ Active view + all-AND + master toggle (#370) ──────────────────────

test('toggles Edit ↔ Active views, keeps the count badge, and has no AND/OR control', () => {
  render(
    <FilterPanel
      options={GA_OPTIONS}
      activeFilters={ACTIVE}
      onFiltersChange={() => {}}
      projectLoaded={true}
      writeEnabled={true}
      onQuickLastSeen={() => {}}
    />
  );
  const filter = screen.getByRole('button', { name: /^Filter/ });

  // Default = Filter view: category sections shown, active rows hidden.
  expect(filter).toBeInTheDocument();
  expect(screen.getByText('Direction')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Direction' }).firstElementChild?.tagName).toBe('svg');
  expect(screen.queryByRole('button', { name: 'Send to this GA' })).not.toBeInTheDocument();
  expect(within(filter).getByText('2')).toBeInTheDocument();
  expect(within(screen.getByRole('button', { name: 'Focus' })).queryByText('2')).not.toBeInTheDocument();
  expect(screen.queryByTitle('Clear all filters')).not.toBeInTheDocument();
  // All filters AND now — no combination control (#275).
  expect(screen.queryByText(/Combine as/i)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'OR' })).not.toBeInTheDocument();

  // Switch to Active view: rows appear, category sections gone, badge stays.
  fireEvent.click(screen.getByRole('button', { name: /^Focus/ }));
  expect(screen.getByRole('button', { name: 'Send to this GA' })).toBeInTheDocument();
  expect(screen.queryByText('Direction')).not.toBeInTheDocument();
  expect(within(filter).getByText('2')).toBeInTheDocument();
});

test('master toggle disables the whole set (#370)', () => {
  const onFiltersEnabledChange = vi.fn();
  const { rerender } = render(
    <FilterPanel
      options={GA_OPTIONS}
      activeFilters={ACTIVE}
      onFiltersChange={() => {}}
      projectLoaded={true}
      filtersEnabled={true}
      onFiltersEnabledChange={onFiltersEnabledChange}
    />
  );
  fireEvent.click(screen.getByTitle(/^Disable filters/));
  expect(onFiltersEnabledChange).toHaveBeenCalledWith(false);

  rerender(
    <FilterPanel
      options={GA_OPTIONS}
      activeFilters={ACTIVE}
      onFiltersChange={() => {}}
      projectLoaded={true}
      filtersEnabled={false}
      onFiltersEnabledChange={onFiltersEnabledChange}
    />
  );
  fireEvent.click(screen.getByTitle(/^Enable filters/));
  expect(onFiltersEnabledChange).toHaveBeenLastCalledWith(true);

  onFiltersEnabledChange.mockClear();
  const onFiltersChange = vi.fn();
  const onFocusGasChange = vi.fn();
  const onFocusDevicesChange = vi.fn();
  const onFocusFilterGasChange = vi.fn();
  const onFocusFilterDevicesChange = vi.fn();
  const onLastSeenGasChange = vi.fn();
  const onLastSeenDevicesChange = vi.fn();
  const onPanelViewChange = vi.fn();
  rerender(
    <FilterPanel
      options={GA_OPTIONS}
      activeFilters={ACTIVE}
      onFiltersChange={onFiltersChange}
      projectLoaded={true}
      filtersEnabled={false}
      onFiltersEnabledChange={onFiltersEnabledChange}
      focusGas={['0/1/2']}
      onFocusGasChange={onFocusGasChange}
      focusDevices={['1.2.3']}
      onFocusDevicesChange={onFocusDevicesChange}
      focusFilterGas={['0/1/2']}
      onFocusFilterGasChange={onFocusFilterGasChange}
      focusFilterDevices={['1.2.3']}
      onFocusFilterDevicesChange={onFocusFilterDevicesChange}
      lastSeenGas={['0/1/2']}
      onLastSeenGasChange={onLastSeenGasChange}
      lastSeenDevices={['1.2.3']}
      onLastSeenDevicesChange={onLastSeenDevicesChange}
      panelView="focus"
      onPanelViewChange={onPanelViewChange}
    />
  );
  fireEvent.click(screen.getByText('0/1/2'));
  expect(document.querySelector('[data-focus-address="0/1/2"]')).toHaveAttribute('data-marked', 'true');
  writePanelScroll('filter', 240);
  writePanelScroll('focus-ga', 180);
  writePanelScroll('focus-pa', 90);
  fireEvent.click(screen.getByTitle(/^Enable filters/), { ctrlKey: true });
  expect(onFiltersChange).toHaveBeenCalledWith(DEFAULT_FILTERS);
  expect(onFiltersEnabledChange).toHaveBeenCalledWith(true);
  expect(onFocusGasChange).toHaveBeenCalledWith([]);
  expect(onFocusDevicesChange).toHaveBeenCalledWith([]);
  expect(onFocusFilterGasChange).toHaveBeenCalledWith([]);
  expect(onFocusFilterDevicesChange).toHaveBeenCalledWith([]);
  expect(onLastSeenGasChange).toHaveBeenCalledWith([]);
  expect(onLastSeenDevicesChange).toHaveBeenCalledWith([]);
  expect(onPanelViewChange).toHaveBeenCalledWith('filter');
  expect(document.querySelector('[data-focus-address="0/1/2"]')).not.toHaveAttribute('data-marked');
  expect(readPanelScroll('filter')).toBe(0);
  expect(readPanelScroll('focus-ga')).toBe(0);
  expect(readPanelScroll('focus-pa')).toBe(0);

  // Only offered where the owner can act on it.
  rerender(
    <FilterPanel options={GA_OPTIONS} activeFilters={ACTIVE} onFiltersChange={() => {}} projectLoaded={true} />
  );
  expect(screen.queryByTitle(/Disable filters|Enable filters/)).not.toBeInTheDocument();
});

test('ctrl-click on the filter switch clears a filter-list mouse selection', () => {
  render(
    <FilterPanel
      options={GA_OPTIONS}
      activeFilters={ACTIVE}
      onFiltersChange={() => {}}
      projectLoaded={true}
      filtersEnabled={true}
      onFiltersEnabledChange={() => {}}
    />
  );
  fireEvent.click(screen.getByText('Write'));
  expect(screen.getByText('Write').closest('[data-marked]')).toHaveAttribute('data-marked', 'true');
  fireEvent.click(screen.getByTitle(/^Disable filters/), { ctrlKey: true });
  expect(screen.getByText('Write').closest('[data-marked]')).toBeNull();
});

test('reset clears the filters and the search, and turns the filter switch on', () => {
  const onFiltersChange = vi.fn();
  const onFiltersEnabledChange = vi.fn();
  render(
    <FilterPanel
      options={GA_OPTIONS}
      activeFilters={ACTIVE}
      onFiltersChange={onFiltersChange}
      projectLoaded={true}
      filtersEnabled={false}
      onFiltersEnabledChange={onFiltersEnabledChange}
    />
  );
  fireEvent.change(screen.getByPlaceholderText('filter...'), { target: { value: 'licht' } });
  fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
  expect(onFiltersChange).toHaveBeenCalledWith(DEFAULT_FILTERS);
  expect(onFiltersEnabledChange).toHaveBeenCalledWith(true);
  expect(screen.getByPlaceholderText('filter...')).toHaveValue('');
});

test('controlled search and compact come from the owner, and reset reports the cleared search', () => {
  const onSearchChange = vi.fn();
  const onCompactChange = vi.fn();
  const onCheckedOnlyChange = vi.fn();
  const onFiltersChange = vi.fn();
  render(
    <FilterPanel
      options={EMPTY_OPTIONS}
      activeFilters={DEFAULT_FILTERS}
      onFiltersChange={onFiltersChange}
      search="licht"
      onSearchChange={onSearchChange}
      compact={true}
      onCompactChange={onCompactChange}
      checkedOnly
      onCheckedOnlyChange={onCheckedOnlyChange}
    />
  );
  const input = screen.getByPlaceholderText('filter...');
  expect(input).toHaveValue('licht');
  expect(screen.getByRole('button', { name: 'Verdichten' })).toHaveAttribute('aria-pressed', 'true');

  fireEvent.change(input, { target: { value: 'wohn' } });
  expect(onSearchChange).toHaveBeenCalledWith('wohn');

  fireEvent.click(screen.getByRole('button', { name: 'Verdichten' }));
  expect(onCompactChange).toHaveBeenCalledWith(false);

  onCompactChange.mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
  expect(onFiltersChange).toHaveBeenCalledWith(DEFAULT_FILTERS);
  expect(onSearchChange).toHaveBeenCalledWith('');
  expect(onCompactChange).toHaveBeenCalledWith(false);
  expect(onCheckedOnlyChange).toHaveBeenCalledWith(false);
});

test('Verdichten hides entries whose telegram count is zero', () => {
  render(
    <FilterPanel
      options={EMPTY_OPTIONS}
      activeFilters={DEFAULT_FILTERS}
      onFiltersChange={() => {}}
      counts={{ sources: {}, targets: {}, types: { Write: 4, Read: 0 }, directions: { Incoming: 4, Outgoing: 0 }, dpts: {} }}
    />
  );
  expect(screen.getByText('Read')).toBeInTheDocument();
  expect(screen.getByText('Outgoing')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Verdichten' }));
  expect(screen.getByText('Write')).toBeInTheDocument();
  expect(screen.getByText('Incoming')).toBeInTheDocument();
  expect(screen.queryByText('Read')).not.toBeInTheDocument();
  expect(screen.queryByText('Outgoing')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Verdichten' }));
  expect(screen.getByText('Read')).toBeInTheDocument();
  expect(screen.getByText('Outgoing')).toBeInTheDocument();
});

test('Verdichten hides a checked entry with no telegrams, and Compact keeps one after the check is cleared', () => {
  const counts = { sources: {}, targets: {}, types: { Write: 4, Read: 0 }, directions: { Incoming: 4, Outgoing: 0 }, dpts: {} };
  function Harness({ mode }: { mode: 'verdichten' | 'compact' }) {
    const [filters, setFilters] = useState({ ...DEFAULT_FILTERS, types: ['Read'] });
    const [on, setOn] = useState(false);
    return (
      <FilterPanel
        options={EMPTY_OPTIONS}
        activeFilters={filters}
        onFiltersChange={setFilters}
        counts={counts}
        compact={mode === 'verdichten' ? on : false}
        onCompactChange={mode === 'verdichten' ? setOn : undefined}
        checkedOnly={mode === 'compact' ? on : false}
        onCheckedOnlyChange={mode === 'compact' ? setOn : undefined}
      />
    );
  }
  const { unmount } = render(<Harness mode="verdichten" />);
  fireEvent.click(screen.getByRole('button', { name: 'Verdichten' }));
  expect(screen.queryByText('Read')).not.toBeInTheDocument();
  expect(screen.getByText('Write')).toBeInTheDocument();
  expect(screen.queryByText('Outgoing')).not.toBeInTheDocument();
  unmount();

  render(<Harness mode="compact" />);
  fireEvent.click(screen.getByRole('button', { name: 'Compact' }));
  expect(screen.getByText('Read')).toBeInTheDocument();
  expect(screen.queryByText('Write')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Read' }));
  expect(screen.getByText('Read')).toBeInTheDocument();
  expect(screen.queryByText('Write')).not.toBeInTheDocument();
});

test('hides the notice when a project is loaded', () => {
  render(
    <FilterPanel
      options={EMPTY_OPTIONS}
      activeFilters={DEFAULT_FILTERS}
      onFiltersChange={() => {}}
      projectLoaded={true}
    />
  );
  expect(screen.queryByText(/No ETS project loaded/i)).not.toBeInTheDocument();
});

test('a category title is bold only when that category has a selection', () => {
  render(
    <FilterPanel
      options={{ ...GA_OPTIONS, dpts: [{ main: 1, sub: 1, label: 'Switch' }] }}
      activeFilters={ACTIVE}
      onFiltersChange={() => {}}
      projectLoaded={true}
    />
  );
  const source = screen.getByText('Source');
  expect(source.style.fontWeight).toBe('700');
  expect(source.style.color).toBe('var(--accent-primary)');
  expect(source.style.fontSize).toBe('0.75rem');
  const target = screen.getByText('Target');
  expect(target.style.fontWeight).toBe('700');
  expect(target.style.color).toBe('var(--accent-primary)');
  expect(screen.getByText('Type').style.fontWeight).toBe('400');
  expect(screen.getByText('Type').style.color).toBe('');
  expect(screen.getByText('Direction').style.fontWeight).toBe('400');
  expect(screen.getByText('DPT').style.fontWeight).toBe('400');
});

test('the Filter and Focus header and the GA or device tab follow the persisted choice', () => {
  const onPanelViewChange = vi.fn();
  const onFocusTabChange = vi.fn();
  render(
    <FilterPanel
      options={EMPTY_OPTIONS}
      activeFilters={DEFAULT_FILTERS}
      onFiltersChange={() => {}}
      projectLoaded
      panelView="focus"
      onPanelViewChange={onPanelViewChange}
      focusTab="pa"
      onFocusTabChange={onFocusTabChange}
    />
  );
  expect(screen.getByRole('button', { name: 'Focus' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'Sources' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: /^Filter/ }));
  expect(onPanelViewChange).toHaveBeenCalledWith('filter');
  fireEvent.click(screen.getByRole('button', { name: 'Targets' }));
  expect(onFocusTabChange).toHaveBeenCalledWith('ga');
});

test('an entry with telegrams in the unfiltered buffer is highlighted like a selected category', () => {
  render(
    <FilterPanel
      options={EMPTY_OPTIONS}
      activeFilters={DEFAULT_FILTERS}
      onFiltersChange={() => {}}
      projectLoaded
      counts={{ sources: {}, targets: {}, types: { Read: 0, Write: 2 }, directions: { Incoming: 0, Outgoing: 1 }, dpts: {} }}
      bufferCounts={{ sources: {}, targets: {}, types: { Read: 4, Write: 2, Response: 0 }, directions: { Incoming: 4, Outgoing: 0 }, dpts: {} }}
    />
  );
  expect(screen.getByText('Read').style.fontWeight).toBe('700');
  expect(screen.getByText('Read').style.color).toBe('var(--accent-primary)');
  expect(screen.getByText('Response').style.fontWeight).toBe('400');
  expect(screen.getByText('Incoming').style.fontWeight).toBe('700');
  expect(screen.getByText('Outgoing').style.fontWeight).toBe('400');
  expect(screen.getByText('Type').style.fontWeight).toBe('400');
  expect(screen.getByText('Direction').style.fontWeight).toBe('400');
});

test('category titles and branches stay plain when only the buffer highlights an entry', () => {
  render(
    <FilterPanel
      options={{
        ...GA_OPTIONS,
        dpts: [{ main: 1, sub: 1, label: 'Switch' }, { main: 9, sub: 1, label: 'Temperature' }],
      }}
      activeFilters={DEFAULT_FILTERS}
      onFiltersChange={() => {}}
      projectLoaded
      bufferCounts={{
        sources: { '1.2.3': 2 },
        targets: {},
        types: {},
        directions: {},
        dpts: { '9.001': 3, '1.001': 0 },
      }}
    />
  );
  expect(screen.getByText('Source').style.fontWeight).toBe('400');
  expect(screen.getByText('1').style.fontWeight).toBe('400');
  expect(screen.getByText('1.2').style.fontWeight).toBe('400');
  fireEvent.click(screen.getByText('1.2'));
  expect(screen.getByText('1.2.3').style.fontWeight).toBe('700');
  expect(screen.getByText('1.2.3').style.color).toBe('var(--accent-primary)');
  expect(screen.getByText('Target').style.fontWeight).toBe('400');
  expect(screen.getByText('DPT').style.fontWeight).toBe('400');
  fireEvent.click(screen.getByRole('button', { name: /^DPT/ }));
  expect(screen.getByText('DPT 9').style.fontWeight).toBe('400');
  expect(screen.getByText('DPT 1').style.fontWeight).toBe('400');
});

test('ctrl-click on a category expands or collapses every branch underneath', () => {
  render(
    <FilterPanel
      options={{
        ...EMPTY_OPTIONS,
        targets: [
          { address: '1/1/75', name: 'Alarm' },
          { address: '1/2/1', name: 'Hall' },
        ],
        dpts: [{ main: 1, sub: 1, label: 'Switch' }, { main: 9, sub: 1, label: 'Temperature' }],
        ga_group_names: { '1': 'Zentral', '1/1': 'EG', '1/2': 'OG' },
      }}
      activeFilters={DEFAULT_FILTERS}
      onFiltersChange={() => {}}
      projectLoaded
    />
  );

  // The category starts open and the middle groups start collapsed.
  fireEvent.click(screen.getByRole('button', { name: /^Target/ }), { ctrlKey: true });
  expect(screen.queryByText('1 — Zentral')).not.toBeInTheDocument();

  // A plain click only reopens the category, so the branches stay closed.
  fireEvent.click(screen.getByRole('button', { name: /^Target/ }));
  expect(screen.getByText('1 — Zentral')).toBeInTheDocument();
  expect(screen.queryByText('1/1 — EG')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /^Target/ }));
  fireEvent.click(screen.getByRole('button', { name: /^Target/ }), { metaKey: true });
  expect(screen.getByText('1/1/75')).toBeInTheDocument();
  expect(screen.getByText('Hall')).toBeInTheDocument();

  // DPT starts closed. Ctrl-click opens the category and every main type inside it.
  expect(screen.queryByText('DPT 1')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^DPT/ }), { ctrlKey: true });
  expect(screen.getByText('1.001')).toBeInTheDocument();
  expect(screen.getByText('9.001')).toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem('spectrum-knx.filter-branches')!)).toMatchObject({
    'category:target': true, 'ga:1': true, 'ga:1/1': true, 'ga:1/2': true,
    'category:dpt': true, 'dpt:1': true, 'dpt:9': true,
  });
});

test('a closed category stays closed after leaving the filter and after a reload', () => {
  const props = {
    options: GA_OPTIONS,
    activeFilters: DEFAULT_FILTERS,
    onFiltersChange: () => {},
    projectLoaded: true,
  };
  const view = render(<FilterPanel {...props} />);
  fireEvent.click(screen.getByRole('button', { name: /^Source/ }));
  expect(screen.queryByText('1.2.3')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /^Focus/ }));
  fireEvent.click(screen.getByRole('button', { name: /^Filter/ }));
  expect(screen.queryByText('1.2.3')).not.toBeInTheDocument();

  view.unmount();
  reloadFilterBranches();
  render(<FilterPanel {...props} />);
  expect(screen.queryByText('1.2.3')).not.toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem('spectrum-knx.filter-branches')!)).toMatchObject({ 'category:source': false });
});

test('a plain click on a category leaves the branches underneath unchanged', () => {
  render(
    <FilterPanel
      options={{
        ...EMPTY_OPTIONS,
        targets: [
          { address: '1/1/75', name: 'Alarm' },
          { address: '1/2/1', name: 'Hall' },
        ],
        ga_group_names: { '1': 'Zentral', '1/1': 'EG', '1/2': 'OG' },
      }}
      activeFilters={DEFAULT_FILTERS}
      onFiltersChange={() => {}}
      projectLoaded
    />
  );
  fireEvent.click(screen.getByText('1/1 — EG'));
  expect(screen.getByText('1/1/75')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^Target/ }));
  fireEvent.click(screen.getByRole('button', { name: /^Target/ }));
  expect(screen.getByText('1/1/75')).toBeInTheDocument();
  expect(screen.queryByText('Hall')).not.toBeInTheDocument();
});

test('category headers show the live total of their entries, counting each DPT telegram once', () => {
  render(
    <FilterPanel
      options={{
        ...EMPTY_OPTIONS,
        sources: [{ address: '1.2.3' }],
        targets: [{ address: '0/1/2' }],
        dpts: [{ main: 1, sub: 1, label: 'Switch' }],
      }}
      activeFilters={DEFAULT_FILTERS}
      onFiltersChange={() => {}}
      counts={{
        sources: { '1.2.3': 4, '9.9.9': 1 },
        targets: { '0/1/2': 5 },
        types: { Write: 3, Read: 2 },
        directions: { Incoming: 5 },
        dpts: { '1': 5, '1.001': 5 },
      }}
    />
  );
  const source = screen.getByRole('button', { name: /^Source/ });
  expect(within(source).getByTitle('Sources in the buffer')).toHaveTextContent('2');
  expect(within(source).getByTitle('Telegrams')).toHaveTextContent('5');
  const target = screen.getByRole('button', { name: /^Target/ });
  expect(within(target).getByTitle('Targets in the buffer')).toHaveTextContent('1');
  expect(within(target).getByTitle('Telegrams')).toHaveTextContent('5');
  expect(within(screen.getByRole('button', { name: /^Type/ })).getByTitle('Types in the buffer')).toHaveTextContent('2');
  const dpt = screen.getByRole('button', { name: /^DPT/ });
  expect(within(dpt).getByTitle('DPTs in the buffer')).toHaveTextContent('1');
  expect(within(dpt).getByTitle('Telegrams')).toHaveTextContent('5');
});

test('every category shows a database badge where the buffer has no telegram', () => {
  render(
    <FilterPanel
      options={{
        ...EMPTY_OPTIONS,
        dpts: [{ main: 1, sub: 1, label: 'Switch' }, { main: 9, sub: 1, label: 'Temperature' }],
      }}
      activeFilters={DEFAULT_FILTERS}
      onFiltersChange={() => {}}
      projectLoaded
      counts={{ sources: {}, targets: {}, types: { Read: 4, Write: 0, Response: 0 }, directions: { Incoming: 4, Outgoing: 0 }, dpts: { '9.001': 4, '9': 4 } }}
      dbCounts={{
        sources: {},
        targets: {},
        types: { Read: 4, Write: 11, Response: 0 },
        directions: { Incoming: 4, Outgoing: 7 },
        dpts: { '1.001': 8, '1': 8, '9.001': 4, '9': 4 },
      }}
    />
  );
  const optionRow = (label: string) => screen.getByText(label).parentElement!.parentElement!.parentElement!;
  expect(within(optionRow('Write')).getByTitle('Telegrams in the database')).toHaveTextContent('11');
  expect(within(optionRow('Read')).queryByTitle('Telegrams in the database')).not.toBeInTheDocument();
  expect(within(optionRow('Response')).queryByTitle('Telegrams in the database')).not.toBeInTheDocument();
  expect(within(optionRow('Outgoing')).getByTitle('Telegrams in the database')).toHaveTextContent('7');
  expect(within(screen.getByRole('button', { name: /^Type/ })).queryByTitle('Telegrams in the database')).not.toBeInTheDocument();
  expect(within(screen.getByRole('button', { name: /^Direction/ })).getByTitle('Telegrams')).toHaveTextContent('4');

  fireEvent.click(screen.getByRole('button', { name: /^DPT/ }));
  const dpt1 = screen.getByText('DPT 1').parentElement!.parentElement!.parentElement!;
  expect(within(dpt1).getByTitle('Telegrams in the database')).toHaveTextContent('8');
  fireEvent.click(screen.getByText('DPT 1'));
  expect(within(screen.getByText('1.001').parentElement!.parentElement!).getByTitle('Telegrams in the database')).toHaveTextContent('8');
  expect(within(screen.getByText('DPT 9').parentElement!.parentElement!.parentElement!).queryByTitle('Telegrams in the database')).not.toBeInTheDocument();
  expect(within(screen.getByRole('button', { name: /^DPT/ })).getByTitle('Telegrams')).toHaveTextContent('4');
});

test('history mode shows count bubbles when counts are supplied (#446)', () => {
  const counts = { sources: {}, targets: {}, types: { Write: 41, Read: 3 }, directions: {}, dpts: {} };
  const { rerender } = render(
    <FilterPanel options={EMPTY_OPTIONS} activeFilters={DEFAULT_FILTERS} onFiltersChange={() => {}} counts={counts} />
  );
  expect(screen.getByText('41')).toBeInTheDocument();
  expect(screen.getByText('3')).toBeInTheDocument();

  // Nothing loaded yet → no counts → no bubbles at all (not a column of zeros).
  rerender(
    <FilterPanel options={EMPTY_OPTIONS} activeFilters={DEFAULT_FILTERS} onFiltersChange={() => {}} />
  );
  expect(screen.queryByText('41')).not.toBeInTheDocument();
  expect(screen.queryByText('0')).not.toBeInTheDocument();
});

test('checking a source or GA in the filter focuses it, and unchecking leaves the focus', () => {
  const onFiltersChange = vi.fn();
  const onFocusDevicesChange = vi.fn();
  const onFocusGasChange = vi.fn();
  const options: FilterOptions = {
    ...EMPTY_OPTIONS,
    sources: [{ address: '1.2.3', name: 'Taster' }, { address: '1.2.4', name: 'Taster 2' }],
    targets: [{ address: '0/1/2', name: 'Licht' }],
  };
  const panel = (filters = DEFAULT_FILTERS, focusDevices: string[] = []) => (
    <FilterPanel
      options={options}
      activeFilters={filters}
      onFiltersChange={onFiltersChange}
      onFocusDevicesChange={onFocusDevicesChange}
      onFocusGasChange={onFocusGasChange}
      focusDevices={focusDevices}
      projectLoaded
    />
  );
  const { rerender } = render(panel());

  fireEvent.click(screen.getByText('1.2'));
  fireEvent.click(screen.getByRole('checkbox', { name: '1.2.3' }));
  expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ sources: ['1.2.3'] }));
  expect(onFocusDevicesChange).toHaveBeenCalledWith(['1.2.3']);

  onFocusDevicesChange.mockClear();
  rerender(panel({ ...DEFAULT_FILTERS, sources: ['1.2.3'] }, ['1.2.3']));
  fireEvent.click(screen.getByRole('checkbox', { name: '1.2.3' }));
  expect(onFiltersChange).toHaveBeenLastCalledWith(expect.objectContaining({ sources: [] }));
  expect(onFocusDevicesChange).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('checkbox', { name: '1.2.4' }));
  expect(onFocusDevicesChange).toHaveBeenCalledWith(['1.2.3', '1.2.4']);

  fireEvent.click(screen.getByText('0/1'));
  fireEvent.click(screen.getByRole('checkbox', { name: '0/1/2' }));
  expect(onFiltersChange).toHaveBeenLastCalledWith(expect.objectContaining({ targets: ['0/1/2'] }));
  expect(onFocusGasChange).toHaveBeenCalledWith(['0/1/2']);
});

test('the focus loupe opens Focus on Sources for a device and Targets for a group address', () => {
  const onPanelViewChange = vi.fn();
  const onFocusTabChange = vi.fn();
  const onFocusDevicesChange = vi.fn();
  const onFocusGasChange = vi.fn();
  const options: FilterOptions = {
    ...EMPTY_OPTIONS,
    sources: [{ address: '1.2.3', name: 'Taster' }],
    targets: [{ address: '0/1/2', name: 'Licht' }],
  };
  render(
    <FilterPanel
      options={options}
      activeFilters={DEFAULT_FILTERS}
      onFiltersChange={() => {}}
      projectLoaded
      panelView="filter"
      onPanelViewChange={onPanelViewChange}
      focusTab="ga"
      onFocusTabChange={onFocusTabChange}
      onFocusDevicesChange={onFocusDevicesChange}
      onFocusGasChange={onFocusGasChange}
    />,
  );
  const rowOf = (address: string) => screen.getByText(address).parentElement!.parentElement as HTMLElement;

  fireEvent.click(screen.getByText('1.2'));
  fireEvent.click(within(rowOf('1.2.3')).getByTitle(/^Toggle focus/));
  expect(onFocusDevicesChange).toHaveBeenCalledWith(['1.2.3']);
  expect(onFocusTabChange).not.toHaveBeenCalled();
  expect(onPanelViewChange).not.toHaveBeenCalled();

  fireEvent.click(screen.getByText('0/1'));
  fireEvent.click(within(rowOf('0/1/2')).getByTitle(/^Toggle focus/));
  expect(onFocusGasChange).toHaveBeenCalledWith(['0/1/2']);
  expect(onFocusTabChange).not.toHaveBeenCalled();
  expect(onPanelViewChange).not.toHaveBeenCalled();

  onFocusDevicesChange.mockClear();
  onFocusGasChange.mockClear();
  fireEvent.click(within(rowOf('1.2.3')).getByTitle(/^Toggle focus/), { ctrlKey: true });
  fireEvent.click(within(rowOf('0/1/2')).getByTitle(/^Toggle focus/), { metaKey: true });
  expect(onFocusDevicesChange).toHaveBeenCalledWith(['1.2.3']);
  expect(onFocusGasChange).toHaveBeenCalledWith(['0/1/2']);
  expect(onFocusTabChange).not.toHaveBeenCalled();
  expect(onPanelViewChange).not.toHaveBeenCalled();

  onFocusDevicesChange.mockClear();
  onFocusGasChange.mockClear();
  fireEvent.click(within(rowOf('1.2.3')).getByTitle(/^Toggle focus/), { shiftKey: true });
  fireEvent.click(within(rowOf('0/1/2')).getByTitle(/^Toggle focus/), { shiftKey: true });
  expect(onFocusTabChange).toHaveBeenNthCalledWith(1, 'pa');
  expect(onFocusTabChange).toHaveBeenNthCalledWith(2, 'ga');
  expect(onPanelViewChange).toHaveBeenCalledWith('focus');

  onFocusDevicesChange.mockClear();
  onFocusGasChange.mockClear();
  onFocusTabChange.mockClear();
  onPanelViewChange.mockClear();
  fireEvent.click(within(rowOf('1.2.3')).getByTitle(/^Toggle focus/), { altKey: true });
  fireEvent.click(within(rowOf('0/1/2')).getByTitle(/^Toggle focus/), { altKey: true });
  expect(onFocusDevicesChange).not.toHaveBeenCalled();
  expect(onFocusGasChange).not.toHaveBeenCalled();
  expect(onFocusTabChange).toHaveBeenNthCalledWith(1, 'pa');
  expect(onFocusTabChange).toHaveBeenNthCalledWith(2, 'ga');
  expect(onPanelViewChange).toHaveBeenCalledWith('focus');

  onFocusTabChange.mockClear();
  onPanelViewChange.mockClear();
  fireEvent.click(within(rowOf('1.2.3')).getByTitle(/^Toggle focus/), { altKey: true, ctrlKey: true });
  expect(onFocusTabChange).not.toHaveBeenCalled();
  expect(onPanelViewChange).not.toHaveBeenCalled();
});

test('Focus lists every project address, pins a checked one above the divider, and its quick filter stays off the source and target filter', () => {
  const onFiltersChange = vi.fn();
  const options: FilterOptions = {
    ...GA_OPTIONS,
    targets: [
      { address: '0/1/2' },
      { address: '1/0/1', name: 'Licht Flur' },
    ],
  };
  render(
    <FilterPanel options={options} activeFilters={DEFAULT_FILTERS} onFiltersChange={onFiltersChange} projectLoaded writeEnabled />
  );
  fireEvent.click(screen.getByRole('button', { name: /^Focus/ }));
  expect(screen.getByRole('button', { name: 'Targets' })).toHaveAttribute('aria-pressed', 'true');

  const addresses = () => [...document.querySelectorAll('[data-focus-address]')].map(el => el.getAttribute('data-focus-address'));
  const row = (address: string) => document.querySelector(`[data-focus-address="${address}"]`) as HTMLElement;
  expect(addresses()).toEqual(['0/1/2', '1/0/1']);
  const nameSlot = (address: string) => row(address).querySelector('[data-focus-name]') as HTMLElement;
  expect(nameSlot('0/1/2').style.height).toBe('0.85rem');
  expect(nameSlot('1/0/1').style.height).toBe(nameSlot('0/1/2').style.height);
  expect(screen.queryByRole('separator')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('checkbox', { name: 'Focus 1/0/1' }));
  expect(addresses()).toEqual(['1/0/1', '0/1/2']);
  const separator = screen.getByRole('separator');
  expect(separator.style.height).toBe('2px');
  expect(separator.style.background).toBe('var(--text-dim)');
  expect(separator.parentElement!.style.height).toBe('0px');
  const quick = within(row('0/1/2')).getByRole('button', { name: 'Focus filter' });
  expect(quick).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(quick);
  expect(onFiltersChange).not.toHaveBeenCalled();
  expect(quick).toHaveAttribute('aria-pressed', 'true');
  expect(within(row('0/1/2')).getByRole('button', { name: 'Send to this GA' })).toBeInTheDocument();
  expect(within(row('0/1/2')).getByRole('button', { name: 'Visualize this GA' })).toHaveAttribute('aria-pressed', 'false');
  expect(within(row('0/1/2')).getByRole('button', { name: 'Colour of 0/1/2' })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Sources' }));
  expect(screen.getByRole('textbox', { name: 'Search devices' })).toBeInTheDocument();
  expect(screen.getByText('1.2.3')).toBeInTheDocument();
  expect(screen.queryByText('0/1/2')).not.toBeInTheDocument();
  const deviceQuick = screen.getByRole('button', { name: 'Focus filter' });
  fireEvent.click(deviceQuick);
  expect(onFiltersChange).not.toHaveBeenCalled();
  expect(deviceQuick).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByRole('button', { name: 'Send to this GA' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Colour of 1.2.3' })).toHaveAttribute(
    'title',
    'Mark telegrams from this device with a colour · ctrl-click clears the selected rows',
  );
  expect(screen.getByRole('button', { name: 'Toggle last seen values' })).toBeInTheDocument();
});

test('Focus search filters live, Compact shows only focused rows, and Reset clears pins and the search', () => {
  const onFocusGasChange = vi.fn();
  const onFocusGaSearchChange = vi.fn();
  const onFocusGaCompactChange = vi.fn();
  const onFocusGaVerdichtenChange = vi.fn();
  const options: FilterOptions = {
    ...EMPTY_OPTIONS,
    targets: [
      { address: '0/1/2', name: 'Licht Küche' },
      { address: '1/0/1', name: 'Licht Flur' },
      { address: '2/0/1', name: 'Rollladen' },
    ],
  };
  const counts = { sources: {}, targets: { '0/1/2': 4, '1/0/1': 0 }, types: {}, directions: {}, dpts: {} };
  const panel = (focusGas: string[], search = '', compact = false, verdichten = false) => (
    <FilterPanel
      options={options}
      activeFilters={DEFAULT_FILTERS}
      onFiltersChange={() => {}}
      counts={counts}
      projectLoaded
      focusGas={focusGas}
      onFocusGasChange={onFocusGasChange}
      focusGaSearch={search}
      onFocusGaSearchChange={onFocusGaSearchChange}
      focusGaCompact={compact}
      onFocusGaCompactChange={onFocusGaCompactChange}
      focusGaVerdichten={verdichten}
      onFocusGaVerdichtenChange={onFocusGaVerdichtenChange}
    />
  );
  const addresses = () => [...document.querySelectorAll('[data-focus-address]')].map(el => el.getAttribute('data-focus-address'));
  const { rerender } = render(panel(['0/1/2', '1/0/1']));
  fireEvent.click(screen.getByRole('button', { name: /^Focus/ }));

  expect(addresses()).toEqual(['0/1/2', '1/0/1', '2/0/1']);
  expect(within(document.querySelector('[data-focus-address="0/1/2"]') as HTMLElement).getByTitle('Telegrams')).toHaveTextContent('4');
  expect(within(document.querySelector('[data-focus-address="1/0/1"]') as HTMLElement).getByTitle('Telegrams')).toHaveTextContent('0');
  expect(within(document.querySelector('[data-focus-address="2/0/1"]') as HTMLElement).queryByTitle('Telegrams')).not.toBeInTheDocument();

  fireEvent.change(screen.getByRole('textbox', { name: 'Search group addresses' }), { target: { value: 'flur' } });
  expect(onFocusGaSearchChange).toHaveBeenCalledWith('flur');
  rerender(panel(['0/1/2', '1/0/1'], 'flur'));
  expect(addresses()).toEqual(['1/0/1']);

  rerender(panel(['0/1/2', '1/0/1']));
  fireEvent.click(screen.getByRole('button', { name: 'Compact' }));
  expect(onFocusGaCompactChange).toHaveBeenCalledWith(true);
  rerender(panel(['0/1/2', '1/0/1'], '', true));
  // Focused rows stay even when their telegram count is 0; unfocused rows go.
  expect(addresses()).toEqual(['0/1/2', '1/0/1']);

  rerender(panel(['0/1/2', '1/0/1'], '', true, true));
  fireEvent.change(screen.getByRole('textbox', { name: 'Search group addresses' }), { target: { value: 'küche' } });
  fireEvent.click(screen.getByRole('button', { name: 'Reset targets' }));
  expect(onFocusGasChange).toHaveBeenCalledWith([]);
  expect(onFocusGaSearchChange).toHaveBeenLastCalledWith('');
  expect(onFocusGaCompactChange).toHaveBeenLastCalledWith(false);
  expect(onFocusGaVerdichtenChange).toHaveBeenCalledWith(false);
});

test('a list reset leaves the other list, and Reset focus clears both without switching tabs', () => {
  resetTargetColors();
  setTargetColor('0/1/2', TARGET_COLORS[0]);
  setTargetColor('1.2.3', TARGET_COLORS[1]);
  const onFocusGasChange = vi.fn();
  const onFocusDevicesChange = vi.fn();
  const onFocusGaSearchChange = vi.fn();
  const onFocusDeviceSearchChange = vi.fn();
  const onFocusFilterGasChange = vi.fn();
  const onFocusFilterDevicesChange = vi.fn();
  const onLastSeenGasChange = vi.fn();
  const onLastSeenDevicesChange = vi.fn();
  const onFocusTabChange = vi.fn();
  const onPanelViewChange = vi.fn();
  const panel = (focusTab: 'ga' | 'pa') => (
    <FilterPanel
      options={GA_OPTIONS}
      activeFilters={DEFAULT_FILTERS}
      onFiltersChange={() => {}}
      projectLoaded
      panelView="focus"
      onPanelViewChange={onPanelViewChange}
      focusTab={focusTab}
      onFocusTabChange={onFocusTabChange}
      focusGas={['0/1/2']}
      onFocusGasChange={onFocusGasChange}
      focusDevices={['1.2.3']}
      onFocusDevicesChange={onFocusDevicesChange}
      focusGaSearch="licht"
      onFocusGaSearchChange={onFocusGaSearchChange}
      focusDeviceSearch="taster"
      onFocusDeviceSearchChange={onFocusDeviceSearchChange}
      focusFilterGas={['0/1/2']}
      onFocusFilterGasChange={onFocusFilterGasChange}
      focusFilterDevices={['1.2.3']}
      onFocusFilterDevicesChange={onFocusFilterDevicesChange}
      lastSeenGas={['0/1/2']}
      onLastSeenGasChange={onLastSeenGasChange}
      lastSeenDevices={['1.2.3']}
      onLastSeenDevicesChange={onLastSeenDevicesChange}
    />
  );
  const { rerender } = render(panel('ga'));

  expect(screen.queryByRole('button', { name: 'Reset sources' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Reset targets' }));
  expect(onFocusTabChange).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Targets' })).toHaveAttribute('aria-pressed', 'true');
  expect(onFocusGasChange).toHaveBeenCalledWith([]);
  expect(onFocusGaSearchChange).toHaveBeenCalledWith('');
  expect(onFocusFilterGasChange).toHaveBeenCalledWith([]);
  expect(onLastSeenGasChange).toHaveBeenCalledWith([]);
  expect(onFocusDevicesChange).not.toHaveBeenCalled();
  expect(onFocusDeviceSearchChange).not.toHaveBeenCalled();
  expect(onFocusFilterDevicesChange).not.toHaveBeenCalled();
  expect(onLastSeenDevicesChange).not.toHaveBeenCalled();
  expect(renderHook(() => useTargetColors()).result.current).toEqual({ '1.2.3': TARGET_COLORS[1] });

  rerender(panel('pa'));
  expect(screen.queryByRole('button', { name: 'Reset targets' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Reset sources' }));
  expect(onFocusDevicesChange).toHaveBeenCalledWith([]);
  expect(onFocusDeviceSearchChange).toHaveBeenCalledWith('');
  expect(onFocusFilterDevicesChange).toHaveBeenCalledWith([]);
  expect(onLastSeenDevicesChange).toHaveBeenCalledWith([]);
  expect(renderHook(() => useTargetColors()).result.current).toEqual({});
  expect(onFocusTabChange).not.toHaveBeenCalled();

  onFocusGasChange.mockClear();
  onFocusDevicesChange.mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'Reset focus' }));
  expect(onFocusGasChange).toHaveBeenCalledWith([]);
  expect(onFocusDevicesChange).toHaveBeenCalledWith([]);
  expect(onFocusTabChange).not.toHaveBeenCalled();
  expect(onPanelViewChange).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Focus' })).toHaveAttribute('aria-pressed', 'true');
});
