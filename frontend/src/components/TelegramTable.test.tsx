import { render, fireEvent, screen } from '@testing-library/react';
import { expect, test, vi, beforeAll } from 'vitest';
import { TelegramTable, type SortConfig } from './TelegramTable';
import { makeTelegram } from '../test/telegramFactory';
import type { Telegram } from '../hooks/useWebSocket';
import { DEFAULT_FILTERS } from '../types/filters';
import { anchorKey } from '../utils/anchorKey';

// jsdom has no layout: give the virtualizer a viewport and rows a rect so it
// renders items and the anchor logic finds rows.
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

/** `count` telegrams sorted newest-first, 1 s apart, ending at `newestOffsetS`. */
const makeList = (count: number, newestOffsetS: number): Telegram[] => {
  const base = new Date('2024-01-01T10:00:00.000Z').getTime();
  return Array.from({ length: count }, (_, i) => {
    const t = base + (newestOffsetS - i) * 1000;
    return makeTelegram({ timestamp: new Date(t).toISOString(), raw_hex: `0x${newestOffsetS - i}` });
  });
};

const renderTable = (telegrams: Telegram[]) =>
  render(
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

const stripesByKey = (container: HTMLElement): Map<string, string> => {
  const map = new Map<string, string>();
  for (const row of container.querySelectorAll<HTMLElement>('.log-row')) {
    map.set(row.getAttribute('data-akey')!, row.style.background);
  }
  return map;
};

test('zebra stripes stay with their telegram when new ones are prepended (#266)', () => {
  const { container, rerender } = renderTable(makeList(6, 5));
  const before = stripesByKey(container);
  expect(before.size).toBeGreaterThan(2);

  // One new telegram arrives at the live edge (top, newest-first).
  rerender(
    <TelegramTable
      telegrams={makeList(7, 6)}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
    />,
  );

  const after = stripesByKey(container);
  for (const [key, background] of before) {
    expect(after.get(key), `stripe of row ${key} must not change`).toBe(background);
  }

  // Adjacent rows still alternate.
  const rows = [...container.querySelectorAll<HTMLElement>('.log-row')];
  for (let i = 1; i < rows.length; i++) {
    expect(rows[i].style.background).not.toBe(rows[i - 1].style.background);
  }
});

test('clicking a row pauses live-following (#266)', () => {
  const { container, rerender } = renderTable(makeList(6, 5));
  fireEvent.click(container.querySelectorAll('.log-row')[2]);

  rerender(
    <TelegramTable
      telegrams={makeList(7, 6)}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
    />,
  );

  // Anchored away from the live edge: the jump-to-live pill appears.
  expect(screen.getByText(/1 new telegram/)).toBeInTheDocument();
});

test('newest-on-bottom: clicking a row stays anchored while the full buffer evicts (#297)', () => {
  const asc: SortConfig = [{ key: 'timestamp', direction: 'asc' }];
  // In asc view the parent hands rows oldest-first, newest at the bottom edge.
  const oldestFirst = (count: number, newestOffsetS: number) => makeList(count, newestOffsetS).slice().reverse();
  const renderAsc = (telegrams: Telegram[]) =>
    render(
      <TelegramTable
        telegrams={telegrams}
        visibleColumns={visibleColumns}
        sortConfig={asc}
        onSort={vi.fn()}
        activeFilters={DEFAULT_FILTERS}
        onQuickFilter={vi.fn()}
        onQuickVisualize={vi.fn()}
      />,
    );

  const { container, rerender } = renderAsc(oldestFirst(6, 5));
  // Click a row that is neither the oldest nor the newest, then simulate a
  // capacity eviction: one new telegram at the bottom, one dropped from the top.
  fireEvent.click(container.querySelectorAll('.log-row')[2]);
  rerender(
    <TelegramTable
      telegrams={oldestFirst(6, 6)}
      visibleColumns={visibleColumns}
      sortConfig={asc}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
    />,
  );

  // The list stayed anchored rather than snapping to the (bottom) live edge.
  expect(screen.getByText(/1 new telegram/)).toBeInTheDocument();
});

test('without a click the table keeps following the live edge', () => {
  renderTable(makeList(6, 5));
  const { rerender } = renderTable(makeList(6, 5));
  rerender(
    <TelegramTable
      telegrams={makeList(7, 6)}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
    />,
  );
  expect(screen.queryByText(/new telegram/)).not.toBeInTheDocument();
});

test('multi-level sort (#311): plain click replaces, ctrl-click adds a level', () => {
  const onSort = vi.fn();
  render(
    <TelegramTable
      telegrams={makeList(3, 2)}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={onSort}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
    />,
  );

  const sourceHeader = screen.getByText('SOURCE').closest('button')!;
  fireEvent.click(sourceHeader);
  expect(onSort).toHaveBeenLastCalledWith('source_address', { additive: false });

  fireEvent.click(sourceHeader, { ctrlKey: true });
  expect(onSort).toHaveBeenLastCalledWith('source_address', { additive: true });

  fireEvent.click(sourceHeader, { metaKey: true });
  expect(onSort).toHaveBeenLastCalledWith('source_address', { additive: true });
});

test('column headers can be reordered via drag and drop', () => {
  const onColumnOrderChange = vi.fn();
  const dataTransfer = {
    setData: vi.fn(),
    getData: vi.fn(),
    effectAllowed: 'move',
    dropEffect: 'move',
  } as unknown as DataTransfer;

  render(
    <TelegramTable
      telegrams={makeList(3, 2)}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      tableConfig={{
        sortConfig,
        onSort: vi.fn(),
        visibleColumns,
        columnOrder: ['time', 'delta', 'source', 'target', 'type', 'dpt', 'value'],
        onColumnOrderChange,
      }}
    />,
  );

  const sourceHeaderCol = screen.getByText('SOURCE').closest('.header-col') as HTMLElement;
  const valueHeaderCol = screen.getByText('VALUE').closest('.header-col') as HTMLElement;

  fireEvent.dragStart(sourceHeaderCol, { dataTransfer });
  fireEvent.dragOver(valueHeaderCol, { dataTransfer, clientX: 999 });
  fireEvent.drop(valueHeaderCol, { dataTransfer, clientX: 999 });

  expect(onColumnOrderChange).toHaveBeenCalledWith(['time', 'delta', 'target', 'type', 'dpt', 'value', 'source']);
});

test('multi-level sort (#311): a numbered badge marks each explicit level beyond the first', () => {
  const multiSort: SortConfig = [{ key: 'source_address', direction: 'asc' }, { key: 'target_address', direction: 'desc' }];
  render(
    <TelegramTable
      telegrams={makeList(3, 2)}
      visibleColumns={visibleColumns}
      sortConfig={multiSort}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
    />,
  );

  const sourceHeader = screen.getByText('SOURCE').closest('button')!;
  const targetHeader = screen.getByText('TARGET').closest('button')!;
  expect(sourceHeader).toHaveTextContent('1');
  expect(targetHeader).toHaveTextContent('2');
});

test('delta column (#311): stays visible when sorted by a non-time column', () => {
  const bySource: SortConfig = [{ key: 'source_address', direction: 'asc' }];
  render(
    <TelegramTable
      telegrams={makeList(3, 2)}
      visibleColumns={visibleColumns}
      sortConfig={bySource}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
    />,
  );
  expect(screen.getByText('Δt')).toBeInTheDocument();
});

test('delta column shows previous/next deltas with opposite signs and conditional line styles', () => {
  renderTable(makeList(3, 2));

  const minus = screen.getAllByText('- 00:01.000')[0] as HTMLElement;
  const plus = screen.getAllByText('+ 00:01.000')[0] as HTMLElement;

  expect(minus.style.fontSize).toBe('0.7rem');
  expect(minus.style.color).toBe('var(--text-main)');
  expect(plus.style.fontSize).toBe('0.65rem');
  expect(plus.style.color).toBe('var(--text-dim)');
});

test('delta-sort exclusive mode (#311): activates on click, pauses live-follow, and exits on another header click', () => {
  const onListFollowChange = vi.fn();
  const { rerender } = render(
    <TelegramTable
      telegrams={makeList(6, 5)}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      listFollow={true}
      onListFollowChange={onListFollowChange}
    />,
  );

  fireEvent.click(screen.getByText('Δt').closest('button')!);
  expect(onListFollowChange).toHaveBeenCalledWith(false);

  // New telegrams while delta-sort is active don't reach the frozen view.
  onListFollowChange.mockClear();
  rerender(
    <TelegramTable
      telegrams={makeList(7, 6)}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      listFollow={false}
      onListFollowChange={onListFollowChange}
    />,
  );
  expect(screen.queryByText(/new telegram/)).not.toBeInTheDocument();

  // Clicking a real column header exits delta-sort and restores live-follow.
  fireEvent.click(screen.getByText('SOURCE').closest('button')!);
  expect(onListFollowChange).toHaveBeenLastCalledWith(true);
});

test('quick info bar (#311): toggled via the header button and summarizes the visible rows', () => {
  render(
    <TelegramTable
      telegrams={makeList(4, 3)}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
    />,
  );

  expect(screen.queryByText(/types:\s*W\s*\/\s*dirs:\s*In/i)).not.toBeInTheDocument();
  fireEvent.click(screen.getByTitle('Show info bar'));
  expect(screen.getByText(/types:\s*W\s*\/\s*dirs:\s*In/i)).toBeInTheDocument();
  expect(screen.getByText(/Oldest:/)).toBeInTheDocument();
  expect(screen.getByText(/Newest:/)).toBeInTheDocument();
});

test('quick info oldest/newest clicks only add marks and never remove them', () => {
  const { container } = render(
    <TelegramTable
      telegrams={makeList(4, 3)}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByTitle('Show info bar'));

  fireEvent.click(screen.getByText(/Oldest:/));
  expect(container.querySelectorAll('.log-row.marked')).toHaveLength(1);
  expect(container.querySelector('.log-row.latest')).toBeTruthy();

  fireEvent.click(screen.getByText(/Newest:/));
  expect(container.querySelectorAll('.log-row.marked')).toHaveLength(2);
  expect(container.querySelector('.log-row.latest')).toBeTruthy();

  // Repeating the same target keeps marks set (no unmarking).
  fireEvent.click(screen.getByText(/Newest:/));
  expect(container.querySelectorAll('.log-row.marked')).toHaveLength(2);
  expect(container.querySelector('.log-row.latest')).toBeTruthy();
});

test('quick info source shows all-buffer source count and filtered/context source counts', () => {
  const rows: Telegram[] = [
    makeTelegram({ timestamp: '2024-01-01T10:00:03.000Z', source_address: '1.1.1', raw_hex: '0x31' }),
    makeTelegram({ timestamp: '2024-01-01T10:00:02.000Z', source_address: '1.1.2', raw_hex: '0x32' }),
    makeTelegram({ timestamp: '2024-01-01T10:00:01.000Z', source_address: '1.1.3', raw_hex: '0x33' }),
  ];

  render(
    <TelegramTable
      telegrams={rows}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      quickFilterOpen
      quickFilterEnabled
      quickPatterns={{ source: { top: '1.1.1', bottom: '' } }}
      allBufferSourceCount={3}
      projectSourceCount={7}
    />,
  );

  fireEvent.click(screen.getByTitle('Show info bar'));

  expect(screen.getByText('buffer: 3 / 7')).toBeInTheDocument();
  expect(screen.getByTitle('Filtered source-device count')).toBeInTheDocument();
  expect(screen.getByText('filtered')).toBeInTheDocument();
});

test('quick info source hides filtered buffer count when all devices are shown', () => {
  const rows: Telegram[] = [
    makeTelegram({ timestamp: '2024-01-01T10:00:03.000Z', source_address: '1.1.1', raw_hex: '0x41' }),
    makeTelegram({ timestamp: '2024-01-01T10:00:02.000Z', source_address: '1.1.2', raw_hex: '0x42' }),
    makeTelegram({ timestamp: '2024-01-01T10:00:01.000Z', source_address: '1.1.3', raw_hex: '0x43' }),
  ];

  render(
    <TelegramTable
      telegrams={rows}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      allBufferSourceCount={3}
      projectSourceCount={7}
    />,
  );

  fireEvent.click(screen.getByTitle('Show info bar'));

  expect(screen.getByText('buffer: 3 / 7')).toBeInTheDocument();
  expect(screen.queryByText('3 filtered')).not.toBeInTheDocument();
});

test('quick info source bottom line includes contextual source count in parentheses', () => {
  const rows: Telegram[] = [
    makeTelegram({ timestamp: '2024-01-01T10:00:03.000Z', source_address: '1.1.1', raw_hex: '0x51' }),
    makeTelegram({ timestamp: '2024-01-01T10:00:02.000Z', source_address: '1.1.2', raw_hex: '0x52' }),
    makeTelegram({ timestamp: '2024-01-01T10:00:01.000Z', source_address: '1.1.3', raw_hex: '0x53' }),
  ];
  const context = new Set([anchorKey(rows[1])]);

  render(
    <TelegramTable
      telegrams={rows}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      allBufferSourceCount={3}
      projectSourceCount={7}
      contextKeys={context}
    />,
  );

  fireEvent.click(screen.getByTitle('Show info bar'));

  expect(screen.getByText('buffer: 3 / 7')).toBeInTheDocument();
  expect(screen.getByTitle('Filtered source-device count')).toBeInTheDocument();
  expect(screen.getByTitle('Contextual source-device count')).toBeInTheDocument();
});

test('quick info target shows all-buffer/project counts and filtered target count', () => {
  const rows: Telegram[] = [
    makeTelegram({ timestamp: '2024-01-01T10:00:03.000Z', target_address: '1/1/1', raw_hex: '0x61' }),
    makeTelegram({ timestamp: '2024-01-01T10:00:02.000Z', target_address: '1/1/2', raw_hex: '0x62' }),
    makeTelegram({ timestamp: '2024-01-01T10:00:01.000Z', target_address: '1/1/3', raw_hex: '0x63' }),
  ];

  render(
    <TelegramTable
      telegrams={rows}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      quickFilterOpen
      quickFilterEnabled
      quickPatterns={{ target: { top: '1/1/1', bottom: '' } }}
      allBufferTargetCount={3}
      projectTargetCount={11}
    />,
  );

  fireEvent.click(screen.getByTitle('Show info bar'));

  expect(screen.getByText('buffer: 3 / 11')).toBeInTheDocument();
  expect(screen.getByTitle('Filtered target-device count')).toBeInTheDocument();
  expect(screen.getByText('filtered')).toBeInTheDocument();
});

test('quick info target bottom line includes contextual target count only when > 0', () => {
  const rows: Telegram[] = [
    makeTelegram({ timestamp: '2024-01-01T10:00:03.000Z', target_address: '1/2/1', raw_hex: '0x71' }),
    makeTelegram({ timestamp: '2024-01-01T10:00:02.000Z', target_address: '1/2/2', raw_hex: '0x72' }),
    makeTelegram({ timestamp: '2024-01-01T10:00:01.000Z', target_address: '1/2/3', raw_hex: '0x73' }),
  ];
  const context = new Set([anchorKey(rows[1])]);

  render(
    <TelegramTable
      telegrams={rows}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      allBufferTargetCount={3}
      projectTargetCount={11}
      contextKeys={context}
    />,
  );

  fireEvent.click(screen.getByTitle('Show info bar'));

  expect(screen.getByText('buffer: 3 / 11')).toBeInTheDocument();
  expect(screen.getByTitle('Filtered target-device count')).toBeInTheDocument();
  expect(screen.getByTitle('Contextual target-device count')).toBeInTheDocument();
});

test('quick info type shows types/directions for total buffer on top and filtered set on bottom', () => {
  const rows: Telegram[] = [
    makeTelegram({ timestamp: '2024-01-01T10:00:03.000Z', simplified_type: 'Write', direction: 'Incoming', raw_hex: '0x81' }),
    makeTelegram({ timestamp: '2024-01-01T10:00:02.000Z', simplified_type: 'Read', direction: 'Outgoing', raw_hex: '0x82' }),
    makeTelegram({ timestamp: '2024-01-01T10:00:01.000Z', simplified_type: 'Response', direction: 'Incoming', raw_hex: '0x83' }),
  ];

  render(
    <TelegramTable
      telegrams={rows}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      quickFilterOpen
      quickFilterEnabled
      quickPatterns={{ type: { top: 'Write', bottom: '' } }}
      allBufferTypes={['Write', 'Read', 'Response']}
      allBufferDirections={['Incoming', 'Outgoing']}
    />,
  );

  fireEvent.click(screen.getByTitle('Show info bar'));

  expect(screen.getByText('types: W, R, Rsp / dirs: In, Out')).toBeInTheDocument();
  expect(screen.getByText('types: W / dirs: In')).toBeInTheDocument();
});

test('quick info type bottom line shows only differing segment(s) versus top line', () => {
  const rows: Telegram[] = [
    makeTelegram({ timestamp: '2024-01-01T10:00:03.000Z', simplified_type: 'Write', direction: 'Outgoing', raw_hex: '0x84' }),
    makeTelegram({ timestamp: '2024-01-01T10:00:02.000Z', simplified_type: 'Write', direction: 'Incoming', raw_hex: '0x85' }),
  ];

  render(
    <TelegramTable
      telegrams={rows}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      quickFilterOpen
      quickFilterEnabled
      quickPatterns={{ type: { top: 'Write', bottom: 'Outgoing' } }}
      allBufferTypes={['Write']}
      allBufferDirections={['Incoming', 'Outgoing']}
    />,
  );

  fireEvent.click(screen.getByTitle('Show info bar'));

  expect(screen.getByText('types: W / dirs: In, Out')).toBeInTheDocument();
  expect(screen.getByText('types: W / dirs: Out')).toBeInTheDocument();
  expect(screen.queryByText('dirs: Out')).not.toBeInTheDocument();
});

test('quick info type bottom line is shown when messages are filtered out even with same summaries', () => {
  const rows: Telegram[] = [
    makeTelegram({ timestamp: '2024-01-01T10:00:03.000Z', simplified_type: 'Write', direction: 'Incoming', source_address: '1.1.1', raw_hex: '0x86' }),
    makeTelegram({ timestamp: '2024-01-01T10:00:02.000Z', simplified_type: 'Write', direction: 'Incoming', source_address: '1.1.2', raw_hex: '0x87' }),
  ];

  render(
    <TelegramTable
      telegrams={rows}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      quickFilterOpen
      quickFilterEnabled
      quickPatterns={{ source: { top: '1.1.1', bottom: '' } }}
      allBufferTypes={['Write']}
      allBufferDirections={['Incoming']}
      quickFilterFiltersOutAny
    />,
  );

  fireEvent.click(screen.getByTitle('Show info bar'));

  expect(screen.getAllByText('types: W / dirs: In')).toHaveLength(2);
});

test('quick info dpt shows main/main.sub values for total buffer and filtered set', () => {
  const rows: Telegram[] = [
    makeTelegram({ timestamp: '2024-01-01T10:00:03.000Z', dpt_main: 1, dpt_sub: 1, dpt_name: 'Switch', raw_hex: '0x91' }),
    makeTelegram({ timestamp: '2024-01-01T10:00:02.000Z', dpt_main: 5, dpt_sub: 1, dpt_name: 'Percent', raw_hex: '0x92' }),
    makeTelegram({ timestamp: '2024-01-01T10:00:01.000Z', dpt_main: 1, dpt_sub: 2, dpt_name: 'Boolean', raw_hex: '0x93' }),
  ];

  render(
    <TelegramTable
      telegrams={rows}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      quickFilterOpen
      quickFilterEnabled
      quickPatterns={{ dpt: { top: '1.*', bottom: '' } }}
      allBufferDptMains={['1', '5']}
      allBufferDptMainSubs={['1.001', '5.001', '1.002']}
    />,
  );

  fireEvent.click(screen.getByTitle('Show info bar'));

  expect(screen.getByText('main: 2 / DPT: 3')).toBeInTheDocument();
  expect(screen.getByText('main: 1 / DPT: 2')).toBeInTheDocument();
});

test('quick info value shows buffer/msg totals and filtered/context/marked/context-active counts', () => {
  const rows: Telegram[] = [
    makeTelegram({ timestamp: '2024-01-01T10:00:03.000Z', raw_hex: '0xA1' }),
    makeTelegram({ timestamp: '2024-01-01T10:00:02.000Z', raw_hex: '0xA2' }),
    makeTelegram({ timestamp: '2024-01-01T10:00:01.000Z', raw_hex: '0xA3' }),
  ];
  const contextKeys = new Set([anchorKey(rows[1])]);
  const marked = [anchorKey(rows[0]), anchorKey(rows[1])];
  const flagged = [anchorKey(rows[2])];

  render(
    <TelegramTable
      telegrams={rows}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      contextKeys={contextKeys}
      markedKeys={marked}
      flaggedKeys={flagged}
      bufferCapacity={100000}
      allBufferMessageCount={3}
    />,
  );

  fireEvent.click(screen.getByTitle('Show info bar'));

  expect(screen.getByText('msg: 3 / buf: 100000, marks:')).toBeInTheDocument();
  expect(screen.getByTitle('Marked message count')).toHaveTextContent('2');
  expect(screen.getByText('context marks:')).toBeInTheDocument();
  expect(screen.getByTitle('Context-marked message count')).toHaveTextContent('1');
  expect(screen.getByText('2 filtered (1)')).toBeInTheDocument();
});

test('quick info value mark/context-mark buttons toggle row filtering', () => {
  const rows: Telegram[] = [
    makeTelegram({ timestamp: '2024-01-01T10:00:03.000Z', raw_hex: '0xB1' }),
    makeTelegram({ timestamp: '2024-01-01T10:00:02.000Z', raw_hex: '0xB2' }),
    makeTelegram({ timestamp: '2024-01-01T10:00:01.000Z', raw_hex: '0xB3' }),
  ];
  const marked = [anchorKey(rows[0]), anchorKey(rows[2])];
  const flagged = [anchorKey(rows[1])];

  const { container } = render(
    <TelegramTable
      telegrams={rows}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={{ ...DEFAULT_FILTERS, deltaBeforeMs: 1000, deltaAfterMs: 0, deltaContextEnabled: true }}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      markedKeys={marked}
      flaggedKeys={flagged}
      bufferCapacity={100000}
      allBufferMessageCount={3}
    />,
  );

  fireEvent.click(screen.getByTitle('Show info bar'));
  expect(container.querySelectorAll('.log-row')).toHaveLength(3);

  fireEvent.click(screen.getByTitle('Marked message count'));
  expect(container.querySelectorAll('.log-row')).toHaveLength(2);

  fireEvent.click(screen.getByTitle('Context-marked message count'));
  expect(container.querySelectorAll('.log-row')).toHaveLength(1);

  fireEvent.click(screen.getByTitle('Context-marked message count'));
  expect(container.querySelectorAll('.log-row')).toHaveLength(3);
});

test('quick info value mark/context-mark filters keep contextual rows visible', () => {
  const rows: Telegram[] = [
    makeTelegram({ timestamp: '2024-01-01T10:00:03.000Z', raw_hex: '0xD1' }),
    makeTelegram({ timestamp: '2024-01-01T10:00:02.000Z', raw_hex: '0xD2' }),
    makeTelegram({ timestamp: '2024-01-01T10:00:01.000Z', raw_hex: '0xD3' }),
  ];
  const marked = [anchorKey(rows[0])];
  const flagged = [anchorKey(rows[0])];
  const contextKeys = new Set([anchorKey(rows[1])]);

  const { container } = render(
    <TelegramTable
      telegrams={rows}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={{ ...DEFAULT_FILTERS, deltaBeforeMs: 1000, deltaAfterMs: 0, deltaContextEnabled: true }}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      markedKeys={marked}
      flaggedKeys={flagged}
      contextKeys={contextKeys}
      bufferCapacity={100000}
      allBufferMessageCount={3}
    />,
  );

  fireEvent.click(screen.getByTitle('Show info bar'));

  fireEvent.click(screen.getByTitle('Marked message count'));
  expect(container.querySelectorAll('.log-row')).toHaveLength(2);

  fireEvent.click(screen.getByTitle('Context-marked message count'));
  expect(container.querySelectorAll('.log-row')).toHaveLength(2);
});

test('quick info value mark/context-mark toggles are disabled when count is zero', () => {
  const rows: Telegram[] = [
    makeTelegram({ timestamp: '2024-01-01T10:00:03.000Z', raw_hex: '0xC1' }),
    makeTelegram({ timestamp: '2024-01-01T10:00:02.000Z', raw_hex: '0xC2' }),
  ];

  const { container } = render(
    <TelegramTable
      telegrams={rows}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      bufferCapacity={100000}
      allBufferMessageCount={2}
    />,
  );

  fireEvent.click(screen.getByTitle('Show info bar'));

  const marksBtn = screen.getByTitle('Marked message count');
  const ctxBtn = screen.getByTitle('Context-marked message count');
  expect(marksBtn).toBeDisabled();
  expect(ctxBtn).toBeDisabled();

  fireEvent.click(marksBtn);
  fireEvent.click(ctxBtn);
  expect(container.querySelectorAll('.log-row')).toHaveLength(2);
});

test('marks filter auto-disables when ctrl-click on a row clears the last mark', () => {
  const rows: Telegram[] = [
    makeTelegram({ timestamp: '2024-01-01T10:00:03.000Z', raw_hex: '0xE1' }),
    makeTelegram({ timestamp: '2024-01-01T10:00:02.000Z', raw_hex: '0xE2' }),
  ];

  const { container } = render(
    <TelegramTable
      telegrams={rows}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      bufferCapacity={100000}
      allBufferMessageCount={2}
    />,
  );

  fireEvent.click(container.querySelector('.log-row')!);
  fireEvent.click(screen.getByTitle('Show info bar'));
  fireEvent.click(screen.getByTitle('Marked message count'));
  expect(container.querySelectorAll('.log-row')).toHaveLength(1);

  fireEvent.click(container.querySelector('.log-row')!, { ctrlKey: true });

  expect(container.querySelectorAll('.log-row')).toHaveLength(2);
  expect(screen.getByTitle('Marked message count')).toHaveTextContent('0');
});

test('quick info delta min/max clicks only add marks and never remove them', () => {
  const base = new Date('2024-01-01T10:00:00.000Z').getTime();
  const rows: Telegram[] = [
    makeTelegram({ timestamp: new Date(base + 10_000).toISOString(), raw_hex: '0x10' }),
    makeTelegram({ timestamp: new Date(base + 9_000).toISOString(), raw_hex: '0x09' }),
    makeTelegram({ timestamp: new Date(base + 5_000).toISOString(), raw_hex: '0x05' }),
    makeTelegram({ timestamp: new Date(base + 0).toISOString(), raw_hex: '0x00' }),
  ];

  const { container } = render(
    <TelegramTable
      telegrams={rows}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
    />,
  );

  fireEvent.click(screen.getByTitle('Show info bar'));

  fireEvent.click(screen.getByText(/Min Δt:/));
  expect(container.querySelectorAll('.log-row.marked')).toHaveLength(1);
  expect(container.querySelector('.log-row.latest')).toBeTruthy();

  fireEvent.click(screen.getByText(/Max Δt:/));
  expect(container.querySelectorAll('.log-row.marked')).toHaveLength(2);
  expect(container.querySelector('.log-row.latest')).toBeTruthy();

  fireEvent.click(screen.getByText(/Max Δt:/));
  expect(container.querySelectorAll('.log-row.marked')).toHaveLength(2);
  expect(container.querySelector('.log-row.latest')).toBeTruthy();
});

test('optional repeated-value hiding suppresses duplicate SOURCE entries on the sort level while keeping the first row value', () => {
  const rows: Telegram[] = [
    makeTelegram({ timestamp: '2024-01-01T10:00:03.000Z', source_address: '1.1.1', source_name: 'Kitchen', raw_hex: '0x11' }),
    makeTelegram({ timestamp: '2024-01-01T10:00:02.000Z', source_address: '1.1.1', source_name: 'Kitchen', raw_hex: '0x12' }),
    makeTelegram({ timestamp: '2024-01-01T10:00:01.000Z', source_address: '1.1.2', source_name: 'Hall', raw_hex: '0x13' }),
  ];

  const { container } = render(
    <TelegramTable
      telegrams={rows}
      visibleColumns={visibleColumns}
      sortConfig={[{ key: 'source_address', direction: 'desc' }]}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      tableConfig={{
        sortConfig: [{ key: 'source_address', direction: 'desc' }],
        onSort: vi.fn(),
        visibleColumns,
        columns: {
          source: { hideRepeatedWhenSorted: true },
        },
      }}
    />,
  );

  expect(screen.getAllByText('1.1.1')).toHaveLength(1);
  expect(screen.getByText('1.1.2')).toBeInTheDocument();
  expect(container.querySelectorAll('.log-row')).toHaveLength(3);
});

test('alt-click on a sortable header toggles repeated-value hiding for that column', () => {
  const rows: Telegram[] = [
    makeTelegram({ timestamp: '2024-01-01T10:00:03.000Z', source_address: '1.1.1', source_name: 'Kitchen', raw_hex: '0x21' }),
    makeTelegram({ timestamp: '2024-01-01T10:00:02.000Z', source_address: '1.1.1', source_name: 'Kitchen', raw_hex: '0x22' }),
    makeTelegram({ timestamp: '2024-01-01T10:00:01.000Z', source_address: '1.1.2', source_name: 'Hall', raw_hex: '0x23' }),
  ];

  render(
    <TelegramTable
      telegrams={rows}
      visibleColumns={visibleColumns}
      sortConfig={[{ key: 'source_address', direction: 'desc' }]}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
    />,
  );

  expect(screen.getAllByText('1.1.1')).toHaveLength(1);

  const sourceHeader = screen.getByText('SOURCE').closest('button')!;
  fireEvent.click(sourceHeader, { altKey: true });

  expect(screen.getAllByText('1.1.1')).toHaveLength(2);
});

test('context rows (#343): marked with a distinct class/tooltip and counted in the info bar', () => {
  const rows = makeList(3, 2);
  rows[0] = { ...rows[0], target_address: '1/1/1' };
  rows[1] = { ...rows[1], target_address: '1/1/2' };
  rows[2] = { ...rows[2], target_address: '1/1/1' };
  const contextKeys = new Set([anchorKey(rows[1])]); // the middle row is context-only

  const { container } = render(
    <TelegramTable
      telegrams={rows}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      contextKeys={contextKeys}
    />,
  );

  const logRows = [...container.querySelectorAll('.log-row')];
  expect(logRows.filter(r => r.classList.contains('context'))).toHaveLength(1);
  expect(logRows.find(r => r.classList.contains('context'))).toHaveAttribute(
    'title', 'Unfiltered Time-Delta-Context — this telegram did not match the active filters'
  );

  fireEvent.click(screen.getByTitle('Show info bar'));
  expect(screen.getByTitle('Filtered target-device count')).toBeInTheDocument();
  expect(screen.getByTitle('Contextual target-device count')).toBeInTheDocument();
});

test('context rows (#343): marking a context row hides the context styling in favor of the mark', () => {
  const rows = makeList(3, 2);
  const contextKeys = new Set([anchorKey(rows[1])]);

  const { container } = render(
    <TelegramTable
      telegrams={rows}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      contextKeys={contextKeys}
    />,
  );

  const logRows = [...container.querySelectorAll('.log-row')];
  fireEvent.click(logRows[1]); // mark the context row
  expect(logRows[1].classList.contains('marked')).toBe(true);
  expect(logRows[1].classList.contains('context')).toBe(false);
});
