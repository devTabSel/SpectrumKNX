import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import { BusValueFacetPair } from './BusValueFacetPair';
import { TT } from '../utils/telegramCellStyles';

test('shows decoded+unit and hex, and cycles through decimal / bin exclusively', () => {
  render(
    <BusValueFacetPair
      value={{ value_numeric: 0, value_formatted: '0', raw_hex: '0x00' }}
      dpt="3.007"
      allowFocus
    />,
  );
  // Preferred: decoded on top, hex underneath.
  expect(screen.getByRole('button', { name: 'decrease 0' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '0x00' })).toBeTruthy();

  // Top cycles free facets: decimal → bin → decoded (hex stays on bottom).
  fireEvent.click(screen.getByRole('button', { name: 'decrease 0' }));
  expect(screen.getByRole('button', { name: '0' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '0x00' })).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: '0' }));
  expect(screen.getByRole('button', { name: '0b0000' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '0x00' })).toBeTruthy();

  // Bottom cycles free facets: bin was free → then decimal, etc.
  fireEvent.click(screen.getByRole('button', { name: '0x00' }));
  expect(screen.getByRole('button', { name: '0b0000' })).toBeTruthy();
});

test('decoded keeps unit (e.g. lx) and still reaches hex', () => {
  render(
    <BusValueFacetPair
      value={{ value_formatted: '1200', value_numeric: 1200, raw_hex: '0x04B0', unit: 'lx' }}
      dpt="9.004"
      allowFocus
    />,
  );
  const decoded = screen.getByRole('button', { name: '1200 lx' });
  expect(decoded.querySelector(`.${TT.valueUnit}`)).toHaveTextContent('lx');
  expect(screen.getByRole('button', { name: '0x04B0' })).toBeTruthy();

  fireEvent.click(decoded);
  // decimal skipped (same as "1200") → swap with hex
  const rows = screen.getAllByRole('button');
  expect(rows.some(r => r.getAttribute('aria-label') === '0x04B0')).toBe(true);
  expect(rows.some(r => r.getAttribute('aria-label') === '1200 lx')).toBe(true);
});

test('≤4-bit DPT exposes hex and binary on the pair', () => {
  render(
    <BusValueFacetPair
      value={{ value_formatted: 'On', value_numeric: 1, raw_hex: '0x01' }}
      dpt="1.001"
      allowFocus
    />,
  );
  expect(screen.getByRole('button', { name: 'on' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '0x01' })).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: '0x01' }));
  expect(screen.getByRole('button', { name: '0b1' })).toBeTruthy();
});
