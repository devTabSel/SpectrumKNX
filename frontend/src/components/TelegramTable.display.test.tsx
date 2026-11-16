import { render, fireEvent, screen, act } from '@testing-library/react';
import { expect, test, beforeAll, afterEach } from 'vitest';
import { TelegramTable, type SortConfig } from './TelegramTable';
import { makeTelegram } from '../test/telegramFactory';
import type { Telegram } from '../hooks/useWebSocket';
import { DEFAULT_FILTERS } from '../types/filters';
import { anchorKey } from '../utils/anchorKey';
import {
  DISPLAY_ROW_PX,
  DISPLAY_RUBBER_PX,
  END_MARKER_PX,
  READING_END_LABEL,
  statusPillCount,
  type ReadingEndCause,
} from '../utils/telegramDisplay';

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
      let total = 0;
      for (const child of Array.from(this.children) as HTMLElement[]) {
        const height = Number.parseFloat(child.style.height);
        if (Number.isFinite(height) && height > 0) total += height;
      }
      return total > 0 ? total : scrollBlockSize;
    },
  });
});

afterEach(() => {
  scrollBlockSize = 800;
});

const visibleColumns = {
  time: true, delta: true, source: true, sourceName: true,
  target: true, targetName: true, type: true, dpt: true, data: true, value: true,
};
const desc: SortConfig = [{ key: 'timestamp', direction: 'desc' }];
const asc: SortConfig = [{ key: 'timestamp', direction: 'asc' }];

const baseProps = {
  visibleColumns,
  onSort: () => {},
  activeFilters: DEFAULT_FILTERS,
  onQuickFilter: () => {},
  onQuickVisualize: () => {},
};

const BASE = Date.parse('2024-01-01T10:00:00.000Z');
const at = (second: number, name: string): Telegram => makeTelegram({
  timestamp: new Date(BASE + second * 1000).toISOString(),
  target_name: name,
  raw_hex: name,
});

const portOf = (container: HTMLElement) =>
  container.querySelector('.custom-scrollbar') as HTMLElement;

const rowText = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('.log-row')).map(row => row.textContent ?? '');

/** 'top' when the end marker is before the rows, 'bottom' when it follows them. */
function markerSide(container: HTMLElement): 'top' | 'bottom' {
  const marker = container.querySelector('[data-testid="reading-end-marker"]');
  const row = container.querySelector('.log-row');
  if (!marker || !row) throw new Error('missing end marker or row');
  const rowFollowsMarker = (marker.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  return rowFollowsMarker ? 'top' : 'bottom';
}

const settledBottom = (port: HTMLElement) => {
  const max = Math.max(0, port.scrollHeight - port.clientHeight);
  return Math.max(0, max - DISPLAY_RUBBER_PX);
};

function emulateRowLayout(port: HTMLElement) {
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const base = original.call(this);
    if (!this.classList.contains('log-row')) return base;
    let contentTop = 0;
    for (const child of Array.from(port.children) as HTMLElement[]) {
      if (child.contains(this)) break;
      contentTop += Number.parseFloat(child.style.height) || 0;
    }
    const start = /translateY\((-?[\d.]+)px\)/.exec((this as HTMLElement).style.transform);
    const top = contentTop + (start ? Number(start[1]) : 0) - port.scrollTop;
    return { ...base, top, y: top, bottom: top + 85, height: 85 } as DOMRect;
  };
  return () => { Element.prototype.getBoundingClientRect = original; };
}

test('end marker names the limit that stopped the reading end', () => {
  const causes: ReadingEndCause[] = ['range', 'loadlimit', 'data', 'loading'];
  const { rerender } = render(
    <TelegramTable
      {...baseProps}
      telegrams={[at(3, 'a'), at(2, 'b')]}
      sortConfig={desc}
      readDirection="backward"
      readingEnd="range"
    />,
  );
  for (const cause of causes) {
    rerender(
      <TelegramTable
        {...baseProps}
        telegrams={[at(3, 'a'), at(2, 'b')]}
        sortConfig={desc}
        readDirection="backward"
        readingEnd={cause}
      />,
    );
    expect(screen.getByTestId('reading-end-marker')).toHaveTextContent(READING_END_LABEL[cause]);
  }
});

test('variant A spacer sizes at the reading and anchor ends, both directions', () => {
  const readingPx = 800 - DISPLAY_ROW_PX - END_MARKER_PX + DISPLAY_RUBBER_PX;
  const { container, rerender } = render(
    <TelegramTable
      {...baseProps}
      telegrams={[at(3, 'a'), at(2, 'b'), at(1, 'c')]}
      sortConfig={desc}
      readDirection="backward"
      readingEnd="range"
    />,
  );
  const back = portOf(container);
  expect(back.dataset.anchorPx).toBe(String(DISPLAY_RUBBER_PX));
  expect(back.dataset.readingPx).toBe(String(readingPx));
  expect(back.dataset.anchorEdge).toBe('top');
  expect(screen.getByTestId('reading-spacer')).toBeInTheDocument();
  expect(container.querySelector('[data-testid="anchor-spacer"]')).toBeNull();

  rerender(
    <TelegramTable
      {...baseProps}
      telegrams={[at(1, 'c'), at(2, 'b'), at(3, 'a')]}
      sortConfig={asc}
      readDirection="forward"
      readingEnd="data"
      directionGesture="chevron"
    />,
  );
  const fore = portOf(container);
  expect(fore.dataset.anchorPx).toBe(String(DISPLAY_RUBBER_PX));
  expect(fore.dataset.readingPx).toBe(String(readingPx));
  expect(fore.dataset.anchorEdge).toBe('top');
  expect(Number.parseFloat(screen.getByTestId('anchor-spacer').style.height)).toBe(DISPLAY_RUBBER_PX);
  expect(screen.getByTestId('reading-end-marker')).toHaveTextContent('end of data');
});

test('only the gapless run from the anchor is visible, and the anchor row stays while the gap closes', () => {
  const rows = [at(30, 'anchor'), at(20, 'mid'), at(0, 'beyond')];
  const gapped: [number, number][] = [[BASE + 25_000, BASE + 30_000]];
  const { container, rerender } = render(
    <TelegramTable
      {...baseProps}
      telegrams={rows}
      sortConfig={desc}
      readDirection="backward"
      bufferAnchorTs={BASE + 30_000}
      covered={gapped}
      listFollow={false}
      liveFollow={false}
      listAnchorKey={anchorKey(rows[0])}
    />,
  );
  expect(rowText(container).join('|')).toContain('anchor');
  expect(rowText(container).join('|')).not.toContain('beyond');
  expect(rowText(container).join('|')).not.toContain('mid');

  const port = portOf(container);
  const restore = emulateRowLayout(port);
  try {
    const anchorRow = () => container.querySelector('.log-row') as HTMLElement;
    const before = anchorRow().getBoundingClientRect().top;
    rerender(
      <TelegramTable
        {...baseProps}
        telegrams={rows}
        sortConfig={desc}
        readDirection="backward"
        bufferAnchorTs={BASE + 30_000}
        covered={[[BASE, BASE + 30_000]]}
        listFollow={false}
        liveFollow={false}
        listAnchorKey={anchorKey(rows[0])}
      />,
    );
    expect(rowText(container)).toEqual([
      expect.stringContaining('anchor'),
      expect.stringContaining('mid'),
      expect.stringContaining('beyond'),
    ]);
    expect(anchorRow().textContent).toContain('anchor');
    expect(anchorRow().getBoundingClientRect().top).toBe(before);
  } finally {
    restore();
  }
});

test('chevron keeps the scroll position; another direction change rebuilds onto the anchor', () => {
  const rows = [at(5, 'a'), at(4, 'b'), at(3, 'c'), at(2, 'd'), at(1, 'e')];
  const { container, rerender } = render(
    <TelegramTable
      {...baseProps}
      telegrams={rows}
      sortConfig={desc}
      readDirection="backward"
      directionGesture="rebuild"
      listFollow={false}
      liveFollow={false}
    />,
  );
  const port = portOf(container);
  const order = () => Array.from(container.querySelectorAll('.log-row')).map(row => row.getAttribute('data-akey'));
  const before = order();
  expect(port.dataset.anchorEdge).toBe('top');
  expect(markerSide(container)).toBe('bottom');
  port.scrollTop = 200;
  fireEvent.scroll(port);

  rerender(
    <TelegramTable
      {...baseProps}
      telegrams={rows}
      sortConfig={desc}
      readDirection="forward"
      directionGesture="chevron"
      listFollow={false}
      liveFollow={false}
    />,
  );
  expect(port.scrollTop).toBe(200);
  expect(order()).toEqual(before);
  // Same rows, same scroll. Only the anchor side moves: desc puts the oldest
  // row (forward anchor) at the bottom, so the reading marker leaves the bottom.
  expect(port.dataset.anchorEdge).toBe('bottom');
  expect(markerSide(container)).toBe('top');

  rerender(
    <TelegramTable
      {...baseProps}
      telegrams={rows}
      sortConfig={desc}
      readDirection="backward"
      directionGesture="rebuild"
      listFollow={false}
      liveFollow={false}
    />,
  );
  expect(port.scrollTop).not.toBe(200);
  expect(port.scrollTop).toBe(DISPLAY_RUBBER_PX);
});

test('the anchor pill counts rows scrolled out toward the anchor, not the status total', () => {
  const rows = [at(4, 'd'), at(3, 'c'), at(2, 'b'), at(1, 'a')];
  const backlog = [at(6, 'p6'), at(5, 'p5')];
  const { unmount } = render(
    <TelegramTable
      {...baseProps}
      telegrams={rows}
      sortConfig={desc}
      readDirection="backward"
      liveFollow={false}
      listFollow={false}
      isPaused
      pausedCount={backlog.length}
      pausedTelegrams={backlog}
    />,
  );
  // Every row is on screen. The pill is the pause backlog, not the 4 visible
  // rows and not the status pill's total.
  expect(statusPillCount(rows.length, rows.length, false)).toBe(rows.length);
  expect(screen.getByRole('button', { name: '2 newer telegrams' })).toHaveAttribute('data-edge', 'top');
  unmount();

  scrollBlockSize = DISPLAY_ROW_PX;
  const forwardRows = [at(1, 'o'), at(2, 'm'), at(3, 'n'), at(4, 'newest')];
  const { container: fore } = render(
    <TelegramTable
      {...baseProps}
      telegrams={forwardRows}
      sortConfig={asc}
      readDirection="forward"
      liveFollow={false}
      listFollow={false}
      isPaused
      pausedCount={backlog.length}
      pausedTelegrams={backlog}
    />,
  );
  const port = portOf(fore);
  // Anchor row is in the viewport: nothing is scrolled out, and forward
  // ignores the pause backlog, so the pill is gone.
  expect(screen.queryByRole('button', { name: /older telegram/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /newer telegram/ })).not.toBeInTheDocument();

  // Two rows sit fully above the one-row viewport. The two below it do not count.
  port.scrollTop = DISPLAY_RUBBER_PX + DISPLAY_ROW_PX * 2;
  fireEvent.scroll(port);
  expect(screen.getByRole('button', { name: '2 older telegrams' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '4 older telegrams' })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '2 older telegrams' }));
  expect(port.scrollTop).toBe(DISPLAY_RUBBER_PX);
  fireEvent.scroll(port);
  expect(screen.queryByRole('button', { name: /older telegram/ })).not.toBeInTheDocument();
});

test('a non-temporal sort keeps the top row and uses half-row spacers with the pill on top', async () => {
  scrollBlockSize = DISPLAY_ROW_PX;
  const bySource: SortConfig = [{ key: 'source_address', direction: 'asc' }];
  const first = makeTelegram({ source_address: '1.1.2', target_name: 'keep-top', raw_hex: 'keep' });
  const second = makeTelegram({ source_address: '1.1.3', target_name: 'lower', raw_hex: 'lower' });
  const inserted = makeTelegram({ source_address: '1.1.1', target_name: 'inserted', raw_hex: 'inserted' });
  const { container, rerender } = render(
    <TelegramTable
      {...baseProps}
      telegrams={[first, second]}
      sortConfig={bySource}
      readDirection="backward"
      liveFollow={false}
      listFollow={false}
      isPaused
      pausedCount={2}
      pausedTelegrams={[at(9, 'pause-a'), at(8, 'pause-b')]}
    />,
  );
  const port = portOf(container);
  expect(port.dataset.anchorPx).toBe(String(DISPLAY_RUBBER_PX));
  expect(port.dataset.readingPx).toBe(String(DISPLAY_RUBBER_PX));
  const pill = screen.getByRole('button', { name: '2 newer telegrams' });
  expect(pill).toHaveAttribute('data-edge', 'top');

  const restore = emulateRowLayout(port);
  try {
    rerender(
      <TelegramTable
        {...baseProps}
        telegrams={[first, second].slice()}
        sortConfig={bySource}
        readDirection="backward"
        liveFollow={false}
        listFollow={false}
        isPaused
        pausedCount={2}
        pausedTelegrams={[at(9, 'pause-a'), at(8, 'pause-b')]}
      />,
    );
    await act(async () => { await new Promise(r => requestAnimationFrame(() => r())); });
    const top = () => Array.from(container.querySelectorAll('.log-row')).find(row => row.textContent?.includes('keep-top')) as HTMLElement;
    const before = top().getBoundingClientRect().top;
    rerender(
      <TelegramTable
        {...baseProps}
        telegrams={[inserted, first, second]}
        sortConfig={bySource}
        readDirection="backward"
        liveFollow={false}
        listFollow={false}
        isPaused
        pausedCount={2}
        pausedTelegrams={[at(9, 'pause-a'), at(8, 'pause-b')]}
      />,
    );
    await act(async () => { await new Promise(r => requestAnimationFrame(() => r())); });
    expect(top().getBoundingClientRect().top).toBe(before);
    expect(rowText(container).some(text => text.includes('inserted'))).toBe(true);
  } finally {
    restore();
  }
});

test('pill, spacer and end marker follow direction together with the time sort', () => {
  const cases = [
    { direction: 'forward' as const, sort: desc, anchor: 'bottom' as const, word: 'older' },
    { direction: 'forward' as const, sort: asc, anchor: 'top' as const, word: 'older' },
    { direction: 'backward' as const, sort: desc, anchor: 'top' as const, word: 'newer' },
    { direction: 'backward' as const, sort: asc, anchor: 'bottom' as const, word: 'newer' },
  ];
  scrollBlockSize = DISPLAY_ROW_PX * 2;
  const backlog = [at(9, 'pause-a'), at(8, 'pause-b')];
  for (const c of cases) {
    const rows = c.sort === asc
      ? [at(1, 'a'), at(2, 'b'), at(3, 'c'), at(4, 'd'), at(5, 'e'), at(6, 'f')]
      : [at(6, 'f'), at(5, 'e'), at(4, 'd'), at(3, 'c'), at(2, 'b'), at(1, 'a')];
    const { container, unmount } = render(
      <TelegramTable
        {...baseProps}
        telegrams={rows}
        sortConfig={c.sort}
        readDirection={c.direction}
        readingEnd="range"
        liveFollow={c.direction === 'backward'}
        listFollow={false}
        isPaused={c.direction === 'backward'}
        pausedCount={c.direction === 'backward' ? backlog.length : 0}
        pausedTelegrams={c.direction === 'backward' ? backlog : []}
      />,
    );
    const port = portOf(container);
    expect(port.dataset.anchorEdge).toBe(c.anchor);
    expect(markerSide(container)).toBe(c.anchor === 'top' ? 'bottom' : 'top');
    expect(port.dataset.anchorPx).toBe(String(DISPLAY_RUBBER_PX));

    if (c.anchor === 'top') port.scrollTop = port.scrollHeight;
    else port.scrollTop = 0;
    fireEvent.scroll(port);
    const pill = screen.getByRole('button', { name: new RegExp(`${c.word} telegram`) });
    expect(pill).toHaveAttribute('data-edge', c.anchor);
    expect(pill).toHaveAttribute('data-edge-kind', c.word);

    fireEvent.click(pill);
    const atAnchor = c.anchor === 'top' ? DISPLAY_RUBBER_PX : settledBottom(port);
    expect(port.scrollTop).toBe(atAnchor);
    unmount();
  }
});

test('live follow backward stays on the newest row for both time sorts', () => {
  const older = [at(1, 'a'), at(2, 'b'), at(3, 'c'), at(4, 'd')];
  const newest = at(5, 'newest');
  const arrived = at(6, 'arrived');

  const descRows = [newest, ...older.slice().reverse()];
  const { container, rerender, unmount } = render(
    <TelegramTable
      {...baseProps}
      telegrams={descRows}
      sortConfig={desc}
      readDirection="backward"
      liveFollow
      listFollow
    />,
  );
  const port = portOf(container);
  const first = () => container.querySelector('.log-row')?.textContent ?? '';
  expect(port.scrollTop).toBe(DISPLAY_RUBBER_PX);
  expect(first()).toContain('newest');

  rerender(
    <TelegramTable
      {...baseProps}
      telegrams={[arrived, ...descRows]}
      sortConfig={desc}
      readDirection="backward"
      liveFollow
      listFollow
    />,
  );
  expect(port.scrollTop).toBe(DISPLAY_RUBBER_PX);
  expect(first()).toContain('arrived');
  unmount();

  const ascRows = [...older, newest];
  const ascView = render(
    <TelegramTable
      {...baseProps}
      telegrams={ascRows}
      sortConfig={asc}
      readDirection="backward"
      liveFollow
      listFollow
    />,
  );
  const ascPort = portOf(ascView.container);
  const last = () => {
    const rows = ascView.container.querySelectorAll('.log-row');
    return rows[rows.length - 1]?.textContent ?? '';
  };
  expect(ascPort.scrollTop).toBe(settledBottom(ascPort));
  expect(last()).toContain('newest');

  ascView.rerender(
    <TelegramTable
      {...baseProps}
      telegrams={[...ascRows, arrived]}
      sortConfig={asc}
      readDirection="backward"
      liveFollow
      listFollow
    />,
  );
  expect(ascPort.scrollTop).toBe(settledBottom(ascPort));
  expect(last()).toContain('arrived');
});
