import { act, render, screen, fireEvent } from '@testing-library/react';
import { beforeAll, beforeEach, expect, test, vi } from 'vitest';
import { FilterPanel } from './FilterPanel';
import { TelegramTable, type SortConfig } from './TelegramTable';
import { DEFAULT_FILTERS, type FilterOptions } from '../types/filters';
import { TARGET_COLORS, resetTargetColors, setTargetColor } from '../utils/targetColors';
import type { Telegram } from '../hooks/useWebSocket';
import { makeTelegram } from '../test/telegramFactory';

// A colour for a group address in the target filter, and its telegrams marked
// with it in the list (#509).

const OPTIONS: FilterOptions = {
  sources: [{ address: '1.1.5', name: 'Taster' }],
  targets: [
    { address: '1/2/3', name: 'Licht Küche', main: 1, sub: 1 },
    { address: '1/2/4', name: 'Licht Flur', main: 1, sub: 1 },
  ],
  types: [],
  dpts: [],
  ga_group_names: {},
  pa_line_names: {},
};
const FILTERS = { ...DEFAULT_FILTERS, sources: ['1.1.5'], targets: ['1/2/3', '1/2/4'] };

const telegram = (second: number, target: string): Telegram =>
  makeTelegram({ timestamp: `2024-01-01T10:00:0${second}.000Z`, target_address: target, raw_hex: `0x0${second}` });

const TELEGRAMS = [telegram(3, '1/2/3'), telegram(2, '1/2/4'), telegram(1, '2/0/1')];
const SORT: SortConfig = [{ key: 'timestamp', direction: 'desc' }];
const COLUMNS = {
  time: true, delta: true, source: true, sourceName: true,
  target: true, targetName: true, type: true, dpt: true, data: true, value: true,
};

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
  // @tanstack/virtual reads clientHeight, which jsdom leaves at 0.
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get() {
      if (this.classList?.contains('log-row')) return 85;
      return 800;
    },
  });
});

const renderPanel = () => {
  render(<FilterPanel options={OPTIONS} activeFilters={FILTERS} onFiltersChange={vi.fn()} projectLoaded />);
  fireEvent.click(screen.getByRole('button', { name: /^Focus/ }));
};

const renderTable = (filters = FILTERS) =>
  render(
    <TelegramTable
      telegrams={TELEGRAMS}
      visibleColumns={COLUMNS}
      sortConfig={SORT}
      onSort={vi.fn()}
      activeFilters={filters}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
    />,
  );

const rowOf = (container: HTMLElement, target: string) =>
  [...container.querySelectorAll<HTMLElement>('.log-row')].find(r => r.textContent?.includes(target))!;

beforeEach(() => resetTargetColors());

test('each target filter has a colour swatch; clicks walk the palette', () => {
  renderPanel();
  const kitchen = screen.getByRole('button', { name: 'Colour of 1/2/3' });
  const hall = screen.getByRole('button', { name: 'Colour of 1/2/4' });
  // The device swatch lives on the Devices list, not among the group addresses.
  expect(screen.queryByRole('button', { name: 'Colour of 1.1.5' })).not.toBeInTheDocument();
  expect(kitchen).toHaveAttribute('title', 'Mark telegrams to this address with a colour');

  fireEvent.click(kitchen);
  expect(kitchen).toHaveStyle({ background: TARGET_COLORS[0] });
  // The next address starts with a colour that is still free.
  fireEvent.click(hall);
  expect(hall).toHaveStyle({ background: TARGET_COLORS[1] });

  fireEvent.click(kitchen);
  expect(kitchen).toHaveStyle({ background: TARGET_COLORS[1] });
});

test('a click on the swatch does not switch the filter off', () => {
  const onFiltersChange = vi.fn();
  render(<FilterPanel options={OPTIONS} activeFilters={FILTERS} onFiltersChange={onFiltersChange} projectLoaded />);
  fireEvent.click(screen.getByRole('button', { name: /^Focus/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Colour of 1/2/3' }));
  expect(onFiltersChange).not.toHaveBeenCalled();
});

const stripeOf = (row: HTMLElement) => row.querySelector<HTMLElement>('.mark-stripe')!;

// jsdom serializes a hex colour inside color-mix() as rgb().
const asRgb = (hex: string) => {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

test('a device colour marks a telegram only when its group address has none', () => {
  const telegrams = [
    makeTelegram({ timestamp: '2024-01-01T10:00:03.000Z', source_address: '1.1.5', target_address: '1/2/3', raw_hex: '0x03' }),
    makeTelegram({ timestamp: '2024-01-01T10:00:02.000Z', source_address: '1.1.5', target_address: '1/2/4', raw_hex: '0x02' }),
  ];
  setTargetColor('1.1.5', TARGET_COLORS[2]);
  setTargetColor('1/2/3', TARGET_COLORS[0]);
  const { container } = render(
    <TelegramTable
      telegrams={telegrams}
      visibleColumns={COLUMNS}
      sortConfig={SORT}
      onSort={vi.fn()}
      activeFilters={FILTERS}
      onQuickFilter={vi.fn()}
      onQuickVisualize={vi.fn()}
    />,
  );
  const gaTint = asRgb(TARGET_COLORS[0]);
  const deviceTint = asRgb(TARGET_COLORS[2]);
  expect(rowOf(container, '1/2/3').style.background).toContain(gaTint);
  expect(rowOf(container, '1/2/3').style.background).not.toContain(deviceTint);
  expect(rowOf(container, '1/2/4').style.background).toContain(deviceTint);
});

test('telegrams to a coloured target are marked in the list', () => {
  setTargetColor('1/2/3', TARGET_COLORS[3]);
  const { container } = renderTable();

  const coloured = rowOf(container, '1/2/3');
  const tint = asRgb(TARGET_COLORS[3]);
  expect(coloured.style.background).toContain(tint);
  expect(coloured.style.boxShadow).toBe('');
  expect(stripeOf(coloured).style.background).toBe(coloured.style.background);
  expect(rowOf(container, '1/2/4').style.background).not.toContain(tint);
  expect(rowOf(container, '2/0/1').style.background).not.toContain(tint);
});

test('the list follows a colour set while it is shown', () => {
  const { container } = renderTable();
  const tint = asRgb(TARGET_COLORS[0]);
  expect(rowOf(container, '1/2/4').style.background).not.toContain(tint);
  act(() => setTargetColor('1/2/4', TARGET_COLORS[0]));
  const row = rowOf(container, '1/2/4');
  expect(row.style.background).toContain(tint);
  expect(stripeOf(row).style.background).toBe(row.style.background);
});

test('a colour marks rows even when the address is not in the target filter', () => {
  setTargetColor('1/2/3', TARGET_COLORS[0]);
  const { container } = renderTable({ ...DEFAULT_FILTERS, targets: ['1/2/4'] });
  const tint = asRgb(TARGET_COLORS[0]);
  const row = rowOf(container, '1/2/3');
  expect(row.style.background).toContain(tint);
  expect(stripeOf(row).style.background).toBe(row.style.background);
});

test('a switched-off filter keeps marking its rows', () => {
  setTargetColor('1/2/3', TARGET_COLORS[0]);
  const { container } = renderTable({ ...FILTERS, disabled: ['targets:1/2/3'] });
  const tint = asRgb(TARGET_COLORS[0]);
  const row = rowOf(container, '1/2/3');
  expect(row.style.background).toContain(tint);
  expect(stripeOf(row).style.background).toBe(row.style.background);

  const resting = row.style.background;
  expect(stripeOf(row).style.background).toBe(resting);
  fireEvent.click(stripeOf(row));
  expect(row.classList.contains('marked')).toBe(false);
  expect(row.style.background).toBe(resting);
  expect(stripeOf(row).getAttribute('aria-pressed')).toBe('true');
  expect(stripeOf(row).style.background).toBe(asRgb(TARGET_COLORS[0]));
  expect(row.querySelector<HTMLElement>('.log-row-body')!.style.background).toBe('');
});
