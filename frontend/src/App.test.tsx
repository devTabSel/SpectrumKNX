import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import App from './App';

// Mock the WebSocket hook
vi.mock('./hooks/useWebSocket', () => ({
  useWebSocket: () => ({
    isConnected: true,
    telegrams: [],
  }),
}));

// Mock fetch calls
vi.stubGlobal('fetch', vi.fn().mockImplementation(() =>
  Promise.resolve({
    json: () => Promise.resolve({}),
  })
));

test('renders app title', async () => {
  render(<App />);
  const titleElement = screen.getByText(/Spectrum KNX/i);
  expect(titleElement).toBeInTheDocument();
});

test('shows the five main-panel tabs with Telegram List active by default (#374)', async () => {
  render(<App />);
  const tabs = await screen.findAllByRole('tab');
  expect(tabs.map(t => t.getAttribute('title'))).toEqual([
    'Building Structure',
    'Telegram List',
    'Visualization',
    'Last Seen Values',
    'Statistics',
  ]);
  // 'list' is the default; every panel's close returns here.
  const list = screen.getByRole('tab', { name: 'Telegram List' });
  expect(list).toHaveAttribute('aria-selected', 'true');
});

test('the filter toggle lives with the Telegram List (#374)', async () => {
  render(<App />);
  expect(screen.queryByRole('button', { name: 'Focus panel toggle temporarily disabled' })).not.toBeInTheDocument();
});

test('the focus panel can be resized with the drag handle', () => {
  render(<App />);
  fireEvent.click(screen.getByTitle('Toggle Focus panel'));

  const handle = screen.getByTitle('Resize Focus panel');
  act(() => {
    fireEvent.mouseDown(handle, { clientX: 320 });
    fireEvent.mouseMove(window, { clientX: 380 });
    fireEvent.mouseUp(window);
  });

  const panel = screen.getByTestId('focus-panel-sidebar');
  expect(panel).toHaveStyle({ width: '260px' });
});
