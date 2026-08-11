import { render, screen, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import { beforeEach, expect, test, vi } from 'vitest';
import { FilterPanel } from './FilterPanel';
import { DEFAULT_FILTERS, type FilterOptions } from '../types/filters';

const EMPTY_OPTIONS: FilterOptions = {
  sources: [], targets: [], types: ['Write', 'Read', 'Response'], dpts: [],
  ga_group_names: {}, pa_line_names: {},
};

beforeEach(() => {
  localStorage.clear();
});

test('shows the no-project notice and CTA when no project is loaded', () => {
  const onUploadProject = vi.fn();
  render(
    <FilterPanel
      options={EMPTY_OPTIONS}
      activeFilters={DEFAULT_FILTERS}
      onFiltersChange={() => {}}
      mode="history"
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
      mode="history"
    />
  );
  expect(screen.queryByText(/No ETS project loaded/i)).not.toBeInTheDocument();
});

test('reserves scrollbar gutter so the focus panel keeps a stable geometry', () => {
  const { container } = render(
    <FilterPanel
      options={GA_OPTIONS}
      activeFilters={ACTIVE}
      onFiltersChange={() => {}}
      mode="live"
      projectLoaded={true}
    />
  );

  const scrollContainer = container.querySelector('div[style*="overflow-y: auto"]') as HTMLElement | null;
  expect(scrollContainer).not.toBeNull();
  expect(scrollContainer).toHaveStyle({ scrollbarGutter: 'stable' });
});

// ── Quick actions on active filter rows (#214) ───────────────────────────────

const GA_OPTIONS: FilterOptions = {
  ...EMPTY_OPTIONS,
  sources: [{ address: '1.2.3', name: 'Taster EG' }],
  targets: [{ address: '0/1/2', name: 'Licht Küche', main: 1, sub: 1 }],
};
const ACTIVE = { ...DEFAULT_FILTERS, sources: ['1.2.3'], targets: ['0/1/2'] };

test('Group Addresses rows offer a borderless send-to-GA action plus all three toggles; Devices rows omit send but keep all three toggles (#406)', () => {
  render(
    <FilterPanel
      options={GA_OPTIONS}
      activeFilters={ACTIVE}
      onFiltersChange={() => {}}
      mode="live"
      projectLoaded={true}
      writeEnabled={true}
    />
  );

  // Default tab = Group Addresses (targets): send-to-GA plus all three toggles.
  const sendBtn = screen.getByTitle('send to this GA');
  expect(sendBtn).toBeInTheDocument();
  expect(sendBtn.style.borderStyle).toBe('none');
  expect(sendBtn.style.opacity).toBe('0.9'); // pinned, so visible without hovering
  expect(screen.getByTitle('Mark for the Telegram List')).toBeInTheDocument();
  expect(screen.getByTitle('Mark for Visualization')).toBeInTheDocument();
  expect(screen.getByTitle('Mark for Last Seen Values')).toBeInTheDocument();

  // Switch to Devices (sources): no send action, but the three toggles remain.
  fireEvent.click(screen.getByRole('button', { name: 'Devices' }));
  expect(screen.queryByTitle('send to this GA')).not.toBeInTheDocument();
  expect(screen.getByTitle('Mark for Visualization')).toBeInTheDocument();
  expect(screen.getByTitle('Mark for the Telegram List')).toBeInTheDocument();
  expect(screen.getByTitle('Mark for Last Seen Values')).toBeInTheDocument();
});

test('hides the send action on Group Addresses rows when writes are disabled', () => {
  render(
    <FilterPanel
      options={GA_OPTIONS}
      activeFilters={ACTIVE}
      onFiltersChange={() => {}}
      mode="live"
      projectLoaded={true}
      writeEnabled={false}
    />
  );
  expect(screen.queryByTitle('send to this GA')).not.toBeInTheDocument();
  expect(screen.getByTitle('Mark for Last Seen Values')).toBeInTheDocument();
});

test('opens the quick-send popover from a Group Addresses row', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ telegrams: [] }),
  }) as Response));
  render(
    <FilterPanel
      options={GA_OPTIONS}
      activeFilters={ACTIVE}
      onFiltersChange={() => {}}
      mode="live"
      projectLoaded={true}
      writeEnabled={true}
    />
  );
  fireEvent.click(screen.getByTitle('send to this GA'));
  // The popover shows the last value and the write/read controls.
  expect(await screen.findByText(/Last value/)).toBeInTheDocument();
  expect(screen.getByTitle('send a GroupValueRead')).toBeInTheDocument();
  vi.unstubAllGlobals();
});

// ── Group Addresses ↔ Devices tabs + all-AND (#398) ──────────────────────────

test('toggles Group Addresses ↔ Devices tabs and has no AND/OR control', () => {
  render(
    <FilterPanel
      options={GA_OPTIONS}
      activeFilters={ACTIVE}
      onFiltersChange={() => {}}
      mode="live"
      projectLoaded={true}
      writeEnabled={true}
      onQuickLastSeen={() => {}}
    />
  );

  // Default tab = Group Addresses: its own search field is shown, Devices' is not.
  expect(screen.getByPlaceholderText('Search group addresses...')).toBeInTheDocument();
  expect(screen.queryByPlaceholderText('Search devices...')).not.toBeInTheDocument();
  // All filters AND now — no combination control (#275).
  expect(screen.queryByText(/Combine as/i)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'OR' })).not.toBeInTheDocument();

  // Switch to Devices tab: its search field appears, Group Addresses' is gone.
  fireEvent.click(screen.getByRole('button', { name: 'Devices' }));
  expect(screen.getByPlaceholderText('Search devices...')).toBeInTheDocument();
  expect(screen.queryByPlaceholderText('Search group addresses...')).not.toBeInTheDocument();
});


test('hides the notice when a project is loaded', () => {
  render(
    <FilterPanel
      options={EMPTY_OPTIONS}
      activeFilters={DEFAULT_FILTERS}
      onFiltersChange={() => {}}
      mode="live"
      projectLoaded={true}
    />
  );
  expect(screen.queryByText(/No ETS project loaded/i)).not.toBeInTheDocument();
});

// ── Flat, pinned Group Addresses / Devices sections (knx-list-filter parity) ─

const MULTI_OPTIONS: FilterOptions = {
  ...EMPTY_OPTIONS,
  sources: [
    { address: '1.1.1', name: 'Taster EG' },
    { address: '1.1.2', name: 'Taster OG' },
  ],
  targets: [
    { address: '0/1/1', name: 'Licht Küche', main: 1, sub: 1 },
    { address: '0/1/2', name: 'Licht Bad', main: 1, sub: 1 },
  ],
};

test('checking an item pins it to the top of its section, like the reference filter component', () => {
  const onFiltersChange = vi.fn();
  const { rerender } = render(
    <FilterPanel
      options={MULTI_OPTIONS}
      activeFilters={DEFAULT_FILTERS}
      onFiltersChange={onFiltersChange}
      mode="live"
      projectLoaded={true}
    />
  );

  // '0/1/2' sorts after '0/1/1' unselected; checking it should pin it first.
  fireEvent.click(screen.getByRole('checkbox', { name: 'Pin 0/1/2' }));
  expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ targets: ['0/1/2'] }));

  rerender(
    <FilterPanel
      options={MULTI_OPTIONS}
      activeFilters={{ ...DEFAULT_FILTERS, targets: ['0/1/2'] }}
      onFiltersChange={onFiltersChange}
      mode="live"
      projectLoaded={true}
    />
  );

  const addresses = screen.getAllByText(/^0\/1\/\d$/).map(el => el.textContent);
  expect(addresses).toEqual(['0/1/2', '0/1/1']);
});

test('pinning an item while the visualization panel is active keeps the UI responsive', () => {
  const onFiltersChange = vi.fn();
  render(
    <FilterPanel
      options={MULTI_OPTIONS}
      activeFilters={DEFAULT_FILTERS}
      onFiltersChange={onFiltersChange}
      mode="live"
      projectLoaded={true}
      activeMainPanel="visualizer"
    />
  );

  expect(() => fireEvent.click(screen.getByRole('checkbox', { name: 'Pin 0/1/2' }))).not.toThrow();
  expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ targets: ['0/1/2'] }));
});

test('pinning an item while the visualization panel is active does not auto-sync the visualization flag without ctrl-click', () => {
  const Harness = () => {
    const [activeFilters, setActiveFilters] = useState(DEFAULT_FILTERS);
    const [visualizationFlaggedAddresses, setVisualizationFlaggedAddresses] = useState<string[]>([]);
    return (
      <FilterPanel
        options={MULTI_OPTIONS}
        activeFilters={activeFilters}
        onFiltersChange={setActiveFilters}
        mode="live"
        projectLoaded={true}
        activeMainPanel="visualizer"
        visualizationFlaggedAddresses={visualizationFlaggedAddresses}
        onVisualizationFlaggedAddressesChange={setVisualizationFlaggedAddresses}
      />
    );
  };

  render(<Harness />);

  fireEvent.click(screen.getByRole('checkbox', { name: 'Pin 0/1/2' }));

  expect(screen.queryByTitle('Unmark for Visualization')).not.toBeInTheDocument();
  expect(screen.getAllByTitle('Mark for Visualization')).toHaveLength(2);
});

// ── Compress toggle: hides zero-count entries (#400) ─────────────────────────

test('the compress toggle hides entries whose live count badge reads "0"', () => {
  render(
    <FilterPanel
      options={MULTI_OPTIONS}
      activeFilters={DEFAULT_FILTERS}
      onFiltersChange={() => {}}
      mode="live"
      projectLoaded={true}
      counts={{
        sources: {}, targets: { '0/1/1': 3, '0/1/2': 0 }, types: {}, directions: {}, dpts: {},
      }}
    />
  );

  expect(screen.getByText('0/1/1')).toBeInTheDocument();
  expect(screen.getByText('0/1/2')).toBeInTheDocument();

  fireEvent.click(screen.getByTitle('Show only entries with a non-zero badge count'));
  expect(screen.getByText('0/1/1')).toBeInTheDocument();
  expect(screen.queryByText('0/1/2')).not.toBeInTheDocument();

  fireEvent.click(screen.getByTitle('Show all entries'));
  expect(screen.getByText('0/1/2')).toBeInTheDocument();
});

test('the compress toggle keeps entries visible while the badge counts are still loading', () => {
  render(
    <FilterPanel
      options={MULTI_OPTIONS}
      activeFilters={DEFAULT_FILTERS}
      onFiltersChange={() => {}}
      mode="live"
      projectLoaded={true}
    />
  );

  expect(screen.getByText('0/1/1')).toBeInTheDocument();
  expect(screen.getByText('0/1/2')).toBeInTheDocument();

  fireEvent.click(screen.getByTitle('Show only entries with a non-zero badge count'));

  expect(screen.getByText('0/1/1')).toBeInTheDocument();
  expect(screen.getByText('0/1/2')).toBeInTheDocument();
});

test('show only pinned entries also includes rows with any active flag', () => {
  render(
    <FilterPanel
      options={MULTI_OPTIONS}
      activeFilters={DEFAULT_FILTERS}
      onFiltersChange={() => {}}
      mode="live"
      projectLoaded={true}
      listFlaggedAddresses={['0/1/2']}
    />
  );

  fireEvent.click(screen.getByTitle('Show only pinned entries'));

  expect(screen.getByText('0/1/2')).toBeInTheDocument();
  expect(screen.queryByText('0/1/1')).not.toBeInTheDocument();
});

test('the search field uses the same regex-style matcher as the quick filter', () => {
  render(
    <FilterPanel
      options={MULTI_OPTIONS}
      activeFilters={DEFAULT_FILTERS}
      onFiltersChange={() => {}}
      mode="live"
      projectLoaded={true}
    />
  );

  const input = screen.getByPlaceholderText('Search group addresses...');
  fireEvent.change(input, { target: { value: 'regex:0/1/2|0/1/1' } });

  expect(screen.getByText('0/1/1')).toBeInTheDocument();
  expect(screen.getByText('0/1/2')).toBeInTheDocument();
});

test('the compress toggle only appears in live mode', () => {
  render(
    <FilterPanel
      options={MULTI_OPTIONS}
      activeFilters={DEFAULT_FILTERS}
      onFiltersChange={() => {}}
      mode="history"
      projectLoaded={true}
    />
  );
  expect(screen.queryByTitle('Hide entries with no matching telegrams')).not.toBeInTheDocument();
});

// ── Lifted Group Addresses/Devices tab (#402) ────────────────────────────────

test('a controlled focusMode drives which tab is shown and notifies changes', () => {
  const onFocusModeChange = vi.fn();
  const { rerender } = render(
    <FilterPanel
      options={MULTI_OPTIONS}
      activeFilters={DEFAULT_FILTERS}
      onFiltersChange={() => {}}
      mode="live"
      projectLoaded={true}
      focusMode="pa"
      onFocusModeChange={onFocusModeChange}
    />
  );

  expect(screen.getByPlaceholderText('Search devices...')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Group Addresses' }));
  expect(onFocusModeChange).toHaveBeenCalledWith('ga');

  // The tab only follows the controlled prop, not the internal click, until
  // the caller re-renders with the new value.
  expect(screen.getByPlaceholderText('Search devices...')).toBeInTheDocument();

  rerender(
    <FilterPanel
      options={MULTI_OPTIONS}
      activeFilters={DEFAULT_FILTERS}
      onFiltersChange={() => {}}
      mode="live"
      projectLoaded={true}
      focusMode="ga"
      onFocusModeChange={onFocusModeChange}
    />
  );
  expect(screen.getByPlaceholderText('Search group addresses...')).toBeInTheDocument();
});

// ── Table-like item rows: checkbox/icons/badge span both rows (#404) ────────

test('the Visualization icon updates the controlled visualizer address list', () => {
  const onVisualizationFlaggedAddressesChange = vi.fn();
  render(
    <FilterPanel
      options={GA_OPTIONS}
      activeFilters={ACTIVE}
      onFiltersChange={() => {}}
      mode="live"
      projectLoaded={true}
      visualizationFlaggedAddresses={[]}
      onVisualizationFlaggedAddressesChange={onVisualizationFlaggedAddressesChange}
    />
  );

  fireEvent.click(screen.getByTitle('Mark for Visualization'));
  expect(onVisualizationFlaggedAddressesChange).toHaveBeenCalledWith(['0/1/2']);

  fireEvent.click(screen.getByTitle('Unmark for Visualization'));
  expect(onVisualizationFlaggedAddressesChange).toHaveBeenLastCalledWith([]);
});

test('the Telegram List/Visualization/Last Seen icons are real toggles that flag the item without navigating (#406)', () => {
  const onShowInTelegramList = vi.fn();
  const onVisualizeGAs = vi.fn();
  const onQuickLastSeen = vi.fn();
  render(
    <FilterPanel
      options={GA_OPTIONS}
      activeFilters={ACTIVE}
      onFiltersChange={() => {}}
      mode="live"
      projectLoaded={true}
      onShowInTelegramList={onShowInTelegramList}
      onVisualizeGAs={onVisualizeGAs}
      onQuickLastSeen={onQuickLastSeen}
    />
  );

  const listBtn = screen.getByTitle('Mark for the Telegram List');
  const visualizeBtn = screen.getByTitle('Mark for Visualization');
  const lastSeenBtn = screen.getByTitle('Mark for Last Seen Values');
  expect(listBtn).toHaveAttribute('aria-pressed', 'false');

  fireEvent.click(listBtn);
  fireEvent.click(visualizeBtn);
  fireEvent.click(lastSeenBtn);

  expect(screen.getByTitle('Unmark for the Telegram List')).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByTitle('Unmark for Visualization')).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByTitle('Unmark for Last Seen Values')).toHaveAttribute('aria-pressed', 'true');

  // None of them navigate anywhere yet — that's future work (#406).
  expect(onShowInTelegramList).not.toHaveBeenCalled();
  expect(onVisualizeGAs).not.toHaveBeenCalled();
  expect(onQuickLastSeen).not.toHaveBeenCalled();
});

test('renders the three toggle icons in one action column with three sub-columns', () => {
  render(
    <FilterPanel
      options={GA_OPTIONS}
      activeFilters={ACTIVE}
      onFiltersChange={() => {}}
      mode="live"
      projectLoaded={true}
      writeEnabled={true}
    />
  );

  const actionsColumn = screen.getByTitle('Mark for the Telegram List').closest('[data-action-column-group]');
  const listWrapper = screen.getByTitle('Mark for the Telegram List').closest('[data-action-column="list"]');
  const visualizeWrapper = screen.getByTitle('Mark for Visualization').closest('[data-action-column="visualize"]');
  const lastSeenWrapper = screen.getByTitle('Mark for Last Seen Values').closest('[data-action-column="lastSeen"]');

  expect(actionsColumn).toHaveStyle({ gridColumn: '3' });
  expect(listWrapper).toHaveStyle({ gridColumn: '1' });
  expect(visualizeWrapper).toHaveStyle({ gridColumn: '2' });
  expect(lastSeenWrapper).toHaveStyle({ gridColumn: '3' });
});

test('the header toggle icons keep the same grid columns for both focus categories', () => {
  render(
    <FilterPanel
      options={GA_OPTIONS}
      activeFilters={ACTIVE}
      onFiltersChange={() => {}}
      mode="live"
      projectLoaded={true}
      writeEnabled={true}
    />
  );

  // Group Addresses tab: the three existing header icons keep their shifted columns 2/3/4.
  expect(screen.getByTitle('No entries marked for the Telegram List')).toHaveStyle({ gridColumn: '2' });
  expect(screen.getByTitle('No entries marked for Visualization')).toHaveStyle({ gridColumn: '3' });
  expect(screen.getByTitle('No entries marked for Last Seen Values')).toHaveStyle({ gridColumn: '4' });

  // Devices tab now also exposes the Visualization header icon at the same column.
  fireEvent.click(screen.getByRole('button', { name: 'Devices' }));
  expect(screen.getByTitle('No entries marked for the Telegram List')).toHaveStyle({ gridColumn: '2' });
  expect(screen.getByTitle('No entries marked for Visualization')).toHaveStyle({ gridColumn: '3' });
  expect(screen.getByTitle('No entries marked for Last Seen Values')).toHaveStyle({ gridColumn: '4' });
});

test('offers a pin header toggle and stretches the search field to the action area', () => {
  const multiOptions: FilterOptions = {
    ...GA_OPTIONS,
    targets: [
      { address: '0/1/2', name: 'Licht Küche', main: 1, sub: 1 },
      { address: '0/1/3', name: 'Licht Bad', main: 1, sub: 1 },
    ],
  };

  render(
    <FilterPanel
      options={multiOptions}
      activeFilters={{ ...ACTIVE, targets: ['0/1/2'] }}
      onFiltersChange={() => {}}
      mode="live"
      projectLoaded={true}
      writeEnabled={true}
    />
  );

  const pinToggle = screen.getByTitle('Show only pinned entries');
  expect(pinToggle).toBeInTheDocument();
  expect(pinToggle).toHaveAttribute('aria-pressed', 'false');

  fireEvent.click(pinToggle);

  expect(screen.getByText('0/1/2')).toBeInTheDocument();
  expect(screen.queryByText('0/1/3')).not.toBeInTheDocument();
  expect(pinToggle).toHaveAttribute('aria-pressed', 'true');

  const searchContainer = screen.getByPlaceholderText('Search group addresses...').closest('div')?.parentElement;
  expect(searchContainer).toHaveStyle({ flex: '1' });
});

test('compact filter buttons are disabled when no matching flagged item exists', () => {
  const { rerender } = render(
    <FilterPanel
      options={GA_OPTIONS}
      activeFilters={ACTIVE}
      onFiltersChange={() => {}}
      mode="live"
      projectLoaded={true}
      writeEnabled={true}
      listFlaggedAddresses={[]}
    />
  );

  const listButton = screen.getByTitle('No entries marked for the Telegram List');
  expect(listButton).toBeDisabled();
  expect(listButton).toHaveAttribute('aria-pressed', 'false');

  rerender(
    <FilterPanel
      options={GA_OPTIONS}
      activeFilters={ACTIVE}
      onFiltersChange={() => {}}
      mode="live"
      projectLoaded={true}
      writeEnabled={true}
      listFlaggedAddresses={['0/1/2']}
    />
  );

  const enabledListButton = screen.getByTitle('Show only entries marked for the Telegram List');
  expect(enabledListButton).toBeEnabled();
  expect(enabledListButton).toHaveAttribute('aria-pressed', 'false');
});

test('compact list mode shows flagged entries before unflagged ones without hiding the unflagged entries', () => {
  render(
    <FilterPanel
      options={MULTI_OPTIONS}
      activeFilters={ACTIVE}
      onFiltersChange={() => {}}
      mode="live"
      projectLoaded={true}
      writeEnabled={true}
      listFlaggedAddresses={['0/1/2']}
    />
  );

  fireEvent.click(screen.getByTitle('Show only entries marked for the Telegram List'));

  const addresses = screen.getAllByText(/^0\/1\/\d$/).map(el => el.textContent);
  expect(addresses).toEqual(['0/1/2', '0/1/1']);
});

test('compact mode toggles stay active after the focus panel is remounted', () => {
  const Harness = () => {
    const [visible, setVisible] = useState(true);
    return (
      <>
        <button onClick={() => setVisible(v => !v)}>toggle panel</button>
        {visible ? (
          <FilterPanel
            options={MULTI_OPTIONS}
            activeFilters={ACTIVE}
            onFiltersChange={() => {}}
            mode="live"
            projectLoaded={true}
            writeEnabled={true}
            listFlaggedAddresses={['0/1/2']}
          />
        ) : null}
      </>
    );
  };

  render(<Harness />);

  fireEvent.click(screen.getByTitle('Show only entries marked for the Telegram List'));
  fireEvent.click(screen.getByRole('button', { name: 'toggle panel' }));
  fireEvent.click(screen.getByRole('button', { name: 'toggle panel' }));

  expect(screen.getByTitle('Show all entries')).toHaveAttribute('aria-pressed', 'true');
});

test('badge compact toggles in one category stay independent from each other', () => {
  const multiOptions: FilterOptions = {
    ...GA_OPTIONS,
    targets: [
      { address: '0/1/2', name: 'Licht Küche', main: 1, sub: 1 },
      { address: '0/1/3', name: 'Licht Bad', main: 1, sub: 1 },
    ],
    sources: [
      { address: '1.1.1', name: 'Steuergerät', main: 0, sub: 0 },
      { address: '1.1.2', name: 'Fernsensor', main: 0, sub: 0 },
    ],
  };

  render(
    <FilterPanel
      options={multiOptions}
      activeFilters={ACTIVE}
      onFiltersChange={() => {}}
      mode="live"
      projectLoaded={true}
      writeEnabled={true}
      listFlaggedAddresses={['0/1/2']}
      visualizationFlaggedAddresses={['0/1/3']}
    />
  );

  fireEvent.click(screen.getByTitle('Show only entries marked for the Telegram List'));
  expect(screen.getAllByTitle('Show all entries')).toHaveLength(1);

  fireEvent.click(screen.getByTitle('Show only entries marked for Visualization'));
  expect(screen.getAllByTitle('Show all entries')).toHaveLength(2);
});

test('devices badge filter shows either all project devices or only source-backed ones', () => {
  const deviceOptions: FilterOptions = {
    ...GA_OPTIONS,
    sources: [
      { address: '1.1.1', name: 'Steuergerät', main: 0, sub: 0 },
      { address: '1.1.2', name: 'Fernsensor', main: 0, sub: 0 },
      { address: '1.1.3', name: 'Bewegung', main: 0, sub: 0 },
    ],
  };

  render(
    <FilterPanel
      options={deviceOptions}
      activeFilters={{ ...ACTIVE, sources: ['1.1.1', '1.1.2', '1.1.3'] }}
      onFiltersChange={() => {}}
      mode="live"
      projectLoaded={true}
      writeEnabled={true}
      focusMode="pa"
      counts={{
        sources: { '1.1.1': 2, '1.1.3': 1 },
        targets: {},
        types: {},
        directions: {},
        dpts: {},
      }}
    />
  );

  expect(screen.getByText('1.1.1')).toBeInTheDocument();
  expect(screen.getByText('1.1.2')).toBeInTheDocument();
  expect(screen.getByText('1.1.3')).toBeInTheDocument();

  fireEvent.click(screen.getByTitle('Show only entries with a non-zero badge count'));

  expect(screen.getByText('1.1.1')).toBeInTheDocument();
  expect(screen.queryByText('1.1.2')).not.toBeInTheDocument();
  expect(screen.getByText('1.1.3')).toBeInTheDocument();

  fireEvent.click(screen.getByTitle('Show all entries'));

  expect(screen.getByText('1.1.1')).toBeInTheDocument();
  expect(screen.getByText('1.1.2')).toBeInTheDocument();
  expect(screen.getByText('1.1.3')).toBeInTheDocument();
});

test('reset restores the focus panel to its initial state and clears the telegram table focus filters', () => {
  const onResetFocusPanel = vi.fn();
  const Harness = () => {
    const [listFlaggedAddresses, setListFlaggedAddresses] = useState<string[]>(['0/1/2']);
    const [visualizationFlaggedAddresses, setVisualizationFlaggedAddresses] = useState<string[]>(['0/1/3']);
    const [activeFilterTargets, setActiveFilterTargets] = useState<string[]>(['0/1/2']);
    const [searchValue, setSearchValue] = useState('0/1/2');

    return (
      <>
        <input aria-label="search-trigger" value={searchValue} onChange={e => setSearchValue(e.target.value)} />
        <FilterPanel
          options={MULTI_OPTIONS}
          activeFilters={{ ...ACTIVE, targets: activeFilterTargets }}
          onFiltersChange={() => {}}
          mode="live"
          projectLoaded={true}
          writeEnabled={true}
          listFlaggedAddresses={listFlaggedAddresses}
          visualizationFlaggedAddresses={visualizationFlaggedAddresses}
          onListFlaggedAddressesChange={setListFlaggedAddresses}
          onVisualizationFlaggedAddressesChange={setVisualizationFlaggedAddresses}
          onResetFocusPanel={() => {
            setListFlaggedAddresses([]);
            setVisualizationFlaggedAddresses([]);
            setActiveFilterTargets([]);
            setSearchValue('');
            onResetFocusPanel();
          }}
        />
      </>
    );
  };

  render(<Harness />);

  const searchInput = screen.getByPlaceholderText('Search group addresses...');
  fireEvent.change(searchInput, { target: { value: '0/1/2' } });
  expect(searchInput).toHaveValue('0/1/2');

  fireEvent.click(screen.getByTitle('Reset Focus panel'));

  expect(onResetFocusPanel).toHaveBeenCalledTimes(1);
  expect(screen.getByPlaceholderText('Search group addresses...')).toHaveValue('');
  expect(screen.getAllByTitle('Mark for the Telegram List')).toHaveLength(2);
  expect(screen.getAllByTitle('Mark for Visualization')).toHaveLength(2);
});

test('reset clears the pinned focus selection so rows return to the unpinned initial state', () => {
  const Harness = () => {
    const [filters, setFilters] = useState({
      ...ACTIVE,
      targets: ['0/1/2'],
    });

    return (
      <FilterPanel
        options={GA_OPTIONS}
        activeFilters={filters}
        onFiltersChange={next => setFilters(prev => ({ ...prev, ...next }))}
        mode="live"
        projectLoaded={true}
        writeEnabled={true}
      />
    );
  };

  render(<Harness />);

  expect(screen.getByRole('checkbox', { name: 'Pin 0/1/2' })).toBeChecked();

  fireEvent.click(screen.getByTitle('Reset Focus panel'));

  expect(screen.getByRole('checkbox', { name: 'Pin 0/1/2' })).not.toBeChecked();
});

test('compact mode is tracked separately per focus category and survives category switches', () => {
  const multiOptions: FilterOptions = {
    ...GA_OPTIONS,
    targets: [
      { address: '0/1/2', name: 'Licht Küche', main: 1, sub: 1 },
      { address: '0/1/3', name: 'Licht Bad', main: 1, sub: 1 },
    ],
    sources: [
      { address: '1.1.1', name: 'Steuergerät', main: 0, sub: 0 },
      { address: '1.1.2', name: 'Fernsensor', main: 0, sub: 0 },
    ],
  };

  const Harness = () => {
    const [focusMode, setFocusMode] = useState<'ga' | 'pa'>('ga');
    return (
      <FilterPanel
        options={multiOptions}
        activeFilters={ACTIVE}
        onFiltersChange={() => {}}
        mode="live"
        projectLoaded={true}
        writeEnabled={true}
        focusMode={focusMode}
        onFocusModeChange={setFocusMode}
        listFlaggedAddresses={['0/1/2']}
      />
    );
  };

  render(<Harness />);

  fireEvent.click(screen.getByTitle('Show only entries marked for the Telegram List'));
  expect(screen.getByTitle('Show all entries')).toHaveAttribute('aria-pressed', 'true');

  fireEvent.click(screen.getByRole('button', { name: 'Devices' }));
  expect(screen.getByTitle('No entries marked for the Telegram List')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Group Addresses' }));
  expect(screen.getByTitle('Show all entries')).toHaveAttribute('aria-pressed', 'true');
});

test('ctrl-clicking rows and toggling an action applies it to every selected row', () => {
  const multiOptions: FilterOptions = {
    ...GA_OPTIONS,
    targets: [
      { address: '0/1/2', name: 'Licht Küche', main: 1, sub: 1 },
      { address: '0/1/3', name: 'Licht Bad', main: 1, sub: 1 },
    ],
  };
  render(
    <FilterPanel
      options={multiOptions}
      activeFilters={{ ...ACTIVE, targets: ['0/1/2'] }}
      onFiltersChange={() => {}}
      mode="live"
      projectLoaded={true}
      writeEnabled={true}
    />
  );

  const firstRow = screen.getByText('0/1/2').closest('[data-address]');
  const secondRow = screen.getByText('0/1/3').closest('[data-address]');

  fireEvent.click(firstRow!);
  fireEvent.click(secondRow!, { ctrlKey: true });

  fireEvent.click(screen.getAllByTitle('Mark for the Telegram List')[0]);

  const activeListButtons = screen.getAllByTitle('Unmark for the Telegram List');
  expect(activeListButtons).toHaveLength(2);
  expect(activeListButtons.every(button => button.getAttribute('aria-pressed') === 'true')).toBe(true);
});

test('shift-clicking rows selects the visible range between the anchor and the clicked row', () => {
  const onListFlaggedAddressesChange = vi.fn();
  const multiOptions: FilterOptions = {
    ...GA_OPTIONS,
    targets: [
      { address: '0/1/1', name: 'Licht EG', main: 1, sub: 1 },
      { address: '0/1/2', name: 'Licht Küche', main: 1, sub: 1 },
      { address: '0/1/3', name: 'Licht Bad', main: 1, sub: 1 },
    ],
  };

  render(
    <FilterPanel
      options={multiOptions}
      activeFilters={{ ...ACTIVE, targets: ['0/1/3'] }}
      onFiltersChange={() => {}}
      mode="live"
      projectLoaded={true}
      writeEnabled={true}
      listFlaggedAddresses={[]}
      onListFlaggedAddressesChange={onListFlaggedAddressesChange}
    />
  );

  const anchorRow = screen.getByText('0/1/3').closest('[data-address]');
  const targetRow = screen.getByText('0/1/1').closest('[data-address]');

  fireEvent.click(anchorRow!);
  fireEvent.click(targetRow!, { shiftKey: true });
  fireEvent.click(screen.getAllByTitle('Mark for the Telegram List')[0]);

  expect(onListFlaggedAddressesChange).toHaveBeenCalledWith(expect.arrayContaining(['0/1/3', '0/1/1']));
  expect(onListFlaggedAddressesChange).toHaveBeenCalledWith(expect.not.arrayContaining(['0/1/2']));
});

test('ctrl-shift-clicking adds a second disjoint range to the existing selection', () => {
  const onListFlaggedAddressesChange = vi.fn();
  const multiOptions: FilterOptions = {
    ...GA_OPTIONS,
    targets: [
      { address: '0/1/1', name: 'A', main: 1, sub: 1 },
      { address: '0/1/2', name: 'B', main: 1, sub: 1 },
      { address: '0/1/3', name: 'C', main: 1, sub: 1 },
      { address: '0/1/4', name: 'D', main: 1, sub: 1 },
      { address: '0/1/5', name: 'E', main: 1, sub: 1 },
    ],
  };

  render(
    <FilterPanel
      options={multiOptions}
      activeFilters={DEFAULT_FILTERS}
      onFiltersChange={() => {}}
      mode="live"
      projectLoaded={true}
      writeEnabled={true}
      listFlaggedAddresses={[]}
      onListFlaggedAddressesChange={onListFlaggedAddressesChange}
    />
  );

  const row = (address: string) => screen.getByText(address).closest('[data-address]')!;

  // First range: 0/1/1..0/1/2 via a plain shift-click.
  fireEvent.click(row('0/1/1'));
  fireEvent.click(row('0/1/2'), { shiftKey: true });
  // Second, disjoint range: ctrl-click a new anchor, then ctrl-shift-click to extend it.
  fireEvent.click(row('0/1/4'), { ctrlKey: true });
  fireEvent.click(row('0/1/5'), { ctrlKey: true, shiftKey: true });

  fireEvent.click(screen.getAllByTitle('Mark for the Telegram List')[0]);

  expect(onListFlaggedAddressesChange).toHaveBeenCalledWith(expect.arrayContaining(['0/1/1', '0/1/2', '0/1/4', '0/1/5']));
  expect(onListFlaggedAddressesChange).toHaveBeenCalledWith(expect.not.arrayContaining(['0/1/3']));
});

test('Devices rows offer Telegram List/Visualization/Last Seen toggles', () => {
  render(
    <FilterPanel
      options={GA_OPTIONS}
      activeFilters={ACTIVE}
      onFiltersChange={() => {}}
      mode="live"
      projectLoaded={true}
    />
  );

  fireEvent.click(screen.getByRole('button', { name: 'Devices' }));
  expect(screen.getByTitle('Mark for the Telegram List')).toBeInTheDocument();
  expect(screen.getByTitle('Mark for Visualization')).toBeInTheDocument();
  expect(screen.getByTitle('Mark for Last Seen Values')).toBeInTheDocument();
});

test('switching the active main panel does not mutate the flag state of pinned rows', () => {
  const onListFlaggedAddressesChange = vi.fn();
  const multiOptions: FilterOptions = {
    ...GA_OPTIONS,
    targets: [
      { address: '0/1/2', name: 'Licht Küche', main: 1, sub: 1 },
    ],
  };

  const { rerender } = render(
    <FilterPanel
      options={multiOptions}
      activeFilters={{ ...ACTIVE, sources: [], targets: ['0/1/2'] }}
      onFiltersChange={() => {}}
      mode="live"
      projectLoaded={true}
      writeEnabled={true}
      activeMainPanel="list"
      listFlaggedAddresses={[]}
      onListFlaggedAddressesChange={onListFlaggedAddressesChange}
    />
  );

  expect(onListFlaggedAddressesChange).not.toHaveBeenCalled();

  rerender(
    <FilterPanel
      options={multiOptions}
      activeFilters={{ ...ACTIVE, sources: [], targets: ['0/1/2'] }}
      onFiltersChange={() => {}}
      mode="live"
      projectLoaded={true}
      writeEnabled={true}
      activeMainPanel="visualizer"
      listFlaggedAddresses={['0/1/2']}
      onListFlaggedAddressesChange={onListFlaggedAddressesChange}
    />
  );

  expect(onListFlaggedAddressesChange).not.toHaveBeenCalled();
});

test('manually toggling the Telegram List flag on a non-pinned row survives the active-panel auto-sync (#409)', () => {
  const onListFlaggedAddressesChange = vi.fn();
  const multiOptions: FilterOptions = {
    ...GA_OPTIONS,
    targets: [
      { address: '0/1/2', name: 'Licht Küche', main: 1, sub: 1 },
      { address: '0/1/3', name: 'Licht Bad', main: 1, sub: 1 },
    ],
  };

  const { rerender } = render(
    <FilterPanel
      options={multiOptions}
      activeFilters={{ ...ACTIVE, sources: [], targets: ['0/1/2'] }}
      onFiltersChange={() => {}}
      mode="live"
      projectLoaded={true}
      writeEnabled={true}
      activeMainPanel="list"
      listFlaggedAddresses={[]}
      onListFlaggedAddressesChange={onListFlaggedAddressesChange}
    />
  );

  expect(onListFlaggedAddressesChange).not.toHaveBeenCalled();

  rerender(
    <FilterPanel
      options={multiOptions}
      activeFilters={{ ...ACTIVE, sources: [], targets: ['0/1/2'] }}
      onFiltersChange={() => {}}
      mode="live"
      projectLoaded={true}
      writeEnabled={true}
      activeMainPanel="list"
      listFlaggedAddresses={['0/1/2']}
      onListFlaggedAddressesChange={onListFlaggedAddressesChange}
    />
  );

  // Manually toggle the flag on the non-pinned row (#409 regression: this used
  // to get wiped out immediately by the pin-sync effect).
  const rows = screen.getAllByTitle('Mark for the Telegram List');
  fireEvent.click(rows[0]);

  expect(onListFlaggedAddressesChange).toHaveBeenLastCalledWith(expect.arrayContaining(['0/1/2', '0/1/3']));

  rerender(
    <FilterPanel
      options={multiOptions}
      activeFilters={{ ...ACTIVE, sources: [], targets: ['0/1/2'] }}
      onFiltersChange={() => {}}
      mode="live"
      projectLoaded={true}
      writeEnabled={true}
      activeMainPanel="list"
      listFlaggedAddresses={['0/1/2', '0/1/3']}
      onListFlaggedAddressesChange={onListFlaggedAddressesChange}
    />
  );

  expect(screen.getAllByTitle('Unmark for the Telegram List')).toHaveLength(2);
});

test('ctrl-clicking a checkbox does not auto-delete the active-panel flag for a pinned row', () => {
  const onListFlaggedAddressesChange = vi.fn();
  const multiOptions: FilterOptions = {
    ...GA_OPTIONS,
    targets: [
      { address: '0/1/2', name: 'Licht Küche', main: 1, sub: 1 },
      { address: '0/1/3', name: 'Licht Bad', main: 1, sub: 1 },
    ],
  };

  render(
    <FilterPanel
      options={multiOptions}
      activeFilters={{ ...ACTIVE, sources: [], targets: ['0/1/2'] }}
      onFiltersChange={() => {}}
      mode="live"
      projectLoaded={true}
      writeEnabled={true}
      activeMainPanel="list"
      listFlaggedAddresses={['0/1/2']}
      onListFlaggedAddressesChange={onListFlaggedAddressesChange}
    />
  );

  fireEvent.click(screen.getByRole('checkbox', { name: 'Pin 0/1/2' }), { ctrlKey: true });

  expect(onListFlaggedAddressesChange).toHaveBeenLastCalledWith(['0/1/2']);
});

// ── Only the checkbox pins/unpins a row (#405) ───────────────────────────────

test('clicking the pin checkbox toggles the pin state for all selected rows', () => {
  const onFiltersChange = vi.fn();
  const multiOptions: FilterOptions = {
    ...GA_OPTIONS,
    targets: [
      { address: '0/1/2', name: 'Licht Küche', main: 1, sub: 1 },
      { address: '0/1/3', name: 'Licht Bad', main: 1, sub: 1 },
    ],
  };

  render(
    <FilterPanel
      options={multiOptions}
      activeFilters={{ ...ACTIVE, targets: ['0/1/2'] }}
      onFiltersChange={onFiltersChange}
      mode="live"
      projectLoaded={true}
      writeEnabled={true}
    />
  );

  const firstRow = screen.getByText('0/1/2').closest('[data-address]');
  const secondRow = screen.getByText('0/1/3').closest('[data-address]');

  fireEvent.click(firstRow!);
  fireEvent.click(secondRow!, { ctrlKey: true });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Pin 0/1/2' }));

  expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({
    targets: expect.arrayContaining(['0/1/2', '0/1/3']),
  }));
});

test('clicking the badge, name, or a quick-action icon does not pin/unpin the row', () => {
  const onFiltersChange = vi.fn();
  render(
    <FilterPanel
      options={GA_OPTIONS}
      activeFilters={DEFAULT_FILTERS}
      onFiltersChange={onFiltersChange}
      mode="live"
      projectLoaded={true}
      counts={{
        sources: {}, targets: { '0/1/2': 3 }, types: {}, directions: {}, dpts: {},
      }}
    />
  );

  fireEvent.click(screen.getByText('0/1/2'));
  fireEvent.click(screen.getByText('Licht Küche'));
  fireEvent.click(screen.getByText('3'));
  fireEvent.click(screen.getByTitle('Mark for Last Seen Values'));
  expect(onFiltersChange).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('checkbox', { name: 'Pin 0/1/2' }));
  expect(onFiltersChange).toHaveBeenCalledWith(expect.objectContaining({ targets: ['0/1/2'] }));
});

test('quick-action icons stay visible for a pinned row without hovering', () => {
  render(
    <FilterPanel
      options={GA_OPTIONS}
      activeFilters={ACTIVE}
      onFiltersChange={() => {}}
      mode="live"
      projectLoaded={true}
    />
  );

  expect(screen.getByTitle('Mark for Last Seen Values').style.opacity).toBe('0.9');
});

test('a set flag keeps its icon visible even on an unpinned, unhovered row (#407)', () => {
  render(
    <FilterPanel
      options={GA_OPTIONS}
      activeFilters={DEFAULT_FILTERS}
      onFiltersChange={() => {}}
      mode="live"
      projectLoaded={true}
    />
  );

  const listBtn = screen.getByTitle('Mark for the Telegram List');
  expect(listBtn.style.opacity).toBe('0');

  fireEvent.click(listBtn);
  expect(screen.getByTitle('Unmark for the Telegram List').style.opacity).toBe('0.9');
});

test('the write-to-GA action is hidden on an unpinned row until it is hovered', () => {
  const { container } = render(
    <FilterPanel
      options={GA_OPTIONS}
      activeFilters={DEFAULT_FILTERS}
      onFiltersChange={() => {}}
      mode="live"
      projectLoaded={true}
      writeEnabled={true}
    />
  );

  const sendBtn = screen.getByTitle('send to this GA');
  expect(sendBtn.style.opacity).toBe('0');

  const row = container.querySelector('[role="checkbox"]')!.parentElement!;
  fireEvent.mouseEnter(row);
  expect(sendBtn.style.opacity).toBe('0.9');

  fireEvent.mouseLeave(row);
  expect(sendBtn.style.opacity).toBe('0');
});


