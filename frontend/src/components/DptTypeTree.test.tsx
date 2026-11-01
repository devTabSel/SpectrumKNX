import { render, screen, fireEvent, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { DptTypeTree } from './DptTypeTree';
import type { FilterOption } from '../types/filters';
import { resetFilterBranches } from '../utils/filterBranchExpansion';

beforeEach(() => {
  resetFilterBranches();
});

const ENTRIES: FilterOption[] = [
  { main: 1, sub: 1, label: 'Switch' },
  { main: 1, sub: 2, label: 'Boolean' },
  { main: 9, sub: 1, label: 'Temperature (°C)' },
  { main: 5, sub: 1, label: 'Percentage (0..100%)' },
];

const renderTree = (selected: string[], onChange = vi.fn(), searchQuery = '') => {
  render(
    <DptTypeTree
      entries={ENTRIES}
      selected={selected}
      onChange={onChange}
      searchQuery={searchQuery}
    />,
  );
  return onChange;
};

test('a main-type badge totals its subtypes once', () => {
  render(
    <DptTypeTree
      entries={ENTRIES}
      selected={[]}
      onChange={vi.fn()}
      searchQuery=""
      counts={{ '1': 5, '1.001': 2, '1.002': 3, '5.001': 4 }}
    />,
  );
  const row = (label: string) => screen.getByText(label).parentElement!.parentElement!.parentElement!;
  const dpt1 = row('DPT 1');
  expect(within(dpt1).getByTitle('DPTs in the buffer')).toHaveTextContent('2');
  expect(within(dpt1).getByTitle('Telegrams')).toHaveTextContent('5');
  const dpt5 = row('DPT 5');
  expect(within(dpt5).getByTitle('DPTs in the buffer')).toHaveTextContent('1');
  expect(within(dpt5).getByTitle('Telegrams')).toHaveTextContent('4');
});

test('groups DPTs by main type with width labels, sorted and collapsed (#273)', () => {
  renderTree([]);

  const groups = screen.getAllByText(/^DPT \d+$/).map(el => el.textContent);
  expect(groups).toEqual(['DPT 1', 'DPT 5', 'DPT 9']);
  expect(screen.getByText('1-bit')).toBeInTheDocument();
  expect(screen.getByText('8-bit unsigned')).toBeInTheDocument();
  expect(screen.getByText('2-byte float')).toBeInTheDocument();

  // Collapsed by default: no subtype rows visible.
  expect(screen.queryByText('Switch')).not.toBeInTheDocument();

  // Expanding a group reveals its subtypes.
  fireEvent.click(screen.getByText('DPT 1'));
  expect(screen.getByText('Switch')).toBeInTheDocument();
  expect(screen.getByText('Boolean')).toBeInTheDocument();
  expect(screen.queryByText('Temperature (°C)')).not.toBeInTheDocument();
});

test('opening a DPT group survives a remount and a search does not store that', () => {
  const { unmount } = render(
    <DptTypeTree entries={ENTRIES} selected={[]} onChange={vi.fn()} searchQuery="" />,
  );
  fireEvent.click(screen.getByText('DPT 1'));
  expect(screen.getByText('Switch')).toBeInTheDocument();
  unmount();

  const again = render(
    <DptTypeTree entries={ENTRIES} selected={[]} onChange={vi.fn()} searchQuery="" />,
  );
  expect(screen.getByText('Switch')).toBeInTheDocument();
  expect(JSON.parse(localStorage.getItem('spectrum-knx.filter-branches')!)).toMatchObject({ 'dpt:1': true });
  again.unmount();

  const searching = render(
    <DptTypeTree entries={ENTRIES} selected={[]} onChange={vi.fn()} searchQuery="temperature" />,
  );
  expect(screen.getByText('Temperature (°C)')).toBeInTheDocument();
  searching.unmount();
  render(<DptTypeTree entries={ENTRIES} selected={[]} onChange={vi.fn()} searchQuery="" />);
  expect(screen.queryByText('Temperature (°C)')).not.toBeInTheDocument();
  expect(screen.getByText('Switch')).toBeInTheDocument();
});

test('an active search expands the groups', () => {
  renderTree([], vi.fn(), 'switch');
  expect(screen.getByText('Switch')).toBeInTheDocument();
});

test('checking or unchecking a group does not expand or collapse it', () => {
  const { rerender } = render(
    <DptTypeTree entries={ENTRIES} selected={[]} onChange={vi.fn()} searchQuery="" />,
  );
  expect(screen.queryByText('Switch')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: 'DPT 1' }));
  rerender(<DptTypeTree entries={ENTRIES} selected={['1']} onChange={vi.fn()} searchQuery="" />);
  expect(screen.queryByText('Switch')).not.toBeInTheDocument();
});

test('a group that started open stays open when its selection is cleared', () => {
  const { rerender } = render(
    <DptTypeTree entries={ENTRIES} selected={['1']} onChange={vi.fn()} searchQuery="" />,
  );
  expect(screen.getByText('Switch')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: 'DPT 1' }));
  rerender(<DptTypeTree entries={ENTRIES} selected={[]} onChange={vi.fn()} searchQuery="" />);
  expect(screen.getByText('Switch')).toBeInTheDocument();
});

test('the group checkbox selects the bare main-type key', () => {
  const onChange = vi.fn();
  renderTree(['9.001'], onChange);

  fireEvent.click(screen.getByRole('checkbox', { name: 'DPT 1' }));
  expect(onChange).toHaveBeenCalledWith(['1']);
});

test('a fully selected group shows a checked checkbox, a partial one mixed', () => {
  renderTree(['1', '9.001']);
  expect(screen.getByRole('checkbox', { name: 'DPT 1' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('checkbox', { name: 'DPT 9' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('checkbox', { name: 'DPT 5' })).toHaveAttribute('aria-checked', 'false');
});

test('a partially selected group shows a mixed checkbox', () => {
  renderTree(['1.001']);
  expect(screen.getByRole('checkbox', { name: 'DPT 1' })).toHaveAttribute('aria-checked', 'mixed');
});

test('unchecking a group removes its bare key and subtype keys', () => {
  const onChange = vi.fn();
  renderTree(['1', '1.002', '9.001'], onChange);
  fireEvent.click(screen.getByRole('checkbox', { name: 'DPT 1' }));
  expect(onChange).toHaveBeenCalledWith([]);
});

test('unchecking one subtype of a fully selected main type keeps the others', () => {
  const onChange = vi.fn();
  renderTree(['1'], onChange);

  // Group is selected → it renders expanded; uncheck the "Switch" subtype.
  fireEvent.click(screen.getByRole('checkbox', { name: '1.001' }));
  expect(onChange).toHaveBeenCalledWith([]);
});

test('toggling a subtype adds and removes its exact key', () => {
  const onChange = vi.fn();
  renderTree(['1.001'], onChange);

  fireEvent.click(screen.getByRole('checkbox', { name: '1.002' }));
  expect(onChange).toHaveBeenCalledWith(['1.002']);
});

test('a subtype with telegrams in the unfiltered buffer is highlighted', () => {
  render(
    <DptTypeTree
      entries={ENTRIES}
      selected={['1.001']}
      onChange={vi.fn()}
      searchQuery=""
      bufferCounts={{ '1.001': 3, '1.002': 0 }}
    />,
  );
  expect(screen.getByText('DPT 1').style.fontWeight).toBe('700');
  expect(screen.getByText('DPT 1').style.color).toBe('var(--accent-primary)');
  expect(screen.getByText('1.001').style.fontWeight).toBe('700');
  expect(screen.getByText('1.001').style.color).toBe('var(--accent-primary)');
  expect(screen.getByText('1.002').style.fontWeight).toBe('400');
  expect(screen.getByText('1.002').style.color).toBe('var(--text-main)');
});

test('a DPT group stays plain when a subtype only has telegrams in the buffer', () => {
  render(
    <DptTypeTree
      entries={ENTRIES}
      selected={[]}
      onChange={vi.fn()}
      searchQuery="temperature"
      bufferCounts={{ '9.001': 4, '1.001': 0 }}
    />,
  );
  expect(screen.getByText('DPT 9').style.fontWeight).toBe('400');
  expect(screen.getByText('DPT 9').style.color).toBe('var(--text-main)');
  expect(screen.getByText('9.001').style.fontWeight).toBe('700');
  expect(screen.getByText('9.001').style.color).toBe('var(--accent-primary)');
});

test('a group and a subtype show the database count when the buffer has none', () => {
  render(
    <DptTypeTree
      entries={ENTRIES}
      selected={[]}
      onChange={vi.fn()}
      searchQuery="switch"
      counts={{ '1.002': 2 }}
      dbCounts={{ '1.001': 8, '1': 10, '9.001': 4, '9': 4 }}
    />,
  );
  const row = (label: string) => screen.getByText(label).parentElement!.parentElement!.parentElement!;
  expect(within(row('DPT 1')).getByTitle('Telegrams')).toHaveTextContent('2');
  expect(within(row('DPT 1')).queryByTitle('Telegrams in the database')).not.toBeInTheDocument();
  const subtype = screen.getByText('1.001').parentElement!.parentElement!;
  expect(within(subtype).getByTitle('Telegrams in the database')).toHaveTextContent('8');
  expect(within(subtype).queryByTitle('Telegrams')).not.toBeInTheDocument();
  expect(within(row('DPT 9')).getByTitle('Telegrams in the database')).toHaveTextContent('4');
  expect(within(row('DPT 9')).queryByTitle('Telegrams')).not.toBeInTheDocument();
});

test('a zero telegram count is not shown', () => {
  render(
    <DptTypeTree
      entries={ENTRIES}
      selected={[]}
      onChange={vi.fn()}
      searchQuery="switch"
      counts={{ '1.001': 0, '1.002': 2 }}
    />,
  );
  expect(screen.getByText('1.002').parentElement!.parentElement!.querySelector('span')).toHaveTextContent('2');
  expect(within(screen.getByText('1.001').parentElement!.parentElement!).queryByTitle('Telegrams')).not.toBeInTheDocument();
});
