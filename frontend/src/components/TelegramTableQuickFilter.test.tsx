import { render, fireEvent, screen } from '@testing-library/react';
import { expect, test, vi, beforeAll } from 'vitest';
import { format } from 'date-fns';
import { TelegramTable, type SortConfig } from './TelegramTable';
import { makeTelegram } from '../test/telegramFactory';
import type { Telegram } from '../hooks/useWebSocket';
import { DEFAULT_FILTERS } from '../types/filters';
import { anchorKey } from '../utils/anchorKey';

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
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get() {
      if (this.classList?.contains('custom-scrollbar')) return 800;
      if (this.classList?.contains('log-row')) return 85;
      return 800;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() { return 1000; },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      if (this.classList?.contains('custom-scrollbar')) return 800;
      if (this.classList?.contains('log-row')) return 85;
      return 0;
    },
  });
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

/** Non-zero context window so per-row / header context controls are shown. */
const FILTERS_WITH_DELTA = { ...DEFAULT_FILTERS, deltaBeforeMs: 100, deltaAfterMs: 100 };

const renderTable = (props: Partial<React.ComponentProps<typeof TelegramTable>> = {}) =>
  render(
    <TelegramTable
      telegrams={TELEGRAMS}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      {...props}
    />,
  );

const rowCount = (container: HTMLElement) => container.querySelectorAll('.log-row').length;

test('expanding the quick filter bar and typing in the name row filters the rows (#271, #309)', () => {
  const { container } = renderTable();
  expect(rowCount(container)).toBe(3);
  expect(screen.queryByLabelText('Quick filter TARGET name')).not.toBeInTheDocument();

  fireEvent.click(screen.getByTitle('Show quick filter bar'));
  const nameInput = screen.getByLabelText('Quick filter TARGET name');

  fireEvent.change(nameInput, { target: { value: 'küche' } });
  expect(rowCount(container)).toBe(1);

  // Explicit regex alternation on the name row.
  fireEvent.change(nameInput, { target: { value: 'regex:Küche|Flur' } });
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

test('an invalid regex: pattern falls back to a literal substring match', () => {
  const { container } = renderTable();
  fireEvent.click(screen.getByTitle('Show quick filter bar'));
  const nameInput = screen.getByLabelText('Quick filter TARGET name');

  // "regex:(" alone is an invalid regex — must not crash, matches nothing literally…
  fireEvent.change(nameInput, { target: { value: 'regex:(' } });
  expect(rowCount(container)).toBe(0);

  // …and a literal fragment of a name still matches (default is substring).
  fireEvent.change(nameInput, { target: { value: 'jalousie' } });
  expect(rowCount(container)).toBe(1);
});

test('the toggle disables filtering without losing patterns; collapsing restores all rows', () => {
  const { container } = renderTable();
  fireEvent.click(screen.getByTitle('Show quick filter bar'));
  const nameInput = screen.getByLabelText('Quick filter TARGET name');
  fireEvent.change(nameInput, { target: { value: 'küche' } });
  expect(rowCount(container)).toBe(1);

  // Disable via the rail toggle — patterns stay, rows come back.
  fireEvent.click(screen.getByTitle(/^Disable quick filter \(keeps patterns\)/));
  expect(rowCount(container)).toBe(3);
  expect(screen.getByLabelText('Quick filter TARGET name')).toHaveValue('küche');

  // Re-enable — filtering resumes with the kept pattern.
  fireEvent.click(screen.getByTitle(/^Enable quick filter/));
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

test('TYPE top matches type and TYPE bottom matches direction separately', () => {
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

  fireEvent.change(screen.getByLabelText('Quick filter TYPE'), { target: { value: 'Write' } });
  expect(rowCount(container)).toBe(1);

  fireEvent.change(screen.getByLabelText('Quick filter TYPE'), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('Quick filter TYPE direction'), { target: { value: 'Outgoing' } });
  expect(rowCount(container)).toBe(1);

  fireEvent.change(screen.getByLabelText('Quick filter TYPE'), { target: { value: 'regex:Write|Response' } });
  expect(rowCount(container)).toBe(1); // Write|Response AND Outgoing → Response only
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

  const toggleBtn = screen.getByTitle(/Time-Delta-Context: on/);
  fireEvent.click(toggleBtn, { ctrlKey: true });
  expect(onDeltaContextEnabledChange).toHaveBeenCalledWith(false);

  // Editing a value while enabled still goes through onDeltaContextChange, preserving the other field.
  fireEvent.change(screen.getByLabelText('Time-Delta-Context before (ms)'), { target: { value: '750' } });
  expect(onDeltaContextChange).toHaveBeenCalledWith(750, 250);
});

const flagButton = (row: Element) => row.querySelector('button[title*="around this message"]')!;
const isFlagged = (row: Element) => flagButton(row).getAttribute('title')!.startsWith('Context is shown');

test('plain click on the DELTA TIME toggle switches the context between all and no messages (#319)', () => {
  const { container } = renderTable({ activeFilters: FILTERS_WITH_DELTA });
  fireEvent.click(screen.getByTitle('Show quick filter bar'));
  const rows = () => [...container.querySelectorAll('.log-row')];

  // Default: every message anchors a context window.
  expect(rows().every(isFlagged)).toBe(true);

  fireEvent.click(screen.getByTitle(/around all messages/));
  expect(screen.getByTitle(/around no message/)).toBeInTheDocument();
  expect(rows().some(isFlagged)).toBe(false);

  fireEvent.click(screen.getByTitle(/around no message/));
  expect(screen.getByTitle(/around all messages/)).toBeInTheDocument();
  expect(rows().every(isFlagged)).toBe(true);
});

test('flagging a single row limits the context to that message (#319)', () => {
  const onFlaggedKeysChange = vi.fn();
  const onContextForAllMatchesChange = vi.fn();
  const { container } = renderTable({
    activeFilters: FILTERS_WITH_DELTA,
    onFlaggedKeysChange,
    onContextForAllMatchesChange,
  });
  fireEvent.click(screen.getByTitle('Show quick filter bar'));
  fireEvent.click(screen.getByTitle(/around all messages/));
  expect(onContextForAllMatchesChange).toHaveBeenLastCalledWith(false);

  const rows = [...container.querySelectorAll('.log-row')];
  const row = rows.find(r => r.textContent?.includes('Licht Flur'))!;
  fireEvent.click(flagButton(row));

  expect(screen.getByTitle(/around the flagged messages only/)).toBeInTheDocument();
  expect(rows.filter(isFlagged)).toEqual([row]);
  expect(onFlaggedKeysChange.mock.lastCall![0]).toHaveLength(1);
});

test('switching one row off while all are on keeps the context around the others (#319)', () => {
  const { container } = renderTable({ activeFilters: FILTERS_WITH_DELTA });
  fireEvent.click(screen.getByTitle('Show quick filter bar'));
  const rows = [...container.querySelectorAll('.log-row')];

  fireEvent.click(flagButton(rows[0]));

  expect(screen.getByTitle(/around the flagged messages only/)).toBeInTheDocument();
  expect(rows.map(isFlagged)).toEqual([false, ...rows.slice(1).map(() => true)]);
});

test('context-row button flags that row as its own anchor without leaving all-mode', () => {
  const onFlaggedKeysChange = vi.fn();
  const onContextForAllMatchesChange = vi.fn();
  // Parent supplies a context-only neighbour; "all" still covers matches.
  const contextKey = anchorKey(TELEGRAMS[2]); // Jalousie Bad
  const { container } = renderTable({
    activeFilters: FILTERS_WITH_DELTA,
    contextKeys: new Set([contextKey]),
    contextForAllMatches: true,
    onFlaggedKeysChange,
    onContextForAllMatchesChange,
  });
  fireEvent.click(screen.getByTitle('Show quick filter bar'));

  const contextRow = [...container.querySelectorAll('.log-row')]
    .find(r => r.getAttribute('data-akey') === contextKey)!;
  expect(isFlagged(contextRow)).toBe(false);

  fireEvent.click(flagButton(contextRow));
  expect(onFlaggedKeysChange).toHaveBeenLastCalledWith([contextKey]);
  // Personal flag only — do not tear down global "all".
  expect(onContextForAllMatchesChange).not.toHaveBeenCalled();

  // Flagging keeps context classification — parent still reports contextKeys.
  const { container: c2 } = renderTable({
    activeFilters: FILTERS_WITH_DELTA,
    contextKeys: new Set([contextKey]),
    contextForAllMatches: true,
    flaggedKeys: [contextKey],
    onFlaggedKeysChange,
    onContextForAllMatchesChange,
  });
  fireEvent.click(screen.getByTitle('Show quick filter bar'));
  onFlaggedKeysChange.mockClear();
  onContextForAllMatchesChange.mockClear();

  const flaggedContext = [...c2.querySelectorAll('.log-row')]
    .find(r => r.getAttribute('data-akey') === contextKey)!;
  expect(flaggedContext.classList.contains('context')).toBe(true);
  expect(isFlagged(flaggedContext)).toBe(true);
  fireEvent.click(flagButton(flaggedContext));
  expect(onFlaggedKeysChange).toHaveBeenLastCalledWith([]);
  expect(onContextForAllMatchesChange).not.toHaveBeenCalled();
});

test('toggling a row context button pins the preferred row as the scroll anchor', async () => {
  const onListAnchorKeyChange = vi.fn();
  const onListFollowChange = vi.fn();
  const { container } = renderTable({
    activeFilters: FILTERS_WITH_DELTA,
    listFollow: true,
    onListFollowChange,
    onListAnchorKeyChange,
  });
  fireEvent.click(screen.getByTitle('Show quick filter bar'));
  fireEvent.click(screen.getByTitle(/around all messages/));

  const rows = [...container.querySelectorAll('.log-row')];
  const row = rows.find(r => r.textContent?.includes('Licht Flur'))!;
  const key = row.getAttribute('data-akey')!;
  // Select the row first so preferred-pin targets it (else: top row).
  fireEvent.click(row);
  onListAnchorKeyChange.mockClear();
  onListFollowChange.mockClear();
  fireEvent.click(flagButton(row));

  await vi.waitFor(() => {
    expect(onListAnchorKeyChange).toHaveBeenCalledWith(key);
  });
});

test("a selected row's context flag applies to every selected row, not rail marks (#319)", () => {
  const { container } = renderTable({ activeFilters: FILTERS_WITH_DELTA });
  fireEvent.click(screen.getByTitle('Show quick filter bar'));
  fireEvent.click(screen.getByTitle(/around all messages/));
  const rows = [...container.querySelectorAll('.log-row')];

  // Select two rows, rail-mark a third (manual only), then flag one selected row.
  fireEvent.click(rows[0]);
  fireEvent.click(rows[1], { ctrlKey: true });
  const rail = rows[2].querySelector('[title="Mark this message"]') as HTMLElement;
  fireEvent.click(rail);
  fireEvent.click(flagButton(rows[0]));

  expect(isFlagged(rows[0])).toBe(true);
  expect(isFlagged(rows[1])).toBe(true);
  // Rail-marked but not selected → context indicator does not follow.
  expect(isFlagged(rows[2])).toBe(false);
});

test('context controls hide when QF is disabled or no window is set', () => {
  const { rerender, container } = renderTable({
    activeFilters: FILTERS_WITH_DELTA,
    quickFilterEnabled: true,
  });
  expect(screen.getByTitle(/Time-Delta-Context:/)).toBeInTheDocument();
  expect(container.querySelector('button[title*="around this message"]')).toBeTruthy();

  rerender(
    <TelegramTable
      telegrams={TELEGRAMS}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={FILTERS_WITH_DELTA}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      quickFilterEnabled={false}
    />,
  );
  expect(screen.queryByTitle(/Time-Delta-Context:/)).not.toBeInTheDocument();
  expect(container.querySelector('button[title*="around this message"]')).toBeNull();
  expect(container.textContent).toMatch(/\+/);

  rerender(
    <TelegramTable
      telegrams={TELEGRAMS}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      quickFilterEnabled={true}
    />,
  );
  expect(screen.queryByTitle(/Time-Delta-Context:/)).not.toBeInTheDocument();
  expect(container.querySelector('button[title*="around this message"]')).toBeNull();
});

test('context rows passed in by the parent survive the quick filter (#520)', () => {
  const contextKey = anchorKey(TELEGRAMS[2]);
  const { container } = renderTable({
    quickFilterOpen: true,
    quickFilterEnabled: true,
    quickPatterns: { target: { top: '', bottom: 'küche' } },
    contextKeys: new Set([contextKey]),
  });
  // 'Licht Küche' matches; 'Jalousie Bad' is a context row and stays; 'Licht Flur' goes.
  expect(rowCount(container)).toBe(2);
  expect(screen.getByText('Jalousie Bad')).toBeInTheDocument();
  expect(screen.queryByText('Licht Flur')).not.toBeInTheDocument();
});

test('disabling a column quick filter ignores that column\'s patterns', () => {
  const { container } = renderTable();
  fireEvent.click(screen.getByTitle('Show quick filter bar'));
  fireEvent.change(screen.getByLabelText('Quick filter TARGET name'), { target: { value: 'küche' } });
  expect(rowCount(container)).toBe(1);

  fireEvent.click(screen.getByTitle(/^Disable quick filter for TARGET/));
  expect(rowCount(container)).toBe(3);
  expect(screen.getByLabelText('Quick filter TARGET name')).toBeDisabled();

  fireEvent.click(screen.getByTitle(/^Enable quick filter for TARGET/));
  expect(rowCount(container)).toBe(1);
});
