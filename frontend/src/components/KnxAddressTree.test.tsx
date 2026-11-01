import { render, screen, fireEvent, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { KnxAddressTree } from './KnxAddressTree';
import { badgeColumnWidth } from './BadgeColumn';
import { reloadFilterBranches, resetFilterBranches } from '../utils/filterBranchExpansion';

beforeEach(() => {
  resetFilterBranches();
});

const withinRow = (row: HTMLElement, title: string) => within(row).getByTitle(title);

const entries = [
  { address: '1/1/75', name: 'Alarm' },
  { address: '1/1/76', name: 'Other' },
  { address: '1/2/1', name: 'Hall' },
];

test('group badges sum live counts up the hierarchy and the chevron sits before the label', () => {
  render(
    <KnxAddressTree
      entries={entries}
      selected={[]}
      groupNames={{ '1': 'Zentral', '1/1': 'EG', '1/2': 'OG' }}
      separator="/"
      onToggle={vi.fn()}
      counts={{ '1/1/75': 2, '1/1/76': 3, '1/2/1': 4, '10/1/1': 100 }}
      searchQuery=""
    />,
  );

  const row = (label: string) => screen.getByText(label).parentElement!.parentElement!.parentElement!;
  const mainRow = row('1 — Zentral');
  expect(mainRow.firstElementChild?.querySelector('svg')).toBeTruthy();
  expect(withinRow(mainRow, 'Addresses in the buffer')).toHaveTextContent('3');
  expect(withinRow(mainRow, 'Telegrams')).toHaveTextContent('9');

  const middle = screen.getByText('1/1 — EG');
  expect(middle).toHaveStyle({ fontWeight: '400' });
  const middleRow = row('1/1 — EG');
  expect(withinRow(middleRow, 'Addresses in the buffer')).toHaveTextContent('2');
  expect(withinRow(middleRow, 'Telegrams')).toHaveTextContent('5');
  const upper = row('1/2 — OG');
  expect(withinRow(upper, 'Addresses in the buffer')).toHaveTextContent('1');
  expect(withinRow(upper, 'Telegrams')).toHaveTextContent('4');

  // Middle groups start collapsed; opening reveals the leaf badges.
  fireEvent.click(middle);
  const leaf = (address: string) => screen.getByText(address).parentElement!.parentElement!;
  expect(within(leaf('1/1/75')).getByTitle('Telegrams')).toHaveTextContent('2');
  expect(within(leaf('1/1/76')).getByTitle('Telegrams')).toHaveTextContent('3');
});

test('opening or closing a branch survives a remount', () => {
  const props = {
    entries,
    selected: [] as string[],
    groupNames: { '1': 'Zentral', '1/1': 'EG', '1/2': 'OG' },
    separator: '/' as const,
    onToggle: vi.fn(),
    searchQuery: '',
  };
  let view = render(<KnxAddressTree {...props} />);
  fireEvent.click(screen.getByText('1/1 — EG'));
  expect(screen.getByText('1/1/75')).toBeInTheDocument();
  view.unmount();

  view = render(<KnxAddressTree {...props} />);
  expect(screen.getByText('1/1/75')).toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem('spectrum-knx.filter-branches')!)).toMatchObject({ 'ga:1/1': true });

  fireEvent.click(screen.getByText('1 — Zentral'));
  view.unmount();
  render(<KnxAddressTree {...props} />);
  expect(screen.queryByText('1/1 — EG')).not.toBeInTheDocument();
});

test('ctrl or cmd click expands or collapses every branch underneath', () => {
  const props = {
    entries,
    selected: [] as string[],
    groupNames: { '1': 'Zentral', '1/1': 'EG', '1/2': 'OG' },
    separator: '/' as const,
    onToggle: vi.fn(),
    searchQuery: '',
  };
  const { unmount } = render(<KnxAddressTree {...props} />);

  // The main group starts open and the middle groups start collapsed.
  fireEvent.click(screen.getByText('1 — Zentral'), { ctrlKey: true });
  expect(screen.queryByText('1/1 — EG')).not.toBeInTheDocument();

  // A plain click only reopens this branch, so the middle groups stay closed.
  fireEvent.click(screen.getByText('1 — Zentral'));
  expect(screen.getByText('1/1 — EG')).toBeInTheDocument();
  expect(screen.queryByText('1/1/75')).not.toBeInTheDocument();

  fireEvent.click(screen.getByText('1 — Zentral'));
  fireEvent.click(screen.getByText('1 — Zentral'), { ctrlKey: true });
  expect(screen.getByText('1/1/75')).toBeInTheDocument();
  expect(screen.getByText('Hall')).toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem('spectrum-knx.filter-branches')!)).toMatchObject({
    'ga:1': true, 'ga:1/1': true, 'ga:1/2': true,
  });

  // Closing with cmd stores the same closed state on every branch underneath.
  fireEvent.click(screen.getByText('1 — Zentral'), { metaKey: true });
  unmount();
  render(<KnxAddressTree {...props} />);
  fireEvent.click(screen.getByText('1 — Zentral'));
  expect(screen.queryByText('1/1/75')).not.toBeInTheDocument();
  expect(screen.queryByText('Hall')).not.toBeInTheDocument();
});

test('a plain click leaves the branches underneath unchanged', () => {
  render(
    <KnxAddressTree
      entries={entries}
      selected={[]}
      groupNames={{ '1': 'Zentral', '1/1': 'EG', '1/2': 'OG' }}
      separator="/"
      onToggle={vi.fn()}
      searchQuery=""
    />,
  );
  fireEvent.click(screen.getByText('1/1 — EG'));
  expect(screen.getByText('1/1/75')).toBeInTheDocument();
  fireEvent.click(screen.getByText('1 — Zentral'));
  fireEvent.click(screen.getByText('1 — Zentral'));
  expect(screen.getByText('1/1/75')).toBeInTheDocument();
  expect(screen.queryByText('Hall')).not.toBeInTheDocument();
});

test('ctrl-click on a group checkbox does not expand or collapse branches', () => {
  const onToggle = vi.fn();
  render(
    <KnxAddressTree
      entries={entries}
      selected={[]}
      groupNames={{ '1': 'Zentral', '1/1': 'EG', '1/2': 'OG' }}
      separator="/"
      onToggle={onToggle}
      searchQuery=""
    />,
  );
  fireEvent.click(screen.getByRole('checkbox', { name: '1 — Zentral' }), { ctrlKey: true });
  expect(onToggle).toHaveBeenCalled();
  expect(screen.getByText('1/1 — EG')).toBeInTheDocument();
  expect(screen.queryByText('1/1/75')).not.toBeInTheDocument();
});

test('a reloaded page restores opened and closed branches', () => {
  localStorage.setItem('spectrum-knx.filter-branches', JSON.stringify({ 'ga:1/2': true, nope: 'yes' }));
  reloadFilterBranches();
  render(
    <KnxAddressTree
      entries={entries}
      selected={[]}
      groupNames={{ '1': 'Zentral', '1/1': 'EG', '1/2': 'OG' }}
      separator="/"
      onToggle={vi.fn()}
      searchQuery=""
    />,
  );
  expect(screen.getByText('Hall')).toBeInTheDocument();
  expect(screen.queryByText('1/1/75')).not.toBeInTheDocument();
});

test('checking a collapsed branch does not expand it', () => {
  const { rerender } = render(
    <KnxAddressTree
      entries={entries}
      selected={[]}
      groupNames={{ '1': 'Zentral', '1/1': 'EG', '1/2': 'OG' }}
      separator="/"
      onToggle={vi.fn()}
      searchQuery=""
    />,
  );
  expect(screen.queryByText('1/1/75')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: '1/1 — EG' }));
  rerender(
    <KnxAddressTree
      entries={entries}
      selected={['1/1/75', '1/1/76']}
      groupNames={{ '1': 'Zentral', '1/1': 'EG', '1/2': 'OG' }}
      separator="/"
      onToggle={vi.fn()}
      searchQuery=""
    />,
  );
  expect(screen.queryByText('1/1/75')).not.toBeInTheDocument();
});

test('a branch with a selected entry is highlighted like a category title', () => {
  render(
    <KnxAddressTree
      entries={entries}
      selected={['1/1/75']}
      groupNames={{ '1': 'Zentral', '1/1': 'EG', '1/2': 'OG' }}
      separator="/"
      onToggle={vi.fn()}
      searchQuery=""
    />,
  );
  expect(screen.getByText('1 — Zentral').style.fontWeight).toBe('700');
  expect(screen.getByText('1 — Zentral').style.color).toBe('var(--accent-primary)');
  expect(screen.getByText('1/1 — EG').style.fontWeight).toBe('700');
  expect(screen.getByText('1/1 — EG').style.color).toBe('var(--accent-primary)');
  expect(screen.getByText('1/2 — OG').style.fontWeight).toBe('400');
  expect(screen.getByText('1/2 — OG').style.color).toBe('var(--text-main)');
});

test('a branch stays plain when a leaf only has telegrams in the buffer', () => {
  render(
    <KnxAddressTree
      entries={entries}
      selected={[]}
      groupNames={{ '1': 'Zentral', '1/1': 'EG', '1/2': 'OG' }}
      separator="/"
      onToggle={vi.fn()}
      bufferCounts={{ '1/1/75': 2, '1/1/76': 0, '1/2/1': 0 }}
      searchQuery=""
    />,
  );
  expect(screen.getByText('1 — Zentral').style.fontWeight).toBe('400');
  expect(screen.getByText('1 — Zentral').style.color).toBe('var(--text-main)');
  expect(screen.getByText('1/1 — EG').style.fontWeight).toBe('400');
  expect(screen.getByText('1/1 — EG').style.color).toBe('var(--text-main)');
  expect(screen.getByText('1/2 — OG').style.fontWeight).toBe('400');
  expect(screen.getByText('1/2 — OG').style.color).toBe('var(--text-main)');
  fireEvent.click(screen.getByText('1/1 — EG'));
  expect(screen.getByText('1/1/75').style.fontWeight).toBe('700');
  expect(screen.getByText('1/1/75').style.color).toBe('var(--accent-primary)');
  expect(screen.getByText('1/1/76').style.fontWeight).toBe('400');
});

test('a selected entry keeps its icons visible', () => {
  render(
    <KnxAddressTree
      entries={[{ address: '1/1/75', name: 'Alarm' }, { address: '1/1/76' }]}
      selected={['1/1/75', '1/1/76']}
      groupNames={{ '1': 'Zentral', '1/1': 'EG' }}
      separator="/"
      onToggle={vi.fn()}
      onLastSeen={vi.fn()}
      writeEnabled
      bufferCounts={{ '1/1/75': 3, '1/1/76': 0 }}
      searchQuery=""
    />,
  );
  fireEvent.click(screen.getByText('1/1 — EG'));
  const row = (address: string) => screen.getByText(address).parentElement!.parentElement!;
  expect(within(row('1/1/75')).getByRole('button', { name: 'Toggle last seen values' })).toBeInTheDocument();
  expect(within(row('1/1/76')).getByRole('button', { name: 'Toggle last seen values' })).toBeInTheDocument();
  expect(within(row('1/1/76')).getByRole('button', { name: 'Send to this GA' })).toBeInTheDocument();
  expect(within(row('1/1/75')).getByRole('button', { name: 'Toggle focus' })).toBeInTheDocument();
  expect(within(row('1/1/75')).getByRole('button', { name: 'Focus filter' })).toBeInTheDocument();
  expect(within(row('1/1/75')).getByRole('button', { name: 'Visualize this GA' })).toBeInTheDocument();
});

test('the count column keeps a fixed width so the row icons line up', () => {
  render(
    <KnxAddressTree
      entries={[{ address: '1.1.1', name: 'Busy' }, { address: '1.1.2' }]}
      selected={[]}
      groupNames={{}}
      separator="."
      onToggle={vi.fn()}
      counts={{ '1.1.1': 35615 }}
      bufferCounts={{ '1.1.1': 4, '1.1.2': 1 }}
      onLastSeen={vi.fn()}
      searchQuery=""
    />,
  );
  fireEvent.click(screen.getByText('1.1'));
  const row = (address: string) => screen.getByText(address).parentElement!.parentElement!;
  expect(screen.getByText('1.1.1').parentElement!.style.flex).toBe('1 1 0%');
  const column = badgeColumnWidth(35615);
  const slot = (address: string) => row(address).querySelector('[data-badge-slot]') as HTMLElement;
  expect(slot('1.1.1').style.width).toBe(column);
  expect(slot('1.1.2').style.width).toBe(column);
  expect(row('1.1.1').lastElementChild).toBe(slot('1.1.1'));
  expect(row('1.1.2').lastElementChild).toBe(slot('1.1.2'));
  expect(within(row('1.1.1')).getByRole('button', { name: 'Toggle focus' })).toBeInTheDocument();
  expect(within(row('1.1.1')).getByRole('button', { name: 'Focus filter' })).toBeInTheDocument();
  expect(within(row('1.1.1')).getByRole('button', { name: 'Visualize this device' })).toBeInTheDocument();
  expect(within(row('1.1.1')).getByRole('button', { name: 'Toggle last seen values' })).toBeInTheDocument();
  expect(within(row('1.1.2')).getByRole('button', { name: 'Toggle last seen values' })).toBeInTheDocument();
  expect(within(row('1.1.1')).queryByRole('button', { name: 'Send to this GA' })).not.toBeInTheDocument();
});

test('a branch shows its database total when the buffer has no telegram under it', () => {
  render(
    <KnxAddressTree
      entries={[{ address: '1.1.1' }, { address: '2.2.1' }]}
      selected={[]}
      groupNames={{}}
      separator="."
      onToggle={vi.fn()}
      counts={{ '1.1.1': 4 }}
      dbCounts={{ '1.1.1': 4, '2.2.1': 9 }}
      searchQuery=""
    />,
  );
  const row = (label: string) => screen.getByTitle(label).parentElement!.parentElement!.parentElement!;
  expect(within(row('1')).getByTitle('Telegrams')).toHaveTextContent('4');
  expect(within(row('1')).queryByTitle('Telegrams in the database')).not.toBeInTheDocument();
  const empty = within(row('2'));
  expect(empty.getByTitle('Telegrams in the database')).toHaveTextContent('9');
  expect(empty.queryByTitle('Telegrams')).not.toBeInTheDocument();
  expect(within(row('2.2')).getByTitle('Telegrams in the database')).toHaveTextContent('9');
});

test('a leaf shows its database count in gray only when the live count is zero', () => {
  render(
    <KnxAddressTree
      entries={[{ address: '1.1.1', name: 'Busy' }, { address: '1.1.2' }, { address: '1.1.3' }]}
      selected={[]}
      groupNames={{}}
      separator="."
      onToggle={vi.fn()}
      counts={{ '1.1.1': 3 }}
      bufferCounts={{ '1.1.1': 3, '1.1.2': 7, '1.1.3': 0 }}
      dbCounts={{ '1.1.1': 9, '1.1.2': 40, '1.1.3': 0 }}
      searchQuery=""
    />,
  );
  fireEvent.click(screen.getByText('1.1'));
  const row = (address: string) => screen.getByText(address).parentElement!.parentElement!;

  expect(screen.getByText('1.1.1').style.height).toBe('1rem');
  expect(screen.getByText('1.1.2').style.height).toBe('1rem');
  expect(within(row('1.1.1')).getByTitle('Telegrams')).toHaveTextContent('3');
  expect(within(row('1.1.1')).queryByTitle('Telegrams in the database')).not.toBeInTheDocument();

  const stored = within(row('1.1.2')).getByTitle('Telegrams in the database');
  expect(stored).toHaveTextContent('40');
  expect(stored.style.color).toBe('var(--text-dim)');
  expect(stored.style.background).toBe('var(--bg-tag)');
  expect(stored.style.height).toBe('1rem');
  expect(within(row('1.1.2')).queryByTitle('Telegrams')).not.toBeInTheDocument();

  expect(within(row('1.1.3')).queryByTitle('Telegrams in the database')).not.toBeInTheDocument();
  expect(within(row('1.1.3')).queryByTitle('Telegrams')).not.toBeInTheDocument();
});

test('marking filter rows and checking one checks every marked row', () => {
  const onToggle = vi.fn();
  render(
    <KnxAddressTree
      entries={[{ address: '1.1.1', name: 'A' }, { address: '1.1.2', name: 'B' }, { address: '1.1.3', name: 'C' }]}
      selected={[]}
      groupNames={{}}
      separator="."
      onToggle={onToggle}
      searchQuery=""
    />,
  );
  fireEvent.click(screen.getByText('1.1'));
  const row = (address: string) => screen.getByText(address).parentElement!.parentElement as HTMLElement;
  fireEvent.click(screen.getByText('1.1.1'));
  fireEvent.click(screen.getByText('1.1.3'), { ctrlKey: true });
  expect(row('1.1.1').dataset.marked).toBe('true');
  expect(row('1.1.2').dataset.marked).toBeUndefined();
  expect(row('1.1.3').dataset.marked).toBe('true');

  fireEvent.click(screen.getByRole('checkbox', { name: '1.1.1' }));
  expect(onToggle).toHaveBeenCalledWith(['1.1.1', '1.1.3']);
});
