import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { LastSeenOverlay } from './LastSeenOverlay';
import type { Telegram } from '../hooks/useWebSocket';
import type { FilterOptions } from '../types/filters';
import { anchorKey } from '../utils/anchorKey';

const FILTER_OPTIONS: FilterOptions = {
  sources: [],
  targets: [
    { address: '16/0/1', name: 'SRV_Alive', main: 1, sub: 11 },
    { address: '1/1/97', name: 'EGD_BWM55TG2A_Helligkeit', main: 9, sub: 4 },
  ],
  types: [],
  dpts: [],
  ga_group_names: {},
  pa_line_names: {},
};

function mockFetch(routes: Record<string, unknown>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    for (const [path, body] of Object.entries(routes)) {
      if (url.includes(path)) {
        return { ok: true, json: async () => body } as Response;
      }
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch({ '/api/telegrams': { telegrams: [] } }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test('has no write panel', () => {
  render(
    <LastSeenOverlay
      filterOptions={FILTER_OPTIONS}
      gaAddresses={['16/0/1']}
      onClose={() => {}}
    />
  );

  expect(screen.queryByText('Write')).not.toBeInTheDocument();
  expect(screen.queryByText('On')).not.toBeInTheDocument();
  expect(screen.queryByPlaceholderText(/Value/)).not.toBeInTheDocument();
});

test('asks for a Focus last-seen toggle when none is on', () => {
  render(
    <LastSeenOverlay
      filterOptions={FILTER_OPTIONS}
      gaAddresses={[]}
      onClose={() => {}}
    />
  );

  expect(screen.getByText('Turn on Last seen values for group addresses or devices in Focus.')).toBeInTheDocument();
  expect(screen.queryByText('16/0/1')).not.toBeInTheDocument();
});

test('the limit is the newest telegrams from toggled devices or to toggled group addresses', () => {
  render(
    <LastSeenOverlay
      filterOptions={FILTER_OPTIONS}
      gaAddresses={['1/1/97']}
      deviceAddresses={['1.1.5']}
      telegrams={[telegram(30, 'device-new'), telegram(20, 'ga-mid'), telegram(10, 'device-old'), telegram(5, 'ga-oldest')]}
      limit={2}
      onClose={() => {}}
    />
  );

  expect(screen.getByText('device-new')).toBeInTheDocument();
  expect(screen.getByText('ga-mid')).toBeInTheDocument();
  expect(screen.queryByText('device-old')).not.toBeInTheDocument();
  expect(screen.queryByText('ga-oldest')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '5' })).toBeInTheDocument();
});

test('each group keeps its own newest telegrams, and a second-level group does too', async () => {
  const row = (second: number, target: string, value: string) => ({
    ...(telegram(second, value) as object),
    target_address: target,
  });
  const telegrams = [
    row(40, '1/1/2', 'b-new'),
    row(4, '1/1/2', 'b-old'),
    row(30, '1/1/1', 'a-new'),
    row(3, '1/1/1', 'a-old'),
    row(1, '1/1/1', 'shared-old'),
  ];

  const { rerender } = render(
    <LastSeenOverlay
      filterOptions={FILTER_OPTIONS}
      gaAddresses={['1/1/1', '1/1/2']}
      telegrams={telegrams}
      group="ga"
      limit={1}
      onClose={() => {}}
    />
  );

  expect(screen.getByText('a-new')).toBeInTheDocument();
  expect(screen.getByText('b-new')).toBeInTheDocument();
  expect(screen.queryByText('shared-old')).not.toBeInTheDocument();

  rerender(
    <LastSeenOverlay
      filterOptions={FILTER_OPTIONS}
      deviceAddresses={['1.1.5']}
      telegrams={telegrams}
      group="both"
      limit={1}
      onClose={() => {}}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: /^1\.1\.5/ }));
  expect(screen.getAllByText('a-new').length).toBeGreaterThan(0);
  expect(screen.getAllByText('b-new').length).toBeGreaterThan(0);
  expect(screen.queryByText('a-old')).not.toBeInTheDocument();
  expect(screen.queryByText('b-old')).not.toBeInTheDocument();
});

test('loads the last values per toggled address and collapses a group', () => {
  render(
    <LastSeenOverlay
      filterOptions={FILTER_OPTIONS}
      gaAddresses={['1/1/97']}
      deviceAddresses={['1.1.5']}
      telegrams={[telegram(2, '222 lx'), telegram(1, '111 lx')]}
      limit={10}
      onClose={() => {}}
    />
  );

  expect(screen.getByText('222 lx')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'GA' }));
  const headerLabels = [...document.querySelectorAll('.last-seen-header .header-col')].map(el => el.textContent?.trim());
  expect(headerLabels).toEqual(['TARGET', 'SOURCE', 'TIME', 'Δt', 'TYPE', 'DPT', 'VALUE']);
  const group = screen.getByRole('button', { name: /^1\/1\/97/ });
  expect(group).toHaveAttribute('aria-expanded', 'false');
  expect(document.querySelector('.log-row')).toBeNull();
  fireEvent.click(group);
  expect(group).toHaveAttribute('aria-expanded', 'true');
  const row = document.querySelector('.log-row') as HTMLElement;
  expect(row.textContent).not.toContain('1/1/97');
  expect(row.textContent).toContain('222 lx');
  expect(group.parentElement?.querySelector('[title="Telegrams"]')).toHaveTextContent('2');

  fireEvent.click(group);
  expect(group).toHaveAttribute('aria-expanded', 'false');
  expect(document.querySelector('.log-row')).toBeNull();
  expect(screen.getByText('222 lx')).toBeInTheDocument();
  expect(screen.queryByText('111 lx')).not.toBeInTheDocument();

  expect(group.parentElement?.parentElement?.textContent).toContain('222 lx');
  expect(screen.queryByRole('button', { name: /Remove .* from last seen/ })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'List' }));
  fireEvent.click(screen.getByRole('button', { name: 'Device' }));
  const deviceLabels = [...document.querySelectorAll('.last-seen-header .header-col')].map(el => el.textContent?.trim());
  expect(deviceLabels.slice(0, 2)).toEqual(['SOURCE', 'TARGET']);
  const device = screen.getByRole('button', { name: /^1\.1\.5/ });
  expect(device).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(device);
  expect(device).toHaveAttribute('aria-expanded', 'true');
  expect(screen.queryByRole('button', { name: /^1\/1\/97/ })).not.toBeInTheDocument();
  const deviceRow = document.querySelector('.log-row') as HTMLElement;
  expect(deviceRow.textContent).toContain('1/1/97');
  expect(deviceRow.textContent).toContain('222 lx');
  expect(deviceRow.textContent).not.toContain('1.1.5');
  fireEvent.click(device);
  expect(document.querySelector('.log-row')).toBeNull();
  expect(screen.getByText('222 lx')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'GA' }));
  expect(screen.getByRole('button', { name: 'Device' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'GA' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByRole('button', { name: /^1\/1\/97/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /^1\.1\.5/ }));
  const nested = screen.getByRole('button', { name: /^1\/1\/97/ });
  expect(nested).toHaveAttribute('aria-expanded', 'false');
  expect(document.querySelector('.log-row')).toBeNull();
  fireEvent.click(nested);
  const nestedRow = document.querySelector('.log-row') as HTMLElement;
  expect(nestedRow.textContent).toContain('222 lx');
  expect(nestedRow.textContent).not.toContain('1/1/97');
  expect(nestedRow.textContent).not.toContain('1.1.5');
  expect(screen.queryByRole('button', { name: /Remove .* from last seen/ })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: /^1\.1\.5/ }), { ctrlKey: true });
  expect(screen.getByRole('button', { name: /^1\.1\.5/ })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('button', { name: /^1\/1\/97/ })).not.toBeInTheDocument();
});

test('an opened group stays open across a remount', async () => {
  const telegrams = [telegram(2, '222 lx'), telegram(1, '111 lx')];

  function Harness() {
    const [show, setShow] = useState(true);
    const [expanded, setExpanded] = useState<string[]>([]);
    return (
      <div>
        <button onClick={() => setShow(value => !value)}>Toggle LastSeen</button>
        {show && (
          <LastSeenOverlay
            filterOptions={FILTER_OPTIONS}
            gaAddresses={['1/1/97']}
            telegrams={telegrams}
            group="ga"
            expanded={expanded}
            onExpandedChange={setExpanded}
            onClose={() => {}}
          />
        )}
      </div>
    );
  }

  const { unmount } = render(<Harness />);
  const group = await screen.findByRole('button', { name: /^1\/1\/97/ });
  expect(group).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(group);
  expect(group).toHaveAttribute('aria-expanded', 'true');
  expect(document.querySelector('.log-row')).not.toBeNull();

  fireEvent.click(screen.getByText('Toggle LastSeen'));
  fireEvent.click(screen.getByText('Toggle LastSeen'));
  expect(await screen.findByRole('button', { name: /^1\/1\/97/ })).toHaveAttribute('aria-expanded', 'true');

  unmount();
  function Restored() {
    const [expanded, setExpanded] = useState(['ga:1/1/97']);
    return (
      <LastSeenOverlay
        filterOptions={FILTER_OPTIONS}
        gaAddresses={['1/1/97']}
        telegrams={telegrams}
        group="ga"
        expanded={expanded}
        onExpandedChange={setExpanded}
        onClose={() => {}}
      />
    );
  }
  render(<Restored />);
  const restored = await screen.findByRole('button', { name: /^1\/1\/97/ });
  expect(restored).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(restored);
  expect(restored).toHaveAttribute('aria-expanded', 'false');
  expect(document.querySelector('.log-row')).toBeNull();
});

// ── Live / frozen (#374) ─────────────────────────────────────────────────────

const telegram = (second: number, value: string) => ({
  timestamp: `2026-01-01T10:00:${String(second).padStart(2, '0')}.000Z`,
  source_address: '1.1.5',
  target_address: '1/1/97',
  telegram_type: 'GroupValueWrite',
  simplified_type: 'Write',
  direction: 'Incoming',
  dpt_main: 9,
  dpt_sub: 4,
  value_formatted: value,
  value_numeric: null,
  raw_hex: '0x00',
} as never);

const renderLastSeen = (props: Partial<React.ComponentProps<typeof LastSeenOverlay>>) => {
  const base = { filterOptions: FILTER_OPTIONS, gaAddresses: ['1/1/97'], onClose: () => {} };
  const view = render(<LastSeenOverlay {...base} {...props} />);
  return { ...view, update: (next: Partial<React.ComponentProps<typeof LastSeenOverlay>>) => view.rerender(<LastSeenOverlay {...base} {...next} />) };
};

test('live shows a matching buffer telegram the moment it arrives, without reading the database (#374)', () => {
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  const { update } = renderLastSeen({ autoRefresh: true, telegrams: [] });

  update({ autoRefresh: true, telegrams: [telegram(1, '111 lx')] });
  expect(screen.getByText('111 lx')).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});

test('frozen holds new buffer telegrams back, counts them, and catches up when going live (#374)', () => {
  const { update } = renderLastSeen({ autoRefresh: false, telegrams: [] });

  update({ autoRefresh: false, telegrams: [telegram(1, '111 lx')] });
  update({ autoRefresh: false, telegrams: [telegram(2, '222 lx'), telegram(1, '111 lx')] });
  expect(screen.queryByText('111 lx')).not.toBeInTheDocument();
  expect(screen.getByText('2 new')).toBeInTheDocument();
  const frozen = screen.getByTitle(/^Frozen: 2 newer telegrams not shown/);
  expect(frozen).not.toHaveTextContent('2 new');
  expect(frozen.nextElementSibling).toHaveTextContent('2 new');

  // A telegram for another address is not counted.
  update({
    autoRefresh: false,
    telegrams: [
      { ...(telegram(3, '333 lx') as object), target_address: '9/9/9' } as never,
      telegram(2, '222 lx'),
      telegram(1, '111 lx'),
    ],
  });
  expect(screen.getByText('2 new')).toBeInTheDocument();

  update({ autoRefresh: true, telegrams: [telegram(2, '222 lx'), telegram(1, '111 lx')] });
  expect(screen.getByText('222 lx')).toBeInTheDocument();
  expect(screen.getByText('111 lx')).toBeInTheDocument();
  expect(screen.queryByText('2 new')).not.toBeInTheDocument();
});

test('telegram rows run newest first, group rows drop delta and stand apart', () => {
  const row = (second: number, target: string, value: string) => ({
    ...(telegram(second, value) as object),
    target_address: target,
  });

  render(
    <LastSeenOverlay
      filterOptions={FILTER_OPTIONS}
      deviceAddresses={['1.1.5']}
      telegrams={[row(1, '1/1/1', 'older'), row(50, '1/1/2', 'newer'), row(40, '1/1/2', 'middle')]}
      onClose={() => {}}
    />
  );

  expect(screen.getByText('newer')).toBeInTheDocument();
  const orderOf = () => [...document.querySelectorAll('.log-row')].map(el =>
    ['newer', 'middle', 'older'].find(value => el.textContent?.includes(value)));
  expect(orderOf()).toEqual(['newer', 'middle', 'older']);

  fireEvent.click(screen.getByRole('button', { name: 'Device' }));
  fireEvent.click(screen.getByRole('button', { name: /^1\.1\.5/ }));
  expect(orderOf()).toEqual(['newer', 'middle', 'older']);
  expect(document.querySelector('.log-row')?.textContent).toContain('+ 00:10.000');
  const ends = [...document.querySelectorAll('.log-row.last-seen-group-end')].map(el =>
    ['newer', 'middle', 'older'].find(value => el.textContent?.includes(value)));
  expect(ends).toEqual(['older']);
  for (const group of document.querySelectorAll('.last-seen-group')) {
    expect(group.textContent).not.toContain('00:10.000');
    expect((group as HTMLElement).style.background).toContain('5%');
    expect((group as HTMLElement).style.boxShadow).toBe('');
  }
  expect(document.querySelector('.log-row.last-seen-group')).toBeNull();
});

test('groups and subgroups sort by address, telegrams inside by time descending', () => {
  const row = (second: number, source: string, target: string, value: string) => ({
    ...(telegram(second, value) as object),
    source_address: source,
    target_address: target,
  });
  const telegrams = [
    row(50, '1.1.20', '1/2/0', 'late-high'),
    row(10, '1.1.20', '1/2/0', 'early-high'),
    row(40, '1.1.20', '1/1/5', 'late-low'),
    row(5, '1.1.2', '9/9/9', 'early-device'),
  ];
  const values = () => [...document.querySelectorAll('.log-row')].map(el =>
    ['late-high', 'early-high', 'late-low', 'early-device'].find(value => el.textContent?.includes(value)));
  const labels = () => [...document.querySelectorAll('.last-seen-group button[aria-expanded]')].map(el => el.getAttribute('aria-label'));

  const { rerender } = render(
    <LastSeenOverlay
      filterOptions={FILTER_OPTIONS}
      deviceAddresses={['1.1.20', '1.1.2']}
      telegrams={telegrams}
      group="both"
      expanded={['pa:1.1.2', 'pa:1.1.2|ga:9/9/9', 'pa:1.1.20', 'pa:1.1.20|ga:1/1/5', 'pa:1.1.20|ga:1/2/0']}
      onExpandedChange={() => {}}
      onClose={() => {}}
    />
  );

  expect(labels()).toEqual(['1.1.2', '9/9/9', '1.1.20', '1/1/5', '1/2/0']);
  expect(values()).toEqual(['early-device', 'late-low', 'late-high', 'early-high']);

  rerender(
    <LastSeenOverlay
      filterOptions={FILTER_OPTIONS}
      gaAddresses={['1/2/0', '1/1/5', '9/9/9']}
      telegrams={telegrams}
      group="ga"
      expanded={['ga:1/1/5', 'ga:1/2/0', 'ga:9/9/9']}
      onExpandedChange={() => {}}
      onClose={() => {}}
    />
  );
  expect(labels()).toEqual(['1/1/5', '1/2/0', '9/9/9']);
  expect(values()).toEqual(['late-low', 'late-high', 'early-high', 'early-device']);
});

test('a telegram without a value leaves the value cell blank', () => {
  render(
    <LastSeenOverlay
      filterOptions={FILTER_OPTIONS}
      gaAddresses={['1/1/97']}
      telegrams={[{ ...(telegram(1, '') as object), value_formatted: '', value_numeric: null, raw_hex: '0xab' }]}
      onClose={() => {}}
    />
  );

  expect(screen.getByText('0xab')).toBeInTheDocument();
  const row = document.querySelector('.log-row') as HTMLElement;
  const cells = [...row.querySelectorAll('.filterable-cell')];
  const value = cells[cells.length - 1];
  expect(value.textContent).toContain('0xab');
  expect(value.textContent).not.toContain('-');
});

test('the mark stripe toggles that telegram and leaves the other highlight', () => {
  const onHighlightedKeysChange = vi.fn();
  const older = telegram(1, '111 lx') as Telegram;
  const newer = telegram(2, '222 lx') as Telegram;
  renderLastSeen({
    telegrams: [newer, older],
    onHighlightedKeysChange,
    highlightedKeys: [anchorKey(older)],
  });

  const newerButton = screen.getByRole('button', { name: `Mark ${newer.timestamp}` });
  const olderButton = screen.getByRole('button', { name: `Mark ${older.timestamp}` });
  expect(olderButton).toHaveAttribute('aria-pressed', 'true');
  expect(newerButton).toHaveAttribute('aria-pressed', 'false');
  const olderRow = olderButton.closest('.log-row') as HTMLElement;
  const newerRow = newerButton.closest('.log-row') as HTMLElement;
  expect(olderRow).not.toHaveClass('marked');
  expect(olderRow.style.background).not.toBe('color-mix(in srgb, var(--text-dim) 18%, var(--bg-dark))');
  expect(olderButton.style.background).toBe('var(--text-dim)');
  expect(olderButton.style.background).not.toBe(olderRow.style.background);
  expect(newerButton.style.background).toBe(newerRow.style.background);

  fireEvent.click(newerButton);
  expect(onHighlightedKeysChange).toHaveBeenCalledWith([anchorKey(older), anchorKey(newer)]);

  fireEvent.click(olderButton);
  expect(onHighlightedKeysChange).toHaveBeenLastCalledWith([]);
});

test('the time button asks to open that telegram in the list', () => {
  const onGotoTelegram = vi.fn();
  const row = telegram(4, '444 lx') as Telegram;
  renderLastSeen({ telegrams: [row], onGotoTelegram });
  fireEvent.click(screen.getByRole('button', { name: `Go to ${row.timestamp}` }));
  expect(onGotoTelegram).toHaveBeenCalledWith(row);
});
