import { render, fireEvent, createEvent, screen } from '@testing-library/react';
import { expect, test, vi, beforeAll } from 'vitest';
import { TelegramTable, type SortConfig } from './TelegramTable';
import { makeTelegram } from '../test/telegramFactory';
import type { Telegram } from '../hooks/useWebSocket';
import { DEFAULT_FILTERS } from '../types/filters';
import { anchorKey } from '../utils/anchorKey';

// jsdom has no layout: give the virtualizer a viewport and rows a rect so it
// renders items and the anchor logic finds rows. `scrollBlockSize` is the
// scrollport height; a test can shrink it before rendering.
let scrollBlockSize = 800;
beforeAll(() => {
  globalThis.ResizeObserver = class {
    private cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb;
    }
    observe(el: Element) {
      const size = { inlineSize: 1000, blockSize: el.classList.contains('log-row') ? 85 : scrollBlockSize };
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
  // @tanstack/virtual reads clientHeight, which jsdom leaves at 0.
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get() {
      if (this.classList?.contains('custom-scrollbar')) return scrollBlockSize;
      if (this.classList?.contains('log-row')) return 85;
      return 800;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() { return 1000; },
  });
  // Item measurement falls back to offsetHeight when no ResizeObserver entry
  // is passed. jsdom reports 0, which collapses the list and makes the
  // virtualizer's visible range land on an arbitrary index.
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      if (this.classList?.contains('custom-scrollbar')) return scrollBlockSize;
      if (this.classList?.contains('log-row')) return 85;
      return 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get() {
      if (!this.classList?.contains('custom-scrollbar')) return 0;
      const inner = this.firstElementChild as HTMLElement | null;
      const height = inner ? Number.parseFloat(inner.style.height) : 0;
      return Number.isFinite(height) && height > 0 ? height : scrollBlockSize;
    },
  });
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

const renderTable = (telegrams: Telegram[], activeFilters = DEFAULT_FILTERS) =>
  render(
    <TelegramTable
      telegrams={telegrams}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={activeFilters}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
    />,
  );

/** A narrowing filter plus a time window: the only case where context buttons exist. */
const contextFilters = { ...DEFAULT_FILTERS, targets: ['1/2/3'], deltaBeforeMs: 1000, deltaAfterMs: 0 };

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

test('an active stripe marks an uncoloured row on the stripe and leaves its background', () => {
  const { container } = renderTable(makeList(3, 2));
  const row = (i: number) => container.querySelectorAll<HTMLElement>('.log-row')[i];
  const stripe = (i: number) => row(i).querySelector<HTMLElement>('.mark-stripe')!;

  const resting = stripe(0).style.background;
  const restingRow = row(0).style.background;
  const otherRow = row(1).style.background;
  expect(stripe(0)).toHaveAttribute('aria-pressed', 'false');
  expect(resting).toBe(restingRow);

  fireEvent.click(stripe(0));
  expect(row(0).classList.contains('marked')).toBe(false);
  expect(stripe(0)).toHaveAttribute('aria-pressed', 'true');
  expect(row(0).style.background).toBe(restingRow);
  expect(stripe(0).style.background).toBe('var(--text-dim)');
  expect(stripe(0).style.background).not.toBe(row(0).style.background);
  const body0 = row(0).querySelector<HTMLElement>('.log-row-body')!;
  expect(body0.style.background).toBe('');

  fireEvent.click(stripe(1));
  const body1 = row(1).querySelector<HTMLElement>('.log-row-body')!;
  expect(body1.style.background).toBe('');
  expect(stripe(1).style.background).toBe(stripe(0).style.background);
  expect(row(1).style.background).toBe(otherRow);
  expect(stripe(1).style.background).not.toBe(row(1).style.background);

  const other = stripe(1).style.background;
  const rowBase = row(1).style.background;
  fireEvent.click(row(1));
  expect(row(1).classList.contains('marked')).toBe(true);
  expect(row(1).style.background).toBe(rowBase);
  expect(stripe(1).style.background).toBe(other);
  const body = row(1).querySelector<HTMLElement>('.log-row-body')!;
  expect(body.style.background).toContain('var(--accent-primary)');
  expect(body.style.background).not.toBe(other);
  expect(stripe(0)).toHaveAttribute('aria-pressed', 'true');

  fireEvent.click(stripe(0));
  expect(stripe(0).style.background).toBe(resting);
  expect(row(0).style.background).toBe(resting);
  expect(row(1).classList.contains('marked')).toBe(true);
});

test('a mouse mark covers the stripe while its toggle is off', () => {
  const { container } = renderTable(makeList(3, 2));
  const row = container.querySelector<HTMLElement>('.log-row')!;
  const stripe = row.querySelector<HTMLElement>('.mark-stripe')!;
  expect(stripe).toHaveAttribute('aria-pressed', 'false');

  fireEvent.click(row);
  const body = row.querySelector<HTMLElement>('.log-row-body')!;
  expect(row.classList.contains('marked')).toBe(true);
  expect(stripe.style.background).toBe(body.style.background);
  expect(stripe.style.background).toContain('var(--accent-primary)');

  fireEvent.click(stripe);
  expect(stripe).toHaveAttribute('aria-pressed', 'true');
  expect(stripe.style.background).not.toContain('var(--accent-primary)');
  expect(body.style.background).toContain('var(--accent-primary)');
});

test('the stripe toggle applies to every mouse-marked row', () => {
  const { container } = renderTable(makeList(4, 3));
  const row = (i: number) => container.querySelectorAll<HTMLElement>('.log-row')[i];
  const stripe = (i: number) => row(i).querySelector<HTMLElement>('.mark-stripe')!;

  fireEvent.click(row(0));
  fireEvent.click(row(1), { ctrlKey: true });
  fireEvent.click(stripe(0));

  expect(stripe(0)).toHaveAttribute('aria-pressed', 'true');
  expect(stripe(1)).toHaveAttribute('aria-pressed', 'true');
  expect(stripe(2)).toHaveAttribute('aria-pressed', 'false');
  expect(row(0).classList.contains('marked')).toBe(true);
  expect(row(2).classList.contains('marked')).toBe(false);

  fireEvent.click(stripe(1));
  expect(stripe(0)).toHaveAttribute('aria-pressed', 'false');
  expect(stripe(1)).toHaveAttribute('aria-pressed', 'false');

  fireEvent.click(stripe(2));
  expect(stripe(2)).toHaveAttribute('aria-pressed', 'true');
  expect(stripe(0)).toHaveAttribute('aria-pressed', 'false');
  expect(stripe(1)).toHaveAttribute('aria-pressed', 'false');
});

test('the marks pill counts mouse selections and stripes once each and clears both', () => {
  const { container } = renderTable(makeList(4, 3));
  const row = (i: number) => container.querySelectorAll<HTMLElement>('.log-row')[i];
  const stripe = (i: number) => row(i).querySelector<HTMLElement>('.mark-stripe')!;
  const clear = () => screen.getByTitle('Clear all marks');

  expect(screen.queryByTitle('Clear all marks')).not.toBeInTheDocument();

  fireEvent.click(row(0));
  expect(clear()).toHaveTextContent('Clear 1 mark');
  expect(screen.getByTitle('Jump to next mark')).toBeInTheDocument();

  fireEvent.click(stripe(0));
  expect(clear()).toHaveTextContent('Clear 1 mark');

  fireEvent.click(row(1), { ctrlKey: true });
  expect(clear()).toHaveTextContent('Clear 2 marks');

  fireEvent.click(stripe(2));
  expect(clear()).toHaveTextContent('Clear 3 marks');

  fireEvent.click(clear());
  expect(screen.queryByTitle('Clear all marks')).not.toBeInTheDocument();
  expect(row(0).classList.contains('marked')).toBe(false);
  expect(row(1).classList.contains('marked')).toBe(false);
  expect(stripe(0)).toHaveAttribute('aria-pressed', 'false');
  expect(stripe(2)).toHaveAttribute('aria-pressed', 'false');
});

test('source and target buttons toggle focus and leave the filters alone', () => {
  const onQuickFilter = vi.fn();
  const onFocusFilter = vi.fn();
  const telegram = makeList(1, 0)[0];
  const { container } = render(
    <TelegramTable
      telegrams={[telegram]}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={{ ...DEFAULT_FILTERS, sources: [telegram.source_address], targets: [telegram.target_address], types: [telegram.simplified_type || telegram.telegram_type] }}
      onQuickFilter={onQuickFilter}
      onFocusFilter={onFocusFilter}
      focusDevices={[telegram.source_address]}
      focusFilterDevices={[telegram.source_address]}
      onQuickVisualize={vi.fn()}
    />,
  );
  const buttons = container.querySelectorAll<HTMLButtonElement>('button[title^="Toggle focus"]');
  expect(buttons).toHaveLength(2);
  expect(buttons[0]).toHaveAttribute('aria-pressed', 'true');
  expect(buttons[1]).toHaveAttribute('aria-pressed', 'false');
  expect(container.querySelector('button[title="Toggle source filter"]')).toBeNull();
  expect(container.querySelector('button[title="Toggle target filter"]')).toBeNull();
  expect(container.querySelector('button[title="Toggle type filter"]')).toBeNull();
  expect(container.querySelector('button[title="Toggle DPT filter"]')).toBeNull();
  expect(buttons[0].querySelector('.cancel-icon')).toBeNull();
  expect(buttons[1].querySelector('.cancel-icon')).toBeNull();

  fireEvent.click(buttons[0]);
  fireEvent.click(buttons[1]);
  const plain = { kind: 'toggle', exclusive: true, navigate: false };
  expect(onFocusFilter).toHaveBeenNthCalledWith(1, [telegram.source_address], 'pa', plain, telegram.source_address);
  expect(onFocusFilter).toHaveBeenNthCalledWith(2, [telegram.target_address], 'ga', plain, telegram.target_address);
  expect(onQuickFilter).not.toHaveBeenCalled();
});

test('filter focused stays inactive without a focus filter and does not hold a mouse selection', () => {
  const deviceA = makeTelegram({ timestamp: '2024-01-01T10:00:02.000Z', source_address: '1.1.1', source_name: 'Device A', raw_hex: '0x02' });
  const deviceB = makeTelegram({ timestamp: '2024-01-01T10:00:01.000Z', source_address: '1.1.2', source_name: 'Device B', raw_hex: '0x01' });
  const props = {
    telegrams: [deviceA, deviceB],
    visibleColumns,
    sortConfig,
    onSort: vi.fn(),
    activeFilters: DEFAULT_FILTERS,
    onQuickFilter: vi.fn(),
    onQuickVisualize: vi.fn(),
  };
  const { container, rerender } = render(<TelegramTable {...props} />);
  const box = (label: string) => {
    const col = [...container.querySelectorAll('.header-col')].find(el => el.querySelector('.sort-header')?.textContent?.includes(label))!;
    return col.querySelector('[role="checkbox"]') as HTMLElement;
  };
  expect(box('SOURCE')).toHaveAttribute('aria-disabled', 'true');
  expect(box('TARGET')).toHaveAttribute('aria-disabled', 'true');
  expect(box('SOURCE').closest('.filter-focused')?.textContent).toContain('filter focused');

  rerender(<TelegramTable {...props} focusFilterDevices={['1.1.1']} />);
  expect(box('SOURCE')).toHaveAttribute('aria-disabled', 'false');
  expect(box('SOURCE')).toHaveAttribute('aria-checked', 'false');
  expect(box('TARGET')).toHaveAttribute('aria-disabled', 'true');

  const rowB = () => [...container.querySelectorAll<HTMLElement>('.log-row')].find(row => row.textContent?.includes('Device B'))!;
  fireEvent.click(rowB());
  expect(rowB().querySelector<HTMLElement>('.log-row-body')!.style.background).not.toContain('11%');

  fireEvent.click(box('SOURCE'));
  expect(box('SOURCE')).toHaveAttribute('aria-checked', 'true');
  expect(rowB().classList.contains('marked')).toBe(true);
  expect(rowB().querySelector<HTMLElement>('.log-row-body')!.style.background).toBe(
    'color-mix(in srgb, var(--accent-primary) 34%, transparent)',
  );
  expect(screen.getByTitle('Clear all marks')).toHaveTextContent('Clear 1 mark');
  expect(box('TARGET')).toHaveAttribute('aria-disabled', 'true');

  rerender(<TelegramTable {...props} />);
  expect(box('SOURCE')).toHaveAttribute('aria-disabled', 'true');
  expect(box('SOURCE')).toHaveAttribute('aria-checked', 'false');
  rerender(<TelegramTable {...props} focusFilterDevices={['1.1.1']} />);
  expect(box('SOURCE')).toHaveAttribute('aria-checked', 'false');
});

test('context buttons stay hidden until a filter narrows the list and a time window is set', () => {
  const { container, rerender } = renderTable(makeList(3, 2));
  const flags = () => container.querySelectorAll('button[title*="around this message"]');
  expect(flags()).toHaveLength(0);

  rerender(
    <TelegramTable
      telegrams={makeList(3, 2)}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={{ ...DEFAULT_FILTERS, targets: ['1/2/3'] }}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
    />,
  );
  expect(flags()).toHaveLength(0);

  rerender(
    <TelegramTable
      telegrams={makeList(3, 2)}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={contextFilters}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
    />,
  );
  expect(flags().length).toBeGreaterThan(0);

  rerender(
    <TelegramTable
      telegrams={makeList(3, 2)}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={contextFilters}
      filtersEnabled={false}
      quickFilterOpen
      quickFilterEnabled
      quickPatterns={{ target: { top: '', bottom: 'Light' } }}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
    />,
  );
  expect(flags().length).toBeGreaterThan(0);

  rerender(
    <TelegramTable
      telegrams={makeList(3, 2)}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={{ ...contextFilters, deltaContextEnabled: false }}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
    />,
  );
  expect(flags()).toHaveLength(0);
});

test('the context toggle applies to every mouse-marked row', () => {
  const { container } = renderTable(makeList(4, 3), contextFilters);
  const row = (i: number) => container.querySelectorAll<HTMLElement>('.log-row')[i];
  const flag = (i: number) => row(i).querySelector<HTMLElement>('button[title*="around this message"]')!;
  const shown = (i: number) => flag(i).getAttribute('title')!.startsWith('Context is shown');

  expect([0, 1, 2, 3].every(shown)).toBe(true);
  fireEvent.click(row(0));
  fireEvent.click(row(1), { ctrlKey: true });
  fireEvent.click(flag(0));

  expect(shown(0)).toBe(false);
  expect(shown(1)).toBe(false);
  expect(shown(2)).toBe(true);
  expect(shown(3)).toBe(true);
  expect(row(0).classList.contains('marked')).toBe(true);

  fireEvent.click(flag(0));
  expect(shown(0)).toBe(true);
  expect(shown(1)).toBe(true);
  expect(shown(2)).toBe(true);
  expect(shown(3)).toBe(true);
});

test('clicking a context button anchors that row under the pointer', () => {
  const onListFollowChange = vi.fn();
  const onListAnchorKeyChange = vi.fn();
  const { container } = render(
    <TelegramTable
      telegrams={makeList(4, 3)}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={contextFilters}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      listFollow
      onListFollowChange={onListFollowChange}
      onListAnchorKeyChange={onListAnchorKeyChange}
    />,
  );
  const row = container.querySelectorAll<HTMLElement>('.log-row')[2];
  fireEvent.click(row.querySelector('button[title*="around this message"]')!);

  expect(onListFollowChange).toHaveBeenLastCalledWith(false);
  expect(onListAnchorKeyChange).toHaveBeenLastCalledWith(row.getAttribute('data-akey'));
  expect(row.classList.contains('marked')).toBe(false);
});

test('clicking a row pauses live-following (#266)', () => {
  const onListFollowChange = vi.fn();
  const { container, rerender } = render(
    <TelegramTable
      telegrams={makeList(6, 5)}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      listFollow
      onListFollowChange={onListFollowChange}
    />,
  );
  fireEvent.click(container.querySelectorAll('.log-row')[2]);
  expect(onListFollowChange).toHaveBeenCalledWith(false);

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

  // The newest telegram is still on screen, so there is nothing newer to report.
  expect(screen.queryByText(/new telegram/)).not.toBeInTheDocument();
});

test('newest-on-bottom: clicking a row stays anchored while the full buffer evicts (#297)', () => {
  const asc: SortConfig = [{ key: 'timestamp', direction: 'asc' }];
  // In asc view the parent hands rows oldest-first, newest at the bottom edge.
  const oldestFirst = (count: number, newestOffsetS: number) => makeList(count, newestOffsetS).slice().reverse();

  const onListFollowChange = vi.fn();
  const { container, rerender } = render(
    <TelegramTable
      telegrams={oldestFirst(6, 5)}
      visibleColumns={visibleColumns}
      sortConfig={asc}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      listFollow
      onListFollowChange={onListFollowChange}
    />,
  );
  // Click a row that is neither the oldest nor the newest, then simulate a
  // capacity eviction: one new telegram at the bottom, one dropped from the top.
  fireEvent.click(container.querySelectorAll('.log-row')[2]);
  expect(onListFollowChange).toHaveBeenCalledWith(false);
  rerender(
    <TelegramTable
      telegrams={oldestFirst(6, 6)}
      visibleColumns={visibleColumns}
      sortConfig={asc}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      listFollow={false}
      onListFollowChange={onListFollowChange}
    />,
  );

  // Every row still fits, including the newest, so the pill stays hidden.
  expect(screen.queryByText(/new telegram/)).not.toBeInTheDocument();
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

test('jump pill counts telegrams newer than the newest one on screen, for both time directions', () => {
  const ROW = 85;
  scrollBlockSize = ROW * 2;
  const table = (telegrams: Telegram[], sort: SortConfig, follow: boolean, anchor: string | null = null) => (
    <TelegramTable
      telegrams={telegrams}
      visibleColumns={visibleColumns}
      sortConfig={sort}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      listFollow={follow}
      onListFollowChange={vi.fn()}
      listAnchorKey={anchor}
      onListAnchorKeyChange={vi.fn()}
    />
  );

  const scrollTo = (container: HTMLElement, top: number) => {
    const port = container.querySelector('.custom-scrollbar') as HTMLElement;
    port.scrollTop = top;
    fireEvent.scroll(port);
  };

  try {
    const rows = makeList(10, 9);
    // Newest first and still following: the newest row is on screen, so no pill.
    const live = render(table(rows, sortConfig, true));
    expect(screen.queryByText(/new telegram/)).not.toBeInTheDocument();
    live.unmount();

    // Scrolled so the fourth row is the newest one on screen: three are newer.
    const three = render(table(rows, sortConfig, false));
    scrollTo(three.container, ROW * 3);
    expect(screen.getByRole('button', { name: '3 newer telegrams' })).toBeInTheDocument();

    // A filter refill replaces the list instead of prepending. Holding the same
    // telegram on screen (it moved down by the two new matches) counts five.
    const newer = makeList(2, 11);
    three.rerender(table([...newer, ...rows], sortConfig, false));
    scrollTo(three.container, ROW * 5);
    expect(screen.getByRole('button', { name: '5 newer telegrams' })).toBeInTheDocument();
    three.unmount();

    // One newer telegram keeps the singular "new telegram".
    const one = render(table(rows, sortConfig, false));
    scrollTo(one.container, ROW);
    expect(screen.getByRole('button', { name: '1 new telegram' })).toBeInTheDocument();
    one.unmount();

    // Oldest first. The viewport holds the two oldest rows, so eight are newer.
    const asc: SortConfig = [{ key: 'timestamp', direction: 'asc' }];
    const ascRows = rows.slice().reverse();
    const view = render(table(ascRows, asc, false));
    scrollTo(view.container, 0);
    expect(screen.getByRole('button', { name: '8 newer telegrams' })).toBeInTheDocument();

    // Live mode hides the pill even while those newer rows are off screen.
    view.rerender(table(ascRows, asc, true));
    expect(screen.queryByText(/new telegram/)).not.toBeInTheDocument();
  } finally {
    scrollBlockSize = 800;
  }
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

  expect(screen.queryByText(/4 telegrams/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByTitle('Show info bar'));
  expect(screen.getByText(/4 telegrams/)).toBeInTheDocument();
  expect(screen.getByText(/Oldest:/)).toBeInTheDocument();
  expect(screen.getByText(/Newest:/)).toBeInTheDocument();
});

test('quick info bar shows the busiest second as a max rate (#441)', () => {
  const at = (ts: string) => makeTelegram({ timestamp: ts, raw_hex: ts });
  render(
    <TelegramTable
      telegrams={[
        at('2024-01-01T10:00:09.000Z'),
        at('2024-01-01T10:00:05.900Z'),
        at('2024-01-01T10:00:05.300Z'),
        at('2024-01-01T10:00:05.000Z'),
        at('2024-01-01T10:00:01.000Z'),
      ]}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByTitle('Show info bar'));
  expect(screen.getByText('Max rate: 3/s')).toBeInTheDocument();
});

test('context rows (#343): marked with a distinct class/tooltip and counted in the info bar', () => {
  const rows = makeList(3, 2);
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
  expect(screen.getByText(/1 context/)).toBeInTheDocument();
});

test('the stripe marks a context row in the context colour', () => {
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
  const logRows = [...container.querySelectorAll<HTMLElement>('.log-row')];
  const stripe = logRows[1].querySelector<HTMLElement>('.mark-stripe')!;

  fireEvent.click(stripe);
  expect(logRows[1].style.background).toBe('color-mix(in srgb, var(--warning, #f59e0b) 12%, transparent)');
  expect(stripe.style.background).toBe('var(--warning, #f59e0b)');
  expect(logRows[1].querySelector<HTMLElement>('.log-row-body')!.style.background).toBe('');
  expect(logRows[0].style.background).not.toContain('var(--warning');

  fireEvent.click(logRows[1]);
  const body = logRows[1].querySelector<HTMLElement>('.log-row-body')!;
  expect(body.style.background).toContain('var(--accent-primary)');
  expect(body.style.background).not.toContain('var(--warning');
  expect(logRows[1].querySelector<HTMLElement>('.mark-stripe')!.style.background).toBe(
    'var(--warning, #f59e0b)',
  );
});

test('a marked context row keeps its context colour when the window no longer covers it', () => {
  const rows = makeList(3, 2);
  const props = {
    telegrams: rows,
    visibleColumns,
    sortConfig,
    onSort: vi.fn(),
    activeFilters: DEFAULT_FILTERS,
    onQuickFilter: vi.fn(),
    onQuickVisualize: vi.fn(),
  };
  const view = render(<TelegramTable {...props} contextKeys={new Set([anchorKey(rows[1])])} />);
  const row = () => view.container.querySelectorAll<HTMLElement>('.log-row')[1];
  const stripe = () => row().querySelector<HTMLElement>('.mark-stripe')!;

  fireEvent.click(stripe());
  view.rerender(<TelegramTable {...props} contextKeys={new Set()} />);

  expect(stripe()).toHaveAttribute('aria-pressed', 'true');
  expect(row().style.background).toBe('color-mix(in srgb, var(--warning, #f59e0b) 12%, transparent)');
  expect(stripe().style.background).toBe('var(--warning, #f59e0b)');
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

test('dragging a column header onto another reorders header and rows, and is remembered', () => {
  localStorage.removeItem('spectrum-knx.columnOrder');
  const props = {
    telegrams: [makeTelegram({ source_address: '1.1.7', target_address: '4/5/6' })],
    visibleColumns, sortConfig, onSort: vi.fn(), activeFilters: DEFAULT_FILTERS, onQuickFilter: vi.fn(), onQuickVisualize: vi.fn(),
  };
  const { container, unmount } = render(<TelegramTable {...props} />);
  const headerLabel = (h: Element) => h.querySelector('.sort-header')?.textContent?.trim().split(/\s/)[0];
  const headers = () => Array.from(container.querySelectorAll('.header-col')).map(headerLabel);
  const header = (label: string) => Array.from(container.querySelectorAll<HTMLElement>('.header-col')).find(h => h.textContent?.includes(label))!;
  const rowText = () => container.querySelector('.log-row')!.textContent ?? '';
  const dataTransfer = { setData: vi.fn(), effectAllowed: '', dropEffect: '' };
  // jsdom's drag events carry no pointer position, so set it by hand.
  const drag = (type: 'dragOver' | 'drop', el: HTMLElement, clientX: number) => {
    const event = createEvent[type](el, { dataTransfer });
    Object.defineProperty(event, 'clientX', { value: clientX });
    fireEvent(el, event);
  };

  expect(headers()).toEqual(['TIME', 'Δt', 'SOURCE', 'TARGET', 'TYPE', 'DPT', 'VALUE']);
  expect(rowText().indexOf('1.1.7')).toBeLessThan(rowText().indexOf('4/5/6'));

  // jsdom rects are 1000px wide starting at 0: clientX 10 is the left half → "before".
  fireEvent.dragStart(header('TARGET'), { dataTransfer });
  drag('dragOver', header('SOURCE'), 10);
  expect(header('SOURCE').className).toContain('drop-before');
  drag('drop', header('SOURCE'), 10);

  expect(headers()).toEqual(['TIME', 'Δt', 'TARGET', 'SOURCE', 'TYPE', 'DPT', 'VALUE']);
  expect(rowText().indexOf('4/5/6')).toBeLessThan(rowText().indexOf('1.1.7'));
  expect(header('SOURCE').className).not.toContain('drop-');

  // Right half of the last column → lands after it.
  fireEvent.dragStart(header('TIME'), { dataTransfer });
  drag('dragOver', header('VALUE'), 900);
  drag('drop', header('VALUE'), 900);
  expect(headers()).toEqual(['Δt', 'TARGET', 'SOURCE', 'TYPE', 'DPT', 'VALUE', 'TIME']);

  // A fresh table (reload, or the History view) picks the order up again.
  unmount();
  const again = render(<TelegramTable {...props} />);
  expect(Array.from(again.container.querySelectorAll('.header-col')).map(h => h.querySelector('.sort-header')?.textContent?.trim().split(/\s/)[0]))
    .toEqual(['Δt', 'TARGET', 'SOURCE', 'TYPE', 'DPT', 'VALUE', 'TIME']);
  localStorage.removeItem('spectrum-knx.columnOrder');
});

test('a jump that centers a telegram draws a white frame that fades within 3 seconds', () => {
  const rows = makeList(6, 5);
  const key = anchorKey(rows[3]);
  const props = {
    telegrams: rows,
    visibleColumns,
    sortConfig,
    onSort: vi.fn(),
    activeFilters: DEFAULT_FILTERS,
    onQuickFilter: vi.fn(),
    onQuickVisualize: vi.fn(),
    listFollow: false,
    listAnchorKey: key,
  };
  const centered = render(<TelegramTable {...props} listAnchorAlign="center" />);
  const framed = centered.container.querySelectorAll('.log-row.jump-flash');
  expect(framed).toHaveLength(1);
  expect(framed[0].getAttribute('data-akey')).toBe(key);
  const frame = Array.from(document.head.querySelectorAll('style')).map(node => node.textContent ?? '').join('\n');
  expect(frame).toContain('border: 2px solid var(--jump-flash, #fff)');
  expect(frame).toContain('animation: jump-flash-fade 3s linear forwards');
  centered.unmount();

  const pinned = render(<TelegramTable {...props} listAnchorAlign="start" />);
  expect(pinned.container.querySelector('.log-row.jump-flash')).toBeNull();
});

test('navigating marks draws the same white frame on the landed row', () => {
  const rows = makeList(6, 5);
  const { container } = renderTable(rows);
  const row = (i: number) => container.querySelectorAll<HTMLElement>('.log-row')[i];

  const stripe = (i: number) => row(i).querySelector<HTMLElement>('.mark-stripe')!;
  fireEvent.click(row(0));
  fireEvent.click(stripe(2));
  const up = () => screen.getByTitle('Jump to previous mark');
  const down = () => screen.getByTitle('Jump to next mark');
  // Cursor is the lower mark: only upward still has a mark.
  expect(up()).toHaveAttribute('aria-disabled', 'false');
  expect(down()).toHaveAttribute('aria-disabled', 'true');

  fireEvent.click(up());
  const next = container.querySelectorAll('.log-row.jump-flash');
  expect(next).toHaveLength(1);
  expect(next[0].getAttribute('data-akey')).toBe(anchorKey(rows[0]));
  const ring = next[0].querySelector('.jump-flash-ring');
  expect(ring).not.toBeNull();
  expect(up()).toHaveAttribute('aria-disabled', 'true');
  expect(down()).toHaveAttribute('aria-disabled', 'false');

  fireEvent.click(down());
  const prev = container.querySelectorAll('.log-row.jump-flash');
  expect(prev).toHaveLength(1);
  expect(prev[0].getAttribute('data-akey')).toBe(anchorKey(rows[2]));
  expect(prev[0].querySelector('.jump-flash-ring')).not.toBe(ring);
  expect(up()).toHaveAttribute('aria-disabled', 'false');
  expect(down()).toHaveAttribute('aria-disabled', 'true');

  // No mark further down: the inactive arrow centers the mark that is here.
  const stayed = container.querySelector('.jump-flash-ring');
  fireEvent.click(down());
  const replayed = container.querySelector('.jump-flash-ring');
  expect(replayed).not.toBe(stayed);
  expect(replayed?.parentElement?.getAttribute('data-akey')).toBe(anchorKey(rows[2]));
  expect(down()).toHaveAttribute('aria-disabled', 'true');

  // The only remaining mark is the cursor. Either inactive arrow centers it.
  fireEvent.click(row(2));
  expect(up()).toHaveAttribute('aria-disabled', 'true');
  expect(down()).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(up());
  expect(container.querySelector('.log-row.jump-flash')?.getAttribute('data-akey')).toBe(anchorKey(rows[2]));
  const once = container.querySelector('.jump-flash-ring');
  fireEvent.click(down());
  expect(container.querySelector('.jump-flash-ring')).not.toBe(once);
  expect(container.querySelector('.log-row.jump-flash')?.getAttribute('data-akey')).toBe(anchorKey(rows[2]));
});
