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

test('backward newer and forward older count the status pill filtered rows', () => {
  const backlog = [at(3, 'p3'), at(2, 'p2'), at(1, 'p1')];
  const status = statusPillCount(backlog.length, backlog.length, false);
  const { unmount } = render(
    <TelegramTable
      {...baseProps}
      telegrams={[]}
      sortConfig={desc}
      readDirection="backward"
      liveFollow
      listFollow={false}
      isPaused
      pausedCount={backlog.length}
      pausedTelegrams={backlog}
    />,
  );
  expect(screen.getByRole('button', { name: `${status} newer telegrams` })).toBeInTheDocument();
  unmount();

  scrollBlockSize = DISPLAY_ROW_PX;
  const rows = [at(1, 'o'), at(2, 'm'), at(3, 'n'), at(4, 'newest')];
  const filtered = rows.length;
  const { container } = render(
    <TelegramTable
      {...baseProps}
      telegrams={rows}
      sortConfig={asc}
      readDirection="forward"
      liveFollow={false}
      listFollow={false}
    />,
  );
  const port = portOf(container);
  // Three filtered rows sit fully on the anchor side of a one-row viewport.
  port.scrollTop = DISPLAY_ROW_PX * 3;
  fireEvent.scroll(port);
  const older = filtered - 1;
  expect(screen.getByRole('button', { name: `${older} older telegrams` })).toBeInTheDocument();
  expect(older + 1).toBe(statusPillCount(filtered, filtered, false));

  fireEvent.click(screen.getByRole('button', { name: `${older} older telegrams` }));
  expect(port.scrollTop).toBe(DISPLAY_RUBBER_PX);
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
