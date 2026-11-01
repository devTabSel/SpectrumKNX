import React, { createContext, useContext } from 'react';
import { focusLoupeTitle } from '../utils/focusClick';
import { formatDpt } from '../utils/knxSend';
import { toggleSendPanel } from '../utils/sendPanel';
import { invokeToggle, toggleTitle, type ToggleGesture } from '../utils/toggleClick';
import { toggleWritePanelAddress, useWritePanelHas } from '../utils/writePanelRows';
import { format } from 'date-fns';
import { Clock, Filter, LineChart, Search, Send } from 'lucide-react';
import type { Telegram } from '../hooks/useWebSocket';
import type { ColId } from './telegramColumns';

/** Unified padding for every telegram cell, in the list and in Last Seen. */
export const CELL_PADDING = '0.75rem 1rem';

export const formatDeltaMs = (diffMs: number, sign: '+' | '-'): string => {
  const mm = String(Math.floor(diffMs / 60000)).padStart(2, '0');
  const ss = String(Math.floor((diffMs % 60000) / 1000)).padStart(2, '0');
  const ms = String(diffMs % 1000).padStart(3, '0');
  return `${sign} ${mm}:${ss}.${ms}`;
};

/**
 * Newest-first pair: the top line is the gap toward the newer neighbour,
 * the bottom line the gap toward the older one. Matches a descending time sort.
 */
export function deltaPair(rows: { timestamp: string }[], index: number): { top: string | null; bottom: string | null } {
  const at = (i: number) => new Date(rows[i].timestamp).getTime();
  const curr = at(index);
  const top = index > 0 ? formatDeltaMs(Math.abs(curr - at(index - 1)), '-') : null;
  const bottom = index < rows.length - 1 ? formatDeltaMs(Math.abs(at(index + 1) - curr), '+') : null;
  return { top, bottom };
}

const getTypeColor = (type?: string | null) => {
  switch (type) {
    case 'Write': return 'var(--accent-primary)';
    case 'Read': return 'var(--warning-text)';
    case 'Response': return 'var(--success)';
    default: return 'var(--text-dim)';
  }
};

const getDPTColor = (dptMain: number | null) => {
  if (dptMain === 1) return 'var(--dpt-1, #818cf8)';
  if (dptMain === 5) return 'var(--dpt-5, #34d399)';
  if (dptMain === 9) return 'var(--dpt-9, #fb923c)';
  return 'var(--dpt-unknown, #6b7280)';
};

const getDPTLabel = (dptMain: number | null) => {
  if (dptMain === 1) return 'DPT 1.x – Binary / Switch';
  if (dptMain === 5) return 'DPT 5.x – 8-bit unsigned';
  if (dptMain === 9) return 'DPT 9.x – 2-byte float';
  if (dptMain != null) return `DPT ${dptMain}.x`;
  return 'Unknown DPT';
};

const dptKeyLabel = (dptMain: number | null, dptSub: number | null): string | null => {
  if (dptMain == null) return null;
  if (dptSub == null) return `${dptMain}.x`;
  return `${dptMain}.${String(dptSub).padStart(3, '0')}`;
};

const dptDescriptionLabel = (dptName: string | null, unit: string | null | undefined): string | null => {
  if (!dptName) return unit ? `(${unit})` : null;
  const cleaned = dptName.trim();
  const withoutCode = cleaned.replace(/^\d+(?:\.\d+)?\s*[-–:]\s*/u, '').trim();
  const base = withoutCode.length > 0 ? withoutCode : cleaned;
  return unit ? `${base} (${unit})` : base;
};

const NAME_LINE_STYLE: React.CSSProperties = {
  fontSize: '0.7rem',
  color: 'var(--text-main)',
  fontWeight: 500,
};

type LineStyleRule = { regex: string; style: React.CSSProperties };
type ColumnLineStyles = {
  top?: React.CSSProperties;
  bottom?: React.CSSProperties;
  topConditional?: LineStyleRule[];
  bottomConditional?: LineStyleRule[];
};

const DEFAULT_COLUMN_LINE_STYLES: Partial<Record<ColId, ColumnLineStyles>> = {
  time: {
    top: { color: 'var(--text-main)', fontVariantNumeric: 'tabular-nums', fontWeight: 500 },
    bottom: { fontSize: '0.65rem', color: 'var(--text-dim)', marginTop: '0.15rem', fontVariantNumeric: 'tabular-nums' },
  },
  delta: {
    top: { fontSize: '0.65rem', color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums', minHeight: '1em' },
    bottom: { fontSize: '0.65rem', color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums', minHeight: '1em', marginTop: '0.02rem' },
    topConditional: [{ regex: '/^-/', style: NAME_LINE_STYLE }],
    bottomConditional: [{ regex: '/^-/', style: NAME_LINE_STYLE }],
  },
  source: {
    bottom: { ...NAME_LINE_STYLE, marginTop: '0.15rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  },
  target: {
    bottom: { ...NAME_LINE_STYLE, marginTop: '0.15rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  },
  dpt: {
    top: { fontSize: '0.75rem', color: 'var(--text-main)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 },
    bottom: { fontSize: '0.68rem', color: 'var(--text-dim)', marginTop: '0.12rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  },
};

function lineStyle(colId: ColId, line: 'top' | 'bottom', lineText?: string): React.CSSProperties | undefined {
  const styles = DEFAULT_COLUMN_LINE_STYLES[colId];
  const base = styles?.[line];
  const rules = (line === 'top' ? styles?.topConditional : styles?.bottomConditional) ?? [];
  let conditional: React.CSSProperties | undefined;
  if (lineText && rules.length > 0) {
    for (const rule of rules) {
      const match = rule.regex.match(/^\/(.*)\/([a-z]*)$/i);
      let re: RegExp | null = null;
      try {
        re = match ? new RegExp(match[1], match[2]) : new RegExp(rule.regex);
      } catch {
        re = null;
      }
      if (re?.test(lineText)) {
        conditional = rule.style;
        break;
      }
    }
  }
  if (!base && !conditional) return undefined;
  return { ...(base ?? {}), ...(conditional ?? {}) };
}

export interface TelegramCellContent {
  telegram: Telegram;
  deltaTop?: string | null;
  deltaBottom?: string | null;
  showSourceName?: boolean;
  showTargetName?: boolean;
  showRaw?: boolean;
  sourceActions?: React.ReactNode;
  targetActions?: React.ReactNode;
  typeAction?: React.ReactNode;
  dptAction?: React.ReactNode;
  valueAction?: React.ReactNode;
  /** Sits at the right of the value, used by a Last Seen group to remove itself. */
  valueExtra?: React.ReactNode;
  /** Sits beside the timestamp. Last Seen uses it to jump to this telegram in the list. */
  timeAction?: React.ReactNode;
  /** Last Seen leaves the value cell blank when the telegram has no value. */
  blankEmptyValue?: boolean;
}

/** Address and name lines shared by a source or target cell and a group header. */
export const TelegramAddressLines: React.FC<{
  address: string;
  name?: string | null;
  kind: 'source' | 'target';
  showName?: boolean;
  /** Sits on the address line, directly after the address. */
  actions?: React.ReactNode;
  /** Sits at the right of the address line, after the actions. */
  trailing?: React.ReactNode;
}> = ({ address, name, kind, showName = true, actions, trailing }) => (
  <span style={{ minWidth: 0, flex: 1 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0 }}>
      <div
        className="mono-addr highlight-target"
        style={{ color: 'var(--accent-primary)', fontWeight: 500, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        {address}
      </div>
      {actions}
      {trailing && <span style={{ marginLeft: 'auto', flexShrink: 0 }}>{trailing}</span>}
    </div>
    {showName && (
      <div className="subtitle-name" title={name || undefined} style={lineStyle(kind, 'bottom')}>
        {name || '-'}
      </div>
    )}
  </span>
);

export const TelegramEmptyCell = () => <div style={{ padding: CELL_PADDING }} />;

type AddressHandler = (address: string, mode: 'ga' | 'pa', gesture: ToggleGesture) => void;

/** Lists and handlers shared by every address cluster rendered inside the app. */
export interface AddressActionState {
  focusGas?: readonly string[];
  focusDevices?: readonly string[];
  focusFilterGas?: readonly string[];
  focusFilterDevices?: readonly string[];
  lastSeenGas?: readonly string[];
  lastSeenDevices?: readonly string[];
  visualizedGas?: readonly string[];
  visualizedDevices?: readonly string[];
  onFocus?: AddressHandler;
  onFilter?: AddressHandler;
  onVisualize?: AddressHandler;
  onLastSeen?: AddressHandler;
  canSend?: boolean;
}

const AddressActionContext = createContext<AddressActionState | null>(null);

export const AddressActionProvider = AddressActionContext.Provider;

function listed(list: readonly string[] | undefined, address: string): boolean {
  return !!list?.includes(address);
}

function SendToggle({ address, dpt }: { address: string; dpt: string }) {
  const present = useWritePanelHas(address);
  return (
    <button
      type="button"
      className={`quick-send-btn ${present ? 'active' : ''}`}
      aria-pressed={present}
      aria-label="Send to this GA"
      title="Send to this GA. Click opens or closes the send panel. Ctrl-click adds or removes this GA."
      onClick={e => {
        e.stopPropagation();
        if (e.altKey && (e.ctrlKey || e.metaKey || e.shiftKey)) return;
        if (e.ctrlKey || e.metaKey) {
          e.preventDefault();
          toggleWritePanelAddress(address, dpt);
          return;
        }
        if (e.shiftKey) return;
        toggleSendPanel();
      }}
    >
      <Send size={12} />
    </button>
  );
}

/**
 * The telegram-table cluster. A physical address shows focus, filter, visualize
 * and last seen. A group address adds send. Each toggle mirrors and operates
 * the matching control in the focus list.
 */
export function AddressActions(opts: {
  mode: 'ga' | 'pa';
  address: string;
  name?: string | null;
  dptMain?: number | null;
  dptSub?: number | null;
  /** Always visible. The telegram list reveals the icons on row hover. */
  inline?: boolean;
  focusOn?: boolean;
  filterOn?: boolean;
  visualizeOn?: boolean;
  lastSeenOn?: boolean;
  onFocus?: AddressHandler;
  onFilter?: AddressHandler;
  onVisualize?: AddressHandler;
  onLastSeen?: AddressHandler;
  canSend?: boolean;
}): React.ReactNode {
  const shared = useContext(AddressActionContext);
  const { mode, address, inline = false } = opts;
  const mine = (gas?: readonly string[], devices?: readonly string[]) => (
    mode === 'ga' ? listed(gas, address) : listed(devices, address)
  );
  const focusOn = opts.focusOn ?? mine(shared?.focusGas, shared?.focusDevices);
  const filterOn = opts.filterOn ?? mine(shared?.focusFilterGas, shared?.focusFilterDevices);
  const visualizeOn = opts.visualizeOn ?? mine(shared?.visualizedGas, shared?.visualizedDevices);
  const lastSeenOn = opts.lastSeenOn ?? mine(shared?.lastSeenGas, shared?.lastSeenDevices);
  const onFocus = opts.onFocus ?? shared?.onFocus;
  const onFilter = opts.onFilter ?? shared?.onFilter;
  const onVisualize = opts.onVisualize ?? shared?.onVisualize;
  const onLastSeen = opts.onLastSeen ?? shared?.onLastSeen;
  const canSend = opts.canSend ?? shared?.canSend ?? false;
  const visualizeLabel = mode === 'ga' ? 'Visualize this GA' : 'Visualize this device';
  return (
    <span className={inline ? 'address-actions-inline' : undefined} style={{ display: 'inline-flex', alignItems: 'center' }}>
      <button
        type="button"
        className={`quick-filter-btn focus-filter-btn ${focusOn ? 'active' : ''}`}
        aria-pressed={focusOn}
        aria-label="Toggle focus"
        onClick={e => { e.stopPropagation(); invokeToggle(e, onFocus, address, mode); }}
        title={focusLoupeTitle()}
      >
        <Search className="filter-icon" size={12} />
      </button>
      <button
        type="button"
        className={`quick-filter-btn focus-filter-btn ${filterOn ? 'active' : ''}`}
        aria-pressed={filterOn}
        aria-label="Focus filter"
        onClick={e => { e.stopPropagation(); invokeToggle(e, onFilter, address, mode); }}
        title={toggleTitle('Focus filter', 'the telegram list')}
      >
        <Filter className="filter-icon" size={12} />
      </button>
      <button
        type="button"
        className={`quick-visualize-btn ${visualizeOn ? 'active' : ''}`}
        aria-pressed={visualizeOn}
        aria-label={visualizeLabel}
        onClick={e => { e.stopPropagation(); invokeToggle(e, onVisualize, address, mode); }}
        title={toggleTitle(visualizeLabel, 'Visualization')}
      >
        <LineChart size={12} />
      </button>
      <button
        type="button"
        className={`quick-last-seen-btn ${lastSeenOn ? 'active' : ''}`}
        aria-pressed={lastSeenOn}
        aria-label="Toggle last seen values"
        onClick={e => { e.stopPropagation(); invokeToggle(e, onLastSeen, address, mode); }}
        title={toggleTitle('Toggle last seen values', 'Last Seen')}
      >
        <Clock size={12} />
      </button>
      {canSend && mode === 'ga' && (
        <SendToggle address={address} dpt={formatDpt(opts.dptMain, opts.dptSub)} />
      )}
    </span>
  );
}

/** Focus, filter, visualize, last seen and (for a group address) send, beside an address. */
export function renderAddressActions(opts: {
  mode: 'ga' | 'pa';
  address: string;
  name?: string | null;
  dptMain?: number | null;
  dptSub?: number | null;
  inline?: boolean;
  focusOn?: boolean;
  filterOn?: boolean;
  visualizeOn?: boolean;
  lastSeenOn?: boolean;
  /** @deprecated Use focusOn. */
  filterActive?: boolean;
  onFocus?: AddressHandler;
  /** @deprecated Use onFocus. */
  onFocusFilter?: AddressHandler;
  onFilter?: AddressHandler;
  onVisualize?: AddressHandler;
  onLastSeen?: AddressHandler;
  canSend?: boolean;
}): React.ReactNode {
  return (
    <AddressActions
      mode={opts.mode}
      address={opts.address}
      name={opts.name}
      dptMain={opts.dptMain}
      dptSub={opts.dptSub}
      inline={opts.inline}
      focusOn={opts.focusOn ?? opts.filterActive}
      filterOn={opts.filterOn}
      visualizeOn={opts.visualizeOn}
      lastSeenOn={opts.lastSeenOn}
      onFocus={opts.onFocus ?? opts.onFocusFilter}
      onFilter={opts.onFilter}
      onVisualize={opts.onVisualize}
      onLastSeen={opts.onLastSeen}
      canSend={opts.canSend}
    />
  );
}

/** Body of one telegram column. The list passes its row actions; Last Seen leaves them out. */
export function renderTelegramCell(id: ColId, cell: TelegramCellContent): React.ReactNode {
  const t = cell.telegram;
  switch (id) {
    case 'time':
      return (
        <div style={{ padding: CELL_PADDING, display: 'flex', alignItems: 'flex-start', gap: '0.35rem' }}>
          <div>
            <div className="mono-addr" style={lineStyle('time', 'top')}>
              {format(new Date(t.timestamp), 'HH:mm:ss.SS')}
            </div>
            <div className="subtitle-name" style={lineStyle('time', 'bottom')}>
              {format(new Date(t.timestamp), 'yyyy-MM-dd')}
            </div>
          </div>
          {cell.timeAction}
        </div>
      );

    case 'delta': {
      const topText = cell.deltaTop ?? '';
      const bottomText = cell.deltaBottom ?? '';
      return (
        <div style={{ padding: CELL_PADDING, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.16rem' }}>
          <div className="mono-addr" style={lineStyle('delta', 'top', topText)}>
            {topText}
          </div>
          <div className="mono-addr" style={lineStyle('delta', 'bottom', bottomText)}>
            {bottomText}
          </div>
        </div>
      );
    }

    case 'source':
      return (
        <div style={{ padding: CELL_PADDING, minWidth: 0, overflow: 'hidden' }} className="filterable-cell">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0 }}>
            <div className="mono-addr highlight-target" style={{ color: 'var(--accent-primary)', fontWeight: 500 }}>
              {t.source_address}
            </div>
            {cell.sourceActions}
          </div>
          {cell.showSourceName && (
            <div className="subtitle-name" title={t.source_name || undefined} style={lineStyle('source', 'bottom')}>
              {t.source_name || '-'}
            </div>
          )}
        </div>
      );

    case 'target':
      return (
        <div style={{ padding: CELL_PADDING, minWidth: 0, overflow: 'hidden' }} className="filterable-cell">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0 }}>
            <div className="mono-addr highlight-target" style={{ color: 'var(--accent-primary)', fontWeight: 500 }}>
              {t.target_address}
            </div>
            {cell.targetActions}
          </div>
          {cell.showTargetName && (
            <div className="subtitle-name" title={t.target_name || undefined} style={lineStyle('target', 'bottom')}>
              {t.target_name || '-'}
            </div>
          )}
        </div>
      );

    case 'type':
      return (
        <div style={{ padding: CELL_PADDING, minWidth: 0, overflow: 'hidden' }} className="filterable-cell">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0 }}>
            <div style={{ color: getTypeColor(t.simplified_type), fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase' }}>
              {t.simplified_type || t.telegram_type}
            </div>
            {cell.typeAction}
          </div>
          <div style={{ fontSize: '0.65rem', color: t.direction === 'Outgoing' ? '#f59e0b' : '#10b981', marginTop: '0.1rem', opacity: 0.8 }}>{t.direction === 'Outgoing' ? 'Outgoing' : 'Incoming'}</div>
        </div>
      );

    case 'dpt':
      return (
        <div style={{ padding: CELL_PADDING, minWidth: 0, overflow: 'hidden' }} className="filterable-cell">
          {t.dpt_main != null ? (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', minWidth: 0 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0 }}>
                  <div title={getDPTLabel(t.dpt_main)} style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: getDPTColor(t.dpt_main), flexShrink: 0 }} />
                  <div title={dptKeyLabel(t.dpt_main, t.dpt_sub) ?? undefined} style={lineStyle('dpt', 'top')}>
                    {dptKeyLabel(t.dpt_main, t.dpt_sub) ?? '-'}
                  </div>
                  {cell.dptAction}
                </div>
                <div title={dptDescriptionLabel(t.dpt_name, t.unit) ?? undefined} style={lineStyle('dpt', 'bottom')}>
                  {dptDescriptionLabel(t.dpt_name, t.unit) ?? '-'}
                </div>
              </div>
            </div>
          ) : '-'}
        </div>
      );

    case 'value': {
      const valueText = t.value_formatted || (t.value_numeric !== null && t.value_numeric !== undefined ? String(t.value_numeric) : '');
      const content = (
        <>
          {!(cell.blankEmptyValue && !valueText) && (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, color: 'var(--accent-primary)', fontSize: '0.9375rem', wordBreak: 'break-all', whiteSpace: 'normal', lineHeight: 1.2 }}>
              {valueText || '-'}
            </span>
            {t.unit && <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)', fontWeight: 500 }}>{t.unit}</span>}
            {cell.valueAction}
          </div>
          )}
          {cell.showRaw && t.raw_hex && (
            <div style={{ marginTop: '0.18rem', fontSize: '0.65rem', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
              {t.raw_hex}
            </div>
          )}
        </>
      );
      if (!cell.valueExtra) {
        return <div style={{ padding: CELL_PADDING }} className="filterable-cell">{content}</div>;
      }
      return (
        <div style={{ padding: CELL_PADDING, display: 'flex', alignItems: 'flex-start', gap: '0.5rem', minWidth: 0 }} className="filterable-cell">
          <div style={{ flex: 1, minWidth: 0 }}>{content}</div>
          {cell.valueExtra}
        </div>
      );
    }
  }
}
