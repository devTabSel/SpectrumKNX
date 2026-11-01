import { type ComponentProps, useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { FocusList } from './FocusList';
import { badgeColumnWidth } from './BadgeColumn';
import { resetTargetColors, setTargetColor, TARGET_COLORS, useTargetColors } from '../utils/targetColors';

const ENTRIES = [
  { address: '0/1/2', name: 'Licht Küche' },
  { address: '1/0/1', name: 'Licht Flur' },
  { address: '2/0/1', name: 'Rollladen' },
  { address: '3/0/1', name: 'Heizung' },
];

const row = (address: string) => document.querySelector(`[data-focus-address="${address}"]`) as HTMLElement;
const isMarked = (address: string) => row(address).dataset.marked === 'true';

beforeEach(() => {
  resetTargetColors();
});

function renderList(overrides: Partial<ComponentProps<typeof FocusList>> = {}) {
  const props: ComponentProps<typeof FocusList> = {
    mode: 'ga',
    entries: ENTRIES,
    focused: [],
    onFocusedChange: vi.fn(),
    search: '',
    onSearchChange: vi.fn(),
    compact: false,
    onCompactChange: vi.fn(),
    counts: { '0/1/2': 4, '1/0/1': 0, '3/0/1': 9 },
    ...overrides,
  };
  render(<FocusList {...props} />);
  return props;
}

test('hides telegram badges whose count is zero', () => {
  renderList();
  const badge = within(row('0/1/2')).getByTitle('Telegrams');
  expect(badge).toHaveTextContent('4');
  const badgeSlot = (address: string) => row(address).querySelector('[data-badge-slot]') as HTMLElement;
  expect(badgeSlot('0/1/2')).toContainElement(badge);
  const column = badgeColumnWidth(9);
  expect(badgeSlot('0/1/2').style.width).toBe(column);
  expect(badgeSlot('3/0/1').style.width).toBe(column);
  expect(badgeSlot('1/0/1').style.width).toBe(column);
  const addressLine = (address: string) => row(address).querySelector('[data-focus-address-line]') as HTMLElement;
  expect(addressLine('0/1/2').lastElementChild).toBe(badgeSlot('0/1/2'));
  expect(addressLine('0/1/2')).toContainElement(row('0/1/2').querySelector('[data-focus-actions]'));
  const name = row('0/1/2').querySelector('[data-focus-name]') as HTMLElement;
  expect(addressLine('0/1/2').nextElementSibling).toBe(name);
  expect(within(row('3/0/1')).getByTitle('Telegrams')).toHaveTextContent('9');
  expect(within(row('1/0/1')).queryByTitle('Telegrams')).not.toBeInTheDocument();
  expect(within(row('2/0/1')).queryByTitle('Telegrams')).not.toBeInTheDocument();
});

test('a focused entry shows a zero badge, an unfocused one does not', () => {
  renderList({ focused: ['1/0/1'] });
  const zero = within(row('1/0/1')).getByTitle('Telegrams');
  const positive = within(row('0/1/2')).getByTitle('Telegrams');
  expect(zero).toHaveTextContent('0');
  expect(zero.style.color).toBe(positive.style.color);
  expect(zero.style.background).toBe(positive.style.background);
  expect(zero.style.border).toBe(positive.style.border);
  expect(within(row('2/0/1')).queryByTitle('Telegrams')).not.toBeInTheDocument();
  expect(row('1/0/1').style.width).toBe('100%');
});

test('highlights addresses that have telegrams in the unfiltered buffer', () => {
  renderList({ bufferCounts: { '0/1/2': 8, '2/0/1': 1 } });
  expect(screen.getByText('0/1/2').style.fontWeight).toBe('700');
  expect(screen.getByText('0/1/2').style.color).toBe('var(--accent-primary)');
  expect(screen.getByText('2/0/1').style.fontWeight).toBe('700');
  expect(screen.getByText('1/0/1').style.fontWeight).toBe('400');
  expect(screen.getByText('1/0/1').style.color).toBe('var(--text-main)');
});

test('shows row actions on focused rows and on hover, and quick filter toggles on its own', () => {
  renderList({ focused: ['0/1/2'] });
  const actions = (address: string) => row(address).querySelector('[data-focus-actions]') as HTMLElement;
  expect(actions('0/1/2').style.opacity).toBe('1');
  expect(actions('1/0/1').style.opacity).toBe('0');
  expect(actions('1/0/1').style.width).toBe('');
  expect(actions('1/0/1').style.pointerEvents).toBe('none');
  expect(actions('1/0/1').style.gap).toBe('0.125rem');
  expect(within(row('1/0/1')).getByRole('button', { name: 'Toggle focus' })).toBeInTheDocument();
  expect(within(row('1/0/1')).getByRole('button', { name: 'Focus filter' })).toBeInTheDocument();
  expect(within(row('1/0/1')).getByRole('button', { name: 'Visualize this GA' })).toBeInTheDocument();
  expect(within(row('1/0/1')).getByRole('button', { name: 'Toggle last seen values' })).toBeInTheDocument();

  fireEvent.mouseEnter(row('1/0/1'));
  expect(actions('1/0/1').style.opacity).toBe('1');
  expect(actions('1/0/1').style.pointerEvents).toBe('auto');

  const own = within(row('0/1/2')).getByRole('button', { name: 'Focus filter' });
  const other = within(row('1/0/1')).getByRole('button', { name: 'Focus filter' });
  expect(own).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(own);
  expect(own).toHaveAttribute('aria-pressed', 'true');
  expect(own).toHaveClass('active');
  expect(other).toHaveAttribute('aria-pressed', 'false');
  expect(other).not.toHaveClass('active');
  fireEvent.click(own);
  expect(own).toHaveAttribute('aria-pressed', 'false');

  const seen = within(row('0/1/2')).getByRole('button', { name: 'Toggle last seen values' });
  expect(seen).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(seen);
  expect(seen).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(seen);
  expect(seen).toHaveAttribute('aria-pressed', 'false');
});

test('keeps a row’s icons visible while one of its toggles is on', () => {
  renderList();
  const actions = (address: string) => row(address).querySelector('[data-focus-actions]') as HTMLElement;
  expect(actions('1/0/1').style.opacity).toBe('0');

  fireEvent.mouseEnter(row('1/0/1'));
  fireEvent.click(within(row('1/0/1')).getByRole('button', { name: 'Focus filter' }));
  fireEvent.mouseLeave(row('1/0/1'));
  expect(actions('1/0/1').style.opacity).toBe('1');
  expect(actions('1/0/1').style.pointerEvents).toBe('auto');
  expect(actions('0/1/2').style.opacity).toBe('0');

  fireEvent.mouseEnter(row('1/0/1'));
  fireEvent.click(within(row('1/0/1')).getByRole('button', { name: 'Focus filter' }));
  fireEvent.click(within(row('1/0/1')).getByRole('button', { name: 'Toggle last seen values' }));
  fireEvent.mouseLeave(row('1/0/1'));
  expect(actions('1/0/1').style.opacity).toBe('1');

  fireEvent.mouseEnter(row('1/0/1'));
  fireEvent.click(within(row('1/0/1')).getByRole('button', { name: 'Toggle last seen values' }));
  fireEvent.mouseLeave(row('1/0/1'));
  expect(actions('1/0/1').style.opacity).toBe('0');
  expect(actions('1/0/1').style.pointerEvents).toBe('none');
});

test('keeps a row’s icons visible while it has a colour', () => {
  const { rerender } = render(
    <FocusList
      mode="ga"
      entries={ENTRIES}
      focused={[]}
      onFocusedChange={vi.fn()}
      search=""
      onSearchChange={vi.fn()}
      compact={false}
      onCompactChange={vi.fn()}
      targetColors={{ '1/0/1': TARGET_COLORS[0] }}
    />,
  );
  const actions = (address: string) => row(address).querySelector('[data-focus-actions]') as HTMLElement;
  expect(actions('1/0/1').style.opacity).toBe('1');
  expect(actions('1/0/1').style.pointerEvents).toBe('auto');
  expect(actions('0/1/2').style.opacity).toBe('0');

  rerender(
    <FocusList
      mode="ga"
      entries={ENTRIES}
      focused={[]}
      onFocusedChange={vi.fn()}
      search=""
      onSearchChange={vi.fn()}
      compact={false}
      onCompactChange={vi.fn()}
      targetColors={{}}
    />,
  );
  expect(actions('1/0/1').style.opacity).toBe('0');
});

test('hides telegram badges until counts have loaded', () => {
  renderList({ counts: undefined });
  expect(screen.queryByTitle('Telegrams')).not.toBeInTheDocument();
});

test('Compact is disabled until an entry is focused, toggled, or coloured', () => {
  const onCheckedOnlyChange = vi.fn();
  const { rerender } = render(
    <FocusList
      mode="ga"
      entries={ENTRIES}
      focused={[]}
      onFocusedChange={vi.fn()}
      search=""
      onSearchChange={vi.fn()}
      compact={false}
      onCompactChange={vi.fn()}
      checkedOnly={false}
      onCheckedOnlyChange={onCheckedOnlyChange}
    />,
  );
  const button = screen.getByRole('button', { name: 'Compact' });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(button);
  expect(onCheckedOnlyChange).not.toHaveBeenCalled();
  expect(screen.getByText('2/0/1')).toBeInTheDocument();

  rerender(
    <FocusList
      mode="ga"
      entries={ENTRIES}
      focused={['0/1/2']}
      onFocusedChange={vi.fn()}
      search=""
      onSearchChange={vi.fn()}
      compact={false}
      onCompactChange={vi.fn()}
      checkedOnly
      onCheckedOnlyChange={onCheckedOnlyChange}
    />,
  );
  expect(screen.getByRole('button', { name: 'Compact' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Compact' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByText('2/0/1')).not.toBeInTheDocument();

  rerender(
    <FocusList
      mode="ga"
      entries={ENTRIES}
      focused={[]}
      onFocusedChange={vi.fn()}
      search=""
      onSearchChange={vi.fn()}
      compact={false}
      onCompactChange={vi.fn()}
      checkedOnly
      onCheckedOnlyChange={onCheckedOnlyChange}
    />,
  );
  expect(screen.getByText('0/1/2')).toBeInTheDocument();
  expect(screen.queryByText('2/0/1')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Compact' })).toBeEnabled();
});

test('Compact shows only focused rows, including those without telegrams', () => {
  renderList({ checkedOnly: true, focused: ['1/0/1'] });
  expect([...document.querySelectorAll('[data-focus-address]')].map(el => el.getAttribute('data-focus-address'))).toEqual(['1/0/1']);
  expect(screen.getByRole('button', { name: 'Compact' })).toHaveAttribute('title', 'Show focused entries, active toggles and coloured entries');
});

test('Compact ignores checkboxes, toggles and colours that belong to the other list', () => {
  renderList({
    focused: ['9.9.9'],
    quickFilter: ['8.8.8'],
    onQuickFilterChange: vi.fn(),
    lastSeen: ['7.7.7'],
    onLastSeenChange: vi.fn(),
    targetColors: { '1.1.1': TARGET_COLORS[1] },
  });
  expect(screen.getByRole('button', { name: 'Compact' })).toBeDisabled();
});

test('Compact is available for an active toggle or a colour and shows those rows', () => {
  const shown = () => [...document.querySelectorAll('[data-focus-address]')].map(el => el.getAttribute('data-focus-address'));
  const { rerender } = render(
    <FocusList
      mode="ga"
      entries={ENTRIES}
      focused={[]}
      onFocusedChange={vi.fn()}
      search=""
      onSearchChange={vi.fn()}
      compact={false}
      onCompactChange={vi.fn()}
      checkedOnly={false}
      quickFilter={['2/0/1']}
      onQuickFilterChange={vi.fn()}
      lastSeen={['0/1/2']}
      onLastSeenChange={vi.fn()}
      targetColors={{ '1/0/1': TARGET_COLORS[0] }}
    />,
  );
  expect(screen.getByRole('button', { name: 'Compact' })).toBeEnabled();

  rerender(
    <FocusList
      mode="ga"
      entries={ENTRIES}
      focused={[]}
      onFocusedChange={vi.fn()}
      search=""
      onSearchChange={vi.fn()}
      compact={false}
      onCompactChange={vi.fn()}
      checkedOnly
      quickFilter={['2/0/1']}
      onQuickFilterChange={vi.fn()}
      lastSeen={['0/1/2']}
      onLastSeenChange={vi.fn()}
      targetColors={{ '1/0/1': TARGET_COLORS[0] }}
    />,
  );
  expect(shown()).toEqual(['0/1/2', '1/0/1', '2/0/1']);

  rerender(
    <FocusList
      mode="ga"
      entries={ENTRIES}
      focused={[]}
      onFocusedChange={vi.fn()}
      search=""
      onSearchChange={vi.fn()}
      compact={false}
      onCompactChange={vi.fn()}
      checkedOnly
      quickFilter={[]}
      onQuickFilterChange={vi.fn()}
      lastSeen={[]}
      onLastSeenChange={vi.fn()}
      targetColors={{}}
    />,
  );
  expect(shown()).toEqual(['0/1/2', '1/0/1', '2/0/1']);
});

test('Verdichten hides entries with no telegram in the buffer, including checked ones', () => {
  const view = (focused: string[], counts: Record<string, number> = { '0/1/2': 4, '1/0/1': 0, '3/0/1': 9 }) => (
    <FocusList
      mode="ga"
      entries={ENTRIES}
      focused={focused}
      onFocusedChange={vi.fn()}
      search=""
      onSearchChange={vi.fn()}
      compact
      onCompactChange={vi.fn()}
      counts={counts}
    />
  );
  const shown = () => [...document.querySelectorAll('[data-focus-address]')].map(el => el.getAttribute('data-focus-address'));
  const { rerender } = render(view(['1/0/1', '0/1/2']));
  expect(shown()).toEqual(['0/1/2', '3/0/1']);
  expect(screen.getByRole('button', { name: 'Verdichten' })).toHaveAttribute('title', 'Hide entries with no telegrams');

  rerender(view([], { '0/1/2': 0, '1/0/1': 0, '3/0/1': 9 }));
  expect(shown()).toEqual(['0/1/2', '1/0/1', '3/0/1']);
});

test('Verdichten keeps an entry while a toggle on it is on', () => {
  function Harness() {
    const [compact, setCompact] = useState(false);
    return (
      <FocusList
        mode="ga"
        entries={ENTRIES}
        focused={[]}
        onFocusedChange={vi.fn()}
        search=""
        onSearchChange={vi.fn()}
        compact={compact}
        onCompactChange={setCompact}
        counts={{ '0/1/2': 0, '1/0/1': 0, '2/0/1': 0, '3/0/1': 9 }}
      />
    );
  }
  const shown = () => [...document.querySelectorAll('[data-focus-address]')].map(el => el.getAttribute('data-focus-address'));
  const { rerender } = render(<Harness />);

  fireEvent.click(within(row('0/1/2')).getByRole('button', { name: 'Focus filter' }));
  fireEvent.click(within(row('2/0/1')).getByRole('button', { name: 'Focus filter' }), { ctrlKey: true });
  fireEvent.click(within(row('2/0/1')).getByRole('button', { name: 'Toggle last seen values' }));
  fireEvent.click(screen.getByRole('button', { name: 'Verdichten' }));
  expect(shown()).toEqual(['0/1/2', '2/0/1', '3/0/1']);

  fireEvent.click(within(row('2/0/1')).getByRole('button', { name: 'Focus filter' }), { ctrlKey: true });
  expect(shown()).toEqual(['0/1/2', '2/0/1', '3/0/1']);
  fireEvent.click(within(row('2/0/1')).getByRole('button', { name: 'Toggle last seen values' }));
  expect(shown()).toEqual(['0/1/2', '3/0/1']);

  rerender(
    <FocusList
      mode="ga"
      entries={ENTRIES}
      focused={[]}
      onFocusedChange={vi.fn()}
      search=""
      onSearchChange={vi.fn()}
      compact
      onCompactChange={vi.fn()}
      counts={{ '0/1/2': 0, '1/0/1': 0, '3/0/1': 9 }}
      lastSeen={['1/0/1']}
      onLastSeenChange={vi.fn()}
    />,
  );
  expect(shown()).toEqual(['1/0/1', '3/0/1']);
});

test('a device colour keeps the row under Verdichten and under Compact', () => {
  const entries = [
    { address: '1.1.1', name: 'Taster' },
    { address: '1.1.2', name: 'Aktor' },
  ];
  const shown = () => [...document.querySelectorAll('[data-focus-address]')].map(el => el.getAttribute('data-focus-address'));
  const list = (props: Partial<ComponentProps<typeof FocusList>>) => (
    <FocusList
      mode="pa"
      entries={entries}
      focused={[]}
      onFocusedChange={vi.fn()}
      search=""
      onSearchChange={vi.fn()}
      compact={false}
      onCompactChange={vi.fn()}
      counts={{ '1.1.1': 0, '1.1.2': 3 }}
      targetColors={{ '1.1.1': TARGET_COLORS[1] }}
      {...props}
    />
  );
  const { rerender } = render(list({ compact: true }));
  expect(shown()).toEqual(['1.1.1', '1.1.2']);
  expect(screen.getByRole('button', { name: 'Colour of 1.1.1' })).toHaveAttribute(
    'title',
    'Telegrams from this device are marked in this colour - click for the next colour, ctrl-click clears the selected rows',
  );
  const actions = row('1.1.1').querySelector('[data-focus-actions]') as HTMLElement;
  expect(actions.style.opacity).toBe('1');

  rerender(list({ compact: true, targetColors: {} }));
  expect(shown()).toEqual(['1.1.1', '1.1.2']);

  rerender(list({ compact: false, checkedOnly: true, targetColors: { '1.1.1': TARGET_COLORS[1] } }));
  expect(shown()).toEqual(['1.1.1']);
  expect(screen.getByRole('button', { name: 'Compact' })).toBeEnabled();
});

test('Verdichten keeps an entry after its colour is removed', () => {
  const counts = { '0/1/2': 0, '1/0/1': 0, '2/0/1': 0, '3/0/1': 9 };
  const shown = () => [...document.querySelectorAll('[data-focus-address]')].map(el => el.getAttribute('data-focus-address'));
  const list = (compact: boolean, targetColors: Record<string, string>) => (
    <FocusList
      mode="ga"
      entries={ENTRIES}
      focused={[]}
      onFocusedChange={vi.fn()}
      search=""
      onSearchChange={vi.fn()}
      compact={compact}
      onCompactChange={vi.fn()}
      counts={counts}
      targetColors={targetColors}
    />
  );
  const { rerender } = render(list(true, { '1/0/1': TARGET_COLORS[2] }));
  expect(shown()).toEqual(['1/0/1', '3/0/1']);

  rerender(list(true, {}));
  expect(shown()).toEqual(['1/0/1', '3/0/1']);

  rerender(list(false, {}));
  rerender(list(true, {}));
  expect(shown()).toEqual(['3/0/1']);
});

test('hovering a row highlights it the way filter rows do', () => {
  renderList();
  expect(row('0/1/2').style.background).toBe('transparent');
  fireEvent.mouseEnter(row('0/1/2'));
  expect(row('0/1/2').style.background).toBe('var(--bg-hover)');
  fireEvent.mouseLeave(row('0/1/2'));
  expect(row('0/1/2').style.background).toBe('transparent');

  fireEvent.click(row('0/1/2'));
  expect(row('0/1/2').style.background).toBe('color-mix(in srgb, var(--accent-primary) 34%, transparent)');
  expect(row('0/1/2').style.boxShadow).toBe('');
  fireEvent.mouseEnter(row('0/1/2'));
  expect(row('0/1/2').style.background).toBe('color-mix(in srgb, var(--accent-primary) 34%, transparent)');
});

test('a plain click marks only that row; ctrl and shift extend the mark', () => {
  renderList();
  fireEvent.click(row('0/1/2'));
  fireEvent.click(row('2/0/1'), { shiftKey: true });
  expect([isMarked('0/1/2'), isMarked('1/0/1'), isMarked('2/0/1'), isMarked('3/0/1')]).toEqual([true, true, true, false]);

  fireEvent.click(row('1/0/1'), { ctrlKey: true });
  expect(isMarked('1/0/1')).toBe(false);

  fireEvent.click(row('3/0/1'), { metaKey: true });
  expect([isMarked('0/1/2'), isMarked('1/0/1'), isMarked('2/0/1'), isMarked('3/0/1')]).toEqual([true, false, true, true]);

  fireEvent.click(row('1/0/1'));
  expect([isMarked('0/1/2'), isMarked('1/0/1'), isMarked('2/0/1'), isMarked('3/0/1')]).toEqual([false, true, false, false]);
});

test('a checkbox or button click on a marked row applies to every marked row', () => {
  const onFocusedChange = vi.fn();
  renderList({ focused: ['0/1/2'], onFocusedChange });

  fireEvent.click(row('0/1/2'));
  fireEvent.click(row('2/0/1'), { ctrlKey: true });

  const quick = (address: string) => within(row(address)).getByRole('button', { name: 'Focus filter' });
  fireEvent.click(quick('2/0/1'));
  expect(quick('0/1/2')).toHaveAttribute('aria-pressed', 'true');
  expect(quick('2/0/1')).toHaveAttribute('aria-pressed', 'true');
  expect(quick('1/0/1')).toHaveAttribute('aria-pressed', 'false');
  expect(isMarked('0/1/2')).toBe(true);
  expect(isMarked('2/0/1')).toBe(true);

  fireEvent.click(screen.getByRole('checkbox', { name: 'Focus 0/1/2' }));
  expect(onFocusedChange).toHaveBeenCalledWith([]);
  expect(isMarked('0/1/2')).toBe(true);
  expect(isMarked('2/0/1')).toBe(true);
});

test('the visualize toggle stays independent of the focus checkbox', () => {
  const onFocusedChange = vi.fn();
  renderList({ focused: ['0/1/2'], onFocusedChange });
  const chart = within(row('0/1/2')).getByRole('button', { name: 'Visualize this GA' });
  expect(chart).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(chart);
  expect(chart).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('checkbox', { name: 'Focus 0/1/2' })).toHaveAttribute('aria-checked', 'true');
  expect(onFocusedChange).not.toHaveBeenCalled();
  fireEvent.click(chart);
  expect(chart).toHaveAttribute('aria-pressed', 'false');
  expect(onFocusedChange).not.toHaveBeenCalled();
});

test('a checkbox click outside the mark changes only that row', () => {
  const onFocusedChange = vi.fn();
  renderList({ onFocusedChange });
  fireEvent.click(row('0/1/2'));
  fireEvent.click(row('2/0/1'), { ctrlKey: true });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Focus 1/0/1' }));
  expect(onFocusedChange).toHaveBeenCalledWith(['1/0/1']);
  expect(isMarked('0/1/2')).toBe(true);
  expect(isMarked('1/0/1')).toBe(false);
});

test('ctrl-click keeps the other toggles and shift-click also navigates', () => {
  const onFocusedChange = vi.fn();
  const onNavigateFocus = vi.fn();
  renderList({ focused: ['0/1/2'], onFocusedChange, onNavigateFocus });

  fireEvent.click(screen.getByRole('checkbox', { name: 'Focus 1/0/1' }), { ctrlKey: true });
  expect(onFocusedChange).toHaveBeenCalledWith(['0/1/2', '1/0/1']);
  expect(onNavigateFocus).not.toHaveBeenCalled();
  expect(isMarked('1/0/1')).toBe(false);

  onFocusedChange.mockClear();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Focus 3/0/1' }), { shiftKey: true });
  expect(onFocusedChange).toHaveBeenCalledWith(['3/0/1']);
  expect(onNavigateFocus).toHaveBeenCalledTimes(1);

  onFocusedChange.mockClear();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Focus 0/1/2' }), { altKey: true });
  expect(onFocusedChange).not.toHaveBeenCalled();
  expect(onNavigateFocus).toHaveBeenCalledTimes(2);

  const calls = onNavigateFocus.mock.calls.length;
  fireEvent.click(screen.getByRole('checkbox', { name: 'Focus 1/0/1' }), { altKey: true, shiftKey: true });
  expect(onFocusedChange).not.toHaveBeenCalled();
  expect(onNavigateFocus).toHaveBeenCalledTimes(calls);
});

function ColorList() {
  const targetColors = useTargetColors();
  return (
    <FocusList
      mode="ga"
      entries={ENTRIES}
      focused={[]}
      onFocusedChange={() => {}}
      search=""
      onSearchChange={() => {}}
      compact={false}
      onCompactChange={() => {}}
      targetColors={targetColors}
    />
  );
}

test('a colour click on a marked row paints every marked row with that colour', () => {
  render(<ColorList />);
  fireEvent.click(row('0/1/2'));
  fireEvent.click(row('2/0/1'), { ctrlKey: true });
  fireEvent.click(screen.getByRole('button', { name: 'Colour of 0/1/2' }));

  const swatch = (address: string) => screen.getByRole('button', { name: `Colour of ${address}` });
  const painted = 'rgb(59, 130, 246)'; // TARGET_COLORS[0], serialised by the DOM
  expect(TARGET_COLORS[0]).toBe('#3b82f6');
  expect(swatch('0/1/2').style.backgroundColor).toBe(painted);
  expect(swatch('2/0/1').style.backgroundColor).toBe(painted);
  expect(swatch('1/0/1').style.backgroundColor).toBe('transparent');
});

test('ctrl-click on a colour clears the marked rows and leaves the marks', () => {
  render(<ColorList />);
  fireEvent.click(row('0/1/2'));
  fireEvent.click(row('2/0/1'), { ctrlKey: true });
  fireEvent.click(screen.getByRole('button', { name: 'Colour of 0/1/2' }));
  fireEvent.click(screen.getByRole('button', { name: 'Colour of 1/0/1' }));

  fireEvent.click(screen.getByRole('button', { name: 'Colour of 1/0/1' }), { ctrlKey: true });

  const swatch = (address: string) => screen.getByRole('button', { name: `Colour of ${address}` });
  expect(swatch('0/1/2').style.backgroundColor).toBe('transparent');
  expect(swatch('2/0/1').style.backgroundColor).toBe('transparent');
  expect(swatch('1/0/1').style.backgroundColor).not.toBe('transparent');
  expect(isMarked('0/1/2')).toBe(true);
  expect(isMarked('2/0/1')).toBe(true);
  expect(isMarked('1/0/1')).toBe(false);

  fireEvent.click(row('1/0/1'));
  fireEvent.click(screen.getByRole('button', { name: 'Colour of 1/0/1' }), { metaKey: true });
  expect(swatch('1/0/1').style.backgroundColor).toBe('transparent');
});

