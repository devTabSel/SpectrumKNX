import { render, screen, fireEvent } from '@testing-library/react';
import { expect, test, beforeEach } from 'vitest';
import { ResizablePane } from './ResizablePane';

const KEY = 'test-pane-width';
const STORED = `spectrum-knx.${KEY}`;
const HANDLE = 'Drag to resize · double-click to reset';

beforeEach(() => localStorage.clear());

const pane = () => screen.getByText('content').parentElement!;

const drag = (fromX: number, toX: number) => {
  fireEvent.mouseDown(screen.getByTitle(HANDLE), { clientX: fromX });
  fireEvent.mouseMove(document, { clientX: toX });
  fireEvent.mouseUp(document);
};

test('uses the responsive default width until resized', () => {
  render(<ResizablePane open prefKey={KEY}><span>content</span></ResizablePane>);
  expect(pane().style.width).toBe('clamp(260px, 18vw, 340px)');
});

test('dragging the handle resizes the pane and remembers the width (#447)', () => {
  window.innerWidth = 1500;
  render(<ResizablePane open prefKey={KEY}><span>content</span></ResizablePane>);
  // jsdom measures the pane as 0px wide, so the drag distance is the new width.
  drag(300, 720);
  expect(pane().style.width).toBe('420px');
  expect(localStorage.getItem(STORED)).toBe('420');
});

test('a remembered width is restored', () => {
  localStorage.setItem(STORED, '480');
  render(<ResizablePane open prefKey={KEY}><span>content</span></ResizablePane>);
  expect(pane().style.width).toBe('480px');
});

test('double-click resets to the default', () => {
  localStorage.setItem(STORED, '480');
  render(<ResizablePane open prefKey={KEY}><span>content</span></ResizablePane>);
  fireEvent.doubleClick(screen.getByTitle(HANDLE));
  expect(pane().style.width).toBe('clamp(260px, 18vw, 340px)');
  expect(localStorage.getItem(STORED)).toBe('');
});

test('a closed pane collapses and offers no handle', () => {
  render(<ResizablePane open={false} prefKey={KEY}><span>content</span></ResizablePane>);
  expect(pane().parentElement!.style.width).toBe('0px');
  expect(screen.queryByTitle(HANDLE)).not.toBeInTheDocument();
});

test('a closed pane is inert so its controls are not tab-focusable', () => {
  const { rerender } = render(
    <ResizablePane open={false} prefKey={KEY}>
      <button type="button">inside</button>
    </ResizablePane>,
  );
  const closed = screen.getByRole('button', { name: 'inside', hidden: true }).parentElement!;
  expect(closed).toHaveAttribute('inert');
  expect(closed).toHaveAttribute('aria-hidden', 'true');

  rerender(
    <ResizablePane open prefKey={KEY}>
      <button type="button">inside</button>
    </ResizablePane>,
  );
  const openInner = screen.getByRole('button', { name: 'inside' }).parentElement!;
  expect(openInner).not.toHaveAttribute('inert');
  expect(openInner).not.toHaveAttribute('aria-hidden');
  screen.getByRole('button', { name: 'inside' }).focus();
  expect(screen.getByRole('button', { name: 'inside' })).toHaveFocus();
});
