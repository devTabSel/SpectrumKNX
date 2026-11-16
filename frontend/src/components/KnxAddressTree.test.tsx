import { render, screen, fireEvent } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { KnxAddressTree } from './KnxAddressTree';
import type { FilterOption } from '../types/filters';

const ENTRIES: FilterOption[] = [
  { address: '1/1/1', name: 'A' },
  { address: '1/1/2', name: 'B' },
  { address: '1/2/1', name: 'C' },
];

const renderTree = (selected: string[], onToggle = vi.fn()) => {
  render(
    <KnxAddressTree
      entries={ENTRIES}
      selected={selected}
      groupNames={{}}
      separator="/"
      onToggle={onToggle}
      searchQuery=""
    />,
  );
  return onToggle;
};

test('group click follows the shared tristate: partial clears, ctrl-click selects all', () => {
  const onToggle = renderTree(['1/1/1']);
  const group = screen.getByRole('checkbox', { name: '1/1' });
  expect(group).toHaveAttribute('aria-checked', 'mixed');

  fireEvent.click(group);
  expect(onToggle).toHaveBeenLastCalledWith([]);

  onToggle.mockClear();
  fireEvent.click(group, { ctrlKey: true });
  expect(onToggle).toHaveBeenLastCalledWith(['1/1/1', '1/1/2']);
});

test('a fully selected group click clears', () => {
  const onToggle = renderTree(['1/2/1']);
  expect(screen.getByRole('checkbox', { name: '1/2' })).toHaveAttribute('aria-checked', 'true');
  fireEvent.click(screen.getByRole('checkbox', { name: '1/2' }));
  expect(onToggle).toHaveBeenLastCalledWith([]);
});

test('an empty group click selects all of its leaves', () => {
  const onToggle = renderTree([]);
  expect(screen.getByRole('checkbox', { name: '1/2' })).toHaveAttribute('aria-checked', 'false');
  fireEvent.click(screen.getByRole('checkbox', { name: '1/2' }));
  expect(onToggle).toHaveBeenLastCalledWith(['1/2/1']);
});
