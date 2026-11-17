import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { DurationField, parseTypedDurationUnit } from './DurationField';
import { RANGE_UNITS } from '../utils/rangeWindow';

afterEach(() => cleanup());

test('parseTypedDurationUnit strips a known suffix', () => {
  expect(parseTypedDurationUnit('5 m', RANGE_UNITS)).toEqual({ value: '5', unit: 'm' });
  expect(parseTypedDurationUnit('1.5h', RANGE_UNITS)).toEqual({ value: '1.5', unit: 'h' });
  expect(parseTypedDurationUnit('30', RANGE_UNITS)).toBeNull();
  expect(parseTypedDurationUnit('5 x', RANGE_UNITS)).toBeNull();
});

test('click cycles through units when unitSwitchable', () => {
  const onUnitChange = vi.fn();
  function Harness() {
    const [unit, setUnit] = useState('m');
    return (
      <DurationField
        value="60"
        onChange={() => {}}
        placeholder="range"
        title="range"
        ariaLabel="range"
        unit={unit}
        alwaysShowUnit
        unitSwitchable
        units={RANGE_UNITS}
        onUnitChange={u => {
          onUnitChange(u);
          setUnit(u);
        }}
        unitTitle="Cycle range unit (s / m / h / d)"
      />
    );
  }
  render(<Harness />);
  const btn = screen.getByRole('button', { name: 'Cycle range unit (s / m / h / d)' });
  expect(btn).toHaveTextContent('m');
  fireEvent.click(btn);
  expect(onUnitChange).toHaveBeenLastCalledWith('h');
  expect(btn).toHaveTextContent('h');
  fireEvent.click(btn);
  expect(onUnitChange).toHaveBeenLastCalledWith('d');
});

test('blur adopts a typed unit suffix', () => {
  const onUnitChange = vi.fn();
  const onBlur = vi.fn();
  const onChange = vi.fn();
  render(
    <DurationField
      value="5 m"
      onChange={onChange}
      placeholder="range"
      title="range"
      ariaLabel="range"
      unit="s"
      alwaysShowUnit
      unitSwitchable
      units={RANGE_UNITS}
      onUnitChange={onUnitChange}
      onBlur={onBlur}
      sanitize={raw => raw.trim()}
    />,
  );
  fireEvent.blur(screen.getByLabelText('range'));
  expect(onUnitChange).toHaveBeenCalledWith('m');
  expect(onChange).toHaveBeenCalledWith('5');
  expect(onBlur).toHaveBeenCalledWith('5', 'm');
});

test('fixed unit is not a button without unitSwitchable', () => {
  render(
    <DurationField
      value="2"
      onChange={() => {}}
      placeholder="delay"
      title="delay"
      unit="s"
    />,
  );
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(document.querySelector('[data-duration-field]')).toBeTruthy();
});

test('range Werthilfe anchors to the field; the chevron after the unit is not focusable', () => {
  const onBlur = vi.fn();
  const onChange = vi.fn();
  const onUnitChange = vi.fn();
  render(
    <DurationField
      value="60"
      onChange={onChange}
      placeholder="range"
      title="range"
      ariaLabel="range"
      unit="m"
      alwaysShowUnit
      unitSwitchable
      units={RANGE_UNITS}
      onUnitChange={onUnitChange}
      unitTitle="Cycle range unit (s / m / h / d)"
      suggestions={['30 s', '1 m', '1 h']}
      onBlur={onBlur}
      sanitize={raw => raw.trim()}
    />,
  );
  const unit = screen.getByRole('button', { name: 'Cycle range unit (s / m / h / d)' });
  const chevron = document.querySelector('[data-duration-chevron]') as HTMLElement;
  const shell = document.querySelector('[data-duration-field]') as HTMLElement;
  expect(chevron).toBeTruthy();
  expect(chevron.tagName).toBe('SPAN');
  expect(chevron.hasAttribute('tabindex')).toBe(false);
  expect(shell.contains(chevron)).toBe(true);
  expect(unit.compareDocumentPosition(chevron) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  const rect = (top: number, bottom: number) => ({
    x: 40, y: top, top, left: 40, right: 160, bottom, width: 120, height: bottom - top, toJSON() { return {}; },
  });
  vi.spyOn(shell, 'getBoundingClientRect').mockReturnValue(rect(100, 128));
  fireEvent.focus(screen.getByLabelText('range'));
  const menu = screen.getByRole('listbox', { name: 'Range presets' });
  expect(menu.style.top).toBe('132px');
  expect(menu.style.left).toBe('40px');
  expect(Number.parseFloat(menu.style.width)).toBe(120);

  fireEvent.blur(screen.getByLabelText('range'));
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

  vi.spyOn(shell, 'getBoundingClientRect').mockReturnValue(rect(700, 728));
  fireEvent.focus(screen.getByLabelText('range'));
  const flipped = screen.getByRole('listbox', { name: 'Range presets' });
  expect(Number.parseFloat(flipped.style.top)).toBeLessThan(700);

  fireEvent.mouseDown(screen.getByRole('option', { name: '1 h' }));
  expect(onUnitChange).toHaveBeenCalledWith('h');
  expect(onChange).toHaveBeenCalledWith('1');
  expect(onBlur).toHaveBeenCalledWith('1', 'h');
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
});
