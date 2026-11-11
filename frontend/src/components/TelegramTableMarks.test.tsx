import { render, fireEvent, screen } from '@testing-library/react';
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
  // Latest selection applies an `auto` rail mark (selected-not-latest wash).
  expect(railRoot(rows(container)[0]).style.background).toContain('16%');

  fireEvent.click(rows(container)[2]);
  expect(marked(container)).toEqual([false, false, true, false, false]);
  expect(latestIdx(container)).toBe(2);
  // `auto` moves with latest; the previous row's rail clears.
  expect(railRoot(rows(container)[0]).style.background).toBe('');
  expect(railRoot(rows(container)[2]).style.background).toContain('16%');
});

test('plain mousedrag does not mark so text selection can stick', () => {
  const { container } = renderTable();
  const row = rows(container)[1];
  fireEvent.mouseDown(row, { clientX: 20, clientY: 30 });
  fireEvent.click(row, { clientX: 80, clientY: 30 });
  expect(marked(container)).toEqual([false, false, false, false, false]);

  // A click without meaningful movement still marks.
  fireEvent.mouseDown(row, { clientX: 20, clientY: 30 });
  fireEvent.click(row, { clientX: 22, clientY: 31 });
  expect(marked(container)).toEqual([false, true, false, false, false]);
});

test('rail click toggles manual mark without changing mouse selection', () => {
  const onMarkReasonsChange = vi.fn();
  const onLastMarkedKeyChange = vi.fn();
  const { container } = renderTable({ onMarkReasonsChange, onLastMarkedKeyChange });

  fireEvent.click(rows(container)[0]);
  const key0 = rows(container)[0].getAttribute('data-akey')!;
  expect(onLastMarkedKeyChange).toHaveBeenLastCalledWith(key0);
  onMarkReasonsChange.mockClear();
  onLastMarkedKeyChange.mockClear();

  fireEvent.click(markRail(rows(container)[2]));
  const key2 = rows(container)[2].getAttribute('data-akey')!;
  expect(markRail(rows(container)[2]).getAttribute('title')).toBe('Unmark this message');
  expect(onLastMarkedKeyChange).not.toHaveBeenCalled();
  const afterRail = onMarkReasonsChange.mock.calls.at(-1)![0] as Record<string, string[]>;
  expect(afterRail[key0]).toEqual(['mouse', 'auto']);
  expect(afterRail[key2]).toEqual(['manual']);
  // Background / `.marked` follows mouse selection only — rail mark does not tint.
  expect(marked(container)).toEqual([true, false, false, false, false]);
  expect(latestIdx(container)).toBe(0);
  // Manual/`auto` rail uses the selected-but-not-latest wash (not the latest body wash).
  expect(railRoot(rows(container)[2]).style.background).toContain('16%');
  expect(railRoot(rows(container)[0]).style.background).toContain('16%');
  expect(rowBody(rows(container)[0]).style.background).toContain('34%');

  fireEvent.click(markRail(rows(container)[2]));
  const afterToggleOff = onMarkReasonsChange.mock.calls.at(-1)![0] as Record<string, string[]>;
  expect(afterToggleOff[key2]).toBeUndefined();
  expect(afterToggleOff[key0]).toEqual(['mouse', 'auto']);
  expect(marked(container)).toEqual([true, false, false, false, false]);
  expect(railRoot(rows(container)[2]).style.background).toBe('');
});

test('promoting auto on latest takes the latest wash; demote restores auto', () => {
  const onMarkReasonsChange = vi.fn();
  const { container } = renderTable({ onMarkReasonsChange });

  fireEvent.click(rows(container)[0]);
  const key0 = rows(container)[0].getAttribute('data-akey')!;
  expect(railRoot(rows(container)[0]).style.background).toContain('16%');

  // Promote auto → manual; rail matches latest body wash.
  onMarkReasonsChange.mockClear();
  fireEvent.click(markRail(rows(container)[0]));
  expect(onMarkReasonsChange).toHaveBeenLastCalledWith({ [key0]: ['mouse', 'manual'] });
  expect(railRoot(rows(container)[0]).style.background).toContain('34%');
  expect(railRoot(rows(container)[0]).style.background).toBe(rowBody(rows(container)[0]).style.background);

  // Demote manual → auto again (mark stays, wash back to 16%).
  fireEvent.click(markRail(rows(container)[0]));
  expect(onMarkReasonsChange).toHaveBeenLastCalledWith({ [key0]: ['mouse', 'auto'] });
  expect(railRoot(rows(container)[0]).style.background).toContain('16%');

  // Promote again, then move latest away — user mark survives.
  fireEvent.click(markRail(rows(container)[0]));
  expect(railRoot(rows(container)[0]).style.background).toContain('34%');
  fireEvent.click(rows(container)[2]);
  const key2 = rows(container)[2].getAttribute('data-akey')!;
  const after = onMarkReasonsChange.mock.calls.at(-1)![0] as Record<string, string[]>;
  expect(after[key0]).toEqual(['manual']);
  expect(after[key2]).toEqual(['mouse', 'auto']);
  expect(railRoot(rows(container)[0]).style.background).toContain('16%');
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
  const onMarkReasonsChange = vi.fn();
  const { container } = renderTable({ onMarkReasonsChange });
  fireEvent.click(rows(container)[0]);
  fireEvent.click(rows(container)[2], { ctrlKey: true });
  expect(marked(container)).toEqual([true, false, true, false, false]);

  const root = container.firstElementChild as HTMLElement;
  fireEvent.keyDown(root, { key: 'Escape' });
  const after = onMarkReasonsChange.mock.calls.at(-1)![0] as Record<string, string[]>;
  expect(Object.values(after).flat().includes('mouse')).toBe(false);
  expect(Object.values(after).flat().includes('auto')).toBe(false);
  expect(marked(container)).toEqual([false, false, false, false, false]);
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
  const onMarkReasonsChange = vi.fn();
  const onMarkColorIndicesChange = vi.fn();
  const { container } = renderTable({ onMarkReasonsChange, onMarkColorIndicesChange });
  fireEvent.click(rows(container)[0]);
  fireEvent.click(rows(container)[2], { ctrlKey: true });
  const key0 = rows(container)[0].getAttribute('data-akey')!;
  const key2 = rows(container)[2].getAttribute('data-akey')!;

  // Promote/mark via rail on one selected row → both get manual.
  onMarkReasonsChange.mockClear();
  fireEvent.click(markRail(rows(container)[0]));
  const afterMark = onMarkReasonsChange.mock.calls.at(-1)![0] as Record<string, string[]>;
  expect(afterMark[key0]).toEqual(expect.arrayContaining(['mouse', 'manual']));
  expect(afterMark[key2]).toEqual(expect.arrayContaining(['mouse', 'manual']));

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

test('clear-marks pill appears only when marked and removes every mark', () => {
  const { container } = renderTable();
  expect(screen.queryByTitle('Clear all marks')).not.toBeInTheDocument();

  fireEvent.click(rows(container)[0]);
  fireEvent.click(rows(container)[2], { ctrlKey: true });
  expect(marked(container).filter(Boolean)).toHaveLength(2);

  fireEvent.click(screen.getByTitle('Clear all marks'));
  expect(marked(container).filter(Boolean)).toHaveLength(0);
  expect(screen.queryByTitle('Clear all marks')).not.toBeInTheDocument();
});

test('clicking a row still pauses live-following (#266) while marking it', () => {
  const onListFollowChange = vi.fn();
  const { container } = renderTable({ listFollow: true, onListFollowChange });
  fireEvent.click(rows(container)[0]);
  expect(onListFollowChange).toHaveBeenCalledWith(false);
  expect(marked(container)[0]).toBe(true);
});

test('prev/next-mark arrows appear with the marks and stop live-following (#442)', async () => {
  const onListFollowChange = vi.fn();
  const { container } = renderTable({ listFollow: true, onListFollowChange });
  expect(screen.queryByTitle('Jump to next mark')).not.toBeInTheDocument();
  expect(screen.queryByTitle('Jump to previous mark')).not.toBeInTheDocument();

  fireEvent.click(rows(container)[1]);
  fireEvent.click(rows(container)[3], { ctrlKey: true });
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

  // Jumping never changes what is marked.
  expect(marked(container)).toEqual([false, true, false, true, false]);
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

test('a goto request marks the telegram when it is in the list and stops live-following', () => {
  const onListFollowChange = vi.fn();
  const onMarkReasonsChange = vi.fn();
  const onLastMarkedKeyChange = vi.fn();
  renderTable({
    listFollow: true,
    onListFollowChange,
    onMarkReasonsChange,
    onLastMarkedKeyChange,
    gotoRequest: { id: 1, telegram: TELEGRAMS[2] },
  });

  const key = anchorKey(TELEGRAMS[2]);
  expect(onMarkReasonsChange).toHaveBeenCalledWith({ [key]: ['goto', 'auto'] });
  expect(onLastMarkedKeyChange).toHaveBeenCalledWith(key);
  // gotoIndex pauses follow; that is the same path that centers the row.
  expect(onListFollowChange).toHaveBeenCalledWith(false);
});

test('Alt-click on the colour swatch hides the row; pill can clear hidden', () => {
  const onMarkReasonsChange = vi.fn();
  const { container } = renderTable({ onMarkReasonsChange });
  const key = rows(container)[1].getAttribute('data-akey')!;
  fireEvent.click(colorSwatch(rows(container)[1]), { altKey: true });
  expect(onMarkReasonsChange).toHaveBeenCalledWith({ [key]: ['hidden'] });
  // Hidden rows leave the list.
  expect(rows(container).map(r => r.getAttribute('data-akey'))).not.toContain(key);
  expect(screen.getByTitle('Clear all hidden')).toHaveTextContent('Clear 1 hidden');

  fireEvent.click(screen.getByTitle('Clear all hidden'));
  expect(onMarkReasonsChange).toHaveBeenLastCalledWith({});
});

test('middle rail swatch sets colour without marking; rail fill needs a mark', () => {
  const onMarkColorIndicesChange = vi.fn();
  const onMarkReasonsChange = vi.fn();
  const { container } = renderTable({ onMarkColorIndicesChange, onMarkReasonsChange });
  const key = rows(container)[0].getAttribute('data-akey')!;
  const swatch = colorSwatch(rows(container)[0]);
  expect(swatch).toBeTruthy();
  expect(swatch.style.background).toBe('transparent');

  fireEvent.click(swatch);
  expect(onMarkReasonsChange).not.toHaveBeenCalled();
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

test('colour without a manual mark is shown dimmed on the swatch', () => {
  const { container } = renderTable({
    markReasons: {},
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
    markReasons: { [key]: ['manual'] },
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
  const onMarkReasonsChange = vi.fn();
  const { container } = renderTable({
    onListAnchorKeyChange,
    onMarkReasonsChange,
    listFollow: false,
    forceIncludeFrom: TELEGRAMS,
  });
  fireEvent.click(rows(container)[2]);
  const key = rows(container)[2].getAttribute('data-akey')!;
  expect(onMarkReasonsChange.mock.calls.at(-1)![0][key]).toEqual(
    expect.arrayContaining(['mouse']),
  );
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
    markReasons: { [key]: ['mouse', 'auto'] },
    lastMarkedKey: key,
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

test('context rows are implicitly marked; rail toggles manual; wash stays on body', () => {
  const onMarkReasonsChange = vi.fn();
  const contextKey = anchorKey(TELEGRAMS[1]);
  const { container } = renderTable({
    onMarkReasonsChange,
    contextKeys: new Set([contextKey]),
  });

  // Sync adds the implicit context reason — actionable, so the pill shows.
  expect(onMarkReasonsChange).toHaveBeenCalledWith({ [contextKey]: ['context'] });
  expect(rows(container)[1].classList.contains('context')).toBe(true);
  expect(screen.getByTitle('Clear all marks')).toHaveTextContent('Clear 1 mark');
  expect(markRail(rows(container)[1]).getAttribute('title')).toBe('Mark this message');
  expect(railRoot(rows(container)[1]).style.background).toBe('');
  // Wash is on the body only — never over the mark rail.
  expect(rowBody(rows(container)[1]).style.background).toContain('color-mix');
  expect(rows(container)[1].style.background).not.toContain('color-mix');

  // Rail toggles manual on context rows; rail fill matches body wash.
  onMarkReasonsChange.mockClear();
  fireEvent.click(markRail(rows(container)[1]));
  expect(onMarkReasonsChange).toHaveBeenCalledWith({ [contextKey]: ['context', 'manual'] });
  expect(rows(container)[1].classList.contains('context')).toBe(true);
  expect(markRail(rows(container)[1]).getAttribute('title')).toBe('Unmark this message');
  expect(railRoot(rows(container)[1]).style.background).toBe(rowBody(rows(container)[1]).style.background);
  expect(rows(container)[1].style.background).not.toContain('color-mix');

  fireEvent.click(markRail(rows(container)[1]));
  expect(onMarkReasonsChange).toHaveBeenLastCalledWith({ [contextKey]: ['context'] });
  expect(railRoot(rows(container)[1]).style.background).toBe('');

  // Clear drops every mark, including context (dismissed until the window changes).
  fireEvent.click(markRail(rows(container)[1]));
  fireEvent.click(markRail(rows(container)[0]));
  expect(screen.getByTitle('Clear all marks')).toHaveTextContent('Clear 2 marks');
  fireEvent.click(rows(container)[2]);
  expect(screen.getByTitle('Clear all marks')).toHaveTextContent('Clear 3 marks');
  fireEvent.click(screen.getByTitle('Clear all marks'));
  expect(screen.queryByTitle('Clear all marks')).not.toBeInTheDocument();
  const afterClear = onMarkReasonsChange.mock.calls.at(-1)![0] as Record<string, string[]>;
  expect(afterClear).toEqual({});
});

test('a goto request does not mark a telegram the current list has filtered out', () => {
  const onMarkReasonsChange = vi.fn();
  const onLastMarkedKeyChange = vi.fn();
  const onListFollowChange = vi.fn();
  const hidden = makeTelegram({
    timestamp: '2024-01-01T10:00:03.500Z',
    target_address: '9/9/9',
    raw_hex: '0x99',
  });
  renderTable({
    onMarkReasonsChange,
    onLastMarkedKeyChange,
    onListFollowChange,
    gotoRequest: { id: 1, telegram: hidden },
  });

  expect(onMarkReasonsChange).not.toHaveBeenCalled();
  expect(onLastMarkedKeyChange).not.toHaveBeenCalled();
  // The list still moves to that time (nearest visible row) and stops following.
  expect(onListFollowChange).toHaveBeenCalledWith(false);
});
