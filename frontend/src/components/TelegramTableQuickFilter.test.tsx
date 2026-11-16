import { render, fireEvent, screen } from '@testing-library/react';
import { expect, test, vi, beforeAll } from 'vitest';
import { format } from 'date-fns';
import { TelegramTable, type SortConfig } from './TelegramTable';
import { makeTelegram } from '../test/telegramFactory';
import type { Telegram } from '../hooks/useWebSocket';
import { DEFAULT_FILTERS } from '../types/filters';
import { anchorKey } from '../utils/anchorKey';

// The quick-filter time rows are local datetime strings (same shape as
// datetime-local, matching the semantics used elsewhere in the
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

  // Values are shown regardless of enabled state (SecondsField text inputs).
  expect(screen.getByLabelText('Time-Delta-Context before (ms)')).toHaveValue('500');
  expect(screen.getByLabelText('Time-Delta-Context after (ms)')).toHaveValue('250');

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

test('mousedown on a context button pins that row and passes through mouse selection', async () => {
  const onListAnchorKeyChange = vi.fn();
  const onMouseSelectedKeysChange = vi.fn();
  const { container } = renderTable({
    activeFilters: FILTERS_WITH_DELTA,
    onListAnchorKeyChange,
    onMouseSelectedKeysChange,
  });
  fireEvent.click(screen.getByTitle('Show quick filter bar'));
  fireEvent.click(screen.getByTitle(/around all messages/));

  const rows = [...container.querySelectorAll('.log-row')];
  fireEvent.click(rows[0]);
  const selected = rows[0].getAttribute('data-akey')!;
  const other = rows.find(r => r.textContent?.includes('Licht Flur'))!;
  const key = other.getAttribute('data-akey')!;
  onListAnchorKeyChange.mockClear();
  onMouseSelectedKeysChange.mockClear();
  fireEvent.mouseDown(flagButton(other));
  fireEvent.click(flagButton(other));

  await vi.waitFor(() => {
    expect(onListAnchorKeyChange).toHaveBeenCalledWith(key);
  });
  expect(onListAnchorKeyChange).not.toHaveBeenCalledWith(selected);
  // Context-button click also selects that row (same as clicking the row).
  expect(onMouseSelectedKeysChange).toHaveBeenCalled();
  expect(onMouseSelectedKeysChange.mock.lastCall![0]).toEqual([key]);
  expect(other.classList.contains('marked')).toBe(true);
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
  const onMouseSelectedKeysChange = vi.fn();
  const onFlaggedKeysChange = vi.fn();
  const { container } = renderTable({
    activeFilters: FILTERS_WITH_DELTA,
    onMouseSelectedKeysChange,
    onFlaggedKeysChange,
  });
  fireEvent.click(screen.getByTitle('Show quick filter bar'));
  fireEvent.click(screen.getByTitle(/around all messages/));
  const rows = [...container.querySelectorAll('.log-row')];

  // Select two rows, rail-mark a third (manual only), then flag one selected row.
  fireEvent.click(rows[0]);
  fireEvent.click(rows[1], { ctrlKey: true });
  const selected = rows.slice(0, 2).map(r => r.getAttribute('data-akey')!);
  const rail = rows[2].querySelector('[title="Mark this message"]') as HTMLElement;
  fireEvent.click(rail);
  onMouseSelectedKeysChange.mockClear();
  onFlaggedKeysChange.mockClear();
  // Real click: mousedown must not collapse the multi-selection.
  fireEvent.mouseDown(flagButton(rows[0]), { button: 0 });
  fireEvent.click(flagButton(rows[0]));

  expect(onMouseSelectedKeysChange).not.toHaveBeenCalled();
  expect(onFlaggedKeysChange).toHaveBeenLastCalledWith(expect.arrayContaining(selected));
  expect(onFlaggedKeysChange.mock.lastCall![0]).toHaveLength(2);
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
  const nameInput = screen.getByLabelText('Quick filter TARGET name');
  expect(nameInput).toBeEnabled();
  expect(nameInput).toHaveValue('küche');

  fireEvent.click(screen.getByTitle(/^Enable quick filter for TARGET/));
  expect(rowCount(container)).toBe(1);
});

test('typing into an empty cell turns the column filter back on', () => {
  const { container } = renderTable();
  fireEvent.click(screen.getByTitle('Show quick filter bar'));
  fireEvent.change(screen.getByLabelText('Quick filter TARGET name'), { target: { value: 'küche' } });
  expect(rowCount(container)).toBe(1);

  fireEvent.click(screen.getByTitle(/^Disable quick filter for TARGET/));
  expect(rowCount(container)).toBe(3);
  expect(screen.getByTitle(/^Enable quick filter for TARGET/)).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('Quick filter TARGET name'), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('Quick filter TARGET name'), { target: { value: 'küche' } });
  expect(screen.getByTitle(/^Disable quick filter for TARGET/)).toBeInTheDocument();
  expect(rowCount(container)).toBe(1);
});

test('clearing both cells of a column turns its filter off', () => {
  const { container } = renderTable();
  fireEvent.click(screen.getByTitle('Show quick filter bar'));
  fireEvent.change(screen.getByLabelText('Quick filter TARGET pattern'), { target: { value: '1/2/*' } });
  fireEvent.change(screen.getByLabelText('Quick filter TARGET name'), { target: { value: 'licht' } });
  expect(rowCount(container)).toBe(2);
  expect(screen.getByTitle(/^Disable quick filter for TARGET/)).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('Quick filter TARGET pattern'), { target: { value: '' } });
  expect(rowCount(container)).toBe(2);
  expect(screen.getByTitle(/^Disable quick filter for TARGET/)).toBeInTheDocument();

  fireEvent.change(screen.getByLabelText('Quick filter TARGET name'), { target: { value: '' } });
  expect(rowCount(container)).toBe(3);
  expect(screen.getByTitle(/^Enable quick filter for TARGET/)).toBeInTheDocument();
});

test('an empty column filter cannot be turned on', () => {
  renderTable({ quickFilterOpen: true, quickFilterEnabled: true });
  const toggle = screen.getByTitle(/^Enable quick filter for TARGET/);
  expect(toggle).not.toHaveClass('open');
  fireEvent.click(toggle);
  expect(screen.getByTitle(/^Enable quick filter for TARGET/)).not.toHaveClass('open');
});

test('QF bottom rule reflects inactive / idle / filtering', () => {
  const { rerender, container } = renderTable({
    quickFilterOpen: true,
    quickFilterEnabled: false,
  });
  expect(container.querySelector('[data-qf-bar-status="inactive"]')).toBeTruthy();

  rerender(
    <TelegramTable
      telegrams={TELEGRAMS}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      quickFilterOpen
      quickFilterEnabled
    />,
  );
  expect(container.querySelector('[data-qf-bar-status="idle"]')).toBeTruthy();

  fireEvent.change(screen.getByLabelText('Quick filter TARGET name'), { target: { value: 'küche' } });
  expect(container.querySelector('[data-qf-bar-status="filtering"]')).toBeTruthy();
});

test('empty quick-filter cells that do not filter use a dark background', () => {
  const { unmount } = renderTable({ quickFilterOpen: true, quickFilterEnabled: true });
  const pattern = screen.getByLabelText('Quick filter TARGET pattern');
  const name = screen.getByLabelText('Quick filter TARGET name');
  expect(pattern).toHaveClass('idle');
  expect(name).toHaveClass('idle');
  // Delta uses SecondsField (send-panel style); empty shows placeholder, not idle class.
  expect(screen.getByLabelText('Time-Delta-Context before (ms)')).toHaveValue('');
  expect(screen.getByLabelText('Time-Delta-Context before (ms)')).toHaveAttribute('placeholder', 'before');
  expect(screen.getByLabelText('Time-Delta-Context after (ms)')).toHaveAttribute('placeholder', 'after');
  // QF delta fields fill the Δt column width.
  expect(screen.getByLabelText('Time-Delta-Context before (ms)').closest('[data-wtb-col="qf-delta"]')).toBeTruthy();

  fireEvent.change(pattern, { target: { value: '1/2/*' } });
  expect(pattern).not.toHaveClass('idle');
  expect(name).toHaveClass('idle');

  // Whitespace-only still counts as input — not the dark idle inset.
  fireEvent.change(name, { target: { value: '   ' } });
  expect(name).not.toHaveClass('idle');
  expect(name).toHaveValue('   ');
  unmount();

  renderTable({
    quickFilterOpen: true,
    quickFilterEnabled: true,
    activeFilters: FILTERS_WITH_DELTA,
  });
  expect(screen.getByLabelText('Time-Delta-Context before (ms)')).toHaveValue('100');
});

test('the DELTA filter toggle is active only when before or after is set', () => {
  const { rerender } = renderTable({ quickFilterOpen: true, quickFilterEnabled: true });
  expect(screen.getByTitle(/^Time-Delta-Context: (on|off)/)).not.toHaveClass('open');

  rerender(
    <TelegramTable
      telegrams={TELEGRAMS}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={FILTERS_WITH_DELTA}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      quickFilterOpen
      quickFilterEnabled
    />,
  );
  expect(screen.getByTitle(/^Time-Delta-Context: (on|off)/)).toHaveClass('open');
});

test('a quick filter hides a flagged non-context row and keeps selection, marks, and context', () => {
  const flagged = makeTelegram({
    timestamp: '2024-01-01T10:00:04.000Z',
    target_address: '9/9/1',
    target_name: 'Flagged only',
    raw_hex: '0x11',
  });
  const selected = makeTelegram({
    timestamp: '2024-01-01T10:00:05.000Z',
    target_address: '9/9/2',
    target_name: 'Selected only',
    raw_hex: '0x12',
  });
  const marked = makeTelegram({
    timestamp: '2024-01-01T10:00:06.000Z',
    target_address: '9/9/3',
    target_name: 'Marked only',
    raw_hex: '0x13',
  });
  const context = makeTelegram({
    timestamp: '2024-01-01T10:00:07.000Z',
    target_address: '9/9/4',
    target_name: 'Context only',
    raw_hex: '0x14',
  });
  const match = TELEGRAMS[0];
  const flaggedKey = anchorKey(flagged);
  const selectedKey = anchorKey(selected);
  const markedKey = anchorKey(marked);
  const contextKey = anchorKey(context);
  const { container } = renderTable({
    telegrams: [flagged, selected, marked, context, match],
    quickFilterOpen: true,
    quickFilterEnabled: true,
    quickPatterns: { target: { top: '', bottom: 'Küche' } },
    flaggedKeys: [flaggedKey],
    mouseSelectedKeys: [selectedKey],
    markedKeys: [markedKey],
    contextKeys: new Set([contextKey]),
    activeFilters: {
      ...DEFAULT_FILTERS,
      deltaContextEnabled: true,
      deltaBeforeMs: 1000,
      deltaAfterMs: 1000,
    },
  });
  const keys = [...container.querySelectorAll('.log-row')].map(r => r.getAttribute('data-akey'));
  expect(keys).not.toContain(flaggedKey);
  expect(keys).toContain(selectedKey);
  expect(keys).toContain(markedKey);
  expect(keys).toContain(contextKey);
  expect(keys).toContain(anchorKey(match));
});

test('ctrl-click drafts an individual context window; Enter commits, Esc/outside discards', () => {
  const onFlaggedKeysChange = vi.fn();
  const onIndividualContextWindowsChange = vi.fn();
  const onMouseSelectedKeysChange = vi.fn();
  const { container } = renderTable({
    activeFilters: FILTERS_WITH_DELTA,
    quickFilterOpen: true,
    quickFilterEnabled: true,
    onFlaggedKeysChange,
    onIndividualContextWindowsChange,
    onMouseSelectedKeysChange,
  });
  const logRows = () => [...container.querySelectorAll('.log-row')];
  // Select row 0, then ctrl-click the context button on row 1: selection gets
  // the ctrl-click (adds row 1) and the popup opens for the multi-selection.
  fireEvent.click(logRows()[0]);
  const flag1 = flagButton(logRows()[1]);
  fireEvent.mouseDown(flag1, { ctrlKey: true, button: 0 });
  fireEvent.click(flag1, { ctrlKey: true });
  const selected = logRows().slice(0, 2).map(r => r.getAttribute('data-akey')!);
  expect(onMouseSelectedKeysChange).toHaveBeenCalled();
  expect(onMouseSelectedKeysChange.mock.lastCall![0]).toEqual(expect.arrayContaining(selected));
  expect(onMouseSelectedKeysChange.mock.lastCall![0]).toHaveLength(2);

  onFlaggedKeysChange.mockClear();
  expect(onFlaggedKeysChange).not.toHaveBeenCalled();
  expect(screen.getByTestId('context-window-popup')).toBeInTheDocument();
  const before = screen.getByLabelText('Individual context before (ms)');
  const after = screen.getByLabelText('Individual context after (ms)');
  expect(before).toHaveAttribute('placeholder', 'before');
  expect(after).toHaveAttribute('placeholder', 'after');
  // Multi-selection without individual times opens prefilled from the QF window.
  expect(before).toHaveValue('100');
  expect(after).toHaveValue('100');
  const toggle = screen.getByRole('button', { name: 'Off' });
  expect(toggle).not.toBeDisabled();
  expect(toggle.querySelector('svg')).toBeTruthy();

  // Enter with QF times clears any individual override (nothing stored).
  onIndividualContextWindowsChange.mockClear();
  fireEvent.keyDown(after, { key: 'Enter' });
  expect(onIndividualContextWindowsChange).toHaveBeenLastCalledWith({});
  expect(screen.queryByTestId('context-window-popup')).not.toBeInTheDocument();

  // Re-open, typing stays in the draft — nothing persisted yet.
  // Prefill already has times, so On stays Off until toggled (no empty→valid auto-on).
  fireEvent.mouseDown(flagButton(logRows()[0]), { ctrlKey: true, button: 0 });
  fireEvent.click(flagButton(logRows()[0]), { ctrlKey: true });
  fireEvent.change(screen.getByLabelText('Individual context before (ms)'), { target: { value: '200' } });
  fireEvent.change(screen.getByLabelText('Individual context after (ms)'), { target: { value: '300' } });
  expect(onIndividualContextWindowsChange).toHaveBeenCalledTimes(1); // only the QF-clear above
  expect(screen.getByRole('button', { name: 'Off' }).querySelector('svg')).toBeTruthy();
  expect(flagButton(logRows()[0]).hasAttribute('data-individual-window')).toBe(false);

  // Esc discards the draft (document capture listener).
  expect(screen.getByTestId('context-window-popup')).toBeInTheDocument();
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByTestId('context-window-popup')).not.toBeInTheDocument();
  expect(onIndividualContextWindowsChange).toHaveBeenCalledTimes(1);

  // Re-open, edit, click outside → discard.
  fireEvent.mouseDown(flagButton(logRows()[0]), { ctrlKey: true, button: 0 });
  fireEvent.click(flagButton(logRows()[0]), { ctrlKey: true });
  fireEvent.change(screen.getByLabelText('Individual context before (ms)'), { target: { value: '200' } });
  fireEvent.pointerDown(document.body);
  expect(screen.queryByTestId('context-window-popup')).not.toBeInTheDocument();
  expect(onIndividualContextWindowsChange).toHaveBeenCalledTimes(1);

  // Enter commits custom times with On, activates context buttons, and closes.
  fireEvent.mouseDown(flagButton(logRows()[0]), { ctrlKey: true, button: 0 });
  fireEvent.click(flagButton(logRows()[0]), { ctrlKey: true });
  fireEvent.change(screen.getByLabelText('Individual context before (ms)'), { target: { value: '150' } });
  fireEvent.change(screen.getByLabelText('Individual context after (ms)'), { target: { value: '250' } });
  fireEvent.click(screen.getByRole('button', { name: 'Off' }));
  expect(screen.getByRole('button', { name: 'On' })).toBeInTheDocument();
  onFlaggedKeysChange.mockClear();
  fireEvent.keyDown(screen.getByLabelText('Individual context after (ms)'), { key: 'Enter' });
  expect(onIndividualContextWindowsChange).toHaveBeenLastCalledWith({
    [selected[0]]: { beforeMs: 150, afterMs: 250, enabled: true },
    [selected[1]]: { beforeMs: 150, afterMs: 250, enabled: true },
  });
  expect(onFlaggedKeysChange).toHaveBeenCalled();
  expect(onFlaggedKeysChange.mock.lastCall![0]).toEqual(expect.arrayContaining(selected));
  expect(screen.queryByTestId('context-window-popup')).not.toBeInTheDocument();
  // Individual window on → context button always highlighted.
  expect(flagButton(logRows()[0]).getAttribute('data-individual-window')).toBe('true');
  expect(isFlagged(logRows()[0])).toBe(true);

  // Re-open shows the individual times (not QF), turn off via toggle + Enter.
  fireEvent.mouseDown(flagButton(logRows()[0]), { ctrlKey: true, button: 0 });
  fireEvent.click(flagButton(logRows()[0]), { ctrlKey: true });
  expect(screen.getByLabelText('Individual context before (ms)')).toHaveValue('150');
  expect(screen.getByLabelText('Individual context after (ms)')).toHaveValue('250');
  fireEvent.click(screen.getByRole('button', { name: 'On' }));
  fireEvent.keyDown(screen.getByLabelText('Individual context after (ms)'), { key: 'Enter' });
  expect(onIndividualContextWindowsChange).toHaveBeenLastCalledWith({
    [selected[0]]: { beforeMs: 150, afterMs: 250, enabled: false },
    [selected[1]]: { beforeMs: 150, afterMs: 250, enabled: false },
  });
  expect(flagButton(logRows()[0]).hasAttribute('data-individual-window')).toBe(false);

  // On/off stays adjustable while the selection already has before/after values.
  fireEvent.mouseDown(flagButton(logRows()[0]), { ctrlKey: true, button: 0 });
  fireEvent.click(flagButton(logRows()[0]), { ctrlKey: true });
  expect(screen.getByRole('button', { name: 'Off' })).not.toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Off' }));
  fireEvent.keyDown(screen.getByLabelText('Individual context after (ms)'), { key: 'Enter' });
  expect(onIndividualContextWindowsChange).toHaveBeenLastCalledWith({
    [selected[0]]: { beforeMs: 150, afterMs: 250, enabled: true },
    [selected[1]]: { beforeMs: 150, afterMs: 250, enabled: true },
  });

  // Commit back to QF times → individual overrides are removed.
  fireEvent.mouseDown(flagButton(logRows()[0]), { ctrlKey: true, button: 0 });
  fireEvent.click(flagButton(logRows()[0]), { ctrlKey: true });
  fireEvent.change(screen.getByLabelText('Individual context before (ms)'), { target: { value: '100' } });
  fireEvent.change(screen.getByLabelText('Individual context after (ms)'), { target: { value: '100' } });
  fireEvent.keyDown(screen.getByLabelText('Individual context after (ms)'), { key: 'Enter' });
  expect(onIndividualContextWindowsChange).toHaveBeenLastCalledWith({});
  expect(flagButton(logRows()[0]).hasAttribute('data-individual-window')).toBe(false);

  // Custom times again, then empty fields on commit also clear individuals.
  fireEvent.mouseDown(flagButton(logRows()[0]), { ctrlKey: true, button: 0 });
  fireEvent.click(flagButton(logRows()[0]), { ctrlKey: true });
  fireEvent.change(screen.getByLabelText('Individual context before (ms)'), { target: { value: '150' } });
  fireEvent.change(screen.getByLabelText('Individual context after (ms)'), { target: { value: '250' } });
  fireEvent.click(screen.getByRole('button', { name: 'Off' }));
  fireEvent.keyDown(screen.getByLabelText('Individual context after (ms)'), { key: 'Enter' });
  expect(onIndividualContextWindowsChange).toHaveBeenLastCalledWith({
    [selected[0]]: { beforeMs: 150, afterMs: 250, enabled: true },
    [selected[1]]: { beforeMs: 150, afterMs: 250, enabled: true },
  });
  fireEvent.mouseDown(flagButton(logRows()[0]), { ctrlKey: true, button: 0 });
  fireEvent.click(flagButton(logRows()[0]), { ctrlKey: true });
  fireEvent.change(screen.getByLabelText('Individual context before (ms)'), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('Individual context after (ms)'), { target: { value: '' } });
  fireEvent.keyDown(screen.getByLabelText('Individual context after (ms)'), { key: 'Enter' });
  expect(onIndividualContextWindowsChange).toHaveBeenLastCalledWith({});
  expect(flagButton(logRows()[0]).hasAttribute('data-individual-window')).toBe(false);
});
