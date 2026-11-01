import { useState } from 'react';
import { render, fireEvent, screen } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { readPanelScroll, restoredScrollTop, usePersistedScroll, writePanelScroll } from './usePersistedScroll';

beforeEach(() => {
  localStorage.clear();
});

test('a saved offset is restored once the list is tall enough, and scrolling stores the new place', () => {
  const observers: ResizeObserver[] = [];
  vi.stubGlobal('ResizeObserver', class {
    cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) {
      this.cb = cb;
      observers.push(this as unknown as ResizeObserver);
    }
    observe() { this.cb([], this as unknown as ResizeObserver); }
    disconnect() {}
  });

  writePanelScroll('filter', 480);
  const Scroller = () => {
    const ref = usePersistedScroll('filter');
    return <div ref={ref} data-testid="scroller" />;
  };
  const view = render(<Scroller />);
  const el = screen.getByTestId('scroller');
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 50 });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: 40 });
  (observers[0] as unknown as { cb: ResizeObserverCallback }).cb([], observers[0]);
  expect(el.scrollTop).toBe(10);

  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 2000 });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: 400 });
  (observers[0] as unknown as { cb: ResizeObserverCallback }).cb([], observers[0]);
  expect(el.scrollTop).toBe(480);

  el.scrollTop = 120;
  fireEvent.scroll(el);
  expect(readPanelScroll('filter')).toBe(120);
  el.scrollTop = 0;
  view.unmount();
  expect(readPanelScroll('filter')).toBe(120);
  vi.unstubAllGlobals();
});

test('switching the list keeps each list at its own offset', () => {
  vi.stubGlobal('ResizeObserver', class {
    cb: ResizeObserverCallback;
    constructor(cb: ResizeObserverCallback) { this.cb = cb; }
    observe() { this.cb([], this as unknown as ResizeObserver); }
    disconnect() {}
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get() { return 2000; } });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return 400; } });
  const Scroller = ({ list }: { list: string }) => {
    const ref = usePersistedScroll(list);
    return <div ref={ref} data-testid="scroller" />;
  };
  const Host = () => {
    const [list, setList] = useState('focus-ga');
    return (
      <>
        <button type="button" onClick={() => setList('focus-pa')}>sources</button>
        <Scroller list={list} />
      </>
    );
  };
  render(<Host />);
  const el = () => screen.getByTestId('scroller');

  el().scrollTop = 300;
  fireEvent.scroll(el());
  fireEvent.click(screen.getByRole('button', { name: 'sources' }));
  expect(readPanelScroll('focus-ga')).toBe(300);
  expect(el().scrollTop).toBe(0);

  el().scrollTop = 80;
  fireEvent.scroll(el());
  expect(readPanelScroll('focus-pa')).toBe(80);
  delete (HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
  delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
  vi.unstubAllGlobals();
});

test('an empty list does not count as restored', () => {
  expect(restoredScrollTop(400, 0, 0)).toBeNull();
  expect(restoredScrollTop(400, 1000, 200)).toBe(400);
  expect(restoredScrollTop(900, 500, 200)).toBe(300);
  expect(restoredScrollTop(0, 1000, 200)).toBe(0);
});
