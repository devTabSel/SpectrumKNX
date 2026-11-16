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

const flagButton = (row: Element, side: 'before' | 'after' = 'after') =>
  row.querySelector(`button[data-context-side="${side}"]`) as HTMLElement;
const isSideOn = (row: Element, side: 'before' | 'after') =>
  flagButton(row, side)?.getAttribute('data-context-side-on') === 'true';
const headerSide = (side: 'before' | 'after') =>
  screen.getByRole('checkbox', { name: new RegExp(`^Time-Delta-Context ${side}:`) });
const clickSide = (btn: HTMLElement, opts?: { ctrl?: boolean }) => {
  fireEvent.mouseDown(btn, { button: 0, ctrlKey: !!opts?.ctrl });
  fireEvent.click(btn, { ctrlKey: !!opts?.ctrl });
};

const contextTable = (props: Partial<React.ComponentProps<typeof TelegramTable>> = {}) =>
  renderTable({ activeFilters: FILTERS_WITH_DELTA, quickFilterEnabled: true, ...props });

test('header click sets one side of the visible rows; ctrl on mixed turns that side on', () => {
  const onFlaggedAfterKeysChange = vi.fn();
  const onFlaggedBeforeKeysChange = vi.fn();
  const onListAnchorKeyChange = vi.fn();
  const { container } = contextTable({
    onFlaggedAfterKeysChange,
    onFlaggedBeforeKeysChange,
    onListAnchorKeyChange,
  });
  const rows = () => [...container.querySelectorAll('.log-row')];
  expect(headerSide('after')).toHaveAttribute('aria-checked', 'false');
  expect(headerSide('before')).toHaveAttribute('aria-checked', 'false');
  expect(headerSide('after').title).toMatch(/Click/);
  expect(headerSide('after').title).toMatch(/Ctrl/);

  fireEvent.click(headerSide('after'));
  expect(headerSide('after')).toHaveAttribute('aria-checked', 'true');
  expect(rows().every(r => isSideOn(r, 'after'))).toBe(true);
  expect(rows().some(r => isSideOn(r, 'before'))).toBe(false);
  expect(onFlaggedBeforeKeysChange).not.toHaveBeenCalled();

  fireEvent.click(headerSide('after'));
  expect(headerSide('after')).toHaveAttribute('aria-checked', 'false');
  expect(rows().some(r => isSideOn(r, 'after'))).toBe(false);

  clickSide(flagButton(rows()[0], 'after'));
  expect(headerSide('after')).toHaveAttribute('aria-checked', 'mixed');
  fireEvent.click(headerSide('after'));
  expect(headerSide('after')).toHaveAttribute('aria-checked', 'false');

  clickSide(flagButton(rows()[0], 'after'));
  fireEvent.click(headerSide('after'), { ctrlKey: true });
  expect(headerSide('after')).toHaveAttribute('aria-checked', 'true');
  expect(rows().every(r => isSideOn(r, 'after'))).toBe(true);
  expect(headerSide('before')).toHaveAttribute('aria-checked', 'false');
  expect(onListAnchorKeyChange).toHaveBeenCalled();
});

test('a header click changes only the rows on screen and does not latch', () => {
  const onFlaggedAfterKeysChange = vi.fn();
  const { container } = contextTable({
    flaggedAfterKeys: ['not-on-screen'],
    onFlaggedAfterKeysChange,
  });
  fireEvent.click(headerSide('after'));
  const visible = [...container.querySelectorAll('.log-row')].map(r => r.getAttribute('data-akey'));
  expect(onFlaggedAfterKeysChange).toHaveBeenLastCalledWith(['not-on-screen', ...visible]);
});

test('a newly shown context row with the flag off makes that side mixed', () => {
  const match = TELEGRAMS[0];
  const context = TELEGRAMS[2];
  const matchKey = anchorKey(match);
  const contextKey = anchorKey(context);
  const { rerender, container } = contextTable({
    telegrams: [match],
    flaggedAfterKeys: [matchKey],
  });
  expect(headerSide('after')).toHaveAttribute('aria-checked', 'true');

  rerender(
    <TelegramTable
      telegrams={[match, context]}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={FILTERS_WITH_DELTA}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      quickFilterEnabled
      flaggedAfterKeys={[matchKey]}
      contextKeys={new Set([contextKey])}
    />,
  );
  expect(headerSide('after')).toHaveAttribute('aria-checked', 'mixed');
  const contextRow = [...container.querySelectorAll('.log-row')]
    .find(r => r.getAttribute('data-akey') === contextKey)!;
  expect(isSideOn(contextRow, 'after')).toBe(false);
  expect(isSideOn(
    [...container.querySelectorAll('.log-row')].find(r => r.getAttribute('data-akey') === matchKey)!,
    'after',
  )).toBe(true);
});

test('plain click toggles one side; ctrl-click toggles both sides that have a window', () => {
  const onFlaggedAfterKeysChange = vi.fn();
  const onFlaggedBeforeKeysChange = vi.fn();
  const { container } = contextTable({ onFlaggedAfterKeysChange, onFlaggedBeforeKeysChange });
  const row = [...container.querySelectorAll('.log-row')].find(r => r.textContent?.includes('Licht Flur'))!;
  const key = row.getAttribute('data-akey')!;

  clickSide(flagButton(row, 'after'));
  expect(onFlaggedAfterKeysChange).toHaveBeenLastCalledWith([key]);
  expect(onFlaggedBeforeKeysChange).not.toHaveBeenCalled();
  expect(isSideOn(row, 'after')).toBe(true);
  expect(isSideOn(row, 'before')).toBe(false);

  clickSide(flagButton(row, 'before'));
  expect(onFlaggedBeforeKeysChange).toHaveBeenLastCalledWith([key]);
  expect(isSideOn(row, 'before')).toBe(true);
  expect(isSideOn(row, 'after')).toBe(true);

  onFlaggedAfterKeysChange.mockClear();
  onFlaggedBeforeKeysChange.mockClear();
  clickSide(flagButton(row, 'after'), { ctrl: true });
  expect(onFlaggedAfterKeysChange).toHaveBeenLastCalledWith([]);
  expect(onFlaggedBeforeKeysChange).toHaveBeenLastCalledWith([]);
  expect(isSideOn(row, 'after')).toBe(false);
  expect(isSideOn(row, 'before')).toBe(false);
});

test('a selected row\'s context flag applies to every selected row, not rail marks', () => {
  const onMouseSelectedKeysChange = vi.fn();
  const onFlaggedAfterKeysChange = vi.fn();
  const { container } = contextTable({ onMouseSelectedKeysChange, onFlaggedAfterKeysChange });
  const rows = [...container.querySelectorAll('.log-row')];

  fireEvent.click(rows[0]);
  fireEvent.click(rows[1], { ctrlKey: true });
  const selected = rows.slice(0, 2).map(r => r.getAttribute('data-akey')!);
  fireEvent.click(rows[2].querySelector('[title="Mark this message"]') as HTMLElement);
  onMouseSelectedKeysChange.mockClear();
  onFlaggedAfterKeysChange.mockClear();
  clickSide(flagButton(rows[0], 'after'));

  expect(onMouseSelectedKeysChange).not.toHaveBeenCalled();
  expect(onFlaggedAfterKeysChange).toHaveBeenLastCalledWith(expect.arrayContaining(selected));
  expect(onFlaggedAfterKeysChange.mock.lastCall![0]).toHaveLength(2);
  expect(isSideOn(rows[0], 'after')).toBe(true);
  expect(isSideOn(rows[1], 'after')).toBe(true);
  expect(isSideOn(rows[2], 'after')).toBe(false);
  expect(isSideOn(rows[0], 'before')).toBe(false);
});

test('mousedown on a context button pins that row and passes through mouse selection', async () => {
  const onListAnchorKeyChange = vi.fn();
  const onMouseSelectedKeysChange = vi.fn();
  const { container } = contextTable({ onListAnchorKeyChange, onMouseSelectedKeysChange });
  const rows = [...container.querySelectorAll('.log-row')];
  fireEvent.click(rows[0]);
  const selected = rows[0].getAttribute('data-akey')!;
  const other = rows.find(r => r.textContent?.includes('Licht Flur'))!;
  const key = other.getAttribute('data-akey')!;
  onListAnchorKeyChange.mockClear();
  onMouseSelectedKeysChange.mockClear();
  clickSide(flagButton(other, 'after'));

  await vi.waitFor(() => {
    expect(onListAnchorKeyChange).toHaveBeenCalledWith(key);
  });
  expect(onListAnchorKeyChange).not.toHaveBeenCalledWith(selected);
  expect(onMouseSelectedKeysChange.mock.lastCall![0]).toEqual([key]);
});

test('toggling a row context button pins the preferred row as the scroll anchor', async () => {
  const onListAnchorKeyChange = vi.fn();
  const { container } = contextTable({ listFollow: true, onListAnchorKeyChange });
  const row = [...container.querySelectorAll('.log-row')].find(r => r.textContent?.includes('Licht Flur'))!;
  const key = row.getAttribute('data-akey')!;
  fireEvent.click(row);
  onListAnchorKeyChange.mockClear();
  clickSide(flagButton(row, 'after'));

  await vi.waitFor(() => {
    expect(onListAnchorKeyChange).toHaveBeenCalledWith(key);
  });
});

test('only the side with a quick-filter window has a circle', () => {
  const { container, rerender } = contextTable({
    activeFilters: { ...DEFAULT_FILTERS, deltaBeforeMs: 0, deltaAfterMs: 100 },
  });
  const row = () => [...container.querySelectorAll('.log-row')]
    .find(r => r.textContent?.includes('Licht Flur'))!;
  expect(flagButton(row(), 'after')).toBeTruthy();
  expect(flagButton(row(), 'before')).toBeNull();
  expect(screen.getByRole('checkbox', { name: /^Time-Delta-Context after:/ })).toBeInTheDocument();
  expect(screen.queryByRole('checkbox', { name: /^Time-Delta-Context before:/ })).not.toBeInTheDocument();

  rerender(
    <TelegramTable
      telegrams={TELEGRAMS}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={{ ...DEFAULT_FILTERS, deltaBeforeMs: 100, deltaAfterMs: 0 }}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      quickFilterEnabled
    />,
  );
  expect(flagButton(row(), 'before')).toBeTruthy();
  expect(flagButton(row(), 'after')).toBeNull();
  expect(screen.getByRole('checkbox', { name: /^Time-Delta-Context before:/ })).toBeInTheDocument();
  expect(screen.queryByRole('checkbox', { name: /^Time-Delta-Context after:/ })).not.toBeInTheDocument();
});

test('a context circle stays thin; colour follows the side flag', () => {
  const { container } = contextTable();
  const row = () => [...container.querySelectorAll('.log-row')]
    .find(r => r.textContent?.includes('Licht Flur'))!;
  const off = flagButton(row(), 'after');
  expect(off.hasAttribute('data-context-side-on')).toBe(false);
  expect(off.style.borderWidth).toBe('1.5px');
  expect(off.style.borderColor).toBe('var(--text-dim)');
  expect(off.title).toMatch(/Ctrl-click/);

  clickSide(off);
  const on = flagButton(row(), 'after');
  expect(on.getAttribute('data-context-side-on')).toBe('true');
  expect(on.style.borderWidth).toBe('1.5px');
  expect(on.style.borderColor).toBe('var(--accent-primary)');
  expect(headerSide('after').style.borderWidth).not.toBe('2.5px');
});

test('context controls hide when QF is disabled or no window is set', () => {
  const { rerender, container } = renderTable({
    activeFilters: FILTERS_WITH_DELTA,
    quickFilterEnabled: true,
  });
  expect(screen.getAllByRole('checkbox', { name: /^Time-Delta-Context (before|after):/ })).toHaveLength(2);
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
  expect(screen.queryAllByRole('checkbox', { name: /^Time-Delta-Context (before|after):/ })).toHaveLength(0);
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
  expect(screen.queryAllByRole('checkbox', { name: /^Time-Delta-Context (before|after):/ })).toHaveLength(0);
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
    flaggedAfterKeys: [flaggedKey],
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
