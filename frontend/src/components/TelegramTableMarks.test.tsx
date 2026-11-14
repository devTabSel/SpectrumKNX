import { render, fireEvent, screen, act } from '@testing-library/react';
import { expect, test, vi, beforeAll } from 'vitest';
import { TelegramTable, type SortConfig } from './TelegramTable';
import { makeTelegram } from '../test/telegramFactory';
import { anchorKey } from '../utils/anchorKey';
import type { Telegram } from '../hooks/useWebSocket';
import { DEFAULT_FILTERS } from '../types/filters';

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

// Five rows so range + additive semantics are unambiguous. Desc timestamp → the
// DOM row order matches this array order (newest first).
const TELEGRAMS: Telegram[] = [
  makeTelegram({ timestamp: '2024-01-01T10:00:05.000Z', target_address: '1/2/5', raw_hex: '0x05' }),
  makeTelegram({ timestamp: '2024-01-01T10:00:04.000Z', target_address: '1/2/4', raw_hex: '0x04' }),
  makeTelegram({ timestamp: '2024-01-01T10:00:03.000Z', target_address: '1/2/3', raw_hex: '0x03' }),
  makeTelegram({ timestamp: '2024-01-01T10:00:02.000Z', target_address: '1/2/2', raw_hex: '0x02' }),
  makeTelegram({ timestamp: '2024-01-01T10:00:01.000Z', target_address: '1/2/1', raw_hex: '0x01' }),
];

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

const rows = (container: HTMLElement) => Array.from(container.querySelectorAll('.log-row')) as HTMLElement[];
const marked = (container: HTMLElement) => rows(container).map(r => r.classList.contains('marked'));
const latestIdx = (container: HTMLElement) => rows(container).findIndex(r => r.classList.contains('latest'));
const markRail = (row: HTMLElement) =>
  row.querySelector('[title="Mark this message"], [title="Unmark this message"]') as HTMLElement;
/** Rail hit-target (also the three-slot grid that carries the manual-mark fill). */
const railRoot = (row: HTMLElement) => markRail(row);
/** Content grid beside the rail — carries the row wash when a rail mark is set. */
const rowBody = (row: HTMLElement) => row.children[1] as HTMLElement;
const colorSwatch = (row: HTMLElement) =>
  row.querySelector('[aria-label="Set row colour"], [aria-label="Row colour"]') as HTMLElement;

test('mouse selection marks the row as latest; a second click replaces', () => {
  const { container } = renderTable();
  fireEvent.click(rows(container)[0]);
  expect(marked(container)).toEqual([true, false, false, false, false]);
  expect(latestIdx(container)).toBe(0);
  // Selection does not set the marked flag, so the rail stays empty.
  expect(railRoot(rows(container)[0]).style.background).toBe('');

  fireEvent.click(rows(container)[2]);
  expect(marked(container)).toEqual([false, false, true, false, false]);
  expect(latestIdx(container)).toBe(2);
  expect(railRoot(rows(container)[0]).style.background).toBe('');
  expect(railRoot(rows(container)[2]).style.background).toBe('');
});

test('mousedown selects the row immediately, and a following drag keeps that selection', () => {
  const { container } = renderTable();
  const row = rows(container)[1];
  fireEvent.mouseDown(row, { clientX: 20, clientY: 30 });
  expect(marked(container)).toEqual([false, true, false, false, false]);
  expect(latestIdx(container)).toBe(1);

  fireEvent.click(row, { clientX: 80, clientY: 30 });
  expect(marked(container)).toEqual([false, true, false, false, false]);
  expect(latestIdx(container)).toBe(1);
});

test('mousedown pins the clicked row and stops live-follow before selection', () => {
  const order: string[] = [];
  const onListFollowChange = vi.fn(() => { order.push('follow'); });
  const onListAnchorKeyChange = vi.fn(() => { order.push('anchor'); });
  const onMouseSelectedKeysChange = vi.fn(() => { order.push('select'); });
  const { container } = renderTable({
    listFollow: true,
    onListFollowChange,
    onListAnchorKeyChange,
    onMouseSelectedKeysChange,
  });
  const row = rows(container)[2];
  const key = row.getAttribute('data-akey')!;
  fireEvent.mouseDown(row, { clientX: 12, clientY: 12, ctrlKey: true });

  expect(onListFollowChange).toHaveBeenCalledWith(false);
  expect(onListAnchorKeyChange).toHaveBeenCalledWith(key);
  expect(onMouseSelectedKeysChange).toHaveBeenCalledWith([key]);
  expect(order.indexOf('anchor')).toBeLessThan(order.indexOf('select'));
  expect(order.indexOf('follow')).toBeLessThan(order.indexOf('select'));
  fireEvent.mouseUp(row, { clientX: 12, clientY: 12, ctrlKey: true });
});

test('ctrl-mousedown adds to the selection; a click without mousedown still selects', () => {
  const onMouseSelectedKeysChange = vi.fn();
  const { container } = renderTable({ onMouseSelectedKeysChange });
  fireEvent.click(rows(container)[0]);
  const key0 = rows(container)[0].getAttribute('data-akey')!;
  expect(onMouseSelectedKeysChange).toHaveBeenLastCalledWith([key0]);

  fireEvent.mouseDown(rows(container)[2], { clientX: 8, clientY: 8, ctrlKey: true });
  const key2 = rows(container)[2].getAttribute('data-akey')!;
  expect(onMouseSelectedKeysChange).toHaveBeenLastCalledWith([key0, key2]);
  fireEvent.mouseUp(rows(container)[2], { clientX: 8, clientY: 8, ctrlKey: true });
});

test('a plain mousedown selects before mouseup, and mouseup does not select again', () => {
  const onMouseSelectedKeysChange = vi.fn();
  const { container } = renderTable({ onMouseSelectedKeysChange });
  const row = rows(container)[1];
  const key = row.getAttribute('data-akey')!;
  fireEvent.mouseDown(row, { clientX: 0, clientY: 0 });
  expect(onMouseSelectedKeysChange).toHaveBeenCalledTimes(1);
  expect(onMouseSelectedKeysChange).toHaveBeenCalledWith([key]);
  expect(row.classList.contains('marked')).toBe(true);
  fireEvent.mouseUp(row, { clientX: 30, clientY: 0 });
  expect(onMouseSelectedKeysChange).toHaveBeenCalledTimes(1);
});

const box = (top: number, bottom: number): DOMRect =>
  ({ width: 1000, height: bottom - top, top, bottom, left: 0, right: 1000, x: 0, y: top, toJSON: () => {} }) as DOMRect;

test('mouseup leaves the scroll offset when the viewport is already full', () => {
  const { container } = renderTable();
  const scroller = container.querySelector('.custom-scrollbar') as HTMLElement;
  const before = scroller.scrollTop;
  const row = rows(container)[1];
  fireEvent.mouseDown(row, { clientX: 6, clientY: 6 });
  fireEvent.mouseUp(row, { clientX: 6, clientY: 6 });
  expect(scroller.scrollTop).toBe(before);
});

test('mouseup scrolls to close a gap under the last row', async () => {
  const { container } = renderTable();
  const scroller = container.querySelector('.custom-scrollbar') as HTMLElement;
  const row = rows(container)[1];
  fireEvent.mouseDown(row, { clientX: 6, clientY: 6 });

  const previous = Element.prototype.getBoundingClientRect;
  const previousHeight = Object.getOwnPropertyDescriptor(scroller, 'scrollHeight');
  Element.prototype.getBoundingClientRect = function (this: Element) {
    if (this.classList?.contains('custom-scrollbar')) return box(0, 800);
    if (this.classList?.contains('log-row')) return box(0, 40);
    return previous.call(this);
  };
  Object.defineProperty(scroller, 'scrollHeight', { configurable: true, get: () => 4000 });
  try {
    fireEvent.mouseUp(row, { clientX: 6, clientY: 6 });
    await vi.waitFor(() => expect(scroller.scrollTop).toBeGreaterThan(0));
  } finally {
    Element.prototype.getBoundingClientRect = previous;
    if (previousHeight) Object.defineProperty(scroller, 'scrollHeight', previousHeight);
    else delete (scroller as unknown as { scrollHeight?: number }).scrollHeight;
  }
});

test('rail click toggles the marked flag without changing mouse selection', () => {
  const onMarkedKeysChange = vi.fn();
  const onMouseSelectedKeysChange = vi.fn();
  const onLastSelectedKeyChange = vi.fn();
  const { container } = renderTable({ onMarkedKeysChange, onMouseSelectedKeysChange, onLastSelectedKeyChange });

  fireEvent.click(rows(container)[0]);
  const key0 = rows(container)[0].getAttribute('data-akey')!;
  expect(onLastSelectedKeyChange).toHaveBeenLastCalledWith(key0);
  expect(onMouseSelectedKeysChange).toHaveBeenLastCalledWith([key0]);
  onMarkedKeysChange.mockClear();
  onMouseSelectedKeysChange.mockClear();
  onLastSelectedKeyChange.mockClear();

  fireEvent.click(markRail(rows(container)[2]));
  const key2 = rows(container)[2].getAttribute('data-akey')!;
  expect(markRail(rows(container)[2]).getAttribute('title')).toBe('Unmark this message');
  expect(onLastSelectedKeyChange).not.toHaveBeenCalled();
  expect(onMouseSelectedKeysChange).not.toHaveBeenCalled();
  expect(onMarkedKeysChange).toHaveBeenLastCalledWith([key2]);
  // Background / `.marked` follows mouse selection only — the marked flag does not tint the row.
  expect(marked(container)).toEqual([true, false, false, false, false]);
  expect(latestIdx(container)).toBe(0);
  expect(railRoot(rows(container)[2]).style.background).toContain('16%');
  expect(railRoot(rows(container)[0]).style.background).toBe('');
  expect(rowBody(rows(container)[0]).style.background).toContain('34%');

  fireEvent.click(markRail(rows(container)[2]));
  expect(onMarkedKeysChange).toHaveBeenLastCalledWith([]);
  expect(marked(container)).toEqual([true, false, false, false, false]);
  expect(railRoot(rows(container)[2]).style.background).toBe('');
});

test('marked flag on the last-selected row uses the latest wash and survives a new selection', () => {
  const onMarkedKeysChange = vi.fn();
  const onMouseSelectedKeysChange = vi.fn();
  const { container } = renderTable({ onMarkedKeysChange, onMouseSelectedKeysChange });

  fireEvent.click(rows(container)[0]);
  const key0 = rows(container)[0].getAttribute('data-akey')!;
  expect(railRoot(rows(container)[0]).style.background).toBe('');

  fireEvent.click(markRail(rows(container)[0]));
  expect(onMarkedKeysChange).toHaveBeenLastCalledWith([key0]);
  expect(railRoot(rows(container)[0]).style.background).toContain('34%');
  expect(railRoot(rows(container)[0]).style.background).toBe(rowBody(rows(container)[0]).style.background);

  fireEvent.click(markRail(rows(container)[0]));
  expect(onMarkedKeysChange).toHaveBeenLastCalledWith([]);
  expect(railRoot(rows(container)[0]).style.background).toBe('');

  fireEvent.click(markRail(rows(container)[0]));
  expect(railRoot(rows(container)[0]).style.background).toContain('34%');
  fireEvent.click(rows(container)[2]);
  const key2 = rows(container)[2].getAttribute('data-akey')!;
  expect(onMarkedKeysChange).toHaveBeenLastCalledWith([key0]);
  expect(onMouseSelectedKeysChange).toHaveBeenLastCalledWith([key2]);
  expect(railRoot(rows(container)[0]).style.background).toContain('16%');
  expect(railRoot(rows(container)[2]).style.background).toBe('');
});

test('Ctrl/Cmd+click adds without clearing, and toggles a marked row off', () => {
  const { container } = renderTable();
  fireEvent.click(rows(container)[0]);
  fireEvent.click(rows(container)[3], { ctrlKey: true });
  expect(marked(container)).toEqual([true, false, false, true, false]);
  expect(latestIdx(container)).toBe(3);

  // Cmd (metaKey) toggles the same row off; the other mark stays.
  fireEvent.click(rows(container)[3], { metaKey: true });
  expect(marked(container)).toEqual([true, false, false, false, false]);
});

test('Escape clears the mouse selection while the table is focused', () => {
  const onMouseSelectedKeysChange = vi.fn();
  const onMarkedKeysChange = vi.fn();
  const { container } = renderTable({ onMouseSelectedKeysChange, onMarkedKeysChange });
  fireEvent.click(rows(container)[0]);
  fireEvent.click(markRail(rows(container)[0]));
  fireEvent.click(rows(container)[2], { ctrlKey: true });
  expect(marked(container)).toEqual([true, false, true, false, false]);

  const root = container.firstElementChild as HTMLElement;
  fireEvent.keyDown(root, { key: 'Escape' });
  expect(onMouseSelectedKeysChange).toHaveBeenLastCalledWith([]);
  expect(onMarkedKeysChange).toHaveBeenLastCalledWith([rows(container)[0].getAttribute('data-akey')]);
  expect(marked(container)).toEqual([false, false, false, false, false]);
  expect(markRail(rows(container)[0]).getAttribute('title')).toBe('Unmark this message');
});

test('Ctrl+A selects every visible row and does not select text', () => {
  const onMouseSelectedKeysChange = vi.fn();
  const onMarkedKeysChange = vi.fn();
  const removeAllRanges = vi.spyOn(window.getSelection()!, 'removeAllRanges');
  const { container } = renderTable({ onMouseSelectedKeysChange, onMarkedKeysChange });
  fireEvent.click(rows(container)[2]);
  fireEvent.click(markRail(rows(container)[0]));
  const root = container.firstElementChild as HTMLElement;
  root.focus();
  const keys = rows(container).map(r => r.getAttribute('data-akey')!);

  const keyEvent = new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true });
  const selectStart = new Event('selectstart', { bubbles: true, cancelable: true });
  act(() => {
    root.dispatchEvent(keyEvent);
    root.dispatchEvent(selectStart);
  });

  expect(keyEvent.defaultPrevented).toBe(true);
  expect(selectStart.defaultPrevented).toBe(true);
  expect(onMouseSelectedKeysChange).toHaveBeenLastCalledWith(keys);
  expect(marked(container)).toEqual([true, true, true, true, true]);
  expect(latestIdx(container)).toBe(2);
  expect(onMarkedKeysChange).toHaveBeenLastCalledWith([keys[0]]);
  expect(removeAllRanges).toHaveBeenCalled();
  removeAllRanges.mockRestore();
});

test('Escape moves OS focus off a rail control onto the table root', () => {
  const { container } = renderTable();
  const root = container.firstElementChild as HTMLElement;
  const swatch = colorSwatch(rows(container)[0]);
  swatch.focus();
  expect(document.activeElement).toBe(swatch);

  fireEvent.keyDown(swatch, { key: 'Escape' });
  expect(document.activeElement).toBe(root);
});

test('rail mark and colour actions apply to every mouse-selected row', () => {
  const onMarkedKeysChange = vi.fn();
  const onMarkColorIndicesChange = vi.fn();
  const { container } = renderTable({ onMarkedKeysChange, onMarkColorIndicesChange });
  fireEvent.click(rows(container)[0]);
  fireEvent.click(rows(container)[2], { ctrlKey: true });
  const key0 = rows(container)[0].getAttribute('data-akey')!;
  const key2 = rows(container)[2].getAttribute('data-akey')!;

  onMarkedKeysChange.mockClear();
  fireEvent.click(markRail(rows(container)[0]));
  expect(onMarkedKeysChange).toHaveBeenLastCalledWith([key0, key2]);

  // Colour swatch on one selected row → both get the same colour.
  onMarkColorIndicesChange.mockClear();
  fireEvent.click(colorSwatch(rows(container)[2]));
  expect(onMarkColorIndicesChange).toHaveBeenCalledWith({ [key0]: 0, [key2]: 0 });
});

test('Shift+click marks the range from the last click to here, in visible order', () => {
  const { container } = renderTable();
  fireEvent.click(rows(container)[1]);
  // mousedown must cancel browser text selection before the range click paints.
  const down = fireEvent.mouseDown(rows(container)[4], { shiftKey: true });
  expect(down).toBe(false);
  expect(window.getSelection()?.rangeCount ?? 0).toBe(0);
  fireEvent.click(rows(container)[4], { shiftKey: true });
  expect(marked(container)).toEqual([false, true, true, true, true]);
  expect(latestIdx(container)).toBe(4);
});

test('Shift+click with no prior click marks only that row', () => {
  const { container } = renderTable();
  fireEvent.click(rows(container)[2], { shiftKey: true });
  expect(marked(container)).toEqual([false, false, true, false, false]);
});

test('Ctrl/Cmd+Shift+click adds the range to existing marks', () => {
  const { container } = renderTable();
  fireEvent.click(rows(container)[4]);                       // mark {4}, last = 4
  fireEvent.click(rows(container)[0], { ctrlKey: true });    // add {0}, last = 0
  fireEvent.click(rows(container)[1], { ctrlKey: true, shiftKey: true }); // + range 0..1
  expect(marked(container)).toEqual([true, true, false, false, true]);
});

test('wheel over the marks pill scrolls the port and does not activate a button', () => {
  const { container } = renderTable();
  fireEvent.click(markRail(rows(container)[0]));
  fireEvent.click(markRail(rows(container)[2]));
  expect(screen.getByTitle('Clear all marks')).toHaveTextContent('Clear 2 marks');

  const port = container.querySelector('.custom-scrollbar') as HTMLElement;
  // jsdom does not implement Element.scrollBy; the browser does.
  const scrollBy = vi.fn();
  port.scrollBy = scrollBy;
  const pill = container.querySelector('.marks-pill') as HTMLElement;
  fireEvent.wheel(pill, { deltaY: 80, deltaX: 0 });
  expect(scrollBy).toHaveBeenCalledWith({ top: 80, left: 0 });
  expect(screen.getByTitle('Clear all marks')).toHaveTextContent('Clear 2 marks');

  scrollBy.mockClear();
  fireEvent.wheel(screen.getByTitle('Clear all marks'), { deltaY: -30, deltaX: 0 });
  expect(scrollBy).toHaveBeenCalledWith({ top: -30, left: 0 });
  expect(screen.getByTitle('Clear all marks')).toHaveTextContent('Clear 2 marks');
});

test('clear-marks pill appears only for the marked flag and clears it', () => {
  const { container } = renderTable();
  expect(screen.queryByTitle('Clear all marks')).not.toBeInTheDocument();

  fireEvent.click(rows(container)[0]);
  fireEvent.click(rows(container)[2], { ctrlKey: true });
  expect(screen.queryByTitle('Clear all marks')).not.toBeInTheDocument();
  expect(marked(container).filter(Boolean)).toHaveLength(2);

  fireEvent.click(markRail(rows(container)[0]));
  expect(screen.getByTitle('Clear all marks')).toHaveTextContent('Clear 2 marks');
  fireEvent.click(screen.getByTitle('Clear all marks'));
  expect(markRail(rows(container)[0]).getAttribute('title')).toBe('Mark this message');
  expect(markRail(rows(container)[2]).getAttribute('title')).toBe('Mark this message');
  expect(marked(container).filter(Boolean)).toHaveLength(2);
  expect(screen.queryByTitle('Clear all marks')).not.toBeInTheDocument();
});

test('clicking a row still pauses live-following (#266) while marking it', () => {
  const onListFollowChange = vi.fn();
  const { container } = renderTable({ listFollow: true, onListFollowChange });
  fireEvent.click(rows(container)[0]);
  expect(onListFollowChange).toHaveBeenCalledWith(false);
  expect(marked(container)[0]).toBe(true);
});

test('prev/next-mark arrows appear with the marked flag and stop live-following (#442)', async () => {
  const onListFollowChange = vi.fn();
  const { container } = renderTable({ listFollow: true, onListFollowChange });
  expect(screen.queryByTitle('Jump to next mark')).not.toBeInTheDocument();
  expect(screen.queryByTitle('Jump to previous mark')).not.toBeInTheDocument();

  fireEvent.click(markRail(rows(container)[1]));
  fireEvent.click(markRail(rows(container)[3]));
  onListFollowChange.mockClear();

  // Cursor is on row 3 (last mark) — next is inactive, previous jumps to row 1.
  expect(screen.getByTitle('Jump to next mark')).toHaveAttribute('aria-disabled', 'true');
  expect(screen.getByTitle('Jump to previous mark')).toHaveAttribute('aria-disabled', 'false');
  fireEvent.click(screen.getByTitle('Jump to previous mark'));
  expect(onListFollowChange).toHaveBeenLastCalledWith(false);
  await vi.waitFor(() => {
    expect(container.querySelector('.log-row.row-flash')).toBeTruthy();
  });
  // Now on first mark — previous inactive, next active.
  expect(screen.getByTitle('Jump to previous mark')).toHaveAttribute('aria-disabled', 'true');
  expect(screen.getByTitle('Jump to next mark')).toHaveAttribute('aria-disabled', 'false');
  onListFollowChange.mockClear();
  fireEvent.click(screen.getByTitle('Jump to next mark'));
  expect(onListFollowChange).toHaveBeenLastCalledWith(false);

  // Jumping never changes the marked flag.
  expect(markRail(rows(container)[1]).getAttribute('title')).toBe('Unmark this message');
  expect(markRail(rows(container)[3]).getAttribute('title')).toBe('Unmark this message');
});

test('mark arrows skip hidden rows and stay on unhidden marks', () => {
  const { container } = renderTable();
  fireEvent.click(markRail(rows(container)[1]));
  fireEvent.click(markRail(rows(container)[3]));
  expect(screen.getByTitle('Jump to previous mark')).toHaveAttribute('aria-disabled', 'false');
  expect(screen.getByTitle('Jump to next mark')).toHaveAttribute('aria-disabled', 'true');

  fireEvent.click(colorSwatch(rows(container)[1]), { altKey: true });
  expect(screen.getByTitle('Show hidden rows. Ctrl-click toggles hide on every row.')).toBeInTheDocument();
  expect(screen.getByTitle('Jump to previous mark')).toHaveAttribute('aria-disabled', 'true');
  expect(screen.getByTitle('Jump to next mark')).toHaveAttribute('aria-disabled', 'true');
});

test('the selected row becomes the scroll anchor while it is on screen (#435)', () => {
  const onListAnchorKeyChange = vi.fn();
  // Not following the live edge, as after scrolling into the list.
  const { container } = renderTable({ listFollow: false, onListFollowChange: vi.fn(), onListAnchorKeyChange });

  fireEvent.click(rows(container)[2]);
  expect(onListAnchorKeyChange).toHaveBeenLastCalledWith(rows(container)[2].getAttribute('data-akey'));

  // Unmarking it hands the anchor back to the top-most visible row.
  fireEvent.click(rows(container)[2], { ctrlKey: true });
  expect(onListAnchorKeyChange).toHaveBeenLastCalledWith(rows(container)[0].getAttribute('data-akey'));
});

test('clicking a row at the live edge anchors that row, not the top one (#435)', () => {
  const onListAnchorKeyChange = vi.fn();
  const onListFollowChange = vi.fn();
  const { container } = renderTable({ listFollow: true, onListFollowChange, onListAnchorKeyChange });

  fireEvent.click(rows(container)[3]);
  expect(onListFollowChange).toHaveBeenLastCalledWith(false);
  expect(onListAnchorKeyChange).toHaveBeenLastCalledWith(rows(container)[3].getAttribute('data-akey'));
});

test('a goto request selects the telegram when it is in the list and stops live-following', async () => {
  const onListFollowChange = vi.fn();
  const onMarkedKeysChange = vi.fn();
  const onMouseSelectedKeysChange = vi.fn();
  const onLastSelectedKeyChange = vi.fn();
  const { container } = renderTable({
    listFollow: true,
    onListFollowChange,
    onMarkedKeysChange,
    onMouseSelectedKeysChange,
    onLastSelectedKeyChange,
    gotoRequest: { id: 1, telegram: TELEGRAMS[2] },
  });

  const key = anchorKey(TELEGRAMS[2]);
  expect(onMarkedKeysChange).not.toHaveBeenCalled();
  expect(onMouseSelectedKeysChange).toHaveBeenCalledWith([key]);
  expect(onLastSelectedKeyChange).toHaveBeenCalledWith(key);
  expect(latestIdx(container)).toBe(2);
  // Selection at the live edge pauses follow, the same way a row click does.
  expect(onListFollowChange).toHaveBeenCalledWith(false);
  await vi.waitFor(() => {
    expect(container.querySelector('.log-row.row-flash')?.getAttribute('data-akey')).toBe(key);
  });
});

test('Alt-click on the colour swatch sets the hide flag', () => {
  const onMarkedKeysChange = vi.fn();
  const onHiddenKeysChange = vi.fn();
  const { container } = renderTable({ onMarkedKeysChange, onHiddenKeysChange });
  const key = rows(container)[1].getAttribute('data-akey')!;
  fireEvent.click(colorSwatch(rows(container)[1]), { altKey: true });
  expect(onMarkedKeysChange).not.toHaveBeenCalled();
  expect(onHiddenKeysChange).toHaveBeenCalledWith([key]);
  expect(rows(container).map(r => r.getAttribute('data-akey'))).not.toContain(key);
  expect(screen.getByTitle('Show hidden rows. Ctrl-click toggles hide on every row.')).toHaveTextContent('Show 1 hidden');

  fireEvent.click(screen.getByTitle('Show hidden rows. Ctrl-click toggles hide on every row.'));
  expect(onHiddenKeysChange).toHaveBeenLastCalledWith([]);
  expect(rows(container).map(r => r.getAttribute('data-akey'))).toContain(key);
});

test('Clear marks only the visible rows; Show hidden restores hidden marks', () => {
  const onHiddenKeysChange = vi.fn();
  const { container } = renderTable({ onHiddenKeysChange });
  fireEvent.click(markRail(rows(container)[1]));
  const hiddenKey = rows(container)[1].getAttribute('data-akey')!;
  fireEvent.click(screen.getByTitle('Clear all marks'), { ctrlKey: true });
  expect(rows(container).map(r => r.getAttribute('data-akey'))).not.toContain(hiddenKey);

  fireEvent.click(markRail(rows(container)[0]));
  const visibleKey = rows(container)[0].getAttribute('data-akey')!;
  expect(screen.getByTitle('Clear all marks')).toHaveTextContent('Clear 1 mark');
  expect(screen.getByTitle('Show hidden rows. Ctrl-click toggles hide on every row.')).toHaveTextContent('Show 1 hidden');

  fireEvent.click(screen.getByTitle('Clear all marks'));
  expect(screen.queryByTitle('Clear all marks')).not.toBeInTheDocument();
  expect(screen.getByTitle('Show hidden rows. Ctrl-click toggles hide on every row.')).toHaveTextContent('Show 1 hidden');

  fireEvent.click(screen.getByTitle('Show hidden rows. Ctrl-click toggles hide on every row.'));
  expect(onHiddenKeysChange).toHaveBeenLastCalledWith([]);
  const restored = rows(container).find(r => r.getAttribute('data-akey') === hiddenKey);
  expect(restored).toBeTruthy();
  expect(markRail(restored!).getAttribute('title')).toBe('Unmark this message');
  expect(screen.getByTitle('Clear all marks')).toHaveTextContent('Clear 1 mark');
  expect(rows(container).find(r => r.getAttribute('data-akey') === visibleKey)?.classList.contains('marked')).toBe(false);
});

test('Ctrl-click on Show hidden toggles the hide flag of every row', () => {
  const onHiddenKeysChange = vi.fn();
  const { container } = renderTable({ onHiddenKeysChange });
  const hiddenKey = rows(container)[1].getAttribute('data-akey')!;
  const visibleKeys = rows(container).map(r => r.getAttribute('data-akey')!).filter(k => k !== hiddenKey);
  fireEvent.click(colorSwatch(rows(container)[1]), { altKey: true });
  expect(screen.getByTitle('Show hidden rows. Ctrl-click toggles hide on every row.')).toHaveTextContent('Show 1 hidden');

  fireEvent.click(screen.getByTitle('Show hidden rows. Ctrl-click toggles hide on every row.'), { ctrlKey: true });
  const inverted = onHiddenKeysChange.mock.calls.at(-1)![0] as string[];
  expect(inverted).toEqual(visibleKeys);
  expect(rows(container).map(r => r.getAttribute('data-akey'))).toEqual([hiddenKey]);
  expect(screen.getByTitle('Show hidden rows. Ctrl-click toggles hide on every row.')).toHaveTextContent(`Show ${visibleKeys.length} hidden`);

  fireEvent.click(screen.getByTitle('Show hidden rows. Ctrl-click toggles hide on every row.'), { ctrlKey: true });
  expect(onHiddenKeysChange).toHaveBeenLastCalledWith([hiddenKey]);
  expect(rows(container).map(r => r.getAttribute('data-akey'))).toEqual(visibleKeys);
});

test('middle rail swatch sets colour without marking; rail fill needs a mark', () => {
  const onMarkColorIndicesChange = vi.fn();
  const onMarkedKeysChange = vi.fn();
  const { container } = renderTable({ onMarkColorIndicesChange, onMarkedKeysChange });
  const key = rows(container)[0].getAttribute('data-akey')!;
  const swatch = colorSwatch(rows(container)[0]);
  expect(swatch).toBeTruthy();
  expect(swatch.style.background).toBe('transparent');

  fireEvent.click(swatch);
  expect(onMarkedKeysChange).not.toHaveBeenCalled();
  expect(onMarkColorIndicesChange).toHaveBeenCalledWith({ [key]: 0 });
  expect(colorSwatch(rows(container)[0]).style.background).toBeTruthy();
  expect(colorSwatch(rows(container)[0]).getAttribute('aria-label')).toBe('Row colour');
  // Colour without mark stays dimmed; rail stays unmarked.
  expect(colorSwatch(rows(container)[0]).style.opacity).toBe('0.45');
  expect(markRail(rows(container)[0]).getAttribute('title')).toBe('Mark this message');
  expect(railRoot(rows(container)[0]).style.background).toBe('');

  // Marking paints the rail with the swatch colour.
  fireEvent.click(markRail(rows(container)[0]));
  expect(markRail(rows(container)[0]).getAttribute('title')).toBe('Unmark this message');
  expect(colorSwatch(rows(container)[0]).style.opacity).toBe('1');
  expect(railRoot(rows(container)[0]).style.background).toContain(colorSwatch(rows(container)[0]).style.background);
  expect(railRoot(rows(container)[0]).style.background).toContain('34%');

  // Unmark keeps the colour (dimmed swatch); only Ctrl/Cmd on the swatch clears it.
  onMarkColorIndicesChange.mockClear();
  fireEvent.click(markRail(rows(container)[0]));
  expect(markRail(rows(container)[0]).getAttribute('title')).toBe('Mark this message');
  expect(onMarkColorIndicesChange).not.toHaveBeenCalled();
  expect(colorSwatch(rows(container)[0]).style.background).toBeTruthy();
  expect(colorSwatch(rows(container)[0]).style.opacity).toBe('0.45');
});

test('colour click repeats the last colour and steps only when the clicked row already has it', () => {
  const onMarkColorIndicesChange = vi.fn();
  const { container } = renderTable({ onMarkColorIndicesChange });
  fireEvent.click(rows(container)[0]);
  fireEvent.click(rows(container)[2], { ctrlKey: true });
  const key0 = rows(container)[0].getAttribute('data-akey')!;
  const key2 = rows(container)[2].getAttribute('data-akey')!;

  fireEvent.click(colorSwatch(rows(container)[0]));
  expect(onMarkColorIndicesChange).toHaveBeenLastCalledWith({ [key0]: 0, [key2]: 0 });

  // Clicked row already has the last colour → one step, still on the selection.
  fireEvent.click(colorSwatch(rows(container)[0]));
  expect(onMarkColorIndicesChange).toHaveBeenLastCalledWith({ [key0]: 1, [key2]: 1 });

  // A row without that colour receives the last colour. Other rows keep theirs.
  const key1 = rows(container)[1].getAttribute('data-akey')!;
  fireEvent.click(colorSwatch(rows(container)[1]));
  expect(onMarkColorIndicesChange).toHaveBeenLastCalledWith({ [key0]: 1, [key1]: 1, [key2]: 1 });

  // Only Ctrl-click clears the selection. A plain click restores the last colour.
  fireEvent.click(rows(container)[0]);
  fireEvent.click(rows(container)[1], { ctrlKey: true });
  fireEvent.click(rows(container)[2], { ctrlKey: true });
  fireEvent.click(colorSwatch(rows(container)[0]), { ctrlKey: true });
  expect(onMarkColorIndicesChange).toHaveBeenLastCalledWith({});
  fireEvent.click(colorSwatch(rows(container)[0]));
  expect(onMarkColorIndicesChange).toHaveBeenLastCalledWith({ [key0]: 1, [key1]: 1, [key2]: 1 });
});

test('colour without a manual mark is shown dimmed on the swatch', () => {
  const { container } = renderTable({
    markedKeys: [],
    markColorIndices: { [anchorKey(TELEGRAMS[0])]: 0 },
  });
  expect(colorSwatch(rows(container)[0]).style.background).toBeTruthy();
  expect(colorSwatch(rows(container)[0]).style.opacity).toBe('0.45');
});

test('viewChangeToken pins and flashes the last selected row', async () => {
  const onListFollowChange = vi.fn();
  const onListAnchorKeyChange = vi.fn();
  const { container, rerender } = renderTable({
    listFollow: true,
    onListFollowChange,
    onListAnchorKeyChange,
    viewChangeToken: 0,
  });
  fireEvent.click(rows(container)[2]);
  const key2 = rows(container)[2].getAttribute('data-akey')!;
  onListFollowChange.mockClear();
  onListAnchorKeyChange.mockClear();

  rerender(
    <TelegramTable
      telegrams={TELEGRAMS}
      visibleColumns={visibleColumns}
      sortConfig={sortConfig}
      onSort={vi.fn()}
      activeFilters={DEFAULT_FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
      listFollow={true}
      onListFollowChange={onListFollowChange}
      onListAnchorKeyChange={onListAnchorKeyChange}
      viewChangeToken={1}
    />,
  );
  // flashRow schedules via rAF after the layout pin.
  await vi.waitFor(() => {
    expect(onListAnchorKeyChange).toHaveBeenCalledWith(key2);
  });
  await vi.waitFor(() => {
    expect(container.querySelector('.log-row.row-flash')?.getAttribute('data-akey')).toBe(key2);
  });
});

test('visible marks stay in the list when the quick filter would drop them', () => {
  const keep = TELEGRAMS[2];
  const key = anchorKey(keep);
  const { container } = renderTable({
    telegrams: TELEGRAMS,
    markedKeys: [key],
    quickFilterOpen: true,
    quickFilterEnabled: true,
    quickPatterns: { target: { top: '', bottom: 'no-such-address' } },
  });
  const keys = rows(container).map(r => r.getAttribute('data-akey'));
  expect(keys).toContain(key);
  expect(keys).toHaveLength(1);
});

test('enabling the quick filter keeps a mouse-selected row visible and pinned', async () => {
  const onListAnchorKeyChange = vi.fn();
  const onMouseSelectedKeysChange = vi.fn();
  const { container } = renderTable({
    onListAnchorKeyChange,
    onMouseSelectedKeysChange,
    listFollow: false,
    forceIncludeFrom: TELEGRAMS,
  });
  fireEvent.click(rows(container)[2]);
  const key = rows(container)[2].getAttribute('data-akey')!;
  expect(onMouseSelectedKeysChange).toHaveBeenLastCalledWith([key]);
  onListAnchorKeyChange.mockClear();

  // Exclude every address — only the selection must survive via force-include.
  fireEvent.click(screen.getByTitle('Show quick filter bar'));
  fireEvent.change(screen.getByLabelText('Quick filter TARGET name'), {
    target: { value: 'no-such-address' },
  });

  await vi.waitFor(() => {
    const keys = rows(container).map(r => r.getAttribute('data-akey'));
    expect(keys).toContain(key);
    expect(keys).toHaveLength(1);
  });
  await vi.waitFor(() => {
    expect(onListAnchorKeyChange).toHaveBeenCalledWith(key);
  });
});

test('forceIncludeFrom restores a selected row the parent already filtered out', () => {
  const keep = TELEGRAMS[2];
  const key = anchorKey(keep);
  // Parent passes only a non-matching subset — the selection must come back
  // from forceIncludeFrom (full buffer).
  const { container } = renderTable({
    telegrams: [TELEGRAMS[0]],
    forceIncludeFrom: TELEGRAMS,
    mouseSelectedKeys: [key],
    lastSelectedKey: key,
    quickFilterOpen: true,
    quickFilterEnabled: true,
    quickPatterns: { target: { top: '', bottom: 'no-such-address' } },
  });
  const keys = rows(container).map(r => r.getAttribute('data-akey'));
  expect(keys).toContain(key);
});

test('changing the latest selected row keeps the previous row colour', () => {
  const onMarkColorIndicesChange = vi.fn();
  const { container } = renderTable({ onMarkColorIndicesChange });
  const key0 = rows(container)[0].getAttribute('data-akey')!;

  fireEvent.click(rows(container)[0]);
  fireEvent.click(colorSwatch(rows(container)[0]));
  expect(onMarkColorIndicesChange).toHaveBeenLastCalledWith({ [key0]: 0 });

  onMarkColorIndicesChange.mockClear();
  fireEvent.click(rows(container)[2]);
  expect(onMarkColorIndicesChange).not.toHaveBeenCalled();
  expect(colorSwatch(rows(container)[0]).style.background).toBeTruthy();
  expect(colorSwatch(rows(container)[0]).getAttribute('aria-label')).toBe('Row colour');
});

test('injected styles define a scheme-aware row-flash fade', () => {
  const css = [...document.querySelectorAll('style')].map(s => s.textContent ?? '').join('\n');
  expect(css).toContain('.log-row.row-flash');
  expect(css).toContain('row-flash-fade');
  expect(css).toContain('inset 0 0 0 1px var(--row-flash-border)');
});

test('context rail shows ∧ above older and ∨ below newer relative to an active context anchor', () => {
  // Desc list: [0]=10:00:05 … [2]=10:00:03 (flagged anchor) … [4]=10:00:01.
  // [1]=10:00:04 is after the anchor → ∨; [3]=10:00:02 is before → ∧.
  const anchorKey2 = anchorKey(TELEGRAMS[2]);
  const { container } = renderTable({
    flaggedKeys: [anchorKey2],
    contextKeys: new Set([anchorKey(TELEGRAMS[1]), anchorKey(TELEGRAMS[3])]),
    contextForAllMatches: false,
    activeFilters: {
      ...DEFAULT_FILTERS,
      deltaBeforeMs: 5000,
      deltaAfterMs: 5000,
      deltaContextEnabled: true,
    },
  });

  expect(rows(container)[3].querySelector('[data-context-rail="before"]')).toHaveTextContent('∧');
  expect(rows(container)[3].querySelector('[data-context-rail="after"]')).toBeNull();
  expect(rows(container)[1].querySelector('[data-context-rail="after"]')).toHaveTextContent('∨');
  expect(rows(container)[1].querySelector('[data-context-rail="before"]')).toBeNull();
  // Anchor itself is not a context row — no signs.
  expect(rows(container)[2].querySelector('[data-context-rail]')).toBeNull();
});

test('context is a row flag, not a mark; rail toggles marked; wash stays on body', () => {
  const onMarkedKeysChange = vi.fn();
  const contextKey = anchorKey(TELEGRAMS[1]);
  const { container } = renderTable({
    onMarkedKeysChange,
    contextKeys: new Set([contextKey]),
  });

  expect(onMarkedKeysChange).not.toHaveBeenCalled();
  expect(rows(container)[1].classList.contains('context')).toBe(true);
  expect(screen.queryByTitle('Clear all marks')).not.toBeInTheDocument();
  expect(markRail(rows(container)[1]).getAttribute('title')).toBe('Mark this message');
  expect(railRoot(rows(container)[1]).style.background).toBe('');
  // Wash is on the body only — never over the mark rail.
  expect(rowBody(rows(container)[1]).style.background).toContain('color-mix');
  expect(rows(container)[1].style.background).not.toContain('color-mix');

  // Rail toggles marked beside the context flag; rail fill matches body wash.
  fireEvent.click(markRail(rows(container)[1]));
  expect(onMarkedKeysChange).toHaveBeenCalledWith([contextKey]);
  expect(rows(container)[1].classList.contains('context')).toBe(true);
  expect(markRail(rows(container)[1]).getAttribute('title')).toBe('Unmark this message');
  expect(railRoot(rows(container)[1]).style.background).toBe(rowBody(rows(container)[1]).style.background);
  expect(rows(container)[1].style.background).not.toContain('color-mix');

  fireEvent.click(markRail(rows(container)[1]));
  expect(onMarkedKeysChange).toHaveBeenLastCalledWith([]);
  expect(railRoot(rows(container)[1]).style.background).toBe('');
  expect(rows(container)[1].classList.contains('context')).toBe(true);

  // Clear drops the marked flag only. The context flag stays.
  fireEvent.click(markRail(rows(container)[1]));
  fireEvent.click(markRail(rows(container)[0]));
  expect(screen.getByTitle('Clear all marks')).toHaveTextContent('Clear 2 marks');
  fireEvent.click(markRail(rows(container)[2]));
  expect(screen.getByTitle('Clear all marks')).toHaveTextContent('Clear 3 marks');
  fireEvent.click(screen.getByTitle('Clear all marks'));
  expect(screen.queryByTitle('Clear all marks')).not.toBeInTheDocument();
  expect(onMarkedKeysChange).toHaveBeenLastCalledWith([]);
  expect(rows(container)[1].classList.contains('context')).toBe(true);
});

test('a goto request does not select a telegram the current list has filtered out', () => {
  const onMouseSelectedKeysChange = vi.fn();
  const onLastSelectedKeyChange = vi.fn();
  const onListFollowChange = vi.fn();
  const hidden = makeTelegram({
    timestamp: '2024-01-01T10:00:03.500Z',
    target_address: '9/9/9',
    raw_hex: '0x99',
  });
  renderTable({
    onMouseSelectedKeysChange,
    onLastSelectedKeyChange,
    onListFollowChange,
    gotoRequest: { id: 1, telegram: hidden },
  });

  expect(onMouseSelectedKeysChange).not.toHaveBeenCalled();
  expect(onLastSelectedKeyChange).not.toHaveBeenCalled();
  // The list still moves to that time (nearest visible row) and stops following.
  expect(onListFollowChange).toHaveBeenCalledWith(false);
});

const tableElement = (props: Partial<React.ComponentProps<typeof TelegramTable>> = {}) => (
  <TelegramTable
    telegrams={TELEGRAMS}
    visibleColumns={visibleColumns}
    sortConfig={sortConfig}
    onSort={vi.fn()}
    activeFilters={DEFAULT_FILTERS}
    onQuickFilter={vi.fn()}
    onQuickVisualize={vi.fn()}
    {...props}
  />
);

test('a ctrl goto adds the target to the existing mouse selection', () => {
  const onMouseSelectedKeysChange = vi.fn();
  const onLastSelectedKeyChange = vi.fn();
  const shared = { onMouseSelectedKeysChange, onLastSelectedKeyChange };
  const { container, rerender } = render(tableElement(shared));
  fireEvent.click(rows(container)[0]);
  const key0 = anchorKey(TELEGRAMS[0]);
  const key2 = anchorKey(TELEGRAMS[2]);

  rerender(tableElement({
    ...shared,
    gotoRequest: { id: 1, telegram: TELEGRAMS[2], additive: true },
  }));

  expect(onMouseSelectedKeysChange).toHaveBeenLastCalledWith([key0, key2]);
  expect(onLastSelectedKeyChange).toHaveBeenLastCalledWith(key2);
  expect(marked(container)).toEqual([true, false, true, false, false]);
  expect(latestIdx(container)).toBe(2);
});

test('a shift goto selects the range from the previous last selected row', () => {
  const onMouseSelectedKeysChange = vi.fn();
  const onLastSelectedKeyChange = vi.fn();
  const shared = { onMouseSelectedKeysChange, onLastSelectedKeyChange };
  const { container, rerender } = render(tableElement(shared));
  fireEvent.click(rows(container)[1]);
  const range = [TELEGRAMS[1], TELEGRAMS[2], TELEGRAMS[3]].map(anchorKey);

  rerender(tableElement({
    ...shared,
    gotoRequest: { id: 1, telegram: TELEGRAMS[3], range: true },
  }));

  expect(onMouseSelectedKeysChange).toHaveBeenLastCalledWith(range);
  expect(onLastSelectedKeyChange).toHaveBeenLastCalledWith(range[2]);
  expect(marked(container)).toEqual([false, true, true, true, false]);
  expect(latestIdx(container)).toBe(3);
});

test('a goto reveals a filtered-out telegram and makes it the last selected row', async () => {
  const onMouseSelectedKeysChange = vi.fn();
  const onLastSelectedKeyChange = vi.fn();
  const target = TELEGRAMS[2];
  const key = anchorKey(target);
  const { container } = renderTable({
    telegrams: [TELEGRAMS[0]],
    forceIncludeFrom: TELEGRAMS,
    onMouseSelectedKeysChange,
    onLastSelectedKeyChange,
    gotoRequest: { id: 1, telegram: target },
  });

  await vi.waitFor(() => {
    expect(onMouseSelectedKeysChange).toHaveBeenCalledWith([key]);
    expect(onLastSelectedKeyChange).toHaveBeenCalledWith(key);
  });
  await vi.waitFor(() => {
    expect(rows(container).map(r => r.getAttribute('data-akey'))).toContain(key);
  });
  await vi.waitFor(() => {
    expect(container.querySelector('.log-row.row-flash')?.getAttribute('data-akey')).toBe(key);
  });
});
