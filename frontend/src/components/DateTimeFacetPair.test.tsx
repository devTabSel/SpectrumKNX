import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { DateTimeFacetPair } from './DateTimeFacetPair';
import { TT } from '../utils/telegramCellStyles';

const TS = '2026-10-21T12:19:46.210';

test('renders time above date and swaps on click', () => {
  render(<DateTimeFacetPair value={TS} allowFocus />);
  const buttons = screen.getAllByRole('button');
  expect(buttons[0]).toHaveAccessibleName('12:19:46.21');
  expect(buttons[1]).toHaveAccessibleName('2026-10-21');
  expect(buttons[0].className).toContain(TT.time);
  expect(buttons[1].className).toContain(TT.timeDate);

  fireEvent.click(buttons[0]);
  const swapped = screen.getAllByRole('button');
  expect(swapped[0]).toHaveAccessibleName('2026-10-21');
  expect(swapped[1]).toHaveAccessibleName('12:19:46.21');
  // Styles follow the facet, not the row index.
  expect(swapped[0].className).toContain(TT.timeDate);
  expect(swapped[1].className).toContain(TT.time);
});

test('clicking the date row also swaps the pair', () => {
  render(<DateTimeFacetPair value={TS} allowFocus />);
  fireEvent.click(screen.getByRole('button', { name: '2026-10-21' }));
  const swapped = screen.getAllByRole('button');
  expect(swapped[0]).toHaveAccessibleName('2026-10-21');
  expect(swapped[1]).toHaveAccessibleName('12:19:46.21');
});

test('lines=1 cycles time ↔ date on a single row; styles stay facet-specific', () => {
  render(<DateTimeFacetPair value={TS} allowFocus lines={1} />);
  const only = screen.getByRole('button', { name: '12:19:46.21' });
  expect(screen.queryByRole('button', { name: '2026-10-21' })).toBeNull();
  expect(only.className).toContain(TT.time);

  fireEvent.click(only);
  const date = screen.getByRole('button', { name: '2026-10-21' });
  expect(date.className).toContain(TT.timeDate);
  expect(screen.queryByRole('button', { name: '12:19:46.21' })).toBeNull();
});
