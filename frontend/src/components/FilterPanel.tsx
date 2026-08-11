import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Search, X, Clock, FolderInput, AlertTriangle, Minimize2, List, LineChart, Pin } from 'lucide-react';
import {
  type FilterOption,
  type FilterOptions,
  type ActiveFilters,
  type FilterCounts,
} from '../types/filters';
import { compareKnxAddress } from '../utils/knxAddress';
import { makeTextMatcher } from '../utils/quickFilter';
import { SendToGaPopover } from './SendToGaPopover';

type ToggleAction = 'pin' | 'list' | 'visualize' | 'lastseen';
type TriState = 'off' | 'mixed' | 'on';

const rowActionBtnStyle: React.CSSProperties = {
  background: 'transparent', border: '1px solid var(--border-color)', cursor: 'pointer',
  color: 'var(--text-dim)', padding: '0.15rem', borderRadius: '3px',
  display: 'flex', alignItems: 'center',
};

/** Borderless, inline style for the write-to-GA action next to the address text (#406). */
const writeActionBtnStyle: React.CSSProperties = {
  background: 'transparent', border: 'none', cursor: 'pointer',
  color: 'var(--text-dim)', padding: '0.1rem', borderRadius: '3px',
  display: 'inline-flex', alignItems: 'center', flexShrink: 0,
};

/** Toggle-icon style (#406): bordered per rowActionBtnStyle, accent-colored while active. */
const toggleIconBtnStyle = (active: boolean): React.CSSProperties => ({
  ...rowActionBtnStyle,
  color: active ? 'var(--accent-primary)' : 'var(--text-dim)',
  borderColor: active ? 'var(--accent-primary)' : 'var(--border-color)',
  background: active ? 'rgba(99,102,241,0.15)' : 'transparent',
});

const triStateButtonStyle = (state: TriState): React.CSSProperties => {
  if (state === 'mixed') {
    return {
      ...rowActionBtnStyle,
      color: 'var(--warning, #f59e0b)',
      borderColor: 'rgba(245, 158, 11, 0.45)',
      background: 'rgba(245, 158, 11, 0.12)',
    };
  }
  return toggleIconBtnStyle(state === 'on');
};

const TriStateButton: React.FC<{ state: TriState; title: string; onClick: (event: React.MouseEvent<HTMLButtonElement>) => void; children: React.ReactNode }> = ({ state, title, onClick, children }) => (
  <button
    onClick={onClick}
    title={title}
    style={{ ...triStateButtonStyle(state), opacity: 0.95, transition: 'all 0.15s' }}
  >
    {children}
  </button>
);

// The three row icons are real toggles (#406): they set/clear a flag on the
// item; they don't navigate anywhere (yet). Once set, an icon stays visible
// regardless of pin/hover state (#407); the `visible` prop otherwise mirrors
// the row's pinned-or-hovered state, computed by the caller.
const LastSeenButton: React.FC<{ active: boolean; visible: boolean; onClick: () => void }> = ({ active, visible, onClick }) => (
  <button
    onClick={onClick}
    title={active ? 'Unmark for Last Seen Values' : 'Mark for Last Seen Values'}
    aria-pressed={active}
    style={{ ...toggleIconBtnStyle(active), opacity: visible ? 0.9 : 0, transition: 'opacity 0.15s' }}
  >
    <Clock size={12} />
  </button>
);

const VisualizeButton: React.FC<{ active: boolean; visible: boolean; onClick: () => void }> = ({ active, visible, onClick }) => (
  <button
    onClick={onClick}
    title={active ? 'Unmark for Visualization' : 'Mark for Visualization'}
    aria-pressed={active}
    style={{ ...toggleIconBtnStyle(active), opacity: visible ? 0.9 : 0, transition: 'opacity 0.15s' }}
  >
    <LineChart size={12} />
  </button>
);

const ShowInListButton: React.FC<{ active: boolean; visible: boolean; onClick: () => void }> = ({ active, visible, onClick }) => (
  <button
    onClick={onClick}
    title={active ? 'Unmark for the Telegram List' : 'Mark for the Telegram List'}
    aria-pressed={active}
    style={{ ...toggleIconBtnStyle(active), opacity: visible ? 0.9 : 0, transition: 'opacity 0.15s' }}
  >
    <List size={12} />
  </button>
);


// ─── FilterPanel component ────────────────────────────────────────────────────

interface FilterPanelProps {
  options: FilterOptions;
  activeFilters: ActiveFilters;
  onFiltersChange: (f: ActiveFilters) => void;
  /** Live-only: count of telegrams that would match each option in isolation */
  counts?: FilterCounts;
  mode: 'live' | 'history';
  /** Reserved for future navigation from a row's Last Seen Values toggle
   * (#406) — the toggle currently only flips its own flag, it doesn't call this. */
  onQuickLastSeen?: (address: string, mode: 'ga' | 'pa') => void;
  /** Reserved for future navigation from a row's Visualization toggle (#406)
   * — the toggle currently only flips its own flag, it doesn't call this. */
  onVisualizeGAs?: (addresses: string[]) => void;
  /** Reserved for future navigation from a row's Telegram List toggle (#406)
   * — the toggle currently only flips its own flag, it doesn't call this. */
  onShowInTelegramList?: (address: string, category: 'ga' | 'pa') => void;
  /**
   * Whether an ETS project is loaded. Source/target/DPT options are derived from
   * the project, so when it's absent (e.g. Home Assistant companion mode without
   * an uploaded project) filtering by them is unavailable. `undefined` means the
   * status isn't known yet, in which case no notice is shown.
   */
  projectLoaded?: boolean;
  /** Opens the project upload flow (Settings). Enables the notice's CTA button. */
  onUploadProject?: () => void;
  writeEnabled?: boolean;
  /**
   * Master enable/disable of the whole filter set (live mode only, #370). When
   * `false` the list shows all telegrams while `activeFilters` is preserved. Absent
   * behaves as enabled; the toggle renders only when `onFiltersEnabledChange` is
   * provided and `mode === 'live'`.
   */
  filtersEnabled?: boolean;
  onFiltersEnabledChange?: (enabled: boolean) => void;
  /** Lifted Group Addresses/Devices tab (#402): lets other panels (e.g. the
   * Telegram List's SOURCE/TARGET "focus" label) switch the visible category.
   * Uncontrolled (own state) when omitted. */
  focusMode?: 'ga' | 'pa';
  onFocusModeChange?: (mode: 'ga' | 'pa') => void;
  listFlaggedAddresses?: string[];
  onListFlaggedAddressesChange?: (addresses: string[]) => void;
  activeMainPanel?: 'list' | 'visualizer' | 'statistics' | 'building' | 'lastseen';
}

interface OptionRowProps {
  label: string;
  sublabel?: string;
  checked: boolean;
  count?: number;
  onToggle: () => void;
  onRemove?: () => void;
  /** Hover-revealed quick actions (send-to-GA / last-seen), as on tree rows (#214). */
  actions?: React.ReactNode;
}

export const OptionRow: React.FC<OptionRowProps> = ({ label, sublabel, checked, count, onToggle, onRemove, actions }) => {
  const [hovered, setHovered] = useState(false);
  return (
  <div style={{
    display: 'flex', alignItems: 'center', gap: '0.4rem',
    borderRadius: '6px', transition: 'background 0.15s',
    paddingRight: '0.25rem'
  }}
    onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; setHovered(true); }}
    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; setHovered(false); }}
  >
    <label
      onClick={(e) => { e.preventDefault(); onToggle(); }}
      style={{
      display: 'flex', alignItems: 'center', gap: '0.6rem',
      padding: '0.35rem 0.25rem', cursor: 'pointer', flex: 1, minWidth: 0,
      userSelect: 'none'
    }}>
      {/* Custom checkbox */}
      <div
        style={{
          width: 14, height: 14, flexShrink: 0, borderRadius: 3,
          border: `1.5px solid ${checked ? 'var(--accent-primary)' : 'var(--border-color)'}`,
          background: checked ? 'var(--accent-primary)' : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'all 0.15s',
        }}
      >
        {checked && (
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
            <path d="M1.5 4L3.5 6L6.5 2" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>

      {/* Label */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          title={label}
          style={{
            fontSize: '0.8125rem', color: 'var(--text-main)', fontFamily: "'JetBrains Mono', monospace",
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{label}</div>
        {sublabel && (
          <div
            title={sublabel}
            style={{
              fontSize: '0.65rem', color: 'var(--text-dim)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{sublabel}</div>
        )}
      </div>
    </label>

    {actions && (
      <div
        onClick={e => e.stopPropagation()}
        style={{
          display: 'flex', alignItems: 'center', flexShrink: 0,
          opacity: hovered ? 0.9 : 0, transition: 'opacity 0.15s',
        }}
      >
        {actions}
      </div>
    )}

    {/* Count bubble — always flush with the row's right edge (#399) */}
    {count !== undefined && (
      <span
        onClick={onToggle}
        style={{
          fontSize: '0.65rem', fontWeight: 600, minWidth: '1.8rem', textAlign: 'center',
          padding: '0.1rem 0.4rem', borderRadius: '999px', flexShrink: 0, cursor: 'pointer',
          background: count > 0 ? 'rgba(99,102,241,0.15)' : 'var(--bg-tag)',
          color: count > 0 ? 'var(--accent-primary)' : 'var(--text-dim)',
          border: count > 0 ? '1px solid rgba(99,102,241,0.3)' : '1px solid var(--border-color)',
        }}>
        {count}
      </span>
    )}

    {onRemove && (
      <button
        onClick={onRemove}
        title="Remove filter"
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: 'var(--text-dim)', padding: '0.2rem', borderRadius: '4px',
          display: 'flex', alignItems: 'center', transition: 'all 0.2s'
        }}
        onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
        onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-dim)')}
      >
        <X size={14} />
      </button>
    )}
  </div>
  );
};

// ─── Focus address list (flat, pin-selected-to-top) ─────────────────────────
// Modeled after XKNX/knx-frontend's "knx-list-filter" component: a flat,
// searchable list where checking an item pins it above the rest instead of
// nesting entries in a line/group tree. One list is shown at a time, switched
// via the Group Addresses / Devices tabs (styled like the Last Seen Values
// sidebar), so it renders without its own section header.

// Fixed (non-auto) column widths shared by the header row and every item row
// (#409): each row is its own grid instance, so 'auto' tracks can size
// independently per row/header and drift out of alignment. Fixed widths make
// the checkbox/actions/badge columns land at identical pixel offsets everywhere.
const FOCUS_ROW_GRID_COLUMNS = '14px 1fr 4rem 1.8rem';

interface FocusOptionRowProps {
  label: string;
  sublabel?: string;
  checked: boolean;
  selected: boolean;
  selectionState?: string[];
  pinnedAddresses?: string[];
  striped?: boolean;
  count?: number;
  hideCheckbox?: boolean;
  onToggle: () => void;
  onToggleSelection?: (addresses: string[]) => void;
  onSelect: (event: React.MouseEvent<HTMLElement>) => void;
  /** Borderless write-to-GA action rendered inline after the address text
   * (#406); receives row-hover so it can hide unless pinned or hovered (#407). */
  writeAction?: (hovered: boolean) => React.ReactNode;
  /** Column 3 quick-action icons (#404), spanning both rows; receives
   * row-hover so each icon can compute its own visibility (#407). */
  actions?: (hovered: boolean) => React.ReactNode;
}

const FocusOptionRow: React.FC<FocusOptionRowProps> = ({ label, sublabel, checked, selected, selectionState, pinnedAddresses, striped, count, hideCheckbox, onToggle, onToggleSelection, onSelect, writeAction, actions }) => {
  const [hovered, setHovered] = useState(false);
  const isRowSelected = selectionState?.includes(label) ?? selected;
  const rowGridColumns = hideCheckbox ? 'minmax(0, 1fr) 4rem 1.8rem' : FOCUS_ROW_GRID_COLUMNS;
  const contentColumn = hideCheckbox ? 1 : 2;
  const actionsColumn = hideCheckbox ? 2 : 3;
  const countColumn = hideCheckbox ? 3 : 4;
  return (
    <div
      data-address={label}
      style={{
        display: 'grid',
        gridTemplateColumns: rowGridColumns,
        gridTemplateRows: 'auto auto',
        alignItems: 'center',
        columnGap: '0.6rem',
        rowGap: '0.1rem',
        padding: '0.3rem 0.25rem',
        borderRadius: '6px',
        userSelect: 'none',
        transition: 'background 0.15s',
        // Matches TelegramTable's marked-row wash (#409) for a consistent selection look.
        background: selected ? 'color-mix(in srgb, var(--accent-primary) 16%, transparent)' : striped ? 'rgba(255,255,255,0.02)' : 'transparent',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = selected ? 'color-mix(in srgb, var(--accent-primary) 24%, transparent)' : striped ? 'rgba(255,255,255,0.04)' : 'var(--bg-hover)'; setHovered(true); }}
      onMouseLeave={e => { e.currentTarget.style.background = selected ? 'color-mix(in srgb, var(--accent-primary) 16%, transparent)' : striped ? 'rgba(255,255,255,0.02)' : 'transparent'; setHovered(false); }}
      onClick={onSelect}
    >
      {!hideCheckbox && (
        <div
          role="checkbox"
          aria-checked={checked}
          aria-label={`Pin ${label}`}
          onClick={e => {
            e.stopPropagation();
            if ((selectionState?.length ?? 0) > 1 && isRowSelected) {
              const addresses = selectionState ?? [label];
              const next = new Set(pinnedAddresses ?? []);
              const shouldPin = !addresses.every(address => next.has(address));
              addresses.forEach(address => {
                if (shouldPin) next.add(address);
                else next.delete(address);
              });
              onToggleSelection?.(Array.from(next));
            } else {
              onToggle();
            }
          }}
          style={{
            gridColumn: 1, gridRow: '1 / span 2',
            width: 14, height: 14, flexShrink: 0, borderRadius: 3, cursor: 'pointer',
            border: `1.5px solid ${checked ? 'var(--accent-primary)' : 'var(--border-color)'}`,
            background: checked ? 'var(--accent-primary)' : 'transparent',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.15s',
          }}
        >
          {checked && (
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
              <path d="M1.5 4L3.5 6L6.5 2" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>
      )}

      <div style={{ gridColumn: contentColumn, gridRow: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '0.3rem', justifyContent: 'flex-start' }}>
        <span
          title={label}
          style={{
            minWidth: 0,
            fontSize: '0.8125rem', color: 'var(--text-main)', fontFamily: "'JetBrains Mono', monospace",
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{label}</span>
        {writeAction?.(hovered)}
      </div>
      <div
        title={sublabel}
        style={{
          gridColumn: contentColumn, gridRow: 2, minWidth: 0,
          fontSize: '0.65rem', color: 'var(--text-dim)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{sublabel}</div>

      {actions && (
        <div
          data-action-column-group
          style={{
            gridColumn: actionsColumn, gridRow: '1 / span 2',
            display: 'grid', gridTemplateColumns: 'repeat(3, auto)', alignItems: 'center', gap: '0.15rem',
            justifyContent: 'start',
          }}
        >
          {actions(hovered)}
        </div>
      )}

      {count !== undefined && (
        <span
          style={{
            gridColumn: countColumn, gridRow: '1 / span 2',
            fontSize: '0.65rem', fontWeight: 600, width: '1.8rem', textAlign: 'center',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            padding: '0.1rem 0.2rem', borderRadius: '999px',
            background: count > 0 ? 'rgba(99,102,241,0.15)' : 'var(--bg-tag)',
            color: count > 0 ? 'var(--accent-primary)' : 'var(--text-dim)',
            border: count > 0 ? '1px solid rgba(99,102,241,0.3)' : '1px solid var(--border-color)',
          }}>
          {count}
        </span>
      )}
    </div>
  );
};

interface FocusAddressSectionProps {
  title: string;
  entries: FilterOption[];
  selected: string[];
  onToggle: (addresses: string[]) => void;
  counts?: Record<string, number>;
  mode: 'live' | 'history';
  writeActionFor?: (address: string, entry: FilterOption, checked: boolean, hovered: boolean) => React.ReactNode;
  actionsFor?: (address: string, entry: FilterOption, checked: boolean, hovered: boolean) => React.ReactNode;
  hideZeroCount?: boolean;
  selectionState?: string[];
  onSelectionChange?: (addresses: string[]) => void;
  listFlaggedAddresses?: string[];
  visualizeFlaggedAddresses?: string[];
  lastSeenFlaggedAddresses?: string[];
  bulkActions?: {
    onTogglePin?: () => void;
    onToggleList?: () => void;
    onToggleVisualize?: () => void;
    onToggleLastSeen?: () => void;
  };
  showVisualizeAction?: boolean;
}

const FocusAddressSection: React.FC<FocusAddressSectionProps> = ({
  title, entries, selected, onToggle, counts, mode, writeActionFor, actionsFor, hideZeroCount, selectionState, onSelectionChange,
  listFlaggedAddresses, visualizeFlaggedAddresses, lastSeenFlaggedAddresses, bulkActions, showVisualizeAction,
}) => {
  const [search, setSearch] = useState('');
  const [anchorAddress, setAnchorAddress] = useState<string | null>(null);
  const [compactMode, setCompactMode] = useState<'list' | 'visualize' | 'lastseen' | 'compress' | null>(null);
  const [showPinnedOnly, setShowPinnedOnly] = useState(false);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const selectionSet = useMemo(() => new Set(selectionState ?? []), [selectionState]);
  const listFlagSet = useMemo(() => new Set(listFlaggedAddresses ?? []), [listFlaggedAddresses]);
  const visualizeFlagSet = useMemo(() => new Set(visualizeFlaggedAddresses ?? []), [visualizeFlaggedAddresses]);
  const lastSeenFlagSet = useMemo(() => new Set(lastSeenFlaggedAddresses ?? []), [lastSeenFlaggedAddresses]);
  const hasListMatches = useMemo(() => entries.some(entry => listFlagSet.has(entry.address ?? '')), [entries, listFlagSet]);
  const hasVisualizeMatches = useMemo(() => entries.some(entry => visualizeFlagSet.has(entry.address ?? '')), [entries, visualizeFlagSet]);
  const hasLastSeenMatches = useMemo(() => entries.some(entry => lastSeenFlagSet.has(entry.address ?? '')), [entries, lastSeenFlagSet]);
  const zeroFilterActive = mode === 'live' && !!hideZeroCount;

  const searchMatcher = useMemo(() => {
    const trimmed = search.trim();
    if (!trimmed) return null;
    return makeTextMatcher(trimmed);
  }, [search]);

  const filtered = useMemo(() => {
    const matchesSearch = (entry: FilterOption) => {
      if (!searchMatcher) return true;
      const haystack = `${entry.address ?? ''} ${entry.name ?? ''}`;
      return searchMatcher(haystack);
    };

    const matchesCompactMode = (entry: FilterOption) => {
      if (!compactMode) return true;
      const address = entry.address ?? '';
      if (compactMode === 'compress') return (counts?.[address] ?? 0) > 0;
      if (compactMode === 'list') return listFlagSet.has(address);
      if (compactMode === 'visualize') return visualizeFlagSet.has(address);
      return lastSeenFlagSet.has(address);
    };

    return entries
      .filter(matchesSearch)
      .filter(e => !zeroFilterActive || (counts?.[e.address ?? ''] ?? 0) > 0)
      .filter(matchesCompactMode)
      .filter(e => !showPinnedOnly || (selected?.includes(e.address ?? '') ?? false));
  }, [entries, searchMatcher, zeroFilterActive, counts, compactMode, listFlagSet, visualizeFlagSet, lastSeenFlagSet, selected, showPinnedOnly]);

  // Selected items float to the top, each group sorted by address (#XXX).
  const { pinned, rest } = useMemo(() => {
    const pinned: FilterOption[] = [];
    const rest: FilterOption[] = [];
    for (const e of filtered) (selectedSet.has(e.address ?? '') ? pinned : rest).push(e);
    const byAddress = (a: FilterOption, b: FilterOption) => compareKnxAddress(a.address ?? '', b.address ?? '');
    pinned.sort(byAddress);
    rest.sort(byAddress);
    return { pinned, rest };
  }, [filtered, selectedSet]);
  const visibleEntries = useMemo(() => [...pinned, ...rest], [pinned, rest]);

  const toggle = (address: string) => {
    const next = selectedSet.has(address) ? selected.filter(v => v !== address) : [...selected, address];
    onToggle(next);
  };

  const toggleSelectionForPin = () => {
    const relevant = filtered.filter(e => selectionSet.has(e.address ?? '')).map(e => e.address ?? '').filter(Boolean);
    if (relevant.length === 0) return;
    const next = new Set(selected);
    const allPinned = relevant.every(address => next.has(address));
    relevant.forEach(address => {
      if (allPinned) next.delete(address);
      else next.add(address);
    });
    onToggle([...next]);
  };

  const getTriState = (values: boolean[]) => {
    if (values.length === 0) return 'off' as TriState;
    if (values.every(Boolean)) return 'on' as TriState;
    if (values.some(Boolean)) return 'mixed' as TriState;
    return 'off' as TriState;
  };

  const pinTriState = useMemo(() => {
    const relevant = filtered.filter(e => selectionSet.has(e.address ?? '')).map(e => e.address ?? '').filter(Boolean);
    return getTriState(relevant.map(address => selectedSet.has(address)));
  }, [filtered, selectedSet, selectionSet]);

  const listTriState = useMemo(() => {
    const relevant = filtered.filter(e => selectionSet.has(e.address ?? '')).map(e => e.address ?? '').filter(Boolean);
    return getTriState(relevant.map(address => listFlagSet.has(address)));
  }, [filtered, listFlagSet, selectionSet]);

  const visualizeTriState = useMemo(() => {
    const relevant = filtered.filter(e => selectionSet.has(e.address ?? '')).map(e => e.address ?? '').filter(Boolean);
    return getTriState(relevant.map(address => visualizeFlagSet.has(address)));
  }, [filtered, visualizeFlagSet, selectionSet]);

  const lastSeenTriState = useMemo(() => {
    const relevant = filtered.filter(e => selectionSet.has(e.address ?? '')).map(e => e.address ?? '').filter(Boolean);
    return getTriState(relevant.map(address => lastSeenFlagSet.has(address)));
  }, [filtered, lastSeenFlagSet, selectionSet]);

  const handleSelect = (address: string, event: React.MouseEvent<HTMLElement>) => {
    if (!onSelectionChange) return;
    const next = [...(selectionState ?? [])];
    const isMulti = event.ctrlKey || event.metaKey;
    const isRange = event.shiftKey && !!anchorAddress;
    // Shift takes priority over Ctrl so Ctrl-Shift-click can add another
    // disjoint range on top of the existing selection (#409); a plain
    // Shift-click (no Ctrl) replaces the selection with the fresh range.
    if (isRange) {
      const start = visibleEntries.findIndex(e => e.address === anchorAddress);
      const end = visibleEntries.findIndex(e => e.address === address);
      if (start >= 0 && end >= 0) {
        const [lo, hi] = [start, end].sort((a, b) => a - b);
        const rangeAddresses = visibleEntries.slice(lo, hi + 1).map(e => e.address ?? '').filter(Boolean);
        const merged = isMulti ? Array.from(new Set([...next, ...rangeAddresses])) : rangeAddresses;
        onSelectionChange(merged);
        setAnchorAddress(address);
        return;
      }
    }
    if (isMulti) {
      const exists = next.includes(address);
      const updated = exists ? next.filter(v => v !== address) : [...next, address];
      onSelectionChange(updated);
      setAnchorAddress(address);
      return;
    }
    onSelectionChange([address]);
    setAnchorAddress(address);
  };

  if (entries.length === 0) {
    return (
      <div style={{ fontSize: '0.78rem', color: 'var(--text-dim)', padding: '1.5rem 1rem', textAlign: 'center', lineHeight: 1.5 }}>
        No {title.toLowerCase()} in the project.
      </div>
    );
  }

  return (
    <>
      <div style={{
        display: 'grid',
        gridTemplateColumns: FOCUS_ROW_GRID_COLUMNS,
        alignItems: 'center',
        columnGap: '0.6rem',
        rowGap: '0.1rem',
        // Matches each row's own padding (#409) so both grids' columns share the same X origin.
        padding: '0.3rem 0.25rem',
        marginBottom: '0.5rem',
      }}>
        <div style={{
          gridColumn: '1 / span 2',
          display: 'grid', gridTemplateColumns: 'auto 1fr', alignItems: 'center', gap: '0.4rem',
          flex: 1, minWidth: 0,
        }}>
          <button
            type="button"
            onClick={() => setShowPinnedOnly(v => !v)}
            title="Show only pinned entries"
            aria-pressed={showPinnedOnly}
            style={{
              ...toggleIconBtnStyle(showPinnedOnly),
              width: '1.7rem', height: '1.7rem', justifyContent: 'center', padding: '0.2rem',
            }}
          >
            <Pin size={12} />
          </button>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.4rem',
            background: 'var(--bg-tag)', border: '1px solid var(--border-color)',
            borderRadius: '6px', padding: '0.35rem 0.55rem', minWidth: 0,
          }}>
            <Search size={12} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
            <input
              type="text"
              placeholder={`Search ${title.toLowerCase()}...`}
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none',
                color: 'var(--text-main)', fontSize: '0.78rem', fontFamily: 'inherit',
              }}
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-dim)' }}
              >
                <X size={10} />
              </button>
            )}
          </div>
        </div>
        <div
          data-action-column-group
          style={{ gridColumn: 3, display: 'grid', gridTemplateColumns: 'repeat(4, auto)', alignItems: 'center', gap: '0.15rem', justifyContent: 'start' }}
        >
          <button
            type="button"
            onClick={() => setCompactMode(mode => mode === 'list' ? null : 'list')}
            title={hasListMatches ? (compactMode === 'list' ? 'Show all entries' : 'Show only entries marked for the Telegram List') : 'No entries marked for the Telegram List'}
            aria-pressed={compactMode === 'list' && hasListMatches}
            disabled={!hasListMatches}
            style={{ ...toggleIconBtnStyle(compactMode === 'list' && hasListMatches), gridColumn: 2, opacity: hasListMatches ? 1 : 0.45 }}
          >
            <List size={12} />
          </button>
          {showVisualizeAction && (
            <button
              type="button"
              onClick={() => setCompactMode(mode => mode === 'visualize' ? null : 'visualize')}
              title={hasVisualizeMatches ? (compactMode === 'visualize' ? 'Show all entries' : 'Show only entries marked for Visualization') : 'No entries marked for Visualization'}
              aria-pressed={compactMode === 'visualize' && hasVisualizeMatches}
              disabled={!hasVisualizeMatches}
              style={{ ...toggleIconBtnStyle(compactMode === 'visualize' && hasVisualizeMatches), gridColumn: 3, opacity: hasVisualizeMatches ? 1 : 0.45 }}
            >
              <LineChart size={12} />
            </button>
          )}
          <button
            type="button"
            onClick={() => setCompactMode(mode => mode === 'lastseen' ? null : 'lastseen')}
            title={hasLastSeenMatches ? (compactMode === 'lastseen' ? 'Show all entries' : 'Show only entries marked for Last Seen Values') : 'No entries marked for Last Seen Values'}
            aria-pressed={compactMode === 'lastseen' && hasLastSeenMatches}
            disabled={!hasLastSeenMatches}
            style={{ ...toggleIconBtnStyle(compactMode === 'lastseen' && hasLastSeenMatches), gridColumn: 4, opacity: hasLastSeenMatches ? 1 : 0.45 }}
          >
            <Clock size={12} />
          </button>
        </div>
        <div style={{ gridColumn: 4, display: 'flex', justifyContent: 'center' }}>
          <button
            type="button"
            onClick={() => setCompactMode(mode => mode === 'compress' ? null : 'compress')}
            title={compactMode === 'compress' ? 'Show all entries' : 'Show only entries with a non-zero badge count'}
            aria-pressed={compactMode === 'compress'}
            style={toggleIconBtnStyle(compactMode === 'compress')}
          >
            <Minimize2 size={12} />
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', padding: '0.5rem 0.25rem' }}>No matches.</div>
      ) : (
        <>
          {pinned.map(e => (
            <FocusOptionRow
              key={e.address}
              label={e.address ?? ''}
              sublabel={e.name || undefined}
              checked={true}
              hideCheckbox={showPinnedOnly}
              selected={selectionSet.has(e.address ?? '')}
              selectionState={selectionState}
              pinnedAddresses={selected}
              striped={pinned.length > 0 && pinned.indexOf(e) % 2 === 1}
              count={mode === 'live' ? (counts?.[e.address ?? ''] ?? 0) : undefined}
              onToggle={() => toggle(e.address ?? '')}
              onToggleSelection={addresses => onToggle(addresses)}
              onSelect={event => handleSelect(e.address ?? '', event)}
              writeAction={hovered => writeActionFor?.(e.address ?? '', e, true, hovered)}
              actions={hovered => actionsFor?.(e.address ?? '', e, true, hovered)}
            />
          ))}
          {pinned.length > 0 && rest.length > 0 && (
            <div style={{ borderTop: '2px solid var(--accent-primary)', opacity: 0.5, margin: '0.5rem 0' }} />
          )}
          {rest.map(e => (
            <FocusOptionRow
              key={e.address}
              label={e.address ?? ''}
              sublabel={e.name || undefined}
              checked={false}
              hideCheckbox={showPinnedOnly}
              selected={selectionSet.has(e.address ?? '')}
              selectionState={selectionState}
              pinnedAddresses={selected}
              striped={rest.indexOf(e) % 2 === 1}
              count={mode === 'live' ? (counts?.[e.address ?? ''] ?? 0) : undefined}
              onToggle={() => toggle(e.address ?? '')}
              onToggleSelection={addresses => onToggle(addresses)}
              onSelect={event => handleSelect(e.address ?? '', event)}
              writeAction={hovered => writeActionFor?.(e.address ?? '', e, false, hovered)}
              actions={hovered => actionsFor?.(e.address ?? '', e, false, hovered)}
            />
          ))}
        </>
      )}
    </>
  );
};

export const FilterPanel: React.FC<FilterPanelProps> = ({
  options,
  activeFilters,
  onFiltersChange,
  counts,
  mode,
  projectLoaded,
  onUploadProject,
  writeEnabled,
  focusMode: controlledFocusMode,
  onFocusModeChange,
  listFlaggedAddresses: controlledListFlaggedAddresses,
  onListFlaggedAddressesChange,
  activeMainPanel,
}) => {
  // Mode tabs mirror the Last Seen Values sidebar: one list shown at a time,
  // switched between Group Addresses (targets) and Devices (sources). Lifted
  // when the caller controls it (#402), otherwise a local fallback.
  const [internalFocusMode, setInternalFocusMode] = useState<'ga' | 'pa'>('ga');
  const focusMode = controlledFocusMode ?? internalFocusMode;
  const setFocusMode = (m: 'ga' | 'pa') => {
    setInternalFocusMode(m);
    onFocusModeChange?.(m);
  };
  // Compress: hides entries whose live count badge reads "0" (#400).
  const [hideZeroCount, setHideZeroCount] = useState(false);
  // The three row icons are real toggles (#406): each just flips a per-address
  // flag, kept here so it survives switching between the two tabs. They don't
  // navigate anywhere yet — that's future work.
  const [internalListFlaggedAddresses, setInternalListFlaggedAddresses] = useState<string[]>([]);
  const listFlaggedSet = useMemo(() => new Set(controlledListFlaggedAddresses ?? internalListFlaggedAddresses), [controlledListFlaggedAddresses, internalListFlaggedAddresses]);
  const [visualizeFlagged, setVisualizeFlagged] = useState<Set<string>>(new Set());
  const [lastSeenFlagged, setLastSeenFlagged] = useState<Set<string>>(new Set());
  const [selectedAddresses, setSelectedAddresses] = useState<string[]>([]);
  const syncMainPanelFlags = useMemo(() => {
    if (activeMainPanel === 'list') return 'list';
    if (activeMainPanel === 'visualizer') return 'visualize';
    if (activeMainPanel === 'lastseen') return 'lastseen';
    return null;
  }, [activeMainPanel]);
  // Tracks the pinned-address set as of the last sync run, so the effect below
  // can react to pin/unpin *transitions* instead of overwriting the whole flag
  // set (#409). Switching the active main panel should not be treated as a
  // fresh pin transition and therefore should not rewrite the current flags.
  const previousPinnedRef = useRef<Set<string>>(new Set());
  const toggleFlag = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, address: string) => {
    setter(prev => {
      const next = new Set(prev);
      if (next.has(address)) next.delete(address); else next.add(address);
      return next;
    });
  };
  const toggleFlagForSelection = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, addresses: string[]) => {
    setter(prev => {
      const next = new Set(prev);
      const allSelected = addresses.every(address => next.has(address));
      addresses.forEach(address => {
        if (allSelected) next.delete(address); else next.add(address);
      });
      return next;
    });
  };
  const toggleListFlag = (address: string) => {
    const next = new Set(controlledListFlaggedAddresses ?? internalListFlaggedAddresses);
    if (next.has(address)) next.delete(address); else next.add(address);
    const nextAddresses = [...next];
    if (onListFlaggedAddressesChange) {
      onListFlaggedAddressesChange(nextAddresses);
    } else {
      setInternalListFlaggedAddresses(nextAddresses);
    }
  };
  const toggleListFlagForSelection = (addresses: string[]) => {
    const next = new Set(controlledListFlaggedAddresses ?? internalListFlaggedAddresses);
    const allSelected = addresses.every(address => next.has(address));
    addresses.forEach(address => {
      if (allSelected) next.delete(address); else next.add(address);
    });
    const nextAddresses = [...next];
    if (onListFlaggedAddressesChange) {
      onListFlaggedAddressesChange(nextAddresses);
    } else {
      setInternalListFlaggedAddresses(nextAddresses);
    }
  };
  const toggleVisualizationFlagForSelection = (addresses: string[]) => toggleFlagForSelection(setVisualizeFlagged, addresses);
  const toggleLastSeenFlagForSelection = (addresses: string[]) => toggleFlagForSelection(setLastSeenFlagged, addresses);
  const handleRowAction = (addresses: string[], action: ToggleAction) => {
    if (addresses.length === 0) return;
    if (action === 'list') toggleListFlagForSelection(addresses);
    if (action === 'visualize') toggleVisualizationFlagForSelection(addresses);
    if (action === 'lastseen') toggleLastSeenFlagForSelection(addresses);
  };
  useEffect(() => {
    if (!syncMainPanelFlags) return;
    const pinnedAddresses = Array.from(new Set([...activeFilters.targets, ...activeFilters.sources]));
    // Only react to pin/unpin transitions (#409): recomputing the whole flag
    // set from `pinnedAddresses` on every run would also erase flags a user
    // just set manually on a row that isn't pinned.
    const previousPinned = previousPinnedRef.current;
    const newlyPinned = pinnedAddresses.filter(address => !previousPinned.has(address));
    const newlyUnpinned = Array.from(previousPinned).filter(address => !pinnedAddresses.includes(address));
    previousPinnedRef.current = new Set(pinnedAddresses);
    if (newlyPinned.length === 0 && newlyUnpinned.length === 0) return;

    if (syncMainPanelFlags === 'list') {
      const next = new Set(controlledListFlaggedAddresses ?? internalListFlaggedAddresses);
      newlyPinned.forEach(address => next.add(address));
      newlyUnpinned.forEach(address => next.delete(address));
      const nextAddresses = [...next];
      if (onListFlaggedAddressesChange) {
        onListFlaggedAddressesChange(nextAddresses);
      } else {
        setInternalListFlaggedAddresses(nextAddresses);
      }
      return;
    }
    const setter = syncMainPanelFlags === 'visualize' ? setVisualizeFlagged : setLastSeenFlagged;
    setter(prev => {
      const next = new Set(prev);
      newlyPinned.forEach(address => next.add(address));
      newlyUnpinned.forEach(address => next.delete(address));
      return next;
    });
  }, [activeFilters.targets, activeFilters.sources, syncMainPanelFlags, controlledListFlaggedAddresses, internalListFlaggedAddresses, onListFlaggedAddressesChange]);
  // Source/target/DPT options come from the ETS project. Without one, those
  // filters are empty and searching them turns up nothing — surface why.
  const showNoProjectNotice = projectLoaded === false;

  const update = (patch: Partial<ActiveFilters>) =>
    onFiltersChange({ ...activeFilters, ...patch });

  return (
    <div style={{
      height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column',
      borderRight: '1px solid var(--border-color)',
    }}>
      {/* Header */}
      <div style={{
        padding: '0.75rem 1rem', borderBottom: '1px solid var(--border-color)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <Search size={15} style={{ color: 'var(--accent-primary)' }} />
          <span style={{ fontWeight: 700, fontSize: '0.875rem' }}>Focus</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }} />
      </div>

      {/* Mode tabs (styled like the Last Seen Values sidebar) */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', flexShrink: 0 }}>
        {(['pa', 'ga'] as const).map(m => (
          <button
            key={m}
            onClick={() => setFocusMode(m)}
            style={{
              flex: 1, padding: '0.55rem 0.25rem', border: 'none', cursor: 'pointer',
              fontSize: '0.73rem', fontWeight: focusMode === m ? 600 : 400,
              background: focusMode === m ? 'rgba(99,102,241,0.12)' : 'transparent',
              color: focusMode === m ? 'var(--accent-primary)' : 'var(--text-dim)',
              borderBottom: `2px solid ${focusMode === m ? 'var(--accent-primary)' : 'transparent'}`,
              transition: 'all 0.15s',
            }}
          >
            {m === 'ga' ? 'Group Addresses' : 'Devices'}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem', scrollbarGutter: 'stable' }}>

        {/* No-project notice — source/target/DPT filters need an ETS project */}
        {showNoProjectNotice && (
          <div style={{
            marginBottom: '0.75rem', padding: '0.85rem',
            border: '1px solid var(--border-color)', borderRadius: '8px',
            background: 'var(--bg-subtle)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.4rem' }}>
              <AlertTriangle size={14} style={{ color: 'var(--warning, #f59e0b)', flexShrink: 0 }} />
              <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-main)' }}>
                No ETS project loaded
              </span>
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', lineHeight: 1.5, marginBottom: onUploadProject ? '0.7rem' : 0 }}>
              Filtering by source and target needs the group and device names
              from your ETS project. Upload a <code>.knxproj</code> file to enable it.
            </div>
            {onUploadProject && (
              <button
                onClick={onUploadProject}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.4rem',
                  width: '100%', justifyContent: 'center',
                  padding: '0.5rem 0.65rem', borderRadius: '6px', cursor: 'pointer',
                  border: '1px solid var(--accent-primary)',
                  background: 'rgba(99,102,241,0.12)', color: 'var(--accent-primary)',
                  fontSize: '0.78rem', fontWeight: 600, fontFamily: 'inherit',
                }}
              >
                <FolderInput size={14} />
                Upload ETS project
              </button>
            )}
          </div>
        )}

        {focusMode === 'ga' ? (
          <FocusAddressSection
            title="Group Addresses"
            entries={options.targets}
            selected={activeFilters.targets}
            onToggle={addresses => update({ targets: addresses })}
            counts={counts?.targets}
            mode={mode}
            hideZeroCount={hideZeroCount}
            selectionState={selectedAddresses}
            onSelectionChange={setSelectedAddresses}
            listFlaggedAddresses={controlledListFlaggedAddresses ?? internalListFlaggedAddresses}
            visualizeFlaggedAddresses={Array.from(visualizeFlagged)}
            lastSeenFlaggedAddresses={Array.from(lastSeenFlagged)}
            bulkActions={{
              onToggleList: () => handleRowAction(selectedAddresses, 'list'),
              onToggleVisualize: () => handleRowAction(selectedAddresses, 'visualize'),
              onToggleLastSeen: () => handleRowAction(selectedAddresses, 'lastseen'),
            }}
            showVisualizeAction
            writeActionFor={writeEnabled ? (address, entry, checked, hovered) => (
              <SendToGaPopover
                address={address}
                name={entry.name}
                dptMain={entry.main}
                dptSub={entry.sub}
                buttonStyle={{ ...writeActionBtnStyle, opacity: (checked || hovered) ? 0.9 : 0, transition: 'opacity 0.15s' }}
              />
            ) : undefined}
            actionsFor={(address, _entry, checked, hovered) => (
              <>
                <div data-action-column="list" style={{ gridColumn: 1, display: 'flex', alignItems: 'center' }}>
                  <ShowInListButton active={listFlaggedSet.has(address)} visible={listFlaggedSet.has(address) || checked || hovered} onClick={event => {
                    event.stopPropagation();
                    if (selectedAddresses.length > 1 && selectedAddresses.includes(address)) {
                      handleRowAction(selectedAddresses, 'list');
                    } else {
                      toggleListFlag(address);
                    }
                  }} />
                </div>
                <div data-action-column="visualize" style={{ gridColumn: 2, display: 'flex', alignItems: 'center' }}>
                  <VisualizeButton active={visualizeFlagged.has(address)} visible={visualizeFlagged.has(address) || checked || hovered} onClick={event => {
                    event.stopPropagation();
                    if (selectedAddresses.length > 1 && selectedAddresses.includes(address)) {
                      handleRowAction(selectedAddresses, 'visualize');
                    } else {
                      toggleFlag(setVisualizeFlagged, address);
                    }
                  }} />
                </div>
                <div data-action-column="lastSeen" style={{ gridColumn: 3, display: 'flex', alignItems: 'center' }}>
                  <LastSeenButton active={lastSeenFlagged.has(address)} visible={lastSeenFlagged.has(address) || checked || hovered} onClick={event => {
                    event.stopPropagation();
                    if (selectedAddresses.length > 1 && selectedAddresses.includes(address)) {
                      handleRowAction(selectedAddresses, 'lastseen');
                    } else {
                      toggleFlag(setLastSeenFlagged, address);
                    }
                  }} />
                </div>
              </>
            )}
          />
        ) : (
          <FocusAddressSection
            title="Devices"
            entries={options.sources}
            selected={activeFilters.sources}
            onToggle={addresses => update({ sources: addresses })}
            counts={counts?.sources}
            mode={mode}
            hideZeroCount={hideZeroCount}
            selectionState={selectedAddresses}
            onSelectionChange={setSelectedAddresses}
            listFlaggedAddresses={controlledListFlaggedAddresses ?? internalListFlaggedAddresses}
            visualizeFlaggedAddresses={Array.from(visualizeFlagged)}
            lastSeenFlaggedAddresses={Array.from(lastSeenFlagged)}
            bulkActions={{
              onToggleList: () => handleRowAction(selectedAddresses, 'list'),
              onToggleVisualize: () => handleRowAction(selectedAddresses, 'visualize'),
              onToggleLastSeen: () => handleRowAction(selectedAddresses, 'lastseen'),
            }}
            showVisualizeAction
            actionsFor={(address, _entry, checked, hovered) => (
              <>
                <div data-action-column="list" style={{ gridColumn: 1, display: 'flex', alignItems: 'center' }}>
                  <ShowInListButton active={listFlaggedSet.has(address)} visible={listFlaggedSet.has(address) || checked || hovered} onClick={event => {
                    event.stopPropagation();
                    if (selectedAddresses.length > 1 && selectedAddresses.includes(address)) {
                      handleRowAction(selectedAddresses, 'list');
                    } else {
                      toggleListFlag(address);
                    }
                  }} />
                </div>
                <div data-action-column="visualize" style={{ gridColumn: 2, display: 'flex', alignItems: 'center' }}>
                  <VisualizeButton active={visualizeFlagged.has(address)} visible={visualizeFlagged.has(address) || checked || hovered} onClick={event => {
                    event.stopPropagation();
                    if (selectedAddresses.length > 1 && selectedAddresses.includes(address)) {
                      handleRowAction(selectedAddresses, 'visualize');
                    } else {
                      toggleFlag(setVisualizeFlagged, address);
                    }
                  }} />
                </div>
                <div data-action-column="lastSeen" style={{ gridColumn: 3, display: 'flex', alignItems: 'center' }}>
                  <LastSeenButton active={lastSeenFlagged.has(address)} visible={lastSeenFlagged.has(address) || checked || hovered} onClick={event => {
                    event.stopPropagation();
                    if (selectedAddresses.length > 1 && selectedAddresses.includes(address)) {
                      handleRowAction(selectedAddresses, 'lastseen');
                    } else {
                      toggleFlag(setLastSeenFlagged, address);
                    }
                  }} />
                </div>
              </>
            )}
          />
        )}

      </div>
    </div>
  );
};

// Add styles for filter section
const style = document.createElement('style');
style.textContent = `
  .filter-chip-removed {
    /* Placeholder to remove old styles if needed, but we'll just rewrite the whole block */
  }
`;
document.head.appendChild(style);

