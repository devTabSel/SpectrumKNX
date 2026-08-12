import { render, screen, fireEvent } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { AutoFollowPill } from './AutoFollowPill';

test('shows the buffered count while telegrams are queued', () => {
  render(<AutoFollowPill count={3} onClick={vi.fn()} />);
  expect(screen.getByText('3 new')).toBeInTheDocument();
});

test('stays visible and shows "paused" once the queued count reaches zero', () => {
  render(<AutoFollowPill count={0} onClick={vi.fn()} />);
  expect(screen.getByText('paused')).toBeInTheDocument();
});

test('clicking the pill invokes onClick regardless of the queued count', () => {
  const onClick = vi.fn();
  render(<AutoFollowPill count={0} onClick={onClick} />);
  fireEvent.click(screen.getByText('paused'));
  expect(onClick).toHaveBeenCalledTimes(1);
});
