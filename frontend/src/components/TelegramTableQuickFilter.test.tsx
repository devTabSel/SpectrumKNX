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

const contextFilters = { ...DEFAULT_FILTERS, targets: ['1/2/3'], deltaBeforeMs: 1000, deltaAfterMs: 0 };

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

  // A regular expression needs the regex: prefix. A bare value is a substring.
  fireEvent.change(nameInput, { target: { value: 'Küche|Flur' } });
  expect(rowCount(container)).toBe(0);
  fireEvent.change(nameInput, { target: { value: 'regex:Küche|Flur' } });
  expect(rowCount(container)).toBe(2);
  fireEvent.change(nameInput, { target: { value: '"*Küche","*Flur"' } });
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

test('a bare name value is a literal substring, and an invalid regex: falls back to one', () => {
  const { container } = renderTable();
  fireEvent.click(screen.getByTitle('Show quick filter bar'));
  const nameInput = screen.getByLabelText('Quick filter TARGET name');

  // "(" is a literal substring — must not crash, and no name contains it.
  fireEvent.change(nameInput, { target: { value: '(' } });
  expect(rowCount(container)).toBe(0);
  fireEvent.change(nameInput, { target: { value: 'regex:(' } });
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
  fireEvent.click(screen.getByTitle('Disable quick filter (keeps patterns) · ctrl/cmd-click clears all quick-filter cells and enables every column'));
  expect(rowCount(container)).toBe(3);
  expect(screen.getByLabelText('Quick filter TARGET name')).toHaveValue('küche');

  // Re-enable — filtering resumes with the kept pattern.
  fireEvent.click(screen.getByTitle('Enable quick filter · ctrl/cmd-click clears all quick-filter cells and enables every column'));
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

test('TYPE matches the type row and the direction row separately', () => {
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
  const typeInput = screen.getByLabelText('Quick filter TYPE');
  const directionInput = screen.getByLabelText('Quick filter TYPE direction');

  // A bare comma list is a literal, so it matches neither type nor direction.
  fireEvent.change(typeInput, { target: { value: 'Write, Outgoing' } });
  expect(rowCount(container)).toBe(0);

  fireEvent.change(typeInput, { target: { value: '"Write", "Read"' } });
  expect(rowCount(container)).toBe(2);

  fireEvent.change(typeInput, { target: { value: '' } });
  fireEvent.change(directionInput, { target: { value: 'regex:out' } });
  expect(rowCount(container)).toBe(1);
});

test("a column's header filter button turns that column off, and ctrl/cmd-click clears its cells", () => {
  const { container } = renderTable();
  fireEvent.click(screen.getByTitle('Show quick filter bar'));
  const nameInput = screen.getByLabelText('Quick filter TARGET name');
  fireEvent.change(nameInput, { target: { value: 'küche' } });
  expect(rowCount(container)).toBe(1);

  fireEvent.click(screen.getByTitle("Disable quick filter for TARGET · ctrl/cmd-click clears this column's quick-filter cells"));
  expect(rowCount(container)).toBe(3);
  expect(nameInput).toBeDisabled();
  expect(nameInput).toHaveValue('küche');

  fireEvent.click(screen.getByTitle("Enable quick filter for TARGET · ctrl/cmd-click clears this column's quick-filter cells"), { ctrlKey: true });
  expect(nameInput).toHaveValue('');
  expect(nameInput).toBeDisabled();
  expect(rowCount(container)).toBe(3);
});

test('ctrl/cmd-click on the global quick filter clears every cell and enables the filter and every column', () => {
  const { container } = renderTable();
  fireEvent.click(screen.getByTitle('Show quick filter bar'));
  const nameInput = screen.getByLabelText('Quick filter TARGET name');
  const sourceInput = screen.getByLabelText('Quick filter SOURCE name');
  fireEvent.change(nameInput, { target: { value: 'küche' } });
  fireEvent.change(sourceInput, { target: { value: '1.1.1' } });

  fireEvent.click(screen.getByTitle("Disable quick filter for SOURCE · ctrl/cmd-click clears this column's quick-filter cells"));
  expect(sourceInput).toBeDisabled();

  fireEvent.click(screen.getByTitle('Disable quick filter (keeps patterns) · ctrl/cmd-click clears all quick-filter cells and enables every column'));
  expect(nameInput).toHaveValue('küche');
  expect(sourceInput).toHaveValue('1.1.1');

  fireEvent.click(screen.getByTitle('Enable quick filter · ctrl/cmd-click clears all quick-filter cells and enables every column'), { ctrlKey: true });
  expect(nameInput).toHaveValue('');
  expect(sourceInput).toHaveValue('');
  expect(nameInput).toBeEnabled();
  expect(sourceInput).toBeEnabled();
  expect(screen.getByTitle('Disable quick filter (keeps patterns) · ctrl/cmd-click clears all quick-filter cells and enables every column')).toBeInTheDocument();
  expect(screen.getByTitle("Disable quick filter for SOURCE · ctrl/cmd-click clears this column's quick-filter cells")).toBeInTheDocument();
  expect(rowCount(container)).toBe(3);
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

  const toggleBtn = screen.getByTitle(/Time-Delta-Context:/);
  fireEvent.click(toggleBtn, { ctrlKey: true });
  expect(onDeltaContextEnabledChange).toHaveBeenCalledWith(false);

  // Editing a value while enabled still goes through onDeltaContextChange, preserving the other field.
  fireEvent.change(screen.getByLabelText('Time-Delta-Context before (ms)'), { target: { value: '750' } });
  expect(onDeltaContextChange).toHaveBeenCalledWith(750, 250);
});

const flagButton = (row: Element) => row.querySelector('button[title*="around this message"]')!;
const isFlagged = (row: Element) => flagButton(row).getAttribute('title')!.startsWith('Context is shown');

test('plain click on the DELTA TIME toggle switches the context between all and no messages (#319)', () => {
  const { container } = renderTable({ activeFilters: contextFilters });
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
  const { container } = renderTable({ activeFilters: contextFilters, onFlaggedKeysChange, onContextForAllMatchesChange });
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
  const { container } = renderTable({ activeFilters: contextFilters });
  fireEvent.click(screen.getByTitle('Show quick filter bar'));
  const rows = [...container.querySelectorAll('.log-row')];

  fireEvent.click(flagButton(rows[0]));

  expect(screen.getByTitle(/around the flagged messages only/)).toBeInTheDocument();
  expect(rows.map(isFlagged)).toEqual([false, ...rows.slice(1).map(() => true)]);
});

test("ctrl/cmd-click on a row's flag applies its new state to every marked row (#319)", () => {
  const { container } = renderTable({ activeFilters: contextFilters });
  fireEvent.click(screen.getByTitle('Show quick filter bar'));
  fireEvent.click(screen.getByTitle(/around all messages/));
  const rows = [...container.querySelectorAll('.log-row')];

  // Mark two rows (row-marks, #310) then ctrl-click a third row's flag.
  fireEvent.click(rows[0]);
  fireEvent.click(rows[1], { ctrlKey: true });
  fireEvent.click(flagButton(rows[2]), { ctrlKey: true });

  // The two marked rows and the clicked one are now flagged.
  expect(rows.slice(0, 3).every(isFlagged)).toBe(true);
});

const tableProps = (extra: Partial<React.ComponentProps<typeof TelegramTable>> = {}) => ({
  telegrams: TELEGRAMS,
  visibleColumns,
  sortConfig,
  onSort: vi.fn(),
  activeFilters: DEFAULT_FILTERS,
  onQuickFilter: vi.fn(),
  onQuickVisualize: vi.fn(),
  ...extra,
});

test('a quick filter removes mouse-selected rows it hides, and the selection still bulk-applies', () => {
  const view = renderTable();
  const row = (name: string) => [...view.container.querySelectorAll<HTMLElement>('.log-row')].find(r => r.textContent?.includes(name))!;
  fireEvent.click(row('Licht Flur'));
  fireEvent.click(row('Licht Küche'), { ctrlKey: true });

  view.rerender(
    <TelegramTable
      {...tableProps({
        activeFilters: { ...DEFAULT_FILTERS, deltaBeforeMs: 1000 },
        quickFilterOpen: true,
        quickFilterEnabled: true,
        quickPatterns: { target: { top: '', bottom: 'küche' } },
      })}
    />,
  );

  expect(screen.queryByText('Licht Flur')).not.toBeInTheDocument();
  expect(row('Licht Küche').classList.contains('marked')).toBe(true);
  expect(screen.getByTitle('Clear all marks')).toHaveTextContent('Clear 1 mark');

  view.rerender(<TelegramTable {...tableProps()} />);
  expect(row('Licht Flur').classList.contains('marked')).toBe(false);
  expect(row('Licht Küche').classList.contains('marked')).toBe(true);

  fireEvent.click(row('Licht Flur'), { ctrlKey: true });
  fireEvent.click(row('Licht Küche').querySelector('.mark-stripe')!);
  expect(row('Licht Küche').querySelector('.mark-stripe')).toHaveAttribute('aria-pressed', 'true');
  expect(row('Licht Flur').querySelector('.mark-stripe')).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByTitle('Clear all marks')).toHaveTextContent('Clear 2 marks');

  fireEvent.click(screen.getByTitle('Clear all marks'));
  expect(row('Licht Küche').classList.contains('marked')).toBe(false);
  expect(row('Licht Flur').classList.contains('marked')).toBe(false);
  expect(row('Licht Küche').querySelector('.mark-stripe')).toHaveAttribute('aria-pressed', 'false');
  expect(row('Licht Flur').querySelector('.mark-stripe')).toHaveAttribute('aria-pressed', 'false');
  expect(screen.queryByTitle('Clear all marks')).not.toBeInTheDocument();
});

test('a mouse selection is not a mark and is not held for the focus filter', () => {
  const view = renderTable({ focusFilterGas: ['1/2/3'], filterFocusedTargets: true });
  const row = (name: string) => [...view.container.querySelectorAll<HTMLElement>('.log-row')].find(r => r.textContent?.includes(name))!;

  fireEvent.click(row('Licht Küche'));
  fireEvent.click(row('Licht Flur'));
  expect(row('Licht Küche').classList.contains('marked')).toBe(false);
  expect(row('Licht Flur').classList.contains('marked')).toBe(true);
  expect(row('Licht Flur').querySelector<HTMLElement>('.log-row-body')!.style.background).toBe(
    'color-mix(in srgb, var(--accent-primary) 34%, transparent)',
  );
  expect(screen.getByTitle('Clear all marks')).toHaveTextContent('Clear 1 mark');

  fireEvent.click(row('Licht Küche'));
  expect(row('Licht Flur').classList.contains('marked')).toBe(false);
  expect(row('Licht Küche').classList.contains('marked')).toBe(true);

  fireEvent.click(row('Licht Flur'), { ctrlKey: true });
  fireEvent.click(row('Licht Küche').querySelector('.mark-stripe')!);
  expect(row('Licht Küche').querySelector('.mark-stripe')).toHaveAttribute('aria-pressed', 'true');
  expect(row('Licht Flur').querySelector('.mark-stripe')).toHaveAttribute('aria-pressed', 'true');
});

test('a stripe mark stays when the quick filter misses it, and losing the stripe drops a mouse selection on that row', () => {
  const view = renderTable();
  const row = (name: string) => [...view.container.querySelectorAll<HTMLElement>('.log-row')].find(r => r.textContent?.includes(name))!;
  fireEvent.click(row('Licht Flur').querySelector('.mark-stripe')!);
  fireEvent.click(row('Licht Flur'));
  fireEvent.click(row('Licht Küche'), { ctrlKey: true });

  view.rerender(
    <TelegramTable
      {...tableProps({
        quickFilterOpen: true,
        quickFilterEnabled: true,
        quickPatterns: { target: { top: '', bottom: 'küche' } },
      })}
    />,
  );

  expect(screen.getByText('Licht Flur')).toBeInTheDocument();
  expect(screen.getByText('Licht Küche')).toBeInTheDocument();
  expect(screen.queryByText('Jalousie Bad')).not.toBeInTheDocument();
  expect(row('Licht Flur').classList.contains('marked')).toBe(true);
  expect(row('Licht Küche').classList.contains('marked')).toBe(true);
  expect(screen.getByTitle('Clear all marks')).toHaveTextContent('Clear 2 marks');
  expect(row('Licht Flur').style.background).not.toBe('color-mix(in srgb, var(--text-dim) 18%, var(--bg-dark))');
  expect(row('Licht Flur').querySelector<HTMLElement>('.mark-stripe')!.style.background).toBe('var(--text-dim)');

  fireEvent.click(row('Licht Flur').querySelector('.mark-stripe')!);
  expect(screen.queryByText('Licht Flur')).not.toBeInTheDocument();
  expect(row('Licht Küche').classList.contains('marked')).toBe(true);
  expect(screen.getByTitle('Clear all marks')).toHaveTextContent('Clear 1 mark');
});

test('a mouse selection the quick filter misses is dropped, while a stripe mark and context stay', () => {
  const markedKey = anchorKey(TELEGRAMS[1]);
  const highlightedKey = anchorKey(TELEGRAMS[2]);
  const onMarkedKeysChange = vi.fn();
  const { container } = renderTable({
    quickFilterOpen: true,
    quickFilterEnabled: true,
    quickPatterns: { target: { top: '', bottom: 'küche' } },
    markedKeys: [markedKey],
    onMarkedKeysChange,
    highlightedKeys: [highlightedKey],
    contextKeys: new Set([highlightedKey]),
  });
  expect(rowCount(container)).toBe(2);
  expect(screen.getByText('Licht Küche')).toBeInTheDocument();
  expect(screen.queryByText('Licht Flur')).not.toBeInTheDocument();
  expect(screen.getByText('Jalousie Bad')).toBeInTheDocument();
  expect(screen.getByTitle('Clear all marks')).toHaveTextContent('Clear 1 mark');
  expect(onMarkedKeysChange).toHaveBeenCalledWith([]);
});

test('a context row the quick filter misses stays an ordinary mouse selection', () => {
  const contextKey = anchorKey(TELEGRAMS[2]);
  const view = renderTable({
    quickFilterOpen: true,
    quickFilterEnabled: true,
    quickPatterns: { target: { top: '', bottom: 'küche' } },
    contextKeys: new Set([contextKey]),
  });
  const row = (name: string) => [...view.container.querySelectorAll<HTMLElement>('.log-row')].find(r => r.textContent?.includes(name))!;
  const bad = row('Jalousie Bad');
  const stripe = () => bad.querySelector<HTMLElement>('.mark-stripe')!;

  fireEvent.click(stripe());
  expect(bad.style.background).toBe('color-mix(in srgb, var(--warning, #f59e0b) 12%, transparent)');
  expect(stripe().style.background).toBe('var(--warning, #f59e0b)');

  fireEvent.click(bad);
  expect(bad.classList.contains('marked')).toBe(true);
  expect(bad.querySelector<HTMLElement>('.log-row-body')!.style.background).toBe(
    'color-mix(in srgb, var(--accent-primary) 34%, transparent)',
  );
  expect(stripe().style.background).toBe('var(--warning, #f59e0b)');

  fireEvent.click(bad, { ctrlKey: true });
  expect(bad.classList.contains('marked')).toBe(false);
  expect(stripe()).toHaveAttribute('aria-pressed', 'true');
  expect(bad.style.background).toBe('color-mix(in srgb, var(--warning, #f59e0b) 12%, transparent)');

  fireEvent.click(stripe());
  expect(stripe()).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByText('Jalousie Bad')).toBeInTheDocument();
});

test('a marked context row does not become a held selection when the window moves on', () => {
  const contextKey = anchorKey(TELEGRAMS[2]);
  const props = {
    telegrams: TELEGRAMS,
    visibleColumns,
    sortConfig,
    onSort: vi.fn(),
    activeFilters: DEFAULT_FILTERS,
    onQuickFilter: vi.fn(),
    onQuickVisualize: vi.fn(),
    quickFilterOpen: true,
    quickFilterEnabled: true,
    quickPatterns: { target: { top: '', bottom: 'küche' } },
  };
  const view = renderTable({ ...props, contextKeys: new Set([contextKey]) });
  const row = () => [...view.container.querySelectorAll<HTMLElement>('.log-row')].find(r => r.textContent?.includes('Jalousie Bad'))!;
  const stripe = () => row().querySelector<HTMLElement>('.mark-stripe')!;

  fireEvent.click(stripe());
  fireEvent.click(row());
  view.rerender(<TelegramTable {...props} contextKeys={new Set()} />);

  expect(row().classList.contains('marked')).toBe(true);
  expect(stripe()).toHaveAttribute('aria-pressed', 'true');
  expect(stripe().style.background).toBe('var(--warning, #f59e0b)');
  expect(row().querySelector<HTMLElement>('.log-row-body')!.style.background).toBe(
    'color-mix(in srgb, var(--accent-primary) 34%, transparent)',
  );

  fireEvent.click(row(), { ctrlKey: true });
  expect(row().classList.contains('marked')).toBe(false);
  expect(stripe()).toHaveAttribute('aria-pressed', 'true');
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

test('turning off the Δt column filter hides context buttons and context rows', () => {
  const contextKey = anchorKey(TELEGRAMS[2]);
  const view = renderTable({
    quickFilterOpen: true,
    quickFilterEnabled: true,
    quickPatterns: { target: { top: '', bottom: 'küche' } },
    activeFilters: { ...DEFAULT_FILTERS, targets: ['1/2/3'], deltaBeforeMs: 5000, deltaAfterMs: 5000 },
    contextKeys: new Set([contextKey]),
  });
  const flags = () => view.container.querySelectorAll('button[title*="around this message"]');
  expect(screen.getByText('Jalousie Bad')).toBeInTheDocument();
  expect(view.container.querySelector('.log-row.context')).not.toBeNull();
  expect(flags().length).toBeGreaterThan(0);

  fireEvent.click(screen.getByTitle("Disable quick filter for Δt · ctrl/cmd-click clears this column's quick-filter cells"));

  expect(screen.queryByText('Jalousie Bad')).not.toBeInTheDocument();
  expect(screen.getByText('Licht Küche')).toBeInTheDocument();
  expect(flags()).toHaveLength(0);

  fireEvent.click(screen.getByTitle("Enable quick filter for Δt · ctrl/cmd-click clears this column's quick-filter cells"));
  expect(screen.getByText('Jalousie Bad')).toBeInTheDocument();
  expect(flags().length).toBeGreaterThan(0);
});
