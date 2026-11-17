import { render, screen, fireEvent, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { FilterPanel } from './FilterPanel';
import { DEFAULT_FILTERS, type FilterOptions } from '../types/filters';
import { getPref, setPref } from '../utils/prefs';
import {
  DPT_TREE_EXPANDED_PREF,
  FILTER_SECTION_DIRECTION,
  FILTER_SECTION_TIME_DELTA,
  SOURCE_TREE_EXPANDED_PREF,
  sectionOpenPrefKey,
} from '../utils/filterPanelExpandPref';

beforeEach(() => {
  localStorage.clear();
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

test('the context window is edited in the side panel', () => {
  const onFiltersChange = vi.fn();
  render(
    <FilterPanel
      options={EMPTY_OPTIONS}
      activeFilters={DEFAULT_FILTERS}
      onFiltersChange={onFiltersChange}
      projectLoaded={true}
    />,
  );
  fireEvent.click(screen.getByText('Time-Delta Context'));
  fireEvent.change(screen.getByLabelText('Side-panel context before (ms)'), { target: { value: '400' } });
  expect(onFiltersChange).toHaveBeenCalledWith({ ...DEFAULT_FILTERS, deltaBeforeMs: 400 });
  fireEvent.change(screen.getByLabelText('Side-panel context after (ms)'), { target: { value: '80' } });
  expect(onFiltersChange).toHaveBeenLastCalledWith({ ...DEFAULT_FILTERS, deltaAfterMs: 80 });
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
  fireEvent.click(screen.getByText('Outgoing'));
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

  // Active rows live in the "Active filters" view (#370), not shown by default.
  fireEvent.click(screen.getByRole('button', { name: 'Active filters' }));
  // One send trigger: the active GA target row (sources are PAs — no send).
  expect(screen.getAllByTitle('Send to this GA')).toHaveLength(1);

  const lastSeen = screen.getAllByTitle('Show last seen values');
  expect(lastSeen).toHaveLength(2); // source (PA) + target (GA)
  fireEvent.click(lastSeen[0]);
  expect(onQuickLastSeen).toHaveBeenCalledWith('1.2.3', 'pa');
  fireEvent.click(lastSeen[1]);
  expect(onQuickLastSeen).toHaveBeenCalledWith('0/1/2', 'ga');
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
  fireEvent.click(screen.getByRole('button', { name: 'Active filters' }));
  expect(screen.queryByTitle('Send to this GA')).not.toBeInTheDocument();
  expect(screen.getAllByTitle('Show last seen values')).toHaveLength(2);
});

test('opens the quick-send popover from an active target row', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ telegrams: [] }),
  }) as Response));
  render(
    <FilterPanel
      options={GA_OPTIONS}
      activeFilters={ACTIVE}
      onFiltersChange={() => {}}
      projectLoaded={true}
      writeEnabled={true}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Active filters' }));
  fireEvent.click(screen.getByTitle('Send to this GA'));
  // No telegram yet, so the last-value line stays hidden. The read control shows the popover opened.
  expect(await screen.findByTitle(/Send a GroupValueRead/)).toBeInTheDocument();
  expect(screen.queryByText(/last value/)).not.toBeInTheDocument();
  vi.unstubAllGlobals();
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
  const header = screen.getByText('Filter').parentElement!;

  // Default = Edit view: category sections shown, active rows hidden.
  expect(screen.getByText('Direction')).toBeInTheDocument();
  expect(screen.queryByTitle('Send to this GA')).not.toBeInTheDocument();
  expect(within(header).getByText('2')).toBeInTheDocument();
  // All filters AND now — no combination control (#275).
  expect(screen.queryByText(/Combine as/i)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'OR' })).not.toBeInTheDocument();

  // Switch to Active view: rows appear, category sections gone, badge stays.
  fireEvent.click(screen.getByRole('button', { name: 'Active filters' }));
  expect(screen.getByTitle('Send to this GA')).toBeInTheDocument();
  expect(screen.queryByText('Direction')).not.toBeInTheDocument();
  expect(within(header).getByText('2')).toBeInTheDocument();
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
  fireEvent.click(screen.getByTitle('Disable all filters (keeps them)'));
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
  fireEvent.click(screen.getByTitle('Enable filters'));
  expect(onFiltersEnabledChange).toHaveBeenLastCalledWith(true);

  // Only offered where the owner can act on it.
  rerender(
    <FilterPanel options={GA_OPTIONS} activeFilters={ACTIVE} onFiltersChange={() => {}} projectLoaded={true} />
  );
  expect(screen.queryByTitle(/Disable all filters|Enable filters/)).not.toBeInTheDocument();
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

// ── Switching single active filters off and on (#437) ────────────────────────

test('in the Active view the checkbox switches an entry off, and only the × removes it (#437)', () => {
  const onFiltersChange = vi.fn();
  const { rerender } = render(
    <FilterPanel options={GA_OPTIONS} activeFilters={ACTIVE} onFiltersChange={onFiltersChange} projectLoaded={true} />
  );
  const header = screen.getByText('Filter').parentElement!;
  fireEvent.click(screen.getByRole('button', { name: 'Active filters' }));

  // Ticking the row keeps the selection and marks it switched off.
  fireEvent.click(screen.getByText('0/1/2'));
  expect(onFiltersChange).toHaveBeenLastCalledWith({ ...ACTIVE, disabled: ['targets:0/1/2'] });

  // Shown as still listed, dimmed, and the badge says how many apply.
  const off = { ...ACTIVE, disabled: ['targets:0/1/2'] };
  rerender(<FilterPanel options={GA_OPTIONS} activeFilters={off} onFiltersChange={onFiltersChange} projectLoaded={true} />);
  expect(screen.getByText('0/1/2')).toBeInTheDocument();
  expect(screen.getByText('0/1/2').closest('label')!.style.opacity).toBe('0.5');
  expect(screen.getByText('1.2.3').closest('label')!.style.opacity).toBe('1');
  expect(within(header).getByText('1/2')).toBeInTheDocument();

  // Ticking again switches it back on.
  fireEvent.click(screen.getByText('0/1/2'));
  expect(onFiltersChange).toHaveBeenLastCalledWith({ ...ACTIVE, disabled: [] });

  // The × removes the entry from the set.
  const row = screen.getByText('0/1/2').closest('label')!.parentElement!;
  fireEvent.click(within(row).getByTitle('Remove filter'));
  expect(onFiltersChange).toHaveBeenLastCalledWith(expect.objectContaining({ sources: ['1.2.3'], targets: [] }));
});

const RICH_OPTIONS: FilterOptions = {
  sources: [
    { address: '1.1.1', name: 'Taster' },
    { address: '1.1.2', name: 'Taster 2' },
    { address: '2.1.1', name: 'Other' },
  ],
  targets: [
    { address: '0/1/2', name: 'Licht' },
    { address: '1/0/1', name: 'Szene' },
  ],
  types: ['Write', 'Read', 'Response'],
  dpts: [
    { main: 1, sub: 1, label: 'Switch' },
    { main: 9, sub: 1, label: 'Temperature' },
  ],
  ga_group_names: { '0': 'Zentral', '0/1': 'Lichtgruppe', '1': 'Szenen', '1/0': 'Szenenlinie' },
  pa_line_names: { '1': 'EG', '1.1': 'Wohnen', '2': 'OG', '2.1': 'Schlafen' },
};

const richPanel = () => (
  <FilterPanel
    options={RICH_OPTIONS}
    activeFilters={DEFAULT_FILTERS}
    onFiltersChange={() => {}}
    projectLoaded
  />
);

function expectSidePanelDefaults() {
  expect(screen.getByText('Outgoing')).toBeInTheDocument();
  expect(screen.queryByLabelText('Side-panel context before (ms)')).not.toBeInTheDocument();
  expect(screen.getByText('1.1 — Wohnen')).toBeInTheDocument();
  expect(screen.queryByText('Taster')).not.toBeInTheDocument();
  expect(screen.getByText('2 — OG')).toBeInTheDocument();
}

test('Time-Delta Context is the last side-panel section', () => {
  render(
    <FilterPanel
      options={RICH_OPTIONS}
      activeFilters={DEFAULT_FILTERS}
      onFiltersChange={() => {}}
      projectLoaded={false}
      onUploadProject={() => {}}
    />,
  );

  const order = ['Source', 'Target', 'Type', 'Direction', 'DPT', 'Time-Delta Context'];
  const buttons = order.map(name => screen.getByRole('button', { name }));
  for (let i = 1; i < buttons.length; i++) {
    expect(buttons[i - 1].compareDocumentPosition(buttons[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }

  const delta = buttons[buttons.length - 1];
  expect(delta.parentElement!.parentElement!.lastElementChild).toBe(delta.parentElement);
  const notice = screen.getByText(/No ETS project loaded/i);
  expect(notice.compareDocumentPosition(delta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('a collapsed side-panel section stays collapsed after remount', () => {
  const { unmount } = render(richPanel());
  expect(screen.getByText('Outgoing')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Direction' }));
  expect(screen.queryByText('Outgoing')).not.toBeInTheDocument();
  expect(getPref(sectionOpenPrefKey(FILTER_SECTION_DIRECTION))).toBe('0');

  unmount();
  render(richPanel());
  expect(screen.queryByText('Outgoing')).not.toBeInTheDocument();
  expect(screen.getByText('WRITE')).toBeInTheDocument();
});

test('an expanded address-tree node stays expanded after remount, untouched nodes keep their default', () => {
  const first = render(richPanel());
  expect(screen.queryByText('Taster')).not.toBeInTheDocument();

  fireEvent.click(screen.getByText('1.1 — Wohnen'));
  expect(screen.getByText('Taster')).toBeInTheDocument();

  first.unmount();
  const second = render(richPanel());
  expect(screen.getByText('Taster')).toBeInTheDocument();
  expect(screen.queryByText('Other')).not.toBeInTheDocument();
  expect(screen.getByText('2.1 — Schlafen')).toBeInTheDocument();

  fireEvent.click(screen.getByText('1 — EG'));
  expect(screen.queryByText('1.1 — Wohnen')).not.toBeInTheDocument();

  second.unmount();
  render(richPanel());
  expect(screen.queryByText('1.1 — Wohnen')).not.toBeInTheDocument();
  expect(screen.getByText('2 — OG')).toBeInTheDocument();
});

test('side-panel sections and tree nodes use their defaults when no preference is stored', () => {
  render(richPanel());
  expectSidePanelDefaults();
  expect(getPref(sectionOpenPrefKey(FILTER_SECTION_DIRECTION))).toBeNull();
  expect(getPref(sectionOpenPrefKey(FILTER_SECTION_TIME_DELTA))).toBeNull();
  expect(getPref(SOURCE_TREE_EXPANDED_PREF)).toBeNull();
});

test('a broken side-panel preference falls back to the same defaults', () => {
  setPref(sectionOpenPrefKey(FILTER_SECTION_DIRECTION), 'open');
  setPref(sectionOpenPrefKey(FILTER_SECTION_TIME_DELTA), 'true');
  setPref(SOURCE_TREE_EXPANDED_PREF, '{');
  setPref(DPT_TREE_EXPANDED_PREF, JSON.stringify({ expanded: [1], collapsed: [] }));

  render(richPanel());
  expectSidePanelDefaults();
  fireEvent.click(screen.getByRole('button', { name: 'DPT' }));
  expect(screen.queryByText('Switch')).not.toBeInTheDocument();
});

test('searching options expands DPT groups without saving that expansion', () => {
  const { unmount } = render(richPanel());
  fireEvent.click(screen.getByRole('button', { name: 'DPT' }));
  expect(screen.queryByText('Switch')).not.toBeInTheDocument();

  fireEvent.change(screen.getByPlaceholderText('Search options...'), { target: { value: 'switch' } });
  expect(screen.getByText('Switch')).toBeInTheDocument();
  expect(getPref(DPT_TREE_EXPANDED_PREF)).toBeNull();

  unmount();
  render(richPanel());
  expect(screen.queryByText('Switch')).not.toBeInTheDocument();
});
