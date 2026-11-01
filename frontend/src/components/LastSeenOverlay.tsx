import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronRight, Clock, RefreshCw, ToggleLeft, ToggleRight } from 'lucide-react';
import { format } from 'date-fns';
import type { Telegram } from '../hooks/useWebSocket';
import type { FilterOptions } from '../types/filters';
import { anchorKey } from '../utils/anchorKey';
import { compareKnxAddress } from '../utils/knxAddress';
import { telegramColor, UNCOLORED_MARK_STRIPE, useTargetColors } from '../utils/targetColors';
import { TELEGRAM_COLUMNS, TelegramColumnHeader, telegramHeaderFrameStyle, useTelegramColumnWidths, type ColId, type ColumnDef } from './telegramColumns';
import { CELL_PADDING, TelegramAddressLines, TelegramEmptyCell, deltaPair, renderAddressActions, renderTelegramCell } from './telegramCell';

const LIMITS = [5, 10, 20, 50, 100] as const;
const NO_ADDRESSES: string[] = [];
const NO_TELEGRAMS: Telegram[] = [];
/** Same width as the telegram list, so the columns stay aligned with the mark button. */
const MARK_STRIPE_WIDTH = '10px';

export type LastSeenGroup = 'none' | 'ga' | 'pa' | 'both';

interface LastSeenOverlayProps {
  filterOptions: FilterOptions;
  /** Group addresses with the Focus last-seen toggle on. */
  gaAddresses?: string[];
  /** Devices with the Focus last-seen toggle on. */
  deviceAddresses?: string[];
  /** Same column-line toggles as the telegram list (names, raw value). */
  visibleColumns?: { [key: string]: boolean };
  /** Flat list, one level, or device groups with a group-address level when both are on. */
  group?: LastSeenGroup;
  onGroupChange?: (group: LastSeenGroup) => void;
  /** Open group keys. A key that is absent stays collapsed. Controlled when the callback is set. */
  expanded?: string[];
  onExpandedChange?: (expanded: string[]) => void;
  /** Same address buttons as the telegram list: focus membership, visualize, last seen, send. */
  onFocusFilter?: (address: string, mode: 'ga' | 'pa') => void;
  /** Addresses checked in the Focus list. The button reflects this and does not change the filter. */
  focusGas?: readonly string[];
  focusDevices?: readonly string[];
  onQuickVisualize?: (targetAddress: string) => void;
  onQuickVisualizeSource?: (sourceAddress: string) => void;
  onQuickLastSeen?: (address: string, mode: 'ga' | 'pa') => void;
  canSend?: boolean;
  /** Telegrams already in the live buffer. Last seen does not read the database. */
  telegrams?: Telegram[];
  /** Stripe highlights shared with the telegram list. A click toggles one telegram and does not change the mouse selection. */
  highlightedKeys?: readonly string[];
  onHighlightedKeysChange?: (keys: string[]) => void;
  /** Switch to the telegram list with this telegram in the middle. */
  onGotoTelegram?: (telegram: Telegram) => void;
  onClose: () => void;
  /** Shared view header. The title and settings render there. */
  headerSlot?: HTMLElement | null;

  limit?: number;
  onLimitChange?: (limit: number) => void;
  autoRefresh?: boolean;
  onAutoRefreshChange?: (refresh: boolean) => void;
  search?: string;
  onSearchChange?: (search: string) => void;
}

interface Group {
  key: string;
  kind: 'ga' | 'pa';
  address: string;
  name?: string;
  rows: Telegram[];
  /** Group addresses under a device. Present only when Device and GA are both on. */
  children?: Group[];
}

const COLUMN_ORDER: Record<LastSeenGroup, ColId[]> = {
  none: ['time', 'delta', 'source', 'target', 'type', 'dpt', 'value'],
  ga: ['target', 'source', 'time', 'delta', 'type', 'dpt', 'value'],
  pa: ['source', 'target', 'time', 'delta', 'type', 'dpt', 'value'],
  both: ['source', 'target', 'time', 'delta', 'type', 'dpt', 'value'],
};

function lastSeenColumns(mode: LastSeenGroup): ColumnDef[] {
  return COLUMN_ORDER[mode].map(id => TELEGRAM_COLUMNS.find(item => item.id === id)!);
}

const timeMs = (timestamp: string) => new Date(timestamp).getTime();

/** Group and subgroup rows stay in address order. Time only orders telegrams inside them. */
const byAddress = (a: [string, Telegram[]], b: [string, Telegram[]]) => compareKnxAddress(a[0], b[0]);

const telegramKey = (t: Telegram) => `${t.timestamp}|${t.source_address}|${t.target_address}|${t.raw_hex ?? ''}`;

function mergeTelegrams(batches: Telegram[][]): Telegram[] {
  const seen = new Map<string, Telegram>();
  for (const batch of batches) {
    for (const telegram of batch) {
      const key = telegramKey(telegram);
      if (!seen.has(key)) seen.set(key, telegram);
    }
  }
  return [...seen.values()].sort((a, b) => timeMs(b.timestamp) - timeMs(a.timestamp));
}

/** Keeps the newest `limit` telegrams of the list, of each group, or of each second-level group. */
function capTelegrams(telegrams: Telegram[], mode: LastSeenGroup, limit: number): Telegram[] {
  const sorted = mergeTelegrams([telegrams]);
  if (mode === 'none') return sorted.slice(0, limit);
  const keyOf = (telegram: Telegram) => mode === 'ga'
    ? telegram.target_address
    : mode === 'pa'
      ? telegram.source_address
      : `${telegram.source_address}|${telegram.target_address}`;
  const counts = new Map<string, number>();
  return sorted.filter(telegram => {
    const key = keyOf(telegram);
    const count = counts.get(key) ?? 0;
    if (count >= limit) return false;
    counts.set(key, count + 1);
    return true;
  });
}

/** Telegrams from toggled devices or to toggled group addresses, taken from `buffer` only. */
function selectFromBuffer(buffer: Telegram[], gas: string[], devices: string[], limit: number, mode: LastSeenGroup): Telegram[] {
  if (gas.length === 0 && devices.length === 0) return [];
  const gaSet = new Set(gas);
  const deviceSet = new Set(devices);
  const selected = buffer.filter(telegram => gaSet.has(telegram.target_address) || deviceSet.has(telegram.source_address));
  return capTelegrams(selected, mode, limit);
}

export const LastSeenOverlay: React.FC<LastSeenOverlayProps> = ({
  filterOptions,
  gaAddresses = NO_ADDRESSES,
  deviceAddresses = NO_ADDRESSES,
  visibleColumns,
  group: groupProp,
  onGroupChange,
  expanded: expandedProp,
  onExpandedChange,
  onFocusFilter,
  focusGas = NO_ADDRESSES,
  focusDevices = NO_ADDRESSES,
  onQuickVisualize,
  onQuickVisualizeSource,
  onQuickLastSeen,
  canSend = false,
  telegrams: buffer = NO_TELEGRAMS,
  highlightedKeys,
  onHighlightedKeysChange,
  onGotoTelegram,
  headerSlot = null,
  limit: limitProp,
  onLimitChange,
  autoRefresh: autoRefreshProp,
  onAutoRefreshChange,
}) => {
  const [internalLimit, setInternalLimit] = useState<number>(20);
  const limit = limitProp !== undefined ? limitProp : internalLimit;
  const setLimit = (val: number) => {
    setInternalLimit(val);
    onLimitChange?.(val);
  };
  const [internalGroup, setInternalGroup] = useState<LastSeenGroup>('none');
  const group = groupProp ?? internalGroup;
  const setGroup = (next: LastSeenGroup) => {
    setInternalGroup(next);
    onGroupChange?.(next);
  };
  const [lastFetchedAt, setLastFetchedAt] = useState<Date | null>(null);
  const [internalAutoRefresh, setInternalAutoRefresh] = useState(false);
  const autoRefresh = autoRefreshProp !== undefined ? autoRefreshProp : internalAutoRefresh;
  const setAutoRefresh = (val: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof val === 'function' ? val(autoRefresh) : val;
    setInternalAutoRefresh(next);
    onAutoRefreshChange?.(next);
  };
  const [ownExpanded, setOwnExpanded] = useState<string[]>([]);
  // While frozen, the rows on screen. Null means follow the buffer.
  const [held, setHeld] = useState<Telegram[] | null>(null);
  const [internalHighlightedKeys, setInternalHighlightedKeys] = useState<string[]>([]);
  const expanded = onExpandedChange ? (expandedProp ?? []) : ownExpanded;
  const setExpanded = (keys: string[]) => (onExpandedChange ? onExpandedChange(keys) : setOwnExpanded(keys));
  const expandedSet = useMemo(() => new Set(expanded), [expanded]);
  const targetColors = useTargetColors();

  const gaKey = gaAddresses.join('\n');
  const deviceKey = deviceAddresses.join('\n');
  const matching = useMemo(
    () => selectFromBuffer(buffer, gaAddresses, deviceAddresses, limit, group),
    // The address lists are read through their stable keys.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [buffer, gaKey, deviceKey, limit, group],
  );
  // A selection change re-snapshots. Buffer updates while frozen do not.
  useEffect(() => {
    if (autoRefresh) {
      setHeld(null);
      return;
    }
    setHeld(matching);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, gaKey, deviceKey, limit, group]);

  const shown = held ?? matching;
  const pendingCount = held == null ? 0 : matching.filter(telegram => {
    const key = telegramKey(telegram);
    return !held.some(item => telegramKey(item) === key);
  }).length;

  useEffect(() => {
    if (!autoRefresh || (gaAddresses.length === 0 && deviceAddresses.length === 0)) return;
    setLastFetchedAt(new Date());
  }, [autoRefresh, matching, gaAddresses.length, deviceAddresses.length]);

  const highlightedList = highlightedKeys ?? internalHighlightedKeys;
  const setHighlightedList = (keys: string[]) => {
    setInternalHighlightedKeys(keys);
    onHighlightedKeysChange?.(keys);
  };
  const highlightedSet = useMemo(() => new Set(highlightedList), [highlightedList]);

  const flat = shown;

  const { gridFor, resizeStart, resetWidth } = useTelegramColumnWidths();
  const columns = useMemo(() => lastSeenColumns(group), [group]);
  const gridTemplate = useMemo(() => gridFor(columns), [columns, gridFor]);

  const groups = useMemo((): Group[] => {
    const gaNames = new Map(filterOptions.targets.map(option => [option.address ?? '', option.name]));
    const deviceNames = new Map(filterOptions.sources.map(option => [option.address ?? '', option.name]));
    const named = (kind: 'ga' | 'pa', address: string, sample?: Telegram) => {
      const stored = (kind === 'ga' ? gaNames : deviceNames).get(address);
      const fromRow = kind === 'ga' ? sample?.target_name : sample?.source_name;
      return stored || fromRow || undefined;
    };
    const sorted = (rows: Telegram[]) => [...rows].sort((a, b) => timeMs(b.timestamp) - timeMs(a.timestamp));
    if (group === 'none') return [{ key: 'all', kind: 'ga', address: '', rows: flat.slice(0, limit) }];

    if (group === 'ga') {
      const buckets = new Map<string, Telegram[]>();
      for (const address of gaAddresses) buckets.set(address, []);
      for (const telegram of flat) {
        const rows = buckets.get(telegram.target_address);
        if (rows) rows.push(telegram);
        else buckets.set(telegram.target_address, [telegram]);
      }
      return [...buckets.entries()]
        .sort(byAddress)
        .map(([address, rows]) => ({
          key: `ga:${address}`,
          kind: 'ga' as const,
          address,
          name: named('ga', address, rows[0]),
          rows: sorted(rows).slice(0, limit),
        }));
    }

    const devices = new Map<string, Telegram[]>();
    for (const address of deviceAddresses) devices.set(address, []);
    for (const telegram of flat) {
      const rows = devices.get(telegram.source_address);
      if (rows) rows.push(telegram);
      else devices.set(telegram.source_address, [telegram]);
    }
    return [...devices.entries()]
      .sort(byAddress)
      .map(([address, rows]) => {
        const ordered = sorted(rows);
        const children = group === 'both'
          ? [...rows.reduce((byGa, telegram) => {
              const list = byGa.get(telegram.target_address) ?? [];
              list.push(telegram);
              byGa.set(telegram.target_address, list);
              return byGa;
            }, new Map<string, Telegram[]>()).entries()]
            .sort(byAddress)
            .map(([ga, gaRows]): Group => ({
              key: `pa:${address}|ga:${ga}`,
              kind: 'ga',
              address: ga,
              name: named('ga', ga, gaRows[0]),
              rows: sorted(gaRows).slice(0, limit),
            }))
          : undefined;
        const shown = children ? sorted(children.flatMap(child => child.rows)) : ordered.slice(0, limit);
        return {
          key: `pa:${address}`,
          kind: 'pa' as const,
          address,
          name: named('pa', address, shown[0]),
          rows: shown,
          children,
        };
      });
  }, [group, flat, gaAddresses, deviceAddresses, filterOptions, limit]);

  const refresh = () => {
    if (gaAddresses.length === 0 && deviceAddresses.length === 0) return;
    // Frozen view catches up to the buffer. Live view is already the buffer.
    if (!autoRefresh) setHeld(matching);
    setLastFetchedAt(new Date());
  };

  const selectedCount = gaAddresses.length + deviceAddresses.length;

  const headerControls = (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0, marginLeft: headerSlot ? 'auto' : undefined }}>
      <div role="group" aria-label="Group last seen values" style={{ display: 'flex', gap: '0.2rem' }}>
        {([
          ['none', 'List', 'No grouping'],
          ['pa', 'Device', 'Group by device'],
          ['ga', 'GA', 'Group by group address. Together with Device this adds a second level'],
        ] as const).map(([id, label, title]) => {
          const deviceOn = group === 'pa' || group === 'both';
          const gaOn = group === 'ga' || group === 'both';
          const pressed = id === 'none' ? group === 'none' : id === 'pa' ? deviceOn : gaOn;
          const select = () => {
            if (id === 'none') {
              setGroup('none');
              return;
            }
            const device = id === 'pa' ? !deviceOn : deviceOn;
            const ga = id === 'ga' ? !gaOn : gaOn;
            setGroup(device && ga ? 'both' : device ? 'pa' : ga ? 'ga' : 'none');
          };
          return (
            <button
              key={id}
              type="button"
              aria-pressed={pressed}
              title={title}
              onClick={select}
              style={{
                padding: '0.2rem 0.45rem', fontSize: '0.72rem', borderRadius: 4, cursor: 'pointer',
                border: `1px solid ${pressed ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                background: pressed ? 'rgba(99,102,241,0.15)' : 'var(--bg-subtle)',
                color: pressed ? 'var(--accent-primary)' : 'var(--text-dim)',
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: '0.2rem' }}>
        {LIMITS.map(l => (
          <button key={l} type="button" onClick={() => setLimit(l)} style={{
            padding: '0.2rem 0.45rem', fontSize: '0.72rem', borderRadius: 4, cursor: 'pointer',
            border: `1px solid ${limit === l ? 'var(--accent-primary)' : 'var(--border-color)'}`,
            background: limit === l ? 'rgba(99,102,241,0.15)' : 'var(--bg-subtle)',
            color: limit === l ? 'var(--accent-primary)' : 'var(--text-dim)',
          }}>
            {l}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setAutoRefresh(r => !r)}
        title={autoRefresh
          ? 'Live: telegrams appear as they arrive — click to freeze the list'
          : pendingCount > 0
            ? `Frozen: ${pendingCount} newer telegram${pendingCount === 1 ? '' : 's'} not shown — click to go live`
            : 'Frozen — click to go live'}
        style={{
          display: 'flex', alignItems: 'center', gap: '0.25rem',
          padding: '0.2rem 0.45rem', borderRadius: 4, cursor: 'pointer', fontSize: '0.72rem',
          border: `1px solid ${autoRefresh ? 'var(--accent-primary)' : 'var(--border-color)'}`,
          background: autoRefresh ? 'rgba(99,102,241,0.15)' : 'var(--bg-subtle)',
          color: autoRefresh ? 'var(--accent-primary)' : 'var(--text-dim)',
        }}
      >
        {autoRefresh ? <ToggleRight size={13} /> : <ToggleLeft size={13} />}
        Live
      </button>
      {!autoRefresh && pendingCount > 0 && (
        <span style={{
          padding: '0 0.3rem', borderRadius: 999, fontSize: '0.65rem', fontWeight: 700,
          background: 'var(--accent-primary)', color: 'white',
        }}>
          {pendingCount > 99 ? '99+' : pendingCount} new
        </span>
      )}

      <button
        type="button"
        onClick={refresh} disabled={selectedCount === 0} title="Refresh now"
        style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-dim)', padding: '0.2rem', display: 'flex' }}
      >
        <RefreshCw size={15} />
      </button>

      {lastFetchedAt && (
        <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)' }}>
          {format(lastFetchedAt, 'HH:mm:ss')}
        </span>
      )}
    </div>
  );

  const title = <div style={{ fontWeight: 600, fontSize: '0.875rem', flexShrink: 0 }}>Last Seen Values</div>;

  let stripe = 0;

  const toggleKey = (key: string, subordinate: string[], e: React.MouseEvent) => {
    const next = !expandedSet.has(key);
    const targets = (e.ctrlKey || e.metaKey) ? [key, ...subordinate] : [key];
    const targetSet = new Set(targets);
    setExpanded(next
      ? [...new Set([...expanded, ...targets])]
      : expanded.filter(item => !targetSet.has(item)));
  };

  const addressActions = (mode: 'ga' | 'pa', address: string, sample?: Telegram) => renderAddressActions({
    mode,
    address,
    name: mode === 'ga' ? sample?.target_name : sample?.source_name,
    dptMain: sample?.dpt_main,
    dptSub: sample?.dpt_sub,
    filterActive: mode === 'ga' ? focusGas.includes(address) : focusDevices.includes(address),
    onFocusFilter,
    onVisualize: mode === 'ga' ? onQuickVisualize : onQuickVisualizeSource,
    onLastSeen: onQuickLastSeen,
    canSend,
  });

  const identityFor = (item: Group, open: boolean, count: number, subordinate: string[], sample?: Telegram) => {
    const kind = item.kind === 'pa' ? 'source' : 'target';
    const showName = kind === 'source' ? visibleColumns?.sourceName !== false : visibleColumns?.targetName !== false;
    const toggleTitle = subordinate.length > 0
      ? 'Click to expand or collapse · ctrl/cmd-click does the same for every group inside'
      : undefined;
    return (
      <div
        onClick={e => toggleKey(item.key, subordinate, e)}
        title={toggleTitle}
        style={{ padding: CELL_PADDING, minWidth: 0, display: 'flex', alignItems: 'flex-start', gap: '0.35rem', cursor: 'pointer' }}
      >
        <button
          type="button"
          aria-expanded={open}
          aria-label={item.name ? `${item.address} ${item.name}` : item.address}
          title={toggleTitle}
          onClick={e => { e.stopPropagation(); toggleKey(item.key, subordinate, e); }}
          style={{
            display: 'flex', alignItems: 'flex-start', flexShrink: 0, marginTop: '0.15rem',
            background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit',
          }}
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <TelegramAddressLines
          address={item.address}
          name={item.name}
          kind={kind}
          showName={showName}
          actions={(
            <span onClick={e => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              {addressActions(item.kind, item.address, sample)}
            </span>
          )}
          trailing={(
            <span title="Telegrams" style={{
              height: '1rem', boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.65rem', fontWeight: 700, fontVariantNumeric: 'tabular-nums', lineHeight: 1, minWidth: '1.4rem',
              padding: '0 0.35rem', borderRadius: '999px',
              background: 'rgba(99,102,241,0.15)', color: 'var(--accent-primary)', border: '1px solid rgba(99,102,241,0.3)',
            }}>{count}</span>
          )}
        />
      </div>
    );
  };

  const toggleHighlight = (event: React.MouseEvent, key: string) => {
    event.stopPropagation();
    const next = highlightedSet.has(key)
      ? highlightedList.filter(item => item !== key)
      : [...highlightedList, key];
    setHighlightedList(next);
  };

  const gotoButton = (telegram: Telegram) => (
    <button
      type="button"
      className="quick-filter-btn"
      title="Show this telegram in the middle of the telegram list"
      aria-label={`Go to ${telegram.timestamp}`}
      style={{ opacity: 0.7 }}
      onClick={event => {
        event.stopPropagation();
        onGotoTelegram?.(telegram);
      }}
    >
      <Clock size={12} />
    </button>
  );

  const rowCells = (
    telegram: Telegram | undefined,
    index: number,
    rows: Telegram[],
    opts: { identityAt?: 'source' | 'target'; identity?: React.ReactNode; hide?: Array<'source' | 'target' | 'delta'> },
  ) => columns.map(column => {
    const id = column.id;
    if (opts.identityAt === id) return <React.Fragment key={id}>{opts.identity}</React.Fragment>;
    if (!telegram || opts.hide?.includes(id as 'source' | 'target' | 'delta')) return <TelegramEmptyCell key={id} />;
    const deltas = deltaPair(rows, index);
    return (
      <React.Fragment key={id}>
        {renderTelegramCell(id, {
          telegram,
          deltaTop: deltas.top,
          deltaBottom: deltas.bottom,
          showSourceName: visibleColumns?.sourceName !== false,
          showTargetName: visibleColumns?.targetName !== false,
          showRaw: visibleColumns?.data !== false,
          blankEmptyValue: true,
          timeAction: id === 'time' ? gotoButton(telegram) : undefined,
          sourceActions: addressActions('pa', telegram.source_address, telegram),
          targetActions: addressActions('ga', telegram.target_address, telegram),
        })}
      </React.Fragment>
    );
  });

  const rowFrame = (
    key: string,
    className: string,
    style: React.CSSProperties,
    cells: React.ReactNode,
    leading: React.ReactNode,
  ) => (
    <div key={key} className={className} style={{ display: 'flex', alignItems: 'stretch', minHeight: 60, ...style }}>
      {leading}
      <div style={{ flex: 1, minWidth: 0, display: 'grid', gridTemplateColumns: gridTemplate, alignItems: 'start' }}>
        {cells}
      </div>
    </div>
  );

  const groupHeader = (item: Group, hide: Array<'source' | 'target'> = [], subordinate: string[] = []) => {
    const open = expandedSet.has(item.key);
    const rows = item.rows;
    const identityAt = item.kind === 'pa' ? 'source' : 'target';
    return rowFrame(
      item.key,
      'last-seen-group',
      {
        borderBottom: '1px solid var(--border-color)', fontSize: '0.8125rem',
        background: 'color-mix(in srgb, var(--accent-primary) 5%, var(--bg-subtle))',
      },
      rowCells(rows[0], 0, rows, { identityAt, identity: identityFor(item, open, rows.length, subordinate, rows[0]), hide: [...hide, 'delta'] }),
      <div aria-hidden style={{ width: MARK_STRIPE_WIDTH, flexShrink: 0 }} />,
    );
  };

  const telegramRows = (rows: Telegram[], hide: Array<'source' | 'target'>, endGroup = false) => rows.map((telegram, index) => {
    const key = anchorKey(telegram);
    const highlighted = highlightedSet.has(key);
    const color = telegramColor(targetColors, telegram);
    // An active stripe with a focus colour is that colour. A row the focus
    // lists left uncoloured keeps its resting background; only the stripe
    // takes the gray mark.
    const resting = color
      ? `color-mix(in srgb, ${color} 9%, transparent)`
      : stripe % 2 === 0 ? 'var(--bg-subtle)' : 'transparent';
    const stripeSurface = highlighted
      ? (color ?? UNCOLORED_MARK_STRIPE)
      : resting;
    stripe += 1;
    const endsGroup = endGroup && index === rows.length - 1;
    return rowFrame(
      key,
      `log-row${endsGroup ? ' last-seen-group-end' : ''}`,
      {
        borderBottom: endsGroup ? '2px solid var(--text-dim)' : '1px solid var(--border-color)',
        fontSize: '0.8125rem',
        background: resting,
      },
      rowCells(telegram, index, rows, { hide }),
      <button
        type="button"
        className="mark-stripe"
        aria-pressed={highlighted}
        aria-label={`Mark ${telegram.timestamp}`}
        title={highlighted ? 'Remove the highlight from this telegram' : 'Highlight this telegram'}
        onClick={event => toggleHighlight(event, key)}
        style={{
          width: MARK_STRIPE_WIDTH,
          flexShrink: 0,
          alignSelf: 'stretch',
          padding: 0,
          border: 'none',
          cursor: 'pointer',
          background: stripeSurface,
        }}
      />,
    );
  });

  return (
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {headerSlot
          ? createPortal(<>{title}{headerControls}</>, headerSlot)
          : (
            <div style={{
              padding: '0.65rem 1rem', borderBottom: '1px solid var(--border-color)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              flexShrink: 0, gap: '1rem',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', minWidth: 0 }}>
                <Clock size={15} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
                {title}
              </div>
              {headerControls}
            </div>
          )}

        <div style={{ flex: 1, overflowY: 'auto' }} className="custom-scrollbar">
          {selectedCount === 0 ? (
            <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.875rem' }}>
              Turn on Last seen values for group addresses or devices in Focus.
            </div>
          ) : flat.length === 0 ? (
            <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.875rem' }}>
              No telegrams for the selected addresses.
            </div>
          ) : (
            <>
              <div className="last-seen-header" style={{ ...telegramHeaderFrameStyle, position: 'sticky', top: 0 }}>
                <div aria-hidden style={{ width: MARK_STRIPE_WIDTH, flexShrink: 0 }} />
                <TelegramColumnHeader
                  columns={columns}
                  gridTemplate={gridTemplate}
                  onResizeStart={resizeStart}
                  onResetWidth={resetWidth}
                />
              </div>
              {groups.map(item => {
                if (group === 'none') return <React.Fragment key={item.key}>{telegramRows(item.rows, [])}</React.Fragment>;
                const open = expandedSet.has(item.key);
                const children = item.children ?? [];
                if (group === 'both') {
                  return (
                    <div key={item.key}>
                      {groupHeader(item, [], children.map(child => child.key))}
                      {open && children.map(child => {
                        const childOpen = expandedSet.has(child.key);
                        return (
                          <div key={child.key}>
                            {groupHeader(child, ['source'])}
                            {childOpen && telegramRows(child.rows, ['source', 'target'], true)}
                          </div>
                        );
                      })}
                    </div>
                  );
                }
                const hide = item.kind === 'pa' ? ['source' as const] : ['target' as const];
                return (
                  <div key={item.key}>
                    {groupHeader(item)}
                    {open && telegramRows(item.rows, hide, true)}
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
