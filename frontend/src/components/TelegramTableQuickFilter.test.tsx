import { render, fireEvent, screen } from '@testing-library/react';
import { expect, test, vi, beforeAll } from 'vitest';
import { format } from 'date-fns';
import { TelegramTable, type SortConfig } from './TelegramTable';
import { makeTelegram } from '../test/telegramFactory';
import type { Telegram } from '../hooks/useWebSocket';
import { DEFAULT_FILTERS } from '../types/filters';
import { anchorKey } from '../utils/anchorKey';
import { compileQuickFilters, DEFAULT_QUICK_FILTER_COLUMN_ENABLED, type QuickFilterColumnEnabled } from '../utils/quickFilter';
import { expandWithDeltaContext } from '../utils/deltaContextExpansion';

// The <input type="datetime-local"> quick-filter rows are interpreted as
// local time (matching the datetime-local semantics used elsewhere in the
// app, e.g. GotoTimeControl) — derive the input value from a telegram's own
// UTC timestamp so the test doesn't depend on the runner's timezone.
const localInputValue = (isoUtc: string) => format(new Date(isoUtc), "yyyy-MM-dd'T'HH:mm:ss");

// jsdom has no layout: give the virtualizer a viewport so it renders rows.
beforeAll(() => {
  globalThis.ResizeObserver = class {
    private cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb;
    }
    observe(el: Element) {
      const size = { inlineSize: 1000, blockSize: el.classList.contains('log-row') ? 85 : 800 };
      this.cb(
        [{ target: el, contentRect: el.getBoundingClientRect(), borderBoxSize: [size], contentBoxSize: [size] } as unknown as ResizeObserverEntry],
        this as unknown as ResizeObserver,
      );
    }
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Element.prototype.getBoundingClientRect = () =>
    ({ width: 1000, height: 800, top: 0, bottom: 800, left: 0, right: 1000, x: 0, y: 0, toJSON: () => {} }) as DOMRect;
});

const visibleColumns = {
  time: true, delta: true, source: true, sourceName: true,
  target: true, targetName: true, type: true, dpt: true, data: true, value: true,
};

const sortConfig: SortConfig = [{ key: 'timestamp', direction: 'desc' }];

const TELEGRAMS: Telegram[] = [
  makeTelegram({ timestamp: '2024-01-01T10:00:03.000Z', target_address: '1/2/3', target_name: 'Licht Küche', raw_hex: '0x03' }),
  makeTelegram({ timestamp: '2024-01-01T10:00:02.000Z', target_address: '1/2/4', target_name: 'Licht Flur', raw_hex: '0x02' }),
  makeTelegram({ timestamp: '2024-01-01T10:00:01.000Z', target_address: '2/0/1', target_name: 'Jalousie Bad', raw_hex: '0x01' }),
];

const renderTable = () =>
  render(
    <TelegramTable
      telegrams={TELEGRAMS}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={{ ...DEFAULT_FILTERS, deltaBeforeMs: 1000, deltaAfterMs: 0, deltaContextEnabled: true }}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      quickFilterFiltersOutAny
    />,
  );

const rowCount = (container: HTMLElement) => container.querySelectorAll('.log-row').length;

const renderTableWithDerivedContext = (
  telegrams: Telegram[],
  options?: {
    quickPatterns?: { target?: { top: string; bottom: string } };
    quickFilterColumnEnabled?: QuickFilterColumnEnabled;
    deltaBeforeMs?: number;
    deltaAfterMs?: number;
    flaggedKeys?: string[];
  },
) => {
  const quickPatterns = options?.quickPatterns ?? { target: { top: '', bottom: 'küche' } };
  const quickFilterColumnEnabled = options?.quickFilterColumnEnabled ?? DEFAULT_QUICK_FILTER_COLUMN_ENABLED;
  const deltaBeforeMs = options?.deltaBeforeMs ?? 0;
  const deltaAfterMs = options?.deltaAfterMs ?? 0;
  const effectiveDeltaBeforeMs = quickFilterColumnEnabled.delta === false ? 0 : deltaBeforeMs;
  const effectiveDeltaAfterMs = quickFilterColumnEnabled.delta === false ? 0 : deltaAfterMs;
  const flaggedKeys = new Set(options?.flaggedKeys ?? []);
  const quickMatches = compileQuickFilters(quickPatterns, quickFilterColumnEnabled);
  const expanded = expandWithDeltaContext(
    telegrams,
    telegrams.map(t => quickMatches(t)),
    anchorKey,
    flaggedKeys,
    effectiveDeltaBeforeMs,
    effectiveDeltaAfterMs,
  );
  return render(
    <TelegramTable
      telegrams={expanded.items}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={{ ...DEFAULT_FILTERS, deltaBeforeMs: effectiveDeltaBeforeMs, deltaAfterMs: effectiveDeltaAfterMs, deltaContextEnabled: true }}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      quickFilterOpen
      quickFilterEnabled
      quickPatterns={quickPatterns}
      quickFilterColumnEnabled={quickFilterColumnEnabled}
      contextKeys={expanded.contextKeys}
      flaggedKeys={[...flaggedKeys]}
    />,
  );
};

test('expanding the quick filter bar and typing in the name row filters the rows (#271, #309)', () => {
  const { container } = renderTable();
  expect(rowCount(container)).toBe(3);
  expect(screen.queryByLabelText('Quick filter TARGET name')).not.toBeInTheDocument();

  fireEvent.click(screen.getByTitle('Show quick filter bar'));
  const nameInput = screen.getByLabelText('Quick filter TARGET name');

  fireEvent.change(nameInput, { target: { value: 'küche' } });
  expect(rowCount(container)).toBe(1);

  // Regex alternation on the name row.
  fireEvent.change(nameInput, { target: { value: 'Küche|Flur' } });
  expect(rowCount(container)).toBe(2);
});

test('the address pattern row (#309) matches by wildcard, independent of the name row', () => {
  const { container } = renderTable();
  fireEvent.click(screen.getByTitle('Show quick filter bar'));

  fireEvent.change(screen.getByLabelText('Quick filter TARGET pattern'), { target: { value: '1/2/*' } });
  expect(rowCount(container)).toBe(2);

  fireEvent.change(screen.getByLabelText('Quick filter TARGET pattern'), { target: { value: '2/0/0-2/0/9' } });
  expect(rowCount(container)).toBe(1);
});

test('an invalid regex in the name row falls back to a literal substring match', () => {
  const { container } = renderTable();
  fireEvent.click(screen.getByTitle('Show quick filter bar'));
  const nameInput = screen.getByLabelText('Quick filter TARGET name');

  // "(" alone is an invalid regex — must not crash, matches nothing literally…
  fireEvent.change(nameInput, { target: { value: '(' } });
  expect(rowCount(container)).toBe(0);

  // …and a literal fragment of a name still matches.
  fireEvent.change(nameInput, { target: { value: 'jalousie' } });
  expect(rowCount(container)).toBe(1);
});

test('the toggle disables filtering without losing patterns; collapsing restores all rows', () => {
  const { container } = renderTable();
  fireEvent.click(screen.getByTitle('Show quick filter bar'));
  const nameInput = screen.getByLabelText('Quick filter TARGET name');
  fireEvent.change(nameInput, { target: { value: 'küche' } });
  expect(rowCount(container)).toBe(1);

  // Disable via the bar's toggle — patterns stay, rows come back.
  fireEvent.click(screen.getByTitle(/Disable quick filter \(keeps patterns\)/));
  expect(rowCount(container)).toBe(3);
  expect(screen.getByLabelText('Quick filter TARGET name')).toHaveValue('küche');

  // Re-enable — filtering resumes with the kept pattern.
  fireEvent.click(screen.getByTitle(/Enable quick filter/));
  expect(rowCount(container)).toBe(1);

  // Collapse — bar gone, all rows visible again.
  fireEvent.click(screen.getByTitle('Hide quick filter bar'));
  expect(screen.queryByLabelText('Quick filter TARGET name')).not.toBeInTheDocument();
  expect(rowCount(container)).toBe(3);
});

test('filters combine across columns (AND)', () => {
  const { container } = renderTable();
  fireEvent.click(screen.getByTitle('Show quick filter bar'));
  fireEvent.change(screen.getByLabelText('Quick filter TARGET name'), { target: { value: 'licht' } });
  fireEvent.change(screen.getByLabelText('Quick filter VALUE from'), { target: { value: '0x02' } });
  expect(rowCount(container)).toBe(1);
});

test('context rows are not filtered out again by the quick filter', () => {
  const contextTelegram = makeTelegram({
    timestamp: '2024-01-01T10:00:00.000Z',
    target_address: '9/9/9',
    target_name: 'Context Only',
    raw_hex: '0x09',
  });
  const { container } = render(
    <TelegramTable
      telegrams={[...TELEGRAMS, contextTelegram]}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      quickFilterOpen
      quickFilterEnabled
      quickPatterns={{ target: { top: '', bottom: 'küche' } }}
      contextKeys={new Set([anchorKey(contextTelegram)])}
    />,
  );

  expect(rowCount(container)).toBe(2);
});

test('context-only rows do not show a message-context flag control, even when marked', () => {
  const contextTelegram = makeTelegram({
    timestamp: '2024-01-01T10:00:00.000Z',
    target_address: '9/9/9',
    target_name: 'Context Only',
    raw_hex: '0x09',
  });
  const { container } = render(
    <TelegramTable
      telegrams={[...TELEGRAMS, contextTelegram]}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      markedKeys={[anchorKey(contextTelegram)]}
      lastMarkedKey={anchorKey(contextTelegram)}
      contextKeys={new Set([anchorKey(contextTelegram)])}
    />,
  );

  const contextRow = [...container.querySelectorAll('.log-row')].find(r => r.textContent?.includes('Context Only'))!;
  expect(contextRow.querySelector('button[title*="Always show context"]')).toBeFalsy();
  expect(contextRow.querySelector('button[title*="click to unflag"]')).toBeFalsy();
});

test('changing delta before/after re-evaluates and updates contextual rows', () => {
  const anchorTelegram = makeTelegram({
    timestamp: '2024-01-01T10:00:03.000Z',
    target_address: '1/2/3',
    target_name: 'Licht Küche',
    raw_hex: '0x03',
  });
  const contextTelegram = makeTelegram({
    timestamp: '2024-01-01T10:00:02.500Z',
    target_address: '9/9/9',
    target_name: 'Context Only',
    raw_hex: '0x09',
  });
  const farTelegram = makeTelegram({
    timestamp: '2024-01-01T09:59:00.000Z',
    target_address: '2/0/1',
    target_name: 'Far Away',
    raw_hex: '0x01',
  });
  const telegrams = [anchorTelegram, contextTelegram, farTelegram];
  const flaggedKeys = [anchorKey(anchorTelegram)];

  const { container, rerender } = renderTableWithDerivedContext(telegrams, {
    deltaBeforeMs: 0,
    deltaAfterMs: 0,
    flaggedKeys,
  });
  expect(rowCount(container)).toBe(1);

  const quickPatterns = { target: { top: '', bottom: 'küche' } };
  const quickFilterColumnEnabled = DEFAULT_QUICK_FILTER_COLUMN_ENABLED;
  const quickMatches = compileQuickFilters(quickPatterns, quickFilterColumnEnabled);
  const expanded = expandWithDeltaContext(
    telegrams,
    telegrams.map(t => quickMatches(t)),
    anchorKey,
    new Set(flaggedKeys),
    1000,
    0,
  );

  rerender(
    <TelegramTable
      telegrams={expanded.items}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={{ ...DEFAULT_FILTERS, deltaBeforeMs: 1000, deltaAfterMs: 0, deltaContextEnabled: true }}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      quickFilterOpen
      quickFilterEnabled
      quickPatterns={quickPatterns}
      quickFilterColumnEnabled={quickFilterColumnEnabled}
      contextKeys={expanded.contextKeys}
      flaggedKeys={flaggedKeys}
    />,
  );

  expect(rowCount(container)).toBe(2);
  expect([...container.querySelectorAll('.log-row')].some(r => r.textContent?.includes('Context Only'))).toBe(true);
});

test('enabling or disabling a quick-filter column re-evaluates which rows are contextual', () => {
  const anchorTelegram = makeTelegram({
    timestamp: '2024-01-01T10:00:03.000Z',
    target_address: '1/2/3',
    target_name: 'Licht Küche',
    raw_hex: '0x03',
  });
  const contextTelegram = makeTelegram({
    timestamp: '2024-01-01T10:00:02.500Z',
    target_address: '9/9/9',
    target_name: 'Context Only',
    raw_hex: '0x09',
  });
  const farTelegram = makeTelegram({
    timestamp: '2024-01-01T09:59:00.000Z',
    target_address: '2/0/1',
    target_name: 'Far Away',
    raw_hex: '0x01',
  });
  const telegrams = [anchorTelegram, contextTelegram, farTelegram];
  const flaggedKeys = [anchorKey(anchorTelegram)];
  const quickPatterns = { target: { top: '', bottom: 'küche' } };

  const { container, rerender } = renderTableWithDerivedContext(telegrams, {
    quickPatterns,
    deltaBeforeMs: 1000,
    deltaAfterMs: 0,
    flaggedKeys,
  });
  const contextRowBefore = [...container.querySelectorAll('.log-row')].find(r => r.textContent?.includes('Context Only'))!;
  expect(contextRowBefore.getAttribute('title')).toContain('Unfiltered Time-Delta-Context');

  const disabledTarget = { ...DEFAULT_QUICK_FILTER_COLUMN_ENABLED, target: false };
  const quickMatches = compileQuickFilters(quickPatterns, disabledTarget);
  const expanded = expandWithDeltaContext(
    telegrams,
    telegrams.map(t => quickMatches(t)),
    anchorKey,
    new Set(flaggedKeys),
    1000,
    0,
  );

  rerender(
    <TelegramTable
      telegrams={expanded.items}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={{ ...DEFAULT_FILTERS, deltaBeforeMs: 1000, deltaAfterMs: 0, deltaContextEnabled: true }}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      quickFilterOpen
      quickFilterEnabled
      quickPatterns={quickPatterns}
      quickFilterColumnEnabled={disabledTarget}
      contextKeys={expanded.contextKeys}
      flaggedKeys={flaggedKeys}
    />,
  );

  const contextRowAfter = [...container.querySelectorAll('.log-row')].find(r => r.textContent?.includes('Context Only'))!;
  expect(contextRowAfter.getAttribute('title')).toBeNull();
});

test('disabling the DELTA quick-filter column re-evaluates contextual rows as if before=after=0', () => {
  const anchorTelegram = makeTelegram({
    timestamp: '2024-01-01T10:00:03.000Z',
    target_address: '1/2/3',
    target_name: 'Licht Küche',
    raw_hex: '0x03',
  });
  const contextTelegram = makeTelegram({
    timestamp: '2024-01-01T10:00:02.500Z',
    target_address: '9/9/9',
    target_name: 'Context Only',
    raw_hex: '0x09',
  });
  const farTelegram = makeTelegram({
    timestamp: '2024-01-01T09:59:00.000Z',
    target_address: '2/0/1',
    target_name: 'Far Away',
    raw_hex: '0x01',
  });
  const telegrams = [anchorTelegram, contextTelegram, farTelegram];
  const flaggedKeys = [anchorKey(anchorTelegram)];

  const { container, rerender } = renderTableWithDerivedContext(telegrams, {
    deltaBeforeMs: 1000,
    deltaAfterMs: 0,
    flaggedKeys,
  });
  expect([...container.querySelectorAll('.log-row')].some(r => r.textContent?.includes('Context Only'))).toBe(true);

  const disabledDelta = { ...DEFAULT_QUICK_FILTER_COLUMN_ENABLED, delta: false };
  const quickPatterns = { target: { top: '', bottom: 'küche' } };
  const quickMatches = compileQuickFilters(quickPatterns, disabledDelta);
  const expanded = expandWithDeltaContext(
    telegrams,
    telegrams.map(t => quickMatches(t)),
    anchorKey,
    new Set(flaggedKeys),
    0,
    0,
  );

  rerender(
    <TelegramTable
      telegrams={expanded.items}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={{ ...DEFAULT_FILTERS, deltaBeforeMs: 0, deltaAfterMs: 0, deltaContextEnabled: true }}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      quickFilterOpen
      quickFilterEnabled
      quickPatterns={quickPatterns}
      quickFilterColumnEnabled={disabledDelta}
      contextKeys={expanded.contextKeys}
      flaggedKeys={flaggedKeys}
    />,
  );

  expect([...container.querySelectorAll('.log-row')].some(r => r.textContent?.includes('Context Only'))).toBe(false);
  expect(rowCount(container)).toBe(1);
});

test('the TYPE row matches a comma-separated list against type or direction', () => {
  const telegrams: Telegram[] = [
    makeTelegram({ simplified_type: 'Write', direction: 'Incoming' }),
    makeTelegram({ simplified_type: 'Read', direction: 'Incoming' }),
    makeTelegram({ simplified_type: 'Response', direction: 'Outgoing' }),
  ];
  const { container } = render(
    <TelegramTable
      telegrams={telegrams}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByTitle('Show quick filter bar'));
  fireEvent.change(screen.getByLabelText('Quick filter TYPE'), { target: { value: 'Write, Outgoing' } });
  expect(rowCount(container)).toBe(2); // the Write/Incoming row and the Response/Outgoing row
});

test('the TIME row restricts to a from/to range', () => {
  const { container } = renderTable();
  fireEvent.click(screen.getByTitle('Show quick filter bar'));
  const boundary = localInputValue('2024-01-01T10:00:02.000Z'); // the middle telegram's own timestamp
  fireEvent.change(screen.getByLabelText('Quick filter TIME from'), { target: { value: boundary } });
  expect(rowCount(container)).toBe(2);
  fireEvent.change(screen.getByLabelText('Quick filter TIME to'), { target: { value: boundary } });
  expect(rowCount(container)).toBe(1);
});

test('ctrl/cmd-click on a column quick-filter toggle clears both quick-filter cells for that column', () => {
  renderTable();
  fireEvent.click(screen.getByTitle('Show quick filter bar'));

  const topInput = screen.getByLabelText('Quick filter TARGET pattern');
  const bottomInput = screen.getByLabelText('Quick filter TARGET name');
  fireEvent.change(topInput, { target: { value: '1/2/*' } });
  fireEvent.change(bottomInput, { target: { value: 'licht' } });
  expect(topInput).toHaveValue('1/2/*');
  expect(bottomInput).toHaveValue('licht');

  fireEvent.click(
    screen.getByTitle("Disable quick filter for TARGET · ctrl/cmd-click clears this column's quick-filter cells"),
    { ctrlKey: true },
  );

  expect(screen.getByLabelText('Quick filter TARGET pattern')).toHaveValue('');
  expect(screen.getByLabelText('Quick filter TARGET name')).toHaveValue('');
});

test('ctrl/cmd-click on the global quick-filter toggle clears all quick-filter cells', () => {
  renderTable();
  fireEvent.click(screen.getByTitle('Show quick filter bar'));

  fireEvent.change(screen.getByLabelText('Quick filter TARGET name'), { target: { value: 'licht' } });
  fireEvent.change(screen.getByLabelText('Quick filter VALUE from'), { target: { value: '0x02' } });

  fireEvent.click(
    screen.getByTitle('Disable quick filter (keeps patterns) · ctrl/cmd-click clears all quick-filter cells'),
    { ctrlKey: true },
  );

  expect(screen.getByLabelText('Quick filter TARGET name')).toHaveValue('');
  expect(screen.getByLabelText('Quick filter VALUE from')).toHaveValue('');
});

test('quick-filter divider is black when the quick filter is globally disabled', () => {
  render(
    <TelegramTable
      telegrams={TELEGRAMS}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={{ ...DEFAULT_FILTERS, deltaBeforeMs: 1000, deltaAfterMs: 0, deltaContextEnabled: true }}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      quickFilterOpen
      quickFilterEnabled={false}
    />,
  );

  expect(screen.getByTestId('quick-filter-divider')).toHaveStyle({ background: '#000000' });
});

test('quick-filter divider is black when all column quick filters are disabled', () => {
  render(
    <TelegramTable
      telegrams={TELEGRAMS}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={{ ...DEFAULT_FILTERS, deltaBeforeMs: 1000, deltaAfterMs: 0, deltaContextEnabled: true }}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      quickFilterOpen
      quickFilterEnabled
      quickFilterColumnEnabled={{
        time: false,
        delta: false,
        source: false,
        target: false,
        type: false,
        dpt: false,
        value: false,
      }}
    />,
  );

  expect(screen.getByTestId('quick-filter-divider')).toHaveStyle({ background: '#000000' });
});

test('quick-filter divider is gray when filtering is enabled but all rows are shown', () => {
  render(
    <TelegramTable
      telegrams={TELEGRAMS}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={{ ...DEFAULT_FILTERS, deltaBeforeMs: 1000, deltaAfterMs: 0, deltaContextEnabled: true }}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      quickFilterOpen
      quickFilterEnabled
      quickPatterns={{}}
    />,
  );

  expect(screen.getByTestId('quick-filter-divider')).toHaveStyle({ background: '#6b7280' });
});

test('quick-filter divider is orange when at least one row is filtered out', () => {
  render(
    <TelegramTable
      telegrams={TELEGRAMS}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={{ ...DEFAULT_FILTERS, deltaBeforeMs: 1000, deltaAfterMs: 0, deltaContextEnabled: true }}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      quickFilterOpen
      quickFilterEnabled
      quickPatterns={{ target: { top: '', bottom: 'küche' } }}
    />,
  );

  expect(screen.getByTestId('quick-filter-divider')).toHaveStyle({ background: '#f59e0b' });
});

test('quick-filter divider stays orange when excluded rows are re-shown as context rows', () => {
  const contextKeys = new Set([
    anchorKey(TELEGRAMS[1]),
    anchorKey(TELEGRAMS[2]),
  ]);
  render(
    <TelegramTable
      telegrams={TELEGRAMS}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={{ ...DEFAULT_FILTERS, deltaBeforeMs: 1000, deltaAfterMs: 0, deltaContextEnabled: true }}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      quickFilterOpen
      quickFilterEnabled
      quickPatterns={{ target: { top: '', bottom: 'küche' } }}
      contextKeys={contextKeys}
    />,
  );

  expect(screen.getByTestId('quick-filter-divider')).toHaveStyle({ background: '#f59e0b' });
});

test('quick-filter divider uses upstream exclusion signal for prefiltered table inputs', () => {
  render(
    <TelegramTable
      telegrams={[TELEGRAMS[0]]}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={{ ...DEFAULT_FILTERS, deltaBeforeMs: 1000, deltaAfterMs: 0, deltaContextEnabled: true }}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      quickFilterOpen
      quickFilterEnabled
      quickPatterns={{ target: { top: '', bottom: 'UGH_BJP_C1' } }}
      quickFilterFiltersOutAny
    />,
  );

  expect(screen.getByTestId('quick-filter-divider')).toHaveStyle({ background: '#f59e0b' });
});

test('ctrl/cmd-click on the DELTA TIME toggle disables/enables the window without losing the entered values (#318)', () => {
  const onDeltaContextChange = vi.fn();
  const onDeltaContextEnabledChange = vi.fn();
  render(
    <TelegramTable
      telegrams={TELEGRAMS}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={{ ...DEFAULT_FILTERS, deltaBeforeMs: 500, deltaAfterMs: 250, deltaContextEnabled: true }}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      onDeltaContextChange={onDeltaContextChange}
      onDeltaContextEnabledChange={onDeltaContextEnabledChange}
    />,
  );
  fireEvent.click(screen.getByTitle('Show quick filter bar'));

  // Values are shown regardless of enabled state.
  expect(screen.getByLabelText('Time-Delta-Context before (ms)')).toHaveValue(500);
  expect(screen.getByLabelText('Time-Delta-Context after (ms)')).toHaveValue(250);

  const toggleBtn = screen.getByTitle(/Time-Delta-Context:/);
  fireEvent.click(toggleBtn, { ctrlKey: true });
  expect(onDeltaContextEnabledChange).toHaveBeenCalledWith(false);

  // Editing a value while enabled still goes through onDeltaContextChange, preserving the other field.
  fireEvent.change(screen.getByLabelText('Time-Delta-Context before (ms)'), { target: { value: '750' } });
  expect(onDeltaContextChange).toHaveBeenCalledWith(750, 250);
});

test('plain click on the DELTA TIME toggle cycles the per-message flag tristate (#319)', () => {
  renderTable();
  fireEvent.click(screen.getByTitle('Show quick filter bar'));

  // none -> all: flags every currently visible row.
  fireEvent.click(screen.getByTitle(/none messages flagged/));
  expect(screen.getByTitle(/all messages flagged/)).toBeInTheDocument();

  // all -> none: clears every flag.
  fireEvent.click(screen.getByTitle(/all messages flagged/));
  expect(screen.getByTitle(/none messages flagged/)).toBeInTheDocument();
});

test('flagging a single row reports the tristate as "some" (#319)', () => {
  const { container } = renderTable();
  fireEvent.click(screen.getByTitle('Show quick filter bar'));
  expect(screen.getByTitle(/none messages flagged/)).toBeInTheDocument();

  const row = [...container.querySelectorAll('.log-row')].find(r => r.textContent?.includes('Licht Flur'))!;
  fireEvent.click(row.querySelector('button[title*="Always show context"]')!);

  expect(screen.getByTitle(/some messages flagged/)).toBeInTheDocument();
});

test('row message-context controls are hidden when delta window is initial (before=after=0)', () => {
  const { container } = render(
    <TelegramTable
      telegrams={TELEGRAMS}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={{ ...DEFAULT_FILTERS, deltaBeforeMs: 0, deltaAfterMs: 0, deltaContextEnabled: true }}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByTitle('Show quick filter bar'));

  expect(container.querySelector('button[title*="Always show context"]')).toBeFalsy();
  expect(container.querySelector('button[title*="click to unflag"]')).toBeFalsy();
});

test('row message-context controls are hidden when DELTA quick-filter column is disabled', () => {
  const { container } = render(
    <TelegramTable
      telegrams={TELEGRAMS}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={{ ...DEFAULT_FILTERS, deltaBeforeMs: 1000, deltaAfterMs: 0, deltaContextEnabled: true }}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      quickFilterOpen
      quickFilterEnabled
      quickFilterColumnEnabled={{ ...DEFAULT_QUICK_FILTER_COLUMN_ENABLED, delta: false }}
    />,
  );

  expect(container.querySelector('button[title*="Always show context"]')).toBeFalsy();
  expect(container.querySelector('button[title*="click to unflag"]')).toBeFalsy();
});

test('row message-context controls are hidden when quick filter excludes no message', () => {
  const { container } = render(
    <TelegramTable
      telegrams={TELEGRAMS}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={{ ...DEFAULT_FILTERS, deltaBeforeMs: 1000, deltaAfterMs: 0, deltaContextEnabled: true }}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      quickFilterOpen
      quickFilterEnabled
      quickPatterns={{}}
      quickFilterFiltersOutAny={false}
    />,
  );

  expect(container.querySelector('button[title*="Always show context"]')).toBeFalsy();
  expect(container.querySelector('button[title*="click to unflag"]')).toBeFalsy();
});

test('plain click on a message-context flag keeps only that row flagged', () => {
  const { container } = renderTable();
  fireEvent.click(screen.getByTitle('Show quick filter bar'));
  const rows = [...container.querySelectorAll('.log-row')];

  fireEvent.click(rows[0].querySelector('button[title*="Always show context"]')!);
  fireEvent.click(rows[1].querySelector('button[title*="Always show context"]')!);

  const activeFlags = container.querySelectorAll('.log-row button[title*="click to unflag"]');
  expect(activeFlags).toHaveLength(1);
  expect(rows[1].querySelector('button[title*="click to unflag"]')).toBeTruthy();
});

test('plain click on a message-context control marks only that row', () => {
  const { container } = renderTable();
  fireEvent.click(screen.getByTitle('Show quick filter bar'));
  const rows = [...container.querySelectorAll('.log-row')];

  fireEvent.click(rows[1].querySelector('button[title*="Always show context"]')!);

  expect(container.querySelectorAll('.log-row.marked')).toHaveLength(1);
  expect(rows[1].className).toContain('marked');
});

test('ctrl-click on a message-context control toggles row marking like a row click', () => {
  const { container } = renderTable();
  fireEvent.click(screen.getByTitle('Show quick filter bar'));
  const rows = [...container.querySelectorAll('.log-row')];

  fireEvent.click(rows[0].querySelector('button[title*="Always show context"]')!);
  fireEvent.click(rows[2].querySelector('button[title*="Always show context"]')!, { ctrlKey: true });
  expect(container.querySelectorAll('.log-row.marked')).toHaveLength(2);

  fireEvent.click(rows[2].querySelector('button[title*="click to unflag"]')!, { ctrlKey: true });
  expect(container.querySelectorAll('.log-row.marked')).toHaveLength(1);
  expect(rows[0].className).toContain('marked');
});

test('shift and ctrl+shift on a message-context control apply row-click range marking semantics', () => {
  const { container } = renderTable();
  fireEvent.click(screen.getByTitle('Show quick filter bar'));
  const rows = [...container.querySelectorAll('.log-row')];

  fireEvent.click(rows[0].querySelector('button[title*="Always show context"]')!);
  fireEvent.click(rows[2].querySelector('button[title*="Always show context"]')!, { shiftKey: true });
  expect(container.querySelectorAll('.log-row.marked')).toHaveLength(3);

  fireEvent.click(rows[0].querySelector('button[title*="click to unflag"]')!, { ctrlKey: true });
  fireEvent.click(rows[2].querySelector('button[title*="Always show context"]')!, { ctrlKey: true, shiftKey: true });
  expect(container.querySelectorAll('.log-row.marked')).toHaveLength(3);
});

test('flagging a row pauses live-follow and anchors that row before list changes', () => {
  const onListFollowChange = vi.fn();
  const onListAnchorKeyChange = vi.fn();
  const { container } = render(
    <TelegramTable
      telegrams={TELEGRAMS}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={{ ...DEFAULT_FILTERS, deltaBeforeMs: 1000, deltaAfterMs: 0, deltaContextEnabled: true }}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      quickFilterFiltersOutAny
      listFollow={true}
      onListFollowChange={onListFollowChange}
      onListAnchorKeyChange={onListAnchorKeyChange}
    />,
  );
  fireEvent.click(screen.getByTitle('Show quick filter bar'));
  const row = [...container.querySelectorAll('.log-row')].find(r => r.textContent?.includes('Licht Flur'))!;
  fireEvent.click(row.querySelector('button[title*="Always show context"]')!);

  expect(onListFollowChange).toHaveBeenCalledWith(false);
  expect(onListAnchorKeyChange).toHaveBeenCalledWith(row.getAttribute('data-akey'));
});

test('ctrl/cmd-click on a row flag toggles only that row', () => {
  const { container } = renderTable();
  fireEvent.click(screen.getByTitle('Show quick filter bar'));
  const rows = [...container.querySelectorAll('.log-row')];

  const flagBtn = rows[2].querySelector('button[title*="Always show context"]')!;
  fireEvent.click(flagBtn, { ctrlKey: true });
  expect(rows[2].querySelector('button[title*="click to unflag"]')).toBeTruthy();

  fireEvent.click(flagBtn, { ctrlKey: true });
  expect(rows[2].querySelector('button[title*="click to unflag"]')).toBeFalsy();
});

test('shift-click on a row flag sets the full range between the last flag anchor and the clicked row', () => {
  const { container } = renderTable();
  fireEvent.click(screen.getByTitle('Show quick filter bar'));
  const rows = [...container.querySelectorAll('.log-row')];

  fireEvent.click(rows[0].querySelector('button[title*="Always show context"]')!);
  fireEvent.click(rows[2].querySelector('button[title*="Always show context"]')!, { shiftKey: true });

  expect(container.querySelectorAll('.log-row button[title*="click to unflag"]')).toHaveLength(3);
});

test('ctrl/cmd+shift-click applies the range-begin flag state to the full range', () => {
  const { container } = renderTable();
  fireEvent.click(screen.getByTitle('Show quick filter bar'));
  const rows = [...container.querySelectorAll('.log-row')];

  fireEvent.click(rows[0].querySelector('button[title*="Always show context"]')!);
  fireEvent.click(rows[0].querySelector('button[title*="click to unflag"]')!, { ctrlKey: true });
  fireEvent.click(rows[2].querySelector('button[title*="Always show context"]')!, { ctrlKey: true, shiftKey: true });

  expect(container.querySelectorAll('.log-row button[title*="click to unflag"]')).toHaveLength(0);
});
