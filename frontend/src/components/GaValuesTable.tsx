import React, { useState, useMemo, useContext } from 'react';
import { format } from 'date-fns';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { GaNameWidthContext } from '../utils/gaNameWidth';
import { useLastSeenValues } from '../hooks/useLastSeenValues';
import { AddressActions } from './telegramCell';
import type { Telegram } from '../hooks/useWebSocket';
import type { ToggleGesture } from '../utils/toggleClick';

// Sortable table of group addresses with their last seen values (#269).
// Used by the building view for a KO's linked GAs and a function's GAs (#306).

export interface GaTableEntry {
  address: string;
  name: string;
  /** DPT of the address, resolved from the project (#295). */
  dpt?: { main: number; sub: number | null; name?: string | null };
  /** The GA this KO sends on (first ETS link of a transmitting object). */
  sending?: boolean;
}

type SortKey = 'ga' | 'name' | 'time';

interface GaValuesTableProps {
  entries: GaTableEntry[];
  /** Indentation depth, matching the surrounding tree rows. */
  depth: number;
  /** Newest telegram from the live websocket feed; used to update values in place. */
  latestTelegram?: Telegram | null;
  /** Show the per-row "send to this GA" action when the bus is writable. */
  writeEnabled?: boolean;
  onFilterGAs: (addresses: string[]) => void;
  onLastSeen: (address: string | string[], mode: 'ga' | 'pa', gesture: ToggleGesture) => void;
  /** Open the visualization panel plotting this GA (#307). */
  onVisualizeGAs: (addresses: string[], gesture: ToggleGesture) => void;
  /** Toggle this GA in the Focus-list target filter. Falls back to the panel filter. */
  onFocusFilter?: (address: string, mode: 'ga' | 'pa', reveal?: ToggleGesture) => void;
  focusFilterGas?: readonly string[];
  /** The KO table shows the columns without the header row. */
  hideHeader?: boolean;
  /** Header is centered in a short gap between the KO row and the first address row. */
  alignToKo?: boolean;
  /** Left edge of the communication-object name. The GA column lines up with it. */
  insetLeft?: string;
  /** Fixed tracks matching the communication-object summary on the row above. */
  alignColumns?: { ga: string; name: string; dpt: string; time: string; actions: string };
}

const gaSortValue = (address: string): number => {
  const parts = address.split('/').map(Number);
  if (parts.some(Number.isNaN)) return Number.MAX_SAFE_INTEGER;
  return parts.reduce((acc, p) => acc * 2048 + p, 0);
};

// "1.011 - Switch" → "1.011 Switch"; falls back to the bare "main.sub" number (#295).
const formatDptLabel = (dpt?: GaTableEntry['dpt']): string | null => {
  if (!dpt || dpt.main == null) return null;
  const num = dpt.sub != null ? `${dpt.main}.${String(dpt.sub).padStart(3, '0')}` : String(dpt.main);
  let desc = '';
  if (dpt.name) {
    const sep = dpt.name.indexOf(' - ');
    desc = sep >= 0 ? dpt.name.slice(sep + 3) : dpt.name === num ? '' : dpt.name;
  }
  return desc ? `${num} ${desc}` : num;
};

/** Column tracks shared by a KO summary and its group-address table, so DPT, time and value line up. */
export function gaAlignColumns(addresses: string[], dptTexts: string[], nameCh: number | null): {
  ga: string; name: string; dpt: string; time: string; actions: string; grid: string;
} {
  const gaChars = Math.max(4, ...addresses.map(address => address.length));
  const dptChars = Math.max(3, ...dptTexts.map(text => text.length));
  const name = `calc(${nameCh ?? 16}ch + 1rem)`;
  const ga = `calc(${gaChars}ch + 1.75rem)`;
  const dpt = `calc(${dptChars}ch + 1.25rem)`;
  const time = '12rem';
  const actions = '9.5rem';
  return {
    ga, name, dpt, time, actions,
    grid: `${ga} ${name} ${dpt} ${time} minmax(0, 1fr) ${actions}`,
  };
}

const cellStyle: React.CSSProperties = {
  padding: '0.25rem 0.5rem',
  fontSize: '0.72rem',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  textAlign: 'left',
  verticalAlign: 'middle',
};

/** Equal, short space above and below a table header, between the parent row and the first address. */
const HEADER_GAP = '0.1rem';
const headerBandStyle: React.CSSProperties = { paddingTop: HEADER_GAP, paddingBottom: HEADER_GAP, lineHeight: 1 };

const HeaderCell: React.FC<{
  label: string;
  sortKey?: SortKey;
  sort: { key: SortKey; dir: 'asc' | 'desc' } | null;
  onSort: (key: SortKey) => void;
  /** Drop the left padding so the label starts on the column edge. */
  flush?: boolean;
}> = ({ label, sortKey, sort, onSort, flush = false }) => {
  const active = sortKey != null && sort?.key === sortKey;
  return (
    <th
      style={{
        ...cellStyle,
        fontSize: '0.62rem', fontWeight: 600, textTransform: 'uppercase',
        letterSpacing: '0.04em', color: 'var(--text-dim)',
        cursor: sortKey ? 'pointer' : 'default', userSelect: 'none',
        borderBottom: '1px solid var(--border-subtle)',
        boxSizing: 'border-box',
        ...headerBandStyle,
        ...(flush ? { paddingLeft: 0 } : {}),
      }}
      onClick={sortKey ? (e => { e.stopPropagation(); onSort(sortKey); }) : undefined}
      title={sortKey ? `Sort by ${label.toLowerCase()}` : undefined}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.15rem' }}>
        {label}
        {active && (sort!.dir === 'asc' ? <ChevronUp size={10} /> : <ChevronDown size={10} />)}
      </span>
    </th>
  );
};

export const GaValuesTable: React.FC<GaValuesTableProps> = ({
  entries, depth, latestTelegram, writeEnabled, onLastSeen, onVisualizeGAs,
  onFocusFilter, focusFilterGas, hideHeader = false, alignToKo = false, insetLeft, alignColumns,
}) => {
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' } | null>(null);
  const nameWidthCh = useContext(GaNameWidthContext);
  const nameColumnStyle: React.CSSProperties = nameWidthCh
    ? { width: `${nameWidthCh}ch`, maxWidth: `${nameWidthCh}ch` }
    : { maxWidth: 300 };

  const addresses = useMemo(() => entries.map(e => e.address), [entries]);
  const valuesByGA = useLastSeenValues(addresses, latestTelegram);

  const handleSort = (key: SortKey) =>
    setSort(prev => {
      if (prev?.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      return null; // third click restores ETS order
    });

  const sorted = useMemo(() => {
    if (!sort) return entries;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...entries].sort((a, b) => {
      switch (sort.key) {
        case 'ga':
          return dir * (gaSortValue(a.address) - gaSortValue(b.address));
        case 'name':
          return dir * (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
        case 'time': {
          // Never-seen entries always sort to the end.
          const ta = valuesByGA[a.address] ? new Date(valuesByGA[a.address].timestamp).getTime() : null;
          const tb = valuesByGA[b.address] ? new Date(valuesByGA[b.address].timestamp).getTime() : null;
          if (ta === null && tb === null) return 0;
          if (ta === null) return 1;
          if (tb === null) return -1;
          return dir * (ta - tb);
        }
      }
    });
  }, [entries, sort, valuesByGA]);

  return (
    <div style={alignToKo ? {
      marginTop: HEADER_GAP,
      padding: `0 0.75rem 0.2rem ${insetLeft ?? `calc(${0.75 + depth * 1.1}rem + 12px + 0.4rem)`}`,
    } : { padding: `${HEADER_GAP} 0.75rem 0.2rem ${0.75 + depth * 1.1}rem` }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: alignColumns ? 'fixed' : 'auto' }}>
        {alignColumns && (
          <colgroup>
            <col style={{ width: alignColumns.ga }} />
            <col style={{ width: alignColumns.name }} />
            <col style={{ width: alignColumns.dpt }} />
            <col style={{ width: alignColumns.time }} />
            <col />
            <col style={{ width: alignColumns.actions }} />
          </colgroup>
        )}
        {!hideHeader && (
        <thead>
          <tr>
            <HeaderCell label="GA" sortKey="ga" sort={sort} onSort={handleSort} flush={!!alignColumns} />
            <HeaderCell label="Name" sortKey="name" sort={sort} onSort={handleSort} />
            <HeaderCell label="DPT" sort={sort} onSort={handleSort} />
            <HeaderCell label="Time" sortKey="time" sort={sort} onSort={handleSort} />
            <HeaderCell label="Value" sort={sort} onSort={handleSort} />
            <th style={{
              ...cellStyle, boxSizing: 'border-box', borderBottom: '1px solid var(--border-subtle)',
              width: alignColumns ? undefined : '1%',
              ...headerBandStyle,
            }} />
          </tr>
        </thead>
        )}
        <tbody>
          {sorted.map((entry, rowIndex) => {
            const t = valuesByGA[entry.address];
            const dptLabel = formatDptLabel(entry.dpt);
            const focusOn = !!onFocusFilter && !!focusFilterGas?.includes(entry.address);
            const firstBand = rowIndex === 0 ? { paddingTop: HEADER_GAP } : {};
            return (
              <tr
                key={entry.address}
                style={entry.sending ? { background: 'rgba(99,102,241,0.08)' } : undefined}
                title={entry.sending ? 'Sending group address' : undefined}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                onMouseLeave={e => (e.currentTarget.style.background = entry.sending ? 'rgba(99,102,241,0.08)' : 'transparent')}
              >
                <td style={{ ...cellStyle, boxSizing: 'border-box', width: alignColumns ? undefined : '1%', ...(alignColumns ? { paddingLeft: 0 } : {}), ...firstBand }}>
                  {/* The sending GA is framed rather than icon-tagged (#295). */}
                  <span
                    aria-label={entry.sending ? 'sending' : undefined}
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      color: 'var(--accent-primary)',
                      fontWeight: entry.sending ? 700 : 400,
                      ...(entry.sending
                        ? {
                            display: 'inline-block',
                            border: '1px solid var(--accent-primary)',
                            borderRadius: '4px',
                            padding: '0.02rem 0.3rem',
                          }
                        : {}),
                    }}
                  >{entry.address}</span>
                </td>
                <td style={{ ...cellStyle, boxSizing: 'border-box', ...(alignColumns ? {} : nameColumnStyle), color: 'var(--text-dim)', ...firstBand }} title={entry.name || undefined}>
                  {entry.name || '—'}
                </td>
                <td style={{ ...cellStyle, boxSizing: 'border-box', width: alignColumns ? undefined : '1%', color: 'var(--text-dim)', ...firstBand }} title={dptLabel || undefined}>
                  {dptLabel || '—'}
                </td>
                <td
                  style={{ ...cellStyle, boxSizing: 'border-box', width: alignColumns ? undefined : '1%', color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums', ...firstBand }}
                  title={t ? `by ${t.source_address}${t.source_name ? ` (${t.source_name})` : ''}` : 'Never updated'}
                >
                  {t ? format(new Date(t.timestamp), 'yyyy-MM-dd HH:mm:ss.SS') : ''}
                </td>
                <td style={{ ...cellStyle, boxSizing: 'border-box', fontWeight: 600, color: t ? 'var(--text-main)' : 'var(--text-dim)', ...firstBand }}>
                  {t && (
                    <>
                      {t.value_formatted ?? t.value_numeric ?? '—'}
                      {t.unit && <span style={{ fontWeight: 400, color: 'var(--text-dim)' }}> {t.unit}</span>}
                    </>
                  )}
                </td>
                <td style={{ ...cellStyle, boxSizing: 'border-box', width: alignColumns ? undefined : '1%', overflow: 'visible', ...firstBand }}>
                  <AddressActions
                    inline
                    mode="ga"
                    address={entry.address}
                    name={entry.name}
                    dptMain={entry.dpt?.main}
                    dptSub={entry.dpt?.sub}
                    focusOn={focusOn}
                    onFocus={onFocusFilter}
                    onVisualize={(_address, _mode, gesture) => onVisualizeGAs([entry.address], gesture)}
                    onLastSeen={onLastSeen}
                    canSend={writeEnabled}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
