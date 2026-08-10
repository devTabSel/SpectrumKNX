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
    new Map(),
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
      contextKeys={expanded.contextReasons}
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

  // Regex alternation on the name row requires regex: prefix.
  fireEvent.change(nameInput, { target: { value: 'regex:Küche|Flur' } });
  expect(rowCount(container)).toBe(2);
});

test('without regex: prefix, text is matched as a literal substring', () => {
  const { container } = renderTable();
  fireEvent.click(screen.getByTitle('Show quick filter bar'));
  const nameInput = screen.getByLabelText('Quick filter TARGET name');

  fireEvent.change(nameInput, { target: { value: 'Küche|Flur' } });
  expect(rowCount(container)).toBe(0);
});

test('the address pattern row (#309) matches by wildcard, independent of the name row', () => {
  const { container } = renderTable();
  fireEvent.click(screen.getByTitle('Show quick filter bar'));

  fireEvent.change(screen.getByLabelText('Quick filter TARGET pattern'), { target: { value: '1/2/*' } });
  expect(rowCount(container)).toBe(2);

  fireEvent.change(screen.getByLabelText('Quick filter TARGET pattern'), { target: { value: '2/0/0-2/0/9' } });
  expect(rowCount(container)).toBe(1);
});

test('quoted text patterns use exact wildcard matching with * and +', () => {
  const telegrams: Telegram[] = [
    makeTelegram({ target_name: 'ABC', target_address: '1/1/1' }),
    makeTelegram({ target_name: 'AXBC', target_address: '1/1/2' }),
    makeTelegram({ target_name: 'AB', target_address: '1/1/3' }),
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
      quickFilterFiltersOutAny
    />,
  );
  fireEvent.click(screen.getByTitle('Show quick filter bar'));
  const nameInput = screen.getByLabelText('Quick filter TARGET name');

  fireEvent.change(nameInput, { target: { value: '"A*", "*C"' } });
  expect(rowCount(container)).toBe(3);

  fireEvent.change(nameInput, { target: { value: '"+A*"' } });
  expect(rowCount(container)).toBe(0);

  fireEvent.change(nameInput, { target: { value: '"*C+"' } });
  expect(rowCount(container)).toBe(0);
});

test('an invalid regex: expression in the name row falls back to a literal substring match', () => {
  const { container } = renderTable();
  fireEvent.click(screen.getByTitle('Show quick filter bar'));
  const nameInput = screen.getByLabelText('Quick filter TARGET name');

  // "regex:(" is invalid regex syntax — must not crash, matches nothing literally…
  fireEvent.change(nameInput, { target: { value: 'regex:(' } });
  expect(rowCount(container)).toBe(0);

  // …and a literal fragment of a name still matches.
  fireEvent.change(nameInput, { target: { value: 'jalousie' } });
  expect(rowCount(container)).toBe(1);
});

test('the delta-context icon in the quick filter bar uses the same row-control glyph', () => {
  renderTable();
  fireEvent.click(screen.getByTitle('Show quick filter bar'));

  const deltaButton = screen.getByTitle(/Time-Delta-Context:/);
  expect(deltaButton).toBeInTheDocument();
  expect(deltaButton.querySelector('svg')).toBeInTheDocument();
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

test('delta-context rows are remixed after the quick filter', () => {
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
      contextKeys={new Map([[anchorKey(contextTelegram), 'delta' as const]])}
    />,
  );

  expect(rowCount(container)).toBe(2);
  expect([...container.querySelectorAll('.log-row')].some(r => r.textContent?.includes('Context Only'))).toBe(true);
});

test('non-delta contextual rows are remixed after quick filter', () => {
  const contextTelegram = makeTelegram({
    timestamp: '2024-01-01T10:00:00.000Z',
    target_address: '9/9/9',
    target_name: 'Marked Context',
    raw_hex: '0x19',
  });
  const contextKey = anchorKey(contextTelegram);
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
      contextKeys={new Map([[contextKey, 'marked' as const]])}
      markedKeys={[contextKey]}
      lastMarkedKey={contextKey}
    />,
  );

  expect(rowCount(container)).toBe(2);
  expect([...container.querySelectorAll('.log-row')].some(r => r.textContent?.includes('Marked Context'))).toBe(true);
});

test('delta-context rows still appear when quick filter excludes every matched message', () => {
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
      quickPatterns={{ target: { top: '', bottom: 'regex:^no-match$' } }}
      contextKeys={new Map([[anchorKey(contextTelegram), 'delta' as const]])}
    />,
  );

  expect(rowCount(container)).toBe(1);
  expect([...container.querySelectorAll('.log-row')].some(r => r.textContent?.includes('Context Only'))).toBe(true);
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
      contextKeys={new Map([[anchorKey(contextTelegram), 'delta' as const]])}
    />,
  );

  const contextRow = [...container.querySelectorAll('.log-row')].find(r => r.textContent?.includes('Context Only'))!;
  expect(contextRow.querySelector('button[title*="Always show context"]')).toBeFalsy();
  expect(contextRow.querySelector('button[title*="click to unflag"]')).toBeFalsy();
});

test('context rows with non-delta reason can show a message-context flag control', () => {
  const contextTelegram = makeTelegram({
    timestamp: '2024-01-01T10:00:00.000Z',
    target_address: '9/9/9',
    target_name: 'Marked Context',
    raw_hex: '0x19',
  });
  const key = anchorKey(contextTelegram);
  const { container } = render(
    <TelegramTable
      telegrams={[...TELEGRAMS, contextTelegram]}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={{ ...DEFAULT_FILTERS, deltaBeforeMs: 1000, deltaAfterMs: 0, deltaContextEnabled: true }}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      quickFilterOpen
      quickFilterEnabled
      quickPatterns={{ target: { top: '', bottom: 'küche' } }}
      contextKeys={new Map([[key, 'marked' as const]])}
      markedKeys={[key]}
      lastMarkedKey={key}
    />,
  );

  const contextRow = [...container.querySelectorAll('.log-row')].find(r => r.textContent?.includes('Marked Context'))!;
  expect(contextRow.querySelector('button[title*="Always show context"]')).toBeTruthy();
});

test('context rows with visualization reason can show a message-context flag control', () => {
  const contextTelegram = makeTelegram({
    timestamp: '2024-01-01T10:00:00.000Z',
    target_address: '9/9/9',
    target_name: 'Visualization Context',
    raw_hex: '0x29',
  });
  const key = anchorKey(contextTelegram);
  const { container } = render(
    <TelegramTable
      telegrams={[...TELEGRAMS, contextTelegram]}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={{ ...DEFAULT_FILTERS, deltaBeforeMs: 1000, deltaAfterMs: 0, deltaContextEnabled: true }}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      quickFilterOpen
      quickFilterEnabled
      quickPatterns={{ target: { top: '', bottom: 'küche' } }}
      contextKeys={new Map([[key, 'visualization' as const]])}
    />,
  );

  const contextRow = [...container.querySelectorAll('.log-row')].find(r => r.textContent?.includes('Visualization Context'))!;
  expect(contextRow.querySelector('button[title*="Always show context"]')).toBeTruthy();
});

test('a non-delta contextual row keeps its colored bar even when it passes the quick filter', () => {
  const contextTelegram = makeTelegram({
    timestamp: '2024-01-01T10:00:00.000Z',
    target_address: '9/9/9',
    target_name: 'Küche Context',
    raw_hex: '0x39',
  });
  const key = anchorKey(contextTelegram);
  const { container } = render(
    <TelegramTable
      telegrams={[...TELEGRAMS, contextTelegram]}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={{ ...DEFAULT_FILTERS, deltaBeforeMs: 1000, deltaAfterMs: 0, deltaContextEnabled: true }}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      quickFilterOpen
      quickFilterEnabled
      quickPatterns={{ target: { top: '', bottom: 'küche' } }}
      contextKeys={new Map([[key, 'marked' as const]])}
      markedKeys={[key]}
      lastMarkedKey={key}
    />,
  );

  const contextRow = [...container.querySelectorAll('.log-row')].find(r => r.textContent?.includes('Küche Context')) as HTMLElement | undefined;
  expect(contextRow).toBeDefined();
  expect(contextRow?.style.boxShadow).toContain('var(--accent-primary)');
});

test('changing delta before/after re-evaluates and keeps contextual rows remixed', () => {
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
      contextKeys={expanded.contextReasons}
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
  const contextRowBefore = [...container.querySelectorAll('.log-row')].find(r => r.textContent?.includes('Context Only'));
  expect(contextRowBefore).toBeDefined();

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
      contextKeys={expanded.contextReasons}
      flaggedKeys={flaggedKeys}
    />,
  );

  const contextRowAfter = [...container.querySelectorAll('.log-row')].find(r => r.textContent?.includes('Context Only'));
  expect(contextRowAfter).toBeDefined();
  expect(contextRowAfter?.getAttribute('title')).toBeNull();
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
      contextKeys={expanded.contextReasons}
      flaggedKeys={flaggedKeys}
    />,
  );

  expect([...container.querySelectorAll('.log-row')].some(r => r.textContent?.includes('Context Only'))).toBe(false);
  expect(rowCount(container)).toBe(1);
});

test('the TYPE rows apply regex matching to type (top) and direction (bottom) via regex: prefix', () => {
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
  fireEvent.change(screen.getByLabelText('Quick filter TYPE'), { target: { value: 'regex:write|response' } });
  expect(rowCount(container)).toBe(2);

  fireEvent.change(screen.getByLabelText('Quick filter TYPE direction'), { target: { value: 'regex:^out' } });
  expect(rowCount(container)).toBe(1);
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
  const contextKeys = new Map([
    [anchorKey(TELEGRAMS[1]), 'delta' as const],
    [anchorKey(TELEGRAMS[2]), 'delta' as const],
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

test('ctrl/cmd-click on the DELTA TIME toggle applies to all displayed messages', () => {
  const onDeltaContextChange = vi.fn();
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
      quickFilterFiltersOutAny
    />,
  );
  fireEvent.click(screen.getByTitle('Show quick filter bar'));

  // Values are shown regardless of enabled state.
  expect(screen.getByLabelText('Time-Delta-Context before (ms)')).toHaveValue(500);
  expect(screen.getByLabelText('Time-Delta-Context after (ms)')).toHaveValue(250);

  const toggleBtn = screen.getByTitle(/Time-Delta-Context:/);
  fireEvent.click(toggleBtn, { ctrlKey: true });
  expect(screen.getByTitle(/all messages flagged/)).toBeInTheDocument();

  fireEvent.click(toggleBtn, { ctrlKey: true });
  expect(screen.getByTitle(/none messages flagged/)).toBeInTheDocument();

  // Editing a value still goes through onDeltaContextChange, preserving the other field.
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

test('context-marks filter auto-disables when DELTA tristate clears the last flagged row', () => {
  const { container } = renderTable();
  fireEvent.click(screen.getByTitle('Show quick filter bar'));
  fireEvent.click(screen.getByTitle('Show info bar'));

  const rows = [...container.querySelectorAll('.log-row')];
  fireEvent.click(rows[0].querySelector('button[title*="Always show context"]')!);

  const ctxFilterBtn = screen.getByTitle('Context-marked message count');
  fireEvent.click(ctxFilterBtn);
  expect(container.querySelectorAll('.log-row')).toHaveLength(1);

  fireEvent.click(screen.getByTitle(/all messages flagged/));

  expect(container.querySelectorAll('.log-row')).toHaveLength(3);
  expect(screen.getByTitle('Context-marked message count')).toBeDisabled();
});

test('context-marks filter auto-disables when row msg-context control unflags the last flagged row', () => {
  const { container } = renderTable();
  fireEvent.click(screen.getByTitle('Show quick filter bar'));
  fireEvent.click(screen.getByTitle('Show info bar'));

  const rows = [...container.querySelectorAll('.log-row')];
  fireEvent.click(rows[0].querySelector('button[title*="Always show context"]')!);

  const ctxFilterBtn = screen.getByTitle('Context-marked message count');
  fireEvent.click(ctxFilterBtn);
  expect(container.querySelectorAll('.log-row')).toHaveLength(1);

  fireEvent.click(container.querySelector('.log-row button[title*="click to unflag"]')!, { ctrlKey: true });

  expect(container.querySelectorAll('.log-row')).toHaveLength(3);
  expect(screen.getByTitle('Context-marked message count')).toBeDisabled();
});

test('delta tristate scopes to marked rows when more than one row is marked', () => {
  const { container } = renderTable();
  fireEvent.click(screen.getByTitle('Show quick filter bar'));

  const rows = [...container.querySelectorAll('.log-row')];
  fireEvent.click(rows[0]);
  fireEvent.click(rows[1], { ctrlKey: true });

  // With >1 marked rows, plain toggle flags only marked rows.
  fireEvent.click(screen.getByTitle(/none messages flagged/));
  expect(screen.getByTitle(/all messages flagged/)).toBeInTheDocument();
  expect(container.querySelectorAll('.log-row button[title*="click to unflag"]')).toHaveLength(2);
});

test('delta tristate considers only visible non-context rows', () => {
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
  const quickPatterns = { target: { top: '', bottom: 'küche' } };
  const quickMatches = compileQuickFilters(quickPatterns, DEFAULT_QUICK_FILTER_COLUMN_ENABLED);
  const expanded = expandWithDeltaContext(
    telegrams,
    telegrams.map(t => quickMatches(t)),
    anchorKey,
    new Set([anchorKey(anchorTelegram)]),
    1000,
    0,
    new Map([[anchorKey(contextTelegram), 'marked' as const]]),
  );

  const { container } = render(
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
      quickFilterColumnEnabled={DEFAULT_QUICK_FILTER_COLUMN_ENABLED}
      contextKeys={expanded.contextReasons}
      markedKeys={[anchorKey(contextTelegram)]}
      lastMarkedKey={anchorKey(contextTelegram)}
      flaggedKeys={[anchorKey(contextTelegram)]}
    />,
  );

  // One context-only row is present and already flagged, but the only
  // non-context row is not — tristate should still read "none".
  expect(container.querySelectorAll('.log-row.context')).toHaveLength(1);
  expect(screen.getByTitle(/none messages flagged/)).toBeInTheDocument();

  // Scope check only: context-only flags do not affect the tristate.
  expect(screen.queryByTitle(/all messages flagged/)).not.toBeInTheDocument();
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

test('ctrl-click on a message-context control never removes existing row marks', () => {
  const { container } = renderTable();
  fireEvent.click(screen.getByTitle('Show quick filter bar'));
  const rows = [...container.querySelectorAll('.log-row')];

  fireEvent.click(rows[0].querySelector('button[title*="Always show context"]')!);
  fireEvent.click(rows[2].querySelector('button[title*="Always show context"]')!, { ctrlKey: true });
  expect(container.querySelectorAll('.log-row.marked')).toHaveLength(2);

  fireEvent.click(rows[2].querySelector('button[title*="click to unflag"]')!, { ctrlKey: true });
  expect(container.querySelectorAll('.log-row.marked')).toHaveLength(2);
  expect(rows[0].className).toContain('marked');
  expect(rows[2].className).toContain('marked');
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
