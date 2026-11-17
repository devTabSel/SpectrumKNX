import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { DateTimeField } from './DateTimeField';
import { TT } from '../utils/telegramCellStyles';

const dayA = Date.parse('2026-03-01T10:00:00');
const dayALater = Date.parse('2026-03-01T12:00:00');
const dayB = Date.parse('2026-03-02T09:00:00');

test('idle if-differs hides date on the same day; click opens the picker field', () => {
  const onBeginEdit = vi.fn();
  render(
    <DateTimeField
      valueMs={dayA}
      referenceMs={dayALater}
      dateDisplay="if-differs"
      editable
      editValue=""
      focused={false}
      aria-label="When"
      onBeginEdit={onBeginEdit}
      onChange={() => {}}
      onBlur={() => {}}
      onKeyDown={() => {}}
    />,
  );
  const idle = screen.getByLabelText('When');
  expect(idle.querySelector(`.${TT.time}`)).toHaveTextContent('10:00:00.00');
  expect(idle.querySelector(`.${TT.timeDate}`)).toBeNull();
  fireEvent.click(idle);
  expect(onBeginEdit).toHaveBeenCalled();
});

test('idle if-differs shows date left of time when the reference day differs', () => {
  render(
    <DateTimeField
      valueMs={dayA}
      referenceMs={dayB}
      dateDisplay="if-differs"
      editable
      editValue=""
      focused={false}
      aria-label="When"
      onBeginEdit={() => {}}
      onChange={() => {}}
      onBlur={() => {}}
      onKeyDown={() => {}}
    />,
  );
  const idle = screen.getByLabelText('When');
  const date = idle.querySelector(`.${TT.timeDate}`);
  const time = idle.querySelector(`.${TT.time}`);
  expect(date).toHaveTextContent('2026-03-01');
  expect(time).toHaveTextContent('10:00:00.00');
  expect(date!.compareDocumentPosition(time!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('focused same-day if-differs still shows only time (no date expand on click)', () => {
  render(
    <DateTimeField
      valueMs={dayA}
      referenceMs={dayALater}
      dateDisplay="if-differs"
      editable
      editValue="2026-03-01 10:00:00.00"
      focused
      aria-label="When"
      onBeginEdit={() => {}}
      onChange={() => {}}
      onBlur={() => {}}
      onKeyDown={() => {}}
    />,
  );
  const input = screen.getByLabelText('When') as HTMLInputElement;
  expect(input.tagName).toBe('INPUT');
  expect(input.value).toBe('10:00:00.00');
  expect(input.value).not.toContain('2026-03-01');
});

test('focused different-day if-differs shows full date+time', () => {
  render(
    <DateTimeField
      valueMs={dayA}
      referenceMs={dayB}
      dateDisplay="if-differs"
      editable
      editValue="2026-03-01 10:00:00.00"
      focused
      aria-label="When"
      onBeginEdit={() => {}}
      onChange={() => {}}
      onBlur={() => {}}
      onKeyDown={() => {}}
    />,
  );
  const input = screen.getByLabelText('When') as HTMLInputElement;
  expect(input.value).toContain('2026-03-01');
  expect(input.value).toContain('10:00:00.00');
});

test('omitted referenceMs uses now as if-differs day', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 2, 1, 18, 0, 0));
  try {
    render(
      <DateTimeField
        valueMs={dayA}
        dateDisplay="if-differs"
        editable
        editValue=""
        focused={false}
        aria-label="When"
        onBeginEdit={() => {}}
        onChange={() => {}}
        onBlur={() => {}}
        onKeyDown={() => {}}
      />,
    );
    const idle = screen.getByLabelText('When');
    expect(idle.querySelector(`.${TT.time}`)).toHaveTextContent('10:00:00.00');
    expect(idle.querySelector(`.${TT.timeDate}`)).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});
