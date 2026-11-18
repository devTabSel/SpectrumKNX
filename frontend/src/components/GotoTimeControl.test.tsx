import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { format } from 'date-fns';
import { GotoTimeControl } from './GotoTimeControl';

afterEach(() => {
  vi.restoreAllMocks();
});

const seed = new Date('2026-07-20T14:30:15').getTime();

function openAnchor() {
  fireEvent.click(screen.getByRole('button', { name: 'Go to time' }));
  return screen.getByRole('button', { name: 'Target time' });
}

/** The anchor button is the control; click it to edit. */
function editTarget() {
  fireEvent.click(openAnchor());
  return screen.getByLabelText('Target time');
}

test('opens a popover seeded with the newest telegram time', () => {
  render(<GotoTimeControl seedMs={seed} onGoto={() => {}} />);

  expect(screen.queryByRole('button', { name: 'Target time' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Go' })).not.toBeInTheDocument();

  const anchor = openAnchor();
  expect(screen.getByRole('button', { name: 'Go' })).toBeEnabled();
  // Seeded to the newest telegram time. if-differs may hide the date.
  expect(anchor.textContent).toContain(format(seed, 'HH:mm:ss'));
  if (/\d{4}-\d{2}-\d{2}/.test(anchor.textContent ?? '')) {
    expect(anchor.textContent).toContain(format(seed, 'yyyy-MM-dd'));
  }
});

test('the anchor button opens the editor and Enter submits', () => {
  const onGoto = vi.fn();
  render(<GotoTimeControl seedMs={seed} onGoto={onGoto} />);

  const input = editTarget();
  expect(input.tagName).toBe('INPUT');
  fireEvent.change(input, { target: { value: '2026-07-20T09:05:00' } });
  fireEvent.keyDown(input, { key: 'Enter' });

  expect(onGoto).toHaveBeenCalledTimes(1);
  expect(onGoto).toHaveBeenCalledWith(new Date('2026-07-20T09:05:00').getTime());
  expect(screen.queryByRole('button', { name: 'Target time' })).not.toBeInTheDocument();
});

test('Enter in the input submits the time', () => {
  const onGoto = vi.fn();
  render(<GotoTimeControl seedMs={seed} onGoto={onGoto} />);

  const input = editTarget();
  fireEvent.change(input, { target: { value: '2026-07-20T10:00:00' } });
  fireEvent.keyDown(input, { key: 'Enter' });

  expect(onGoto).toHaveBeenCalledWith(new Date('2026-07-20T10:00:00').getTime());
});

test('blur submits the entered time', () => {
  const onGoto = vi.fn();
  render(<GotoTimeControl seedMs={seed} onGoto={onGoto} />);
  const input = editTarget();
  fireEvent.change(input, { target: { value: '2026-07-20T08:00:00' } });
  fireEvent.blur(input);
  expect(onGoto).toHaveBeenCalledWith(new Date('2026-07-20T08:00:00').getTime());
});

test('Escape in the field closes without submitting', () => {
  const onGoto = vi.fn();
  render(<GotoTimeControl seedMs={seed} onGoto={onGoto} />);
  const input = editTarget();
  fireEvent.change(input, { target: { value: '2026-07-20T08:00:00' } });
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(onGoto).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Target time' })).not.toBeInTheDocument();
});

test('Escape closes the popover without submitting', () => {
  const onGoto = vi.fn();
  render(<GotoTimeControl seedMs={seed} onGoto={onGoto} />);

  openAnchor();
  expect(screen.getByRole('button', { name: 'Go' })).toBeInTheDocument();

  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('button', { name: 'Target time' })).not.toBeInTheDocument();
  expect(onGoto).not.toHaveBeenCalled();
});

test('an outside time loads on Enter', () => {
  const onGoto = vi.fn();
  const oldest = new Date('2026-07-20T08:00:00').getTime();
  const newest = new Date('2026-07-20T12:00:00').getTime();
  render(
    <GotoTimeControl seedMs={newest} oldestMs={oldest} newestMs={newest} onGoto={onGoto} />,
  );
  const input = editTarget();
  fireEvent.change(input, { target: { value: '2026-07-20T07:00:00' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onGoto).toHaveBeenCalledWith(new Date('2026-07-20T07:00:00').getTime(), { load: true });
});

test('a history time outside the loaded span does not load', () => {
  const onGoto = vi.fn();
  render(
    <GotoTimeControl
      seedMs={seed}
      oldestMs={seed - 60_000}
      newestMs={seed}
      scope="history"
      onGoto={onGoto}
    />,
  );
  const input = editTarget();
  fireEvent.change(input, { target: { value: '2026-07-20T01:00:00' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(onGoto).not.toHaveBeenCalled();
});

test('the endSlot goto button submits the seeded time', () => {
  const onGoto = vi.fn();
  render(<GotoTimeControl seedMs={seed} onGoto={onGoto} />);
  openAnchor();
  fireEvent.click(screen.getByRole('button', { name: 'Go' }));
  expect(onGoto).toHaveBeenCalledTimes(1);
  expect(onGoto.mock.calls[0][0]).toBe(new Date('2026-07-20T14:30:15').getTime());
});

test('an empty seed shows the anchor placeholder and disables Go', () => {
  render(<GotoTimeControl seedMs={null} onGoto={() => {}} />);

  const anchor = openAnchor();
  expect(screen.getByRole('button', { name: 'Go' })).toBeDisabled();
  expect(anchor).toHaveTextContent('Target time');
});
