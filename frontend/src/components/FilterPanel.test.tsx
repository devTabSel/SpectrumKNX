import { render, screen, fireEvent } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { FilterPanel } from './FilterPanel';
import { DEFAULT_FILTERS, type FilterOptions } from '../types/filters';

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

// ── Quick actions on active filter rows (#214) ───────────────────────────────

const GA_OPTIONS: FilterOptions = {
  ...EMPTY_OPTIONS,
  sources: [{ address: '1.2.3', name: 'Taster EG' }],
  targets: [{ address: '0/1/2', name: 'Licht Küche', main: 1, sub: 1 }],
};
const ACTIVE = { ...DEFAULT_FILTERS, sources: ['1.2.3'], targets: ['0/1/2'] };

test('Group Addresses rows offer a borderless send-to-GA action plus all three toggles; Devices rows omit send/visualize (#406)', () => {
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

  // Switch to Devices (sources): no send/visualize, but list/last-seen remain.
  fireEvent.click(screen.getByRole('button', { name: 'Devices' }));
  expect(screen.queryByTitle('send to this GA')).not.toBeInTheDocument();
  expect(screen.queryByTitle('Mark for Visualization')).not.toBeInTheDocument();
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

  fireEvent.click(screen.getByTitle('Hide entries with no matching telegrams'));
  expect(screen.getByText('0/1/1')).toBeInTheDocument();
  expect(screen.queryByText('0/1/2')).not.toBeInTheDocument();

  fireEvent.click(screen.getByTitle('Show all entries'));
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

test('renders each toggle in its own dedicated action column', () => {
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

  const listWrapper = screen.getByTitle('Mark for the Telegram List').closest('[data-action-column="list"]');
  const visualizeWrapper = screen.getByTitle('Mark for Visualization').closest('[data-action-column="visualize"]');
  const lastSeenWrapper = screen.getByTitle('Mark for Last Seen Values').closest('[data-action-column="lastSeen"]');

  expect(listWrapper).toHaveStyle({ gridColumn: '3' });
  expect(visualizeWrapper).toHaveStyle({ gridColumn: '4' });
  expect(lastSeenWrapper).toHaveStyle({ gridColumn: '5' });
});

test('Devices rows offer Telegram List/Last Seen toggles but no Visualization toggle', () => {
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
  expect(screen.getByTitle('Mark for Last Seen Values')).toBeInTheDocument();
  expect(screen.queryByTitle('Mark for Visualization')).not.toBeInTheDocument();
});

// ── Only the checkbox pins/unpins a row (#405) ───────────────────────────────

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


