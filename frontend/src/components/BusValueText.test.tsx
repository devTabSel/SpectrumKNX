import { render, screen, fireEvent } from '@testing-library/react';
import { expect, test } from 'vitest';
import { BusValueText } from './BusValueText';
import { TT } from '../utils/telegramCellStyles';

test('cycles decoded → decimal → hex → bin for ≤4-bit DPT', () => {
  render(
    <BusValueText
      value={{ value_numeric: 0, value_formatted: '0', raw_hex: '0x00' }}
      dpt="3.007"
    />,
  );
  const el = screen.getByRole('button', { name: 'decrease 0' });
  expect(el.querySelector(`.${TT.value}`)).toHaveStyle({ visibility: 'visible' });

  fireEvent.click(el);
  expect(screen.getByRole('button', { name: '0' })).toBe(el);

  fireEvent.click(el);
  expect(screen.getByRole('button', { name: '0x00' })).toBe(el);

  fireEvent.click(el);
  expect(screen.getByRole('button', { name: '0b0000' })).toBe(el);

  fireEvent.click(el);
  expect(screen.getByRole('button', { name: 'decrease 0' })).toBe(el);
});

test('skips decimal when it matches decoded text', () => {
  render(
    <BusValueText
      value={{ value_formatted: '21.5', value_numeric: 21.5, raw_hex: '0x0C65', unit: '°C' }}
      dpt="9.001"
    />,
  );
  // Decoded is "21.5" with unit; decimal would also be "21.5" → skipped.
  const el = screen.getByRole('button', { name: '21.5 °C' });
  fireEvent.click(el);
  expect(screen.getByRole('button', { name: '0x0C65' })).toBe(el);
  fireEvent.click(el);
  expect(screen.getByRole('button', { name: '21.5 °C' })).toBe(el);
});

test('omits binary outside ≤4-bit discrete DPTs', () => {
  render(
    <BusValueText
      value={{ value_formatted: '21.5', value_numeric: 21.5, raw_hex: '0x0C65' }}
      dpt="9.001"
    />,
  );
  const el = screen.getByRole('button', { name: '21.5' });
  fireEvent.click(el); // hex
  fireEvent.click(el); // back to decoded (no bin)
  expect(screen.getByRole('button', { name: '21.5' })).toBe(el);
});

test('renders unit in a separate tt-value-unit span', () => {
  render(
    <BusValueText value={{ value_formatted: '21.5', unit: '°C' }} dpt="9.001" />,
  );
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  const value = screen.getByText((_, node) => node?.textContent === '21.5 °C' && node.classList.contains(TT.value));
  expect(value).toBeTruthy();
  expect(screen.getByText((content, node) => (
    node?.classList.contains(TT.valueUnit) === true && content.includes('°C')
  ))).toBeTruthy();
});

test('className / rawClassName overrides replace defaults', () => {
  render(
    <BusValueText
      value={{ value_formatted: 'On', raw_hex: '0x01' }}
      dpt="1.001"
      className="custom-value"
      rawClassName="custom-raw"
    />,
  );
  const el = screen.getByRole('button', { name: 'on' });
  expect(el.querySelector('.custom-value')).toBeTruthy();
  expect(el.querySelector(`.${TT.value}`)).toBeNull();
  fireEvent.click(el); // decimal "1"
  fireEvent.click(el); // hex
  expect(el.querySelector('.custom-raw')).toBeTruthy();
  expect(el.querySelector(`.${TT.rawBadge}`)).toBeNull();
});

test('defaultShowHex starts in hex mode and cycles onward', () => {
  render(
    <BusValueText
      value={{ value_numeric: 0, value_formatted: '0', raw_hex: '0x00' }}
      dpt="3.007"
      defaultShowHex
    />,
  );
  const el = screen.getByRole('button', { name: '0x00' });
  const hexLayer = [...el.querySelectorAll(`.${TT.rawBadge}`)]
    .find(node => node.textContent === '0x00') as HTMLElement;
  expect(hexLayer).toHaveStyle({ visibility: 'visible' });
  fireEvent.click(el);
  expect(screen.getByRole('button', { name: '0b0000' })).toBe(el);
});

test('text DPTs render padded values in monospace', () => {
  const { container } = render(
    <BusValueText value={{ value_formatted: 'Hi' }} dpt="16.000" />,
  );
  const el = container.querySelector(`.${TT.value}`) as HTMLElement;
  expect(el).toHaveTextContent('Hi');
  expect(el.textContent).toBe('Hi'.padEnd(14, ' '));
  expect(el).toHaveStyle({ fontFamily: "'JetBrains Mono', monospace", whiteSpace: 'pre' });
});

test('allowFocus=false keeps the toggle out of the tab order', () => {
  render(
    <BusValueText
      value={{ value_formatted: 'On', raw_hex: '0x01' }}
      dpt="1.001"
      allowFocus={false}
    />,
  );
  const el = screen.getByRole('button', { name: 'on' });
  expect(el).toHaveAttribute('tabIndex', '-1');
  fireEvent.mouseDown(el);
  expect(el).not.toHaveFocus();
  fireEvent.click(el);
  expect(screen.getByRole('button', { name: '1' })).toBe(el);
});
