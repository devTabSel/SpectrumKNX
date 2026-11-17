import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import React from 'react';
import App from './App';
import { makeTelegram } from './test/telegramFactory';
import { readMonitorViewPref, writeMonitorViewPref } from './utils/monitorView';
import { getPref } from './utils/prefs';
import { readSortConfigPref, writeSortConfigPref } from './utils/sortConfig';

// Mock the WebSocket hook
vi.mock('./hooks/useWebSocket', () => ({
  useWebSocket: () => {
    const [, bump] = React.useState(0);
    React.useEffect(() => {
      const notify = () => bump(n => n + 1);
      wsCtl.bump.add(notify);
      return () => { wsCtl.bump.delete(notify); };
    }, []);
    return {
      isConnected: wsCtl.connected,
      telegrams: [],
    };
  },
}));

/** Test handle into the mocked cache: inject live telegrams, observe reveals. */
const cacheCtl = vi.hoisted(() => ({
  addLive: null as null | ((t: { timestamp: string }) => void),
  revealCalls: [] as number[],
  /** Per-test hook run on every reveal (e.g. to simulate the row pin). */
  onReveal: null as null | ((n: number) => void),
  loadRangeCalls: [] as [number, number][],
  fillForwardCalls: [] as number[],
  retainCalls: [] as [number, number][],
  fillingGaps: false,
  setFillingGaps: null as null | ((v: boolean) => void),
}));

/** Controllable socket so the pill can show Offline. */
const wsCtl = vi.hoisted(() => ({
  connected: true,
  bump: new Set<() => void>(),
}));

/** Controllable cache so pause/clear tests can leave the empty-buffer lock. */
vi.mock('./hooks/useTelegramCache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./hooks/useTelegramCache')>();
  return {
    ...actual,
    useTelegramCache: () => {
      const [telegrams, setTelegrams] = React.useState(() => [makeTelegram({ raw_hex: '0xseed' })]);
      const [fillingGaps, setFillingGaps] = React.useState(cacheCtl.fillingGaps);
      cacheCtl.setFillingGaps = setFillingGaps;
      const [pausedCount, setPausedCount] = React.useState(0);
      const pausedRef = React.useRef(false);
      const backlogRef = React.useRef<ReturnType<typeof makeTelegram>[]>([]);
      const addLive = (t: ReturnType<typeof makeTelegram>) => {
        if (pausedRef.current) {
          backlogRef.current.push(t);
          setPausedCount(c => c + 1);
        } else {
          setTelegrams(prev => [t, ...prev]);
        }
      };
      cacheCtl.addLive = addLive as (t: { timestamp: string }) => void;
      // Newest first, like the real cache; re-read whenever the count changes.
      const pausedTelegrams = React.useMemo(
        () => backlogRef.current.slice().reverse(),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [pausedCount],
      );
      return {
        telegrams,
        addLive,
        setConnected: () => {},
        fillingGaps,
        setPaused: (paused: boolean) => {
          if (pausedRef.current === paused) return;
          pausedRef.current = paused;
          setPausedCount(0);
          if (!paused && backlogRef.current.length > 0) {
            const batch = backlogRef.current;
            backlogRef.current = [];
            setTelegrams(prev => [...batch, ...prev]);
          }
        },
        pausedCount,
        pausedTelegrams,
        revealPaused: (n: number) => {
          cacheCtl.revealCalls.push(n);
          if (!pausedRef.current || n <= 0) return backlogRef.current.length;
          const batch = backlogRef.current.splice(0, n);
          cacheCtl.onReveal?.(batch.length);
          if (batch.length > 0) setTelegrams(prev => [...batch.reverse(), ...prev]);
          const remaining = backlogRef.current.length;
          setPausedCount(remaining);
          return remaining;
        },
        loadRange: async (start: number, end: number) => {
          cacheCtl.loadRangeCalls.push([start, end]);
        },
        fillForwardFrom: async (start: number) => {
          cacheCtl.fillForwardCalls.push(start);
        },
        fillBackwardTo: async () => {},
        oldestTs: telegrams.length > 0
          ? new Date(telegrams[telegrams.length - 1].timestamp).getTime()
          : null,
        newestTs: telegrams.length > 0
          ? new Date(telegrams[0].timestamp).getTime()
          : null,
        isLoading: false,
        loadError: null,
        clear: async () => {
          backlogRef.current = [];
          setPausedCount(0);
          setTelegrams([]);
        },
        cancelLoad: () => {},
        setEvictionMode: () => {},
        bufferAnchor: { direction: 'backward' as const, ts: null },
        setBufferAnchor: () => {},
        adoptAnchorDirection: () => {},
        setBufferRangeMinutes: () => {},
        trimToTimeWindow: () => {},
        enforceTimeWindow: () => {},
        retainPausedInWindow: (min: number, max: number) => {
          cacheCtl.retainCalls.push([min, max]);
          const lo = Math.min(min, max);
          const hi = Math.max(min, max);
          setTelegrams(prev => prev.filter(t => {
            const ts = new Date(t.timestamp).getTime();
            return ts >= lo && ts <= hi;
          }));
        },
        publishBuffer: () => {},
      };
    },
  };
});

// Mock fetch calls
vi.stubGlobal('fetch', vi.fn().mockImplementation(() =>
  Promise.resolve({
    json: () => Promise.resolve({}),
  })
));

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  cacheCtl.revealCalls.length = 0;
  cacheCtl.loadRangeCalls.length = 0;
  cacheCtl.fillForwardCalls.length = 0;
  cacheCtl.retainCalls.length = 0;
  cacheCtl.fillingGaps = false;
  cacheCtl.setFillingGaps = null;
  wsCtl.connected = true;
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() =>
    Promise.resolve({
      json: () => Promise.resolve({}),
    })
  ));
});

function setWsConnected(connected: boolean) {
  wsCtl.connected = connected;
  act(() => {
    for (const notify of wsCtl.bump) notify();
  });
}

test('renders app title', async () => {
  render(<App />);
  const titleElement = screen.getByText(/Spectrum KNX/i);
  expect(titleElement).toBeInTheDocument();
});

test('shows the five main-panel tabs with Telegram List active by default (#374)', async () => {
  render(<App />);
  const tabs = await screen.findAllByRole('tab');
  expect(tabs.map(t => t.getAttribute('title'))).toEqual([
    'Telegram List',
    'Visualization',
    'Statistics',
    'Building Structure',
    'Last Seen Values',
  ]);
  // 'list' is the default; every panel's close returns here.
  const list = screen.getByRole('tab', { name: 'Telegram List' });
  expect(list).toHaveAttribute('aria-selected', 'true');
});

test('play/pause and the filter toggle live with the Telegram List (#374)', async () => {
  render(<App />);
  // Both sit in the monitor table toolbar: filter on the left, pill in the center.
  const playing = await screen.findByRole('button', { name: 'Playing' });
  const filter = screen.getByRole('button', { name: 'Toggle filter panel' });
  const bar = playing.closest('[data-tt-header]');
  expect(bar).toBeTruthy();
  expect(bar!.closest('[data-telegram-table]')).toBeTruthy();
  expect(playing.closest('[data-tt-header-center]')).toBe(bar!.querySelector('[data-tt-header-center]'));
  expect(filter.closest('[data-tt-header-leading]')).toBe(bar!.querySelector('[data-tt-header-leading]'));
  expect(document.querySelector('[data-app-header]')!.contains(playing)).toBe(false);
  expect(document.querySelector('[data-app-header]')!.querySelector('[data-buffer-status-pill]')).toBeNull();
});

test('history tab keeps its range bar and does not show the monitor buffer pill', async () => {
  render(<App />);
  expect(await screen.findByRole('button', { name: 'Playing' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Group Monitor' }));
  fireEvent.click(screen.getByRole('button', { name: 'History Search' }));
  expect(await screen.findByLabelText('History range')).toBeInTheDocument();
  expect(screen.getByLabelText('History load limit')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reload history' })).toBeInTheDocument();
  expect(screen.queryByLabelText('Buffer range')).not.toBeInTheDocument();
  expect(document.querySelector('[data-buffer-status-pill]')).toBeNull();
  expect(document.querySelector('[data-tt-header]')).toBeNull();
});

test('manual pause latches as Paused manually', async () => {
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Playing' }));
  expect(screen.getByRole('button', { name: 'Paused manually' })).toBeInTheDocument();
});

test('newer pill does not leave manual pause', async () => {
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Playing' }));
  await act(async () => {
    cacheCtl.addLive!(makeTelegram({
      timestamp: new Date().toISOString(),
      raw_hex: '0xmanual',
    }));
  });
  const revealsBefore = cacheCtl.revealCalls.length;
  fireEvent.click(screen.getByRole('button', { name: '1 newer telegram' }));
  expect(screen.getByRole('button', { name: 'Paused manually' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /newer telegram/ })).not.toBeInTheDocument();
  expect(cacheCtl.revealCalls.slice(revealsBefore)).toEqual([1]);
});

test('ctrl-click on the newer pill leaves manual pause and flushes the backlog', async () => {
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Playing' }));
  await act(async () => {
    cacheCtl.addLive!(makeTelegram({
      timestamp: new Date().toISOString(),
      raw_hex: '0xctrl',
    }));
  });
  fireEvent.click(screen.getByRole('button', { name: '1 newer telegram' }), { ctrlKey: true });
  expect(screen.getByRole('button', { name: 'Playing' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '1 newer telegram' })).not.toBeInTheDocument();
});

test('Pause icon toggles Paused manually ↔ Paused automatically', async () => {
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Playing' }));
  expect(screen.getByRole('button', { name: 'Paused manually' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Paused manually' }));
  expect(screen.getByRole('button', { name: 'Paused automatically' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Paused automatically' }));
  expect(screen.getByRole('button', { name: 'Paused manually' })).toBeInTheDocument();
});

test('auto-pause backlog is fed in slices by fill-axis wheels and resumes playing once drained', async () => {
  cacheCtl.revealCalls.length = 0;
  const { container } = render(<App />);
  expect(await screen.findByRole('button', { name: 'Playing' })).toBeInTheDocument();
  const port = container.querySelector('.custom-scrollbar') as HTMLElement;
  // jsdom has no layout: give the scrollport a real range so edge / rubber
  // zone checks behave (scrollTop 60 is "at the live edge", not overscrolled).
  Object.defineProperty(port, 'scrollHeight', { configurable: true, get: () => 2000 });
  Object.defineProperty(port, 'clientHeight', { configurable: true, get: () => 800 });
  // Let the mount-time scrollToEdge's programmatic mark expire.
  await act(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

  // Scrolling away from the live edge unfollows → auto pause.
  await act(async () => {
    port.scrollTop = 500;
    fireEvent.scroll(port);
  });
  expect(screen.getByRole('button', { name: 'Paused automatically' })).toBeInTheDocument();

  // Five telegrams arrive into the frozen snapshot.
  const base = Date.now();
  await act(async () => {
    for (let i = 0; i < 5; i++) {
      cacheCtl.addLive!(makeTelegram({ timestamp: new Date(base + i * 1000).toISOString(), raw_hex: `0xb${i}` }));
    }
  });
  expect(screen.getByRole('button', { name: '5 newer telegrams' })).toBeInTheDocument();

  // Back at the live edge, a small wheel toward newer reveals a slice (not all).
  await act(async () => {
    port.scrollTop = 60;
    fireEvent.scroll(port);
  });
  await act(async () => {
    fireEvent.wheel(port, { deltaY: -5 });
  });
  expect(cacheCtl.revealCalls).toEqual([2]);
  expect(screen.getByRole('button', { name: 'Paused automatically' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '3 newer telegrams' })).toBeInTheDocument();

  // Further slices drain the backlog; the last one resumes playing.
  await act(async () => {
    fireEvent.wheel(port, { deltaY: -5 });
  });
  expect(cacheCtl.revealCalls).toEqual([2, 2]);
  expect(screen.getByRole('button', { name: 'Paused automatically' })).toBeInTheDocument();
  await act(async () => {
    fireEvent.wheel(port, { deltaY: -5 });
  });
  expect(cacheCtl.revealCalls).toEqual([2, 2, 1]);
  expect(screen.getByRole('button', { name: 'Playing' })).toBeInTheDocument();
});

test('manual → auto pause with the fill spacer on screen reveals one backlog row, not the whole backlog', async () => {
  cacheCtl.revealCalls.length = 0;
  const { container } = render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Playing' }));
  expect(screen.getByRole('button', { name: 'Paused manually' })).toBeInTheDocument();
  const port = container.querySelector('.custom-scrollbar') as HTMLElement;
  Object.defineProperty(port, 'scrollHeight', { configurable: true, get: () => 2000 });
  Object.defineProperty(port, 'clientHeight', { configurable: true, get: () => 800 });
  // jsdom rows have no height, so the table's pin is a no-op: simulate it by
  // moving scrollTop by the height of the rows prepended above the edge row.
  cacheCtl.onReveal = n => { port.scrollTop += n * 85; };
  await act(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

  const base = Date.now();
  await act(async () => {
    for (let i = 0; i < 3; i++) {
      cacheCtl.addLive!(makeTelegram({ timestamp: new Date(base + i * 1000).toISOString(), raw_hex: `0xm${i}` }));
    }
  });
  expect(screen.getByRole('button', { name: '3 newer telegrams' })).toBeInTheDocument();

  // Fill spacer fully on screen: manual pause holds it (labels, no reveal).
  await act(async () => {
    port.scrollTop = 0;
    fireEvent.scroll(port);
  });
  expect(screen.getByTestId('fill-rubber-pause-label')).toHaveTextContent('...paused manually...');
  expect(cacheCtl.revealCalls).toEqual([]);

  // Switching to auto pause fills the slot with the oldest backlog row only.
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Paused manually' }));
  });
  try {
    expect(screen.getByRole('button', { name: 'Paused automatically' })).toBeInTheDocument();
    expect(cacheCtl.revealCalls).toEqual([1]);
    expect(screen.getByRole('button', { name: '2 newer telegrams' })).toBeInTheDocument();
    // The previous edge row kept its place: no snap to the settled edge.
    expect(port.scrollTop).toBe(85);
  } finally {
    cacheCtl.onReveal = null;
  }
});

test('ctrl-clicking buffer clear does not pause and keeps the anchor telegram', async () => {
  render(<App />);
  expect(await screen.findByRole('button', { name: 'Playing' })).toBeInTheDocument();
  await act(async () => {
    fireEvent.click(screen.getByTitle(/Clear \(also wipes the local telegram cache\)/), { ctrlKey: true });
  });
  // Clear parks the captured edge as a fixed anchor → auto-pause icon.
  const parked = await screen.findByRole('button', { name: 'Paused automatically' });
  expect(parked).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Playing' })).not.toBeInTheDocument();
  expect(screen.queryByText('No data available.')).not.toBeInTheDocument();
  expect(screen.getByLabelText('1 in buffer and backlog')).toBeInTheDocument();
});

test('clearing the buffer latches auto pause and collapses onto the anchor', async () => {
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Playing' }));
  expect(screen.getByRole('button', { name: 'Paused manually' })).toBeInTheDocument();
  cacheCtl.loadRangeCalls.length = 0;
  cacheCtl.retainCalls.length = 0;
  await act(async () => {
    fireEvent.click(screen.getByTitle(/Clear \(also wipes the local telegram cache\)/));
  });
  const paused = await screen.findByRole('button', { name: 'Paused automatically' });
  expect(paused).toBeEnabled();
  const seedMs = new Date('2024-01-01T10:00:00.000000Z').getTime();
  expect(cacheCtl.retainCalls).toEqual([[seedMs, seedMs]]);
  expect(cacheCtl.loadRangeCalls).toEqual([]);
  expect(screen.queryByText('No data available.')).not.toBeInTheDocument();
  expect(screen.getByLabelText('1 in buffer and backlog')).toBeInTheDocument();
  expect(screen.getByLabelText('Newest telegram in buffer').textContent).toMatch(/\d{2}:\d{2}:\d{2}/);
  expect(screen.getByLabelText('Oldest telegram in buffer').textContent).toMatch(/\d{2}:\d{2}:\d{2}/);
});

test('clear keeps the anchor telegram and shows later arrivals on the newer pill', async () => {
  render(<App />);
  await screen.findByRole('button', { name: 'Playing' });
  cacheCtl.loadRangeCalls.length = 0;
  cacheCtl.fillForwardCalls.length = 0;
  await act(async () => {
    fireEvent.click(screen.getByTitle(/Clear \(also wipes the local telegram cache\)/));
  });
  expect(cacheCtl.loadRangeCalls).toEqual([]);
  expect(cacheCtl.fillForwardCalls).toEqual([]);
  expect(screen.queryByText('No data available.')).not.toBeInTheDocument();
  expect(screen.getByLabelText('1 in buffer and backlog')).toBeInTheDocument();
  expect(screen.getByLabelText('Newest telegram in buffer').textContent).toMatch(/\d{2}:\d{2}:\d{2}/);
  expect(screen.getByLabelText('Oldest telegram in buffer').textContent).toMatch(/\d{2}:\d{2}:\d{2}/);
  await act(async () => {
    cacheCtl.addLive!(makeTelegram({
      timestamp: new Date().toISOString(),
      raw_hex: '0xafter',
      target_name: 'after-clear',
    }));
  });
  expect(screen.getByRole('button', { name: '1 newer telegram' })).toBeInTheDocument();
  expect(screen.queryByText('after-clear')).not.toBeInTheDocument();
});

test('changing load limit refills from the direction anchor', async () => {
  render(<App />);
  const seedMs = new Date('2024-01-01T10:00:00.000000Z').getTime();
  cacheCtl.loadRangeCalls.length = 0;
  const limit = screen.getByLabelText('Load limit');
  fireEvent.change(limit, { target: { value: '2000' } });
  await act(async () => {
    fireEvent.blur(limit);
  });
  await waitFor(() => {
    expect(cacheCtl.loadRangeCalls.length).toBeGreaterThan(0);
  });
  const [start, end] = cacheCtl.loadRangeCalls[cacheCtl.loadRangeCalls.length - 1];
  expect(end).toBe(seedMs);
  expect(start).toBe(seedMs - 60 * 60_000);
});

test('companion mode warns while Home Assistant\'s store holds pre-UTC timestamps (#462)', async () => {
  const fetchMock = vi.mocked(fetch);
  const original = fetchMock.getMockImplementation();
  const respondWith = (legacy: boolean) =>
    fetchMock.mockImplementation(((url: string) =>
      Promise.resolve({
        json: () => Promise.resolve(
          String(url).includes('/api/server/config')
            ? { mode: 'companion', status: { connected: true, write_enabled: false, legacy_timestamps: legacy } }
            : {},
        ),
      })) as unknown as typeof fetch);

  try {
    respondWith(true);
    const first = render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/Telegram times may be wrong/);
    first.unmount();

    respondWith(false);
    render(<App />);
    await screen.findAllByRole('tab');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  } finally {
    fetchMock.mockImplementation(original!);
  }
});

test('Back and Forward step through panel changes', async () => {
  window.history.replaceState(null, '', '/');
  render(<App />);
  const selected = () => screen.getAllByRole('tab').find(t => t.getAttribute('aria-selected') === 'true')?.getAttribute('title');
  await screen.findAllByRole('tab');
  // Let the first sync pass: it only tidies the URL and adds no entry.
  await act(() => new Promise(r => setTimeout(r, 600)));
  const start = window.history.length;

  fireEvent.click(screen.getByRole('tab', { name: 'Visualization' }));
  await waitFor(() => expect(window.location.search).toContain('panel=visualizer'), { timeout: 2000 });
  fireEvent.click(screen.getByRole('tab', { name: 'Last Seen Values' }));
  await waitFor(() => expect(window.location.search).toContain('panel=lastseen'), { timeout: 2000 });
  expect(window.history.length).toBe(start + 2);

  act(() => window.history.back());
  await waitFor(() => expect(selected()).toBe('Visualization'));
  act(() => window.history.back());
  await waitFor(() => expect(selected()).toBe('Telegram List'));
  expect(window.location.search).toBe('');

  act(() => window.history.forward());
  await waitFor(() => expect(selected()).toBe('Visualization'));
  // Navigating must not have pushed anything itself.
  expect(window.history.length).toBe(start + 2);
});

test('a bare URL starts live and does not load an anchor window', async () => {
  render(<App />);
  expect(await screen.findByRole('button', { name: 'Reading backward' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Playing' })).toBeInTheDocument();
  expect(cacheCtl.loadRangeCalls).toEqual([]);
  expect(cacheCtl.fillForwardCalls).toEqual([]);
});

test('a saved anchor loads from that timestamp and restores pause mode', async () => {
  writeMonitorViewPref({
    direction: 'backward',
    anchorTs: 1_700_000_000_000,
    follow: true,
    pauseMode: 'auto',
  });
  render(<App />);
  await waitFor(() => {
    expect(cacheCtl.loadRangeCalls).toEqual([[1_700_000_000_000 - 60 * 60_000, 1_700_000_000_000]]);
  });
  expect(cacheCtl.fillForwardCalls).toEqual([]);
  expect(screen.getByRole('button', { name: 'Paused automatically' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reading backward' })).toBeInTheDocument();
});

test('the monitor URL wins over prefs for direction, anchor and range', async () => {
  writeMonitorViewPref({
    direction: 'backward',
    anchorTs: null,
    follow: false,
    pauseMode: 'manual',
  });
  writeSortConfigPref([{ key: 'timestamp', direction: 'desc' }]);
  window.history.replaceState(null, '', '/?view=monitor&rd=forward&anchor=5000&range=15');
  render(<App />);
  await waitFor(() => expect(cacheCtl.fillForwardCalls).toEqual([5000]));
  expect(cacheCtl.loadRangeCalls).toEqual([]);
  expect(screen.getByRole('button', { name: 'Reading forward' })).toBeInTheDocument();
  // Forward has no pause. The preference's manual latch is normalized away.
  const play = screen.getByRole('button', { name: 'Play' });
  expect(play).toBeEnabled();
  expect(play).toHaveStyle({ color: 'var(--accent-primary)' });
  expect(screen.queryByRole('button', { name: 'Paused manually' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Playing' })).not.toBeInTheDocument();
  await waitFor(() => expect(getPref('bufferRangeMinutes')).toBe('15'));
  await waitFor(() => {
    expect(readMonitorViewPref()).toMatchObject({
      direction: 'forward',
      anchorTs: 5000,
      follow: false,
      pauseMode: 'off',
    });
  });
  expect(readSortConfigPref()).toEqual([{ key: 'timestamp', direction: 'desc' }]);
});

test('a restored direction keeps the sort preference', async () => {
  writeSortConfigPref([{ key: 'source_address', direction: 'asc' }]);
  writeMonitorViewPref({
    direction: 'forward',
    anchorTs: null,
    follow: true,
    pauseMode: 'playing',
  });
  render(<App />);
  expect(await screen.findByRole('button', { name: 'Reading forward' })).toBeInTheDocument();
  expect(readSortConfigPref()).toEqual([{ key: 'source_address', direction: 'asc' }]);
});

test('toggling the filter pane updates the URL without a history entry', async () => {
  window.history.replaceState(null, '', '/');
  render(<App />);
  const toggle = await screen.findByRole('button', { name: 'Toggle filter panel' });
  await act(() => new Promise(r => setTimeout(r, 600)));
  const start = window.history.length;

  fireEvent.click(toggle);
  await waitFor(() => expect(window.location.search).toContain('fp=0'), { timeout: 2000 });
  expect(window.history.length).toBe(start);
});

test('a saved forward playing view starts as a blue Play', async () => {
  writeMonitorViewPref({
    direction: 'forward',
    anchorTs: null,
    follow: true,
    pauseMode: 'playing',
  });
  render(<App />);
  const play = await screen.findByRole('button', { name: 'Play' });
  expect(play).toBeEnabled();
  expect(play).toHaveAttribute('title', 'Jetzt auf die Gegenseite');
  expect(screen.queryByRole('button', { name: 'Playing' })).not.toBeInTheDocument();
  await waitFor(() => {
    expect(readMonitorViewPref()).toMatchObject({
      direction: 'forward',
      follow: false,
      pauseMode: 'off',
    });
  });
});

test('forward Play writes now on the edge opposite the anchor and starts the fill', async () => {
  writeMonitorViewPref({
    direction: 'forward',
    anchorTs: null,
    follow: true,
    pauseMode: 'manual',
  });
  render(<App />);
  const play = await screen.findByRole('button', { name: 'Play' });
  expect(play).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Paused manually' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Playing' })).not.toBeInTheDocument();

  await act(async () => {
    cacheCtl.addLive!(makeTelegram({
      timestamp: '2024-06-01T12:00:00.000000Z',
      source_address: '1.2.77',
      raw_hex: '0xforward',
    }));
  });
  expect(screen.queryByRole('button', { name: /newer telegram/ })).not.toBeInTheDocument();

  const before = Date.now();
  cacheCtl.fillForwardCalls.length = 0;
  cacheCtl.loadRangeCalls.length = 0;
  fireEvent.click(play);
  const seedMs = new Date('2024-01-01T10:00:00.000000Z').getTime();
  await waitFor(() => {
    expect(cacheCtl.fillForwardCalls).toEqual([seedMs]);
  });
  expect(cacheCtl.loadRangeCalls).toEqual([]);
  expect(screen.getByRole('button', { name: 'Play' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Reading forward' })).toBeInTheDocument();
  const newest = screen.getByLabelText('Newest telegram in buffer');
  const title = newest.getAttribute('title') ?? '';
  const match = title.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{2})/);
  expect(match).not.toBeNull();
  const [, y, mo, d, h, mi, s, cs] = match!;
  const shown = new Date(+y, +mo - 1, +d, +h, +mi, +s, +cs * 10).getTime();
  expect(shown).toBeGreaterThanOrEqual(before - 10);
  expect(shown).toBeLessThanOrEqual(Date.now());
  await waitFor(() => {
    expect(readMonitorViewPref()).toMatchObject({
      direction: 'forward',
      anchorTs: null,
      follow: false,
      pauseMode: 'off',
    });
  });
});

test('popstate normalizes a forward view that was playing and leaves the sort', async () => {
  writeSortConfigPref([{ key: 'timestamp', direction: 'desc' }]);
  render(<App />);
  expect(await screen.findByRole('button', { name: 'Playing' })).toBeInTheDocument();
  await act(() => new Promise(r => setTimeout(r, 600)));

  window.history.pushState(null, '', '/?view=monitor&rd=forward&anchor=9000');
  act(() => window.dispatchEvent(new PopStateEvent('popstate')));

  expect(await screen.findByRole('button', { name: 'Play' })).toBeEnabled();
  await waitFor(() => {
    expect(readMonitorViewPref()).toMatchObject({
      direction: 'forward',
      anchorTs: 9000,
      follow: false,
      pauseMode: 'off',
    });
  });
  expect(readSortConfigPref()).toEqual([{ key: 'timestamp', direction: 'desc' }]);
});

test('the direction chevron does not change the sort', async () => {
  writeSortConfigPref([{ key: 'timestamp', direction: 'desc' }]);
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Reading backward' }));
  expect(await screen.findByRole('button', { name: 'Reading forward' })).toBeInTheDocument();
  expect(readSortConfigPref()).toEqual([{ key: 'timestamp', direction: 'desc' }]);
});

test('fast-forward from forward leaves manual pause behind and goes live', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/database/info')) {
      return {
        ok: true,
        json: async () => ({
          oldest_timestamp: '2020-01-01T00:00:00.000Z',
          newest_timestamp: '2024-06-01T00:00:00.000Z',
        }),
      };
    }
    return { ok: true, json: async () => ({}) };
  }));
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Playing' }));
  expect(screen.getByRole('button', { name: 'Paused manually' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Load from oldest telegram in database' }));
  expect(await screen.findByRole('button', { name: 'Play' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Load up to newest telegram in database' }));
  expect(await screen.findByRole('button', { name: 'Playing' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reading backward' })).toBeInTheDocument();
  await waitFor(() => {
    expect(readMonitorViewPref()).toMatchObject({
      direction: 'backward',
      anchorTs: null,
      follow: true,
      pauseMode: 'playing',
    });
  });
});

test('rewind and fast-forward change direction without changing the sort', async () => {
  writeSortConfigPref([{ key: 'source_address', direction: 'asc' }]);
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/database/info')) {
      return {
        ok: true,
        json: async () => ({
          oldest_timestamp: '2020-01-01T00:00:00.000Z',
          newest_timestamp: '2024-06-01T00:00:00.000Z',
        }),
      };
    }
    return { ok: true, json: async () => ({}) };
  }));
  render(<App />);
  await screen.findByRole('button', { name: 'Reading backward' });
  fireEvent.click(screen.getByRole('button', { name: 'Load from oldest telegram in database' }));
  expect(await screen.findByRole('button', { name: 'Reading forward' })).toBeInTheDocument();
  expect(readSortConfigPref()).toEqual([{ key: 'source_address', direction: 'asc' }]);

  fireEvent.click(screen.getByRole('button', { name: 'Load up to newest telegram in database' }));
  expect(await screen.findByRole('button', { name: 'Reading backward' })).toBeInTheDocument();
  expect(readSortConfigPref()).toEqual([{ key: 'source_address', direction: 'asc' }]);
});

test('a manual sort change does not change the read direction', async () => {
  render(<App />);
  expect(await screen.findByRole('button', { name: 'Reading backward' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'TIME' }));
  await waitFor(() => {
    expect(readSortConfigPref()).toEqual([{ key: 'timestamp', direction: 'asc' }]);
  });
  expect(screen.getByRole('button', { name: 'Reading backward' })).toBeInTheDocument();
});

test('switching forward to backward without a timestamp parks on the edge', async () => {
  writeSortConfigPref([{ key: 'timestamp', direction: 'asc' }]);
  writeMonitorViewPref({
    direction: 'forward',
    anchorTs: 5000,
    follow: true,
    pauseMode: 'playing',
  });
  render(<App />);
  await screen.findByRole('button', { name: 'Play' });
  const before = cacheCtl.loadRangeCalls.length;
  fireEvent.click(screen.getByRole('button', { name: 'Reading forward' }));
  expect(await screen.findByRole('button', { name: 'Paused automatically' })).toBeInTheDocument();
  const edge = Date.parse('2024-01-01T10:00:00.000000Z');
  await waitFor(() => {
    expect(readMonitorViewPref()).toMatchObject({
      direction: 'backward',
      anchorTs: null,
      follow: false,
      pauseMode: 'auto',
    });
  });
  expect(cacheCtl.loadRangeCalls.slice(before)).toEqual([[edge - 60 * 60_000, edge]]);
  expect(readSortConfigPref()).toEqual([{ key: 'timestamp', direction: 'asc' }]);
});

test('the pill keeps Play while the socket is down and during a gap fill', async () => {
  render(<App />);
  expect(await screen.findByRole('button', { name: 'Playing' })).toBeInTheDocument();
  setWsConnected(false);
  expect(screen.getByRole('button', { name: 'Playing' })).toBeEnabled();
  expect(screen.getByLabelText('WebSocket offline')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Offline' })).not.toBeInTheDocument();

  setWsConnected(true);
  expect(screen.getByLabelText('WebSocket active')).toBeInTheDocument();
  act(() => { cacheCtl.setFillingGaps!(true); });
  expect(screen.getByRole('button', { name: 'Playing' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Lädt nach' })).not.toBeInTheDocument();
  act(() => { cacheCtl.setFillingGaps!(false); });
  expect(screen.getByRole('button', { name: 'Playing' })).toBeInTheDocument();
});

const DB_NEWEST = '2024-06-01T00:00:00.000Z';
const DB_NEWEST_MS = Date.parse(DB_NEWEST);

function stubDatabaseInfo() {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/database/info')) {
      return {
        ok: true,
        json: async () => ({
          oldest_timestamp: '2020-01-01T00:00:00.000Z',
          newest_timestamp: DB_NEWEST,
        }),
      };
    }
    return { ok: true, json: async () => ({}) };
  }));
}

test('fast-forward while playing stays live', async () => {
  stubDatabaseInfo();
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Load up to newest telegram in database' }));
  await waitFor(() => {
    expect(readMonitorViewPref()).toMatchObject({
      direction: 'backward',
      anchorTs: null,
      follow: true,
      pauseMode: 'playing',
    });
  });
  expect(screen.getByRole('button', { name: 'Playing' })).toBeInTheDocument();
  expect(cacheCtl.loadRangeCalls).toContainEqual([DB_NEWEST_MS - 60 * 60_000, DB_NEWEST_MS]);
});

test('fast-forward during manual pause keeps the pause on the newest telegram', async () => {
  stubDatabaseInfo();
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Playing' }));
  fireEvent.click(screen.getByRole('button', { name: 'Load up to newest telegram in database' }));
  await waitFor(() => {
    expect(readMonitorViewPref()).toMatchObject({
      direction: 'backward',
      anchorTs: DB_NEWEST_MS,
      follow: false,
      pauseMode: 'manual',
    });
  });
  expect(screen.getByRole('button', { name: 'Paused manually' })).toBeInTheDocument();
});

test('fast-forward from auto-pause turns live and follow on', async () => {
  stubDatabaseInfo();
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Playing' }));
  fireEvent.click(screen.getByRole('button', { name: 'Paused manually' }));
  expect(screen.getByRole('button', { name: 'Paused automatically' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Load up to newest telegram in database' }));
  await waitFor(() => {
    expect(readMonitorViewPref()).toMatchObject({
      direction: 'backward',
      anchorTs: null,
      follow: true,
      pauseMode: 'playing',
    });
  });
  expect(screen.getByRole('button', { name: 'Playing' })).toBeInTheDocument();
});

test('fast-forward from a forward view turns live on', async () => {
  stubDatabaseInfo();
  writeMonitorViewPref({
    direction: 'forward',
    anchorTs: null,
    follow: false,
    pauseMode: 'off',
  });
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Load up to newest telegram in database' }));
  await waitFor(() => {
    expect(readMonitorViewPref()).toMatchObject({
      direction: 'backward',
      anchorTs: null,
      follow: true,
      pauseMode: 'playing',
    });
  });
  expect(screen.getByRole('button', { name: 'Playing' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Play' })).not.toBeInTheDocument();
});

test('a backward fixed anchor shows the auto-pause control and a click latches manual pause', async () => {
  writeMonitorViewPref({
    direction: 'backward',
    anchorTs: 1_700_000_000_000,
    follow: true,
    pauseMode: 'playing',
  });
  render(<App />);
  const parked = await screen.findByRole('button', { name: 'Paused automatically' });
  expect(screen.queryByRole('button', { name: 'Playing' })).not.toBeInTheDocument();
  fireEvent.click(parked);
  expect(screen.getByRole('button', { name: 'Paused manually' })).toBeInTheDocument();
});

test('the status count includes the pause backlog', async () => {
  render(<App />);
  fireEvent.click(await screen.findByRole('button', { name: 'Playing' }));
  await act(async () => {
    cacheCtl.addLive!(makeTelegram({
      timestamp: new Date().toISOString(),
      source_address: '1.2.1',
      raw_hex: '0xa',
    }));
    cacheCtl.addLive!(makeTelegram({
      timestamp: new Date().toISOString(),
      source_address: '1.2.2',
      raw_hex: '0xb',
    }));
  });
  expect(screen.getByLabelText('3 in buffer and backlog')).toHaveTextContent('3');
});
