import { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { ThemedDatetimePicker } from './ThemedDatetimePicker';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function openPicker(label = 'When') {
  const input = screen.getByLabelText(label);
  fireEvent.mouseDown(input);
  fireEvent.focus(input);
  return input;
}

test('opens a glass Chromium-style popover', () => {
  render(
    <ThemedDatetimePicker
      value="2026-07-18T12:30:00"
      onChange={() => {}}
      aria-label="When"
    />,
  );

  const input = screen.getByLabelText('When');
  expect(input).toHaveAttribute('type', 'text');
  expect(screen.queryByRole('dialog', { name: 'Date and time picker' })).not.toBeInTheDocument();

  openPicker();
  const dialog = screen.getByRole('dialog', { name: 'Date and time picker' });
  expect(dialog).toHaveAttribute('data-themed-datetime-picker');
  expect(dialog.style.background).toBe('var(--bg-panel)');
  expect(within(dialog).getByRole('grid', { name: 'Calendar' })).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Now' })).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'OK' })).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Clear' })).toBeInTheDocument();
});

test('clicking a disabled day does not close the picker or click through', () => {
  const other = vi.fn();
  render(
    <>
      <ThemedDatetimePicker
        mode="date"
        value="2026-07-15"
        onChange={() => {}}
        aria-label="Day"
        minDate="2026-07-10"
        maxDate="2026-07-20"
        openOnFocus={false}
      />
      <input aria-label="Other" onFocus={other} />
    </>,
  );
  openPicker('Day');
  const dialog = screen.getByRole('dialog', { name: 'Date and time picker' });
  const disabledDay = within(dialog).getByRole('button', { name: '2026-07-09' });
  expect(disabledDay).toHaveAttribute('aria-disabled', 'true');
  expect(disabledDay.style.pointerEvents).not.toBe('none');
  fireEvent.mouseDown(disabledDay);
  fireEvent.click(disabledDay);
  expect(screen.getByRole('dialog', { name: 'Date and time picker' })).toBeInTheDocument();
  expect(other).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Day')).toHaveFocus();
});

test('ArrowLeft/Right cycle segments; Tab leaves the field', () => {
  render(
    <>
      <ThemedDatetimePicker
        value="2026-07-18T12:30:00"
        onChange={() => {}}
        aria-label="When"
        openOnFocus={false}
      />
      <input aria-label="Next" />
    </>,
  );
  const input = openPicker() as HTMLInputElement;
  const dialog = screen.getByRole('dialog', { name: 'Date and time picker' });
  expect(dialog).toHaveAttribute('data-active-seg', 'year');
  expect(input.selectionStart).toBe(0);
  expect(input.selectionEnd).toBe(4);

  fireEvent.keyDown(input, { key: 'ArrowRight' });
  expect(dialog).toHaveAttribute('data-active-seg', 'month');
  fireEvent.keyDown(input, { key: 'ArrowRight' });
  expect(dialog).toHaveAttribute('data-active-seg', 'day');

  fireEvent.keyDown(input, { key: 'Tab' });
  expect(dialog).toHaveAttribute('data-active-seg', 'day');
});

test('typing digits edits the focused segment and advances when full', () => {
  render(
    <ThemedDatetimePicker
      mode="date"
      value="2026-07-18"
      onChange={() => {}}
      aria-label="Day"
      openOnFocus={false}
    />,
  );
  const input = openPicker('Day') as HTMLInputElement;
  fireEvent.keyDown(input, { key: '2' });
  fireEvent.keyDown(input, { key: '0' });
  fireEvent.keyDown(input, { key: '2' });
  fireEvent.keyDown(input, { key: '7' });
  expect(input).toHaveValue('2027-07-18');
  expect(screen.getByRole('dialog')).toHaveAttribute('data-active-seg', 'month');
});

test('mouse wheel rolls the focused time segment and wraps', () => {
  const onChange = vi.fn();
  render(
    <ThemedDatetimePicker
      value="2026-07-18T23:59:59"
      onChange={onChange}
      aria-label="When"
      openOnFocus={false}
    />,
  );
  const input = openPicker() as HTMLInputElement;
  fireEvent.keyDown(input, { key: 'ArrowRight' });
  fireEvent.keyDown(input, { key: 'ArrowRight' });
  fireEvent.keyDown(input, { key: 'ArrowRight' });
  expect(screen.getByRole('dialog')).toHaveAttribute('data-active-seg', 'h');
  fireEvent.wheel(input, { deltaY: -1 });
  expect(input).toHaveValue('2026-07-18T00:59:59');

  fireEvent.keyDown(input, { key: 'ArrowRight' });
  fireEvent.wheel(input, { deltaY: -1 });
  expect(input).toHaveValue('2026-07-18T00:00:59');

  fireEvent.keyDown(input, { key: 'ArrowRight' });
  fireEvent.wheel(input, { deltaY: -1 });
  expect(input).toHaveValue('2026-07-18T00:00:00');
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.blur(input);
  expect(onChange).toHaveBeenCalledWith('2026-07-18T00:00:00');
  expect(screen.queryByRole('dialog', { name: 'Date and time picker' })).not.toBeInTheDocument();
});

test('ArrowUp/Down bump the active field segment; OK commits', () => {
  const onChange = vi.fn();
  render(
    <ThemedDatetimePicker
      mode="date"
      value="2026-07-18"
      onChange={onChange}
      aria-label="Day"
      openOnFocus={false}
    />,
  );
  const input = openPicker('Day');
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'OK' }));
  expect(onChange).toHaveBeenCalledWith('2027-07-18');
});

test('ArrowDown allows any day in the field; blur clamps to DB span', () => {
  function Controlled() {
    const [value, setValue] = useState('2026-07-20');
    return (
      <ThemedDatetimePicker
        mode="date"
        value={value}
        onChange={setValue}
        aria-label="Day"
        minDate="2026-07-10"
        maxDate="2026-07-20"
        openOnFocus={false}
      />
    );
  }
  render(<Controlled />);
  const input = openPicker('Day') as HTMLInputElement;
  fireEvent.keyDown(input, { key: 'ArrowRight' }); // month
  fireEvent.keyDown(input, { key: 'ArrowRight' }); // day
  fireEvent.keyDown(input, { key: 'ArrowDown' }); // 21 — allowed while editing
  expect(input).toHaveValue('2026-07-21');
  fireEvent.blur(input);
  expect(input).toHaveValue('2026-07-20');
});

test('date before oldest clamps to oldest on blur; after newest to newest', () => {
  function Controlled() {
    const [value, setValue] = useState('2026-07-15');
    return (
      <ThemedDatetimePicker
        mode="date"
        value={value}
        onChange={setValue}
        aria-label="Day"
        minDate="2026-07-10"
        maxDate="2026-07-20"
        openOnFocus={false}
      />
    );
  }
  render(<Controlled />);
  const input = openPicker('Day') as HTMLInputElement;
  fireEvent.keyDown(input, { key: '1' });
  fireEvent.keyDown(input, { key: '9' });
  fireEvent.keyDown(input, { key: '9' });
  fireEvent.keyDown(input, { key: '9' });
  expect(input).toHaveValue('1999-07-15');
  fireEvent.blur(input);
  expect(input).toHaveValue('2026-07-10');

  fireEvent.focus(input);
  // jump year to 2099 via digits
  fireEvent.keyDown(input, { key: '2' });
  fireEvent.keyDown(input, { key: '0' });
  fireEvent.keyDown(input, { key: '9' });
  fireEvent.keyDown(input, { key: '9' });
  fireEvent.blur(input);
  expect(input).toHaveValue('2026-07-20');
});

test('mouse: picking a day drafts; OK commits', () => {
  const onChange = vi.fn();
  render(
    <ThemedDatetimePicker
      mode="date"
      value="2026-07-15"
      onChange={onChange}
      aria-label="Day"
      openOnFocus={false}
    />,
  );
  openPicker('Day');
  const dialog = screen.getByRole('dialog', { name: 'Date and time picker' });
  fireEvent.click(within(dialog).getByRole('button', { name: '2026-07-20' }));
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'OK' }));
  expect(onChange).toHaveBeenCalledWith('2026-07-20');
  expect(screen.queryByRole('dialog', { name: 'Date and time picker' })).not.toBeInTheDocument();
});

test('Now applies current time and closes', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 6, 18, 15, 45, 12));
  const onChange = vi.fn();
  render(
    <ThemedDatetimePicker
      value="2026-07-10T01:00:00"
      onChange={onChange}
      aria-label="When"
      openOnFocus={false}
    />,
  );
  openPicker();
  fireEvent.click(screen.getByRole('button', { name: 'Now' }));
  expect(onChange).toHaveBeenCalledWith('2026-07-18T15:45:12');
  expect(screen.queryByRole('dialog', { name: 'Date and time picker' })).not.toBeInTheDocument();
});

test('Clear clears the field', () => {
  function Controlled() {
    const [value, setValue] = useState('2026-07-18T12:30:00');
    return (
      <ThemedDatetimePicker value={value} onChange={setValue} aria-label="When" openOnFocus={false} />
    );
  }
  render(<Controlled />);
  const input = openPicker() as HTMLInputElement;
  expect(input).toHaveValue('2026-07-18T12:30:00');
  fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
  expect(input).toHaveValue('');
  expect(screen.queryByRole('dialog', { name: 'Date and time picker' })).not.toBeInTheDocument();
});

test('month chevrons navigate the calendar view', () => {
  render(
    <ThemedDatetimePicker
      mode="date"
      value="2026-07-18"
      onChange={() => {}}
      aria-label="Day"
      openOnFocus={false}
    />,
  );
  openPicker('Day');
  const dialog = screen.getByRole('dialog', { name: 'Date and time picker' });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Next month' }));
  expect(within(dialog).getByText('August 2026')).toBeInTheDocument();
});

test('mouse wheel on month/year scrolls the calendar month', () => {
  render(
    <ThemedDatetimePicker
      mode="date"
      value="2026-07-18"
      onChange={() => {}}
      aria-label="Day"
      openOnFocus={false}
    />,
  );
  openPicker('Day');
  const dialog = screen.getByRole('dialog', { name: 'Date and time picker' });
  const heading = dialog.querySelector('[data-cal-heading]') as HTMLElement;
  fireEvent.wheel(heading, { deltaY: -1 });
  expect(within(dialog).getByText('August 2026')).toBeInTheDocument();
  fireEvent.wheel(heading, { deltaY: 1 });
  expect(within(dialog).getByText('July 2026')).toBeInTheDocument();
});

test('Escape discards draft without committing', () => {
  const onChange = vi.fn();
  render(
    <ThemedDatetimePicker
      value="2026-07-18T12:30:00"
      onChange={onChange}
      aria-label="When"
      openOnFocus={false}
    />,
  );
  const input = openPicker();
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog', { name: 'Date and time picker' })).not.toBeInTheDocument();
});

test('click on the field toggles the picker; Enter applies', () => {
  const onChange = vi.fn();
  render(
    <ThemedDatetimePicker
      value="2026-07-18T12:30:00"
      onChange={onChange}
      aria-label="When"
      openOnFocus={false}
    />,
  );
  const input = screen.getByLabelText('When');
  fireEvent.mouseDown(input);
  expect(screen.getByRole('dialog', { name: 'Date and time picker' })).toBeInTheDocument();
  fireEvent.mouseDown(input);
  expect(screen.queryByRole('dialog', { name: 'Date and time picker' })).not.toBeInTheDocument();

  fireEvent.mouseDown(input);
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onChange).toHaveBeenCalledWith('2027-07-18T12:30:00');
  expect(screen.queryByRole('dialog', { name: 'Date and time picker' })).not.toBeInTheDocument();
});

test('standard actions: Now left and Clear right above time, OK below', () => {
  render(
    <ThemedDatetimePicker value="2026-07-18T12:30:00" onChange={() => {}} aria-label="When" />,
  );
  openPicker();
  const dialog = screen.getByRole('dialog', { name: 'Date and time picker' });
  const side = dialog.querySelector('[data-side-block]') as HTMLElement;
  const row = side.querySelector('[data-action-row="now-clear"]') as HTMLElement;
  expect(row.style.justifyContent).toBe('space-between');
  expect(within(row).getByRole('button', { name: 'Now' })).toBeInTheDocument();
  expect(within(row).getByRole('button', { name: 'Clear' })).toBeInTheDocument();
  const labels = within(side).getAllByRole('button')
    .map(b => b.getAttribute('aria-label'))
    .filter(n => n === 'Clear' || n === 'Now' || n === 'OK');
  expect(labels).toEqual(['Now', 'Clear', 'OK']);
});

test('since actions (TIME von): Since… and Clear', () => {
  const onChange = vi.fn();
  render(
    <ThemedDatetimePicker
      value="2026-07-18T12:30:00"
      onChange={onChange}
      aria-label="From"
      actions="since"
      openOnFocus={false}
    />,
  );
  openPicker('From');
  const dialog = screen.getByRole('dialog', { name: 'Date and time picker' });
  expect(within(dialog).getByRole('button', { name: 'Since' })).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Clear' })).toBeInTheDocument();
  expect(within(dialog).queryByRole('button', { name: 'OK' })).not.toBeInTheDocument();
  expect(within(dialog).queryByRole('button', { name: 'Live' })).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Since' }));
  expect(onChange).toHaveBeenCalledWith('2026-07-18T12:30:00');
});

test('before actions (TIME bis): Before…, Live play icon, Clear', () => {
  const onChange = vi.fn();
  const onLive = vi.fn();
  render(
    <ThemedDatetimePicker
      value="2026-07-18T12:30:00"
      onChange={onChange}
      aria-label="To"
      actions="before"
      onLive={onLive}
      openOnFocus={false}
    />,
  );
  openPicker('To');
  const dialog = screen.getByRole('dialog', { name: 'Date and time picker' });
  expect(within(dialog).getByRole('button', { name: 'Before' })).toBeInTheDocument();
  const live = within(dialog).getByRole('button', { name: 'Live' });
  expect(live).toBeInTheDocument();
  expect(live.style.color).toBe('rgb(34, 197, 94)');
  expect(within(dialog).getByRole('button', { name: 'Clear' })).toBeInTheDocument();
  fireEvent.click(live);
  expect(onChange).toHaveBeenCalledWith('');
  expect(onLive).toHaveBeenCalled();
});

test('date mode omits time spins; still has Now/Clear/OK', () => {
  render(
    <ThemedDatetimePicker mode="date" value="2026-07-18" onChange={() => {}} aria-label="Day" />,
  );
  openPicker('Day');
  const dialog = screen.getByRole('dialog', { name: 'Date and time picker' });
  expect(within(dialog).queryByRole('spinbutton', { name: 'hour' })).not.toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Now' })).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'OK' })).toBeInTheDocument();
});

test('time mode omits calendar; shows time spins and Now', () => {
  render(
    <ThemedDatetimePicker mode="time" value="12:30:00" onChange={() => {}} aria-label="Clock" />,
  );
  openPicker('Clock');
  const dialog = screen.getByRole('dialog', { name: 'Date and time picker' });
  expect(within(dialog).queryByRole('grid', { name: 'Calendar' })).not.toBeInTheDocument();
  expect(within(dialog).getByRole('spinbutton', { name: 'hour' })).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Now' })).toBeInTheDocument();
});

test('days outside minDate/maxDate are disabled in the calendar', () => {
  render(
    <ThemedDatetimePicker
      mode="date"
      value="2026-07-15"
      onChange={() => {}}
      aria-label="Day"
      minDate="2026-07-10"
      maxDate="2026-07-20"
      openOnFocus={false}
    />,
  );
  openPicker('Day');
  const dialog = screen.getByRole('dialog', { name: 'Date and time picker' });
  expect(within(dialog).getByRole('button', { name: '2026-07-09' })).toHaveAttribute('aria-disabled', 'true');
  expect(within(dialog).getByRole('button', { name: '2026-07-10' })).toHaveAttribute('aria-disabled', 'false');
});

test('popover controls are not keyboard-focusable', () => {
  render(
    <ThemedDatetimePicker
      value="2026-07-18T12:30:00"
      onChange={() => {}}
      aria-label="When"
      openOnFocus={false}
    />,
  );
  openPicker();
  const dialog = screen.getByRole('dialog', { name: 'Date and time picker' });
  for (const b of within(dialog).getAllByRole('button')) {
    expect(b).toHaveAttribute('tabindex', '-1');
  }
});
