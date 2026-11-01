import React, { useState, useMemo, useRef } from 'react';
import { useStickyChecked } from '../hooks/useStickyChecked';
import { usePersistedScroll, writePanelScroll } from '../hooks/usePersistedScroll';
import { useRowMarks } from '../hooks/useRowMarks';
import { applyToggle, toggleGesture, type ToggleGesture } from '../utils/toggleClick';
import { Search, ChevronDown, ChevronRight, X, FolderInput, AlertTriangle, Power, FoldVertical, ListChecks, RotateCcw } from 'lucide-react';
import {
  type FilterOptions,
  type ActiveFilters,
  type FilterCounts,
  DEFAULT_FILTERS,
  DIRECTIONS,
  dptKey,
  countSelections,
  enabledFilters,
} from '../types/filters';
import { compareKnxAddress } from '../utils/knxAddress';
import { KnxAddressTree, knxBranchKeys } from './KnxAddressTree';
import { DptTypeTree, dptBranchKeys } from './DptTypeTree';
import { setFilterBranches, useFilterBranch } from '../utils/filterBranchExpansion';
import { dptWidthLabel } from '../utils/dpt';
import { matchesAnyText } from '../utils/quickFilter';
import { FocusList } from './FocusList';
import { BadgeColumn, BadgeColumnScope } from './BadgeColumn';
import { CheckMark, toggleButtonColors } from './filterControls';
import { clearTargetColors, useTargetColors } from '../utils/targetColors';
import type { DbTelegramCounts } from '../hooks/useDbTelegramCounts';

const TabReset: React.FC<{ label: string; title: string; onClick: () => void }> = ({ label, title, onClick }) => (
  <button
    type="button"
    aria-label={label}
    title={title}
    onClick={onClick}
    style={{
      flexShrink: 0, cursor: 'pointer', borderRadius: '7px',
      display: 'flex', alignItems: 'center', padding: '0.4rem',
      border: 'none', background: 'transparent', color: 'var(--text-dim)',
    }}
    onMouseEnter={e => { e.currentTarget.style.color = 'var(--accent-primary)'; }}
    onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-dim)'; }}
  >
    <RotateCcw size={14} />
  </button>
);

// ─── FilterPanel component ────────────────────────────────────────────────────

interface FilterPanelProps {
  options: FilterOptions;
  activeFilters: ActiveFilters;
  onFiltersChange: (f: ActiveFilters) => void;
  /** Live-only: count of telegrams that would match each option in isolation */
  counts?: FilterCounts;
  /** Every telegram in the buffer, ignoring the panel filter. Entry highlighting uses this. */
  bufferCounts?: FilterCounts;
  /** Database totals per category. The gray badge uses these when the buffer has none. */
  dbCounts?: DbTelegramCounts;
  onQuickLastSeen?: (address: string | string[], mode: 'ga' | 'pa', gesture?: ToggleGesture, clicked?: string) => void;
  /** Shift or alt on a toggle opens this panel. */
  onOpenPanel?: (panel: 'list' | 'visualizer' | 'lastseen') => void;
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
   * Master enable/disable of the whole filter set (#370, #436). When `false` the
   * list shows all telegrams while `activeFilters` is preserved. Absent behaves as
   * enabled; the toggle renders only when `onFiltersEnabledChange` is provided.
   */
  filtersEnabled?: boolean;
  onFiltersEnabledChange?: (enabled: boolean) => void;
  /** Option search. Controlled when `onSearchChange` is set, so it can persist. */
  search?: string;
  onSearchChange?: (search: string) => void;
  /** Hide entries whose telegram count is 0. Controlled when `onCompactChange` is set. */
  compact?: boolean;
  onCompactChange?: (compact: boolean) => void;
  /** Show only checked entries. Controlled when `onCheckedOnlyChange` is set. */
  checkedOnly?: boolean;
  onCheckedOnlyChange?: (checkedOnly: boolean) => void;
  /** Header side. Controlled when `onPanelViewChange` is set, so it can persist. */
  panelView?: 'filter' | 'focus';
  onPanelViewChange?: (view: 'filter' | 'focus') => void;
  /** Focus pins, shared so Group Monitor and History keep the same list. */
  focusGas?: string[];
  onFocusGasChange?: (addresses: string[]) => void;
  focusDevices?: string[];
  onFocusDevicesChange?: (addresses: string[]) => void;
  focusTab?: 'ga' | 'pa';
  onFocusTabChange?: (tab: 'ga' | 'pa') => void;
  /** Search and compact of the two Focus lists. Controlled when the change callback is set. */
  focusGaSearch?: string;
  onFocusGaSearchChange?: (search: string) => void;
  focusDeviceSearch?: string;
  onFocusDeviceSearchChange?: (search: string) => void;
  focusGaCompact?: boolean;
  onFocusGaCompactChange?: (compact: boolean) => void;
  focusDeviceCompact?: boolean;
  onFocusDeviceCompactChange?: (compact: boolean) => void;
  /** Focus "Verdichten": only entries with telegrams in the buffer. */
  focusGaVerdichten?: boolean;
  onFocusGaVerdichtenChange?: (compact: boolean) => void;
  focusDeviceVerdichten?: boolean;
  onFocusDeviceVerdichtenChange?: (compact: boolean) => void;
  /** Addresses with the Focus last-seen toggle on. The Last Seen table reads these. */
  lastSeenGas?: string[];
  onLastSeenGasChange?: (addresses: string[]) => void;
  lastSeenDevices?: string[];
  onLastSeenDevicesChange?: (addresses: string[]) => void;
  /** Addresses whose visualization toggle is on. This is not the focus checkbox. */
  visualizedGas?: string[];
  onVisualizedGasChange?: (addresses: string[]) => void;
  visualizedDevices?: string[];
  onVisualizedDevicesChange?: (addresses: string[]) => void;
  /** Addresses whose Focus-list filter toggle is on. */
  focusFilterGas?: string[];
  onFocusFilterGasChange?: (addresses: string[]) => void;
  focusFilterDevices?: string[];
  onFocusFilterDevicesChange?: (addresses: string[]) => void;
}

interface SectionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  /** Live telegram total for this category. Absent hides the badge. */
  count?: number;
  /** Database total. Shown in gray when the live count is exactly 0. */
  dbCount?: number;
  /** Distinct objects of this category present in the buffer. */
  objects?: number;
  /** What `objects` counts, used as the badge title. */
  objectLabel?: string;
  /** Bold title when this category has at least one selected filter. */
  selected?: boolean;
  /** Stable id stored with the open state, e.g. `source`. */
  sectionKey: string;
  /** Branches drawn inside this category. Ctrl/cmd-click applies the category's new open state to them. */
  branchKeys?: string[];
}

/**
 * Sum of a category's live counts. DPT maps store each telegram twice — once
 * under its subtype and once under the bare main type — so only the bare keys
 * are totaled. Subtype keys are used when no bare total is present.
 */
function categoryCount(values: Record<string, number> | undefined, dpt = false): number | undefined {
  if (!values) return undefined;
  const entries = Object.entries(values);
  if (entries.length === 0) return undefined;
  const rows = dpt && entries.some(([key]) => !key.includes('.'))
    ? entries.filter(([key]) => !key.includes('.'))
    : entries;
  return rows.reduce((sum, [, n]) => sum + n, 0);
}

/** How many distinct objects of a category are in the buffer. */
function categoryObjects(values: Record<string, number> | undefined, dpt = false): number | undefined {
  if (!values) return undefined;
  const keys = Object.keys(values);
  if (keys.length === 0) return undefined;
  if (!dpt) return keys.length;
  // A bare main key is the rollup of its subtypes, not an extra object.
  const subtypes = keys.filter(key => key.includes('.'));
  if (subtypes.length === 0) return keys.length;
  const mains = new Set(subtypes.map(key => key.split('.')[0]));
  const bareOnly = keys.filter(key => !key.includes('.') && !mains.has(key));
  return subtypes.length + bareOnly.length;
}

const CountBadge: React.FC<{ count: number; database?: boolean }> = ({ count, database = false }) => (
  <span
    title={database ? 'Telegrams in the database' : 'Telegrams'}
    style={{
      height: '1rem', boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontSize: '0.65rem', fontWeight: 600, fontVariantNumeric: 'tabular-nums', lineHeight: 1, minWidth: '1.8rem', textAlign: 'center',
      padding: '0 0.4rem', borderRadius: '999px', flexShrink: 0,
      background: database ? 'var(--bg-tag)' : 'rgba(99,102,241,0.15)',
      color: database ? 'var(--text-dim)' : 'var(--accent-primary)',
      border: database ? '1px solid var(--border-color)' : '1px solid rgba(99,102,241,0.3)',
    }}
  >{count}</span>
);

const Section: React.FC<SectionProps> = ({ title, children, defaultOpen = true, count, dbCount, objects, objectLabel, selected = false, sectionKey, branchKeys = [] }) => {
  const storedKey = `category:${sectionKey}`;
  const [open, setOpen] = useFilterBranch(storedKey, defaultOpen);
  const toggle = (e: React.MouseEvent) => {
    const next = !open;
    // Ctrl/cmd applies the same open or closed state to every branch in the category.
    if ((e.ctrlKey || e.metaKey) && branchKeys.length > 0) {
      setFilterBranches(Object.fromEntries([[storedKey, next], ...branchKeys.map(key => [key, next])]));
      return;
    }
    setOpen(next);
  };
  return (
    <div style={{ borderBottom: '1px solid var(--border-color)' }}>
      <button
        type="button"
        onClick={toggle}
        title={branchKeys.length > 0
          ? 'Click to expand or collapse · ctrl/cmd-click does the same for every branch underneath'
          : undefined}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: '0.4rem',
          padding: '0.65rem 1rem', background: 'transparent', border: 'none',
          color: 'var(--text-main)', fontWeight: 400, fontSize: '0.75rem', fontFamily: 'inherit',
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span style={{
          textAlign: 'left',
          fontSize: '0.75rem',
          fontWeight: selected ? 700 : 400,
          ...(selected ? { color: 'var(--accent-primary)' } : {}),
        }}>{title}</span>
        {objects !== undefined && (
          <span
            title={objectLabel}
            style={{
              height: '1rem', boxSizing: 'border-box', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.65rem', fontWeight: 600, lineHeight: 1, minWidth: '1.8rem', textAlign: 'center',
              padding: '0 0.4rem', borderRadius: '999px', flexShrink: 0,
              background: objects > 0 ? 'rgba(168,85,247,0.15)' : 'var(--bg-tag)',
              color: objects > 0 ? 'var(--accent-secondary)' : 'var(--text-dim)',
              border: objects > 0 ? '1px solid rgba(168,85,247,0.35)' : '1px solid var(--border-color)',
            }}
          >{objects}</span>
        )}
        <span style={{ flex: 1 }} />
        <BadgeColumn>
          {count !== undefined && count > 0 && <CountBadge count={count} />}
          {count === 0 && (dbCount ?? 0) > 0 && <CountBadge count={dbCount as number} database />}
        </BadgeColumn>
      </button>
      {open && <div style={{ padding: '0 0.75rem 0.75rem' }}>{children}</div>}
    </div>
  );
};

interface OptionRowProps {
  label: string;
  sublabel?: string;
  checked: boolean;
  count?: number;
  /** Database total. Shown in gray when the live count is exactly 0. */
  dbCount?: number;
  /** Primary label uses the selected-category style when the buffer holds this entry. */
  emphasized?: boolean;
  onToggle: (e: React.MouseEvent) => void;
  onRemove?: () => void;
  /** Hover-revealed quick actions (send-to-GA / last-seen), as on tree rows (#214). */
  actions?: React.ReactNode;
  /** Renders the row dimmed: selected, but currently switched off (#437). */
  muted?: boolean;
  /** Colour swatch of the entry (#509); a click moves on to the next colour. */
  swatch?: { color: string | null; onClick: () => void };
  /** When set, a row click marks it and the checkbox toggles. Otherwise the row toggles. */
  onMark?: (e: React.MouseEvent) => void;
  marked?: boolean;
  anchor?: boolean;
}

export const OptionRow: React.FC<OptionRowProps> = ({ label, sublabel, checked, count, dbCount, emphasized = false, onToggle, onRemove, actions, muted, swatch, onMark, marked = false, anchor = false }) => {
  const [hovered, setHovered] = useState(false);
  return (
  <div
    data-marked={marked ? 'true' : undefined}
    data-mark-anchor={anchor ? 'true' : undefined}
    onClick={onMark}
    style={{
      display: 'flex', alignItems: 'center', gap: '0.4rem',
      borderRadius: '6px', transition: 'background 0.15s',
      padding: '0.3rem 0.25rem',
      background: anchor
        ? 'color-mix(in srgb, var(--accent-primary) 34%, transparent)'
        : marked
          ? 'color-mix(in srgb, var(--accent-primary) 16%, transparent)'
          : hovered
            ? 'var(--bg-hover)'
            : 'transparent',
    }}
    onMouseEnter={() => setHovered(true)}
    onMouseLeave={() => setHovered(false)}
  >
    <div
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={e => {
        e.stopPropagation();
        e.preventDefault();
        onToggle(e);
      }}
      style={{ display: 'flex', cursor: 'pointer', flexShrink: 0, opacity: muted ? 0.5 : 1 }}
    >
      <CheckMark state={checked ? 'checked' : 'unchecked'} />
    </div>
    <div
      onClick={onMark ? undefined : (e) => { e.preventDefault(); onToggle(e); }}
      style={{
        display: 'flex', alignItems: 'center', gap: '0.6rem',
        padding: '0.35rem 0.25rem', cursor: 'pointer', flex: 1, minWidth: 0,
        userSelect: 'none', opacity: muted ? 0.5 : 1, transition: 'opacity 0.15s',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          title={label}
          style={{
            height: '1rem', lineHeight: '1rem',
            fontSize: '0.75rem', fontFamily: "'JetBrains Mono', monospace",
            fontWeight: emphasized ? 700 : 400,
            color: emphasized ? 'var(--accent-primary)' : 'var(--text-main)',
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
    </div>

    {swatch && (
      <button
        onClick={swatch.onClick}
        aria-label={`Colour of ${label}`}
        title={swatch.color
          ? 'Telegrams to this address are marked in this colour - click for the next colour'
          : 'Mark telegrams to this address with a colour'}
        style={{
          width: 14, height: 14, flexShrink: 0, padding: 0, borderRadius: '50%', cursor: 'pointer',
          background: swatch.color ?? 'transparent',
          border: swatch.color ? `1.5px solid ${swatch.color}` : '1.5px dashed var(--text-dim)',
          opacity: swatch.color || hovered ? 1 : 0.45, transition: 'opacity 0.15s',
        }}
      />
    )}

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

    {onRemove && (
      <button
        onClick={onRemove}
        title="Remove filter"
        style={{
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: 'var(--text-dim)', padding: '0.2rem', borderRadius: '4px',
          display: 'flex', alignItems: 'center', transition: 'all 0.2s'
        }}
        onMouseEnter={e => (e.currentTarget.style.color = 'var(--error)')}
        onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-dim)')}
      >
        <X size={14} />
      </button>
    )}

    <BadgeColumn>
      {count !== undefined && count > 0 && <CountBadge count={count} />}
      {count === 0 && (dbCount ?? 0) > 0 && <CountBadge count={dbCount} database />}
    </BadgeColumn>
  </div>
  );
};

const FilterChoiceList: React.FC<{
  ids: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  onOpenList?: () => void;
  markReset?: number;
  row: (id: string) => { count?: number; dbCount?: number; emphasized?: boolean; hidden?: boolean };
}> = ({ ids, selected, onChange, onOpenList, markReset = 0, row }) => {
  const visible = ids.filter(id => !row(id).hidden);
  const { marked, lastMarked, markAt, targetsFor } = useRowMarks(visible, markReset);
  return (
    <>
      {visible.map(id => {
        const info = row(id);
        return (
          <OptionRow
            key={id}
            label={id}
            checked={selected.includes(id)}
            count={info.count}
            dbCount={info.dbCount}
            emphasized={info.emphasized}
            marked={marked.includes(id)}
            anchor={marked.includes(id) && lastMarked === id}
            onMark={e => markAt(e, id)}
            onToggle={e => {
              const gesture = toggleGesture(e);
              if (gesture.kind === 'none') return;
              if (gesture.kind === 'toggle') {
                onChange(applyToggle(selected, targetsFor(id), !selected.includes(id), gesture.exclusive));
                if (!gesture.navigate) return;
              }
              onOpenList?.();
            }}
          />
        );
      })}
    </>
  );
};

export const FilterPanel: React.FC<FilterPanelProps> = ({
  options,
  activeFilters,
  onFiltersChange,
  counts,
  bufferCounts,
  dbCounts,
  onQuickLastSeen,
  onOpenPanel,
  projectLoaded,
  onUploadProject,
  writeEnabled,
  filtersEnabled = true,
  onFiltersEnabledChange,
  search: searchProp,
  onSearchChange,
  compact: compactProp,
  onCompactChange,
  checkedOnly: checkedOnlyProp,
  onCheckedOnlyChange,
  panelView: panelViewProp,
  onPanelViewChange,
  focusGas: focusGasProp,
  onFocusGasChange,
  focusDevices: focusDevicesProp,
  onFocusDevicesChange,
  focusTab: focusTabProp,
  onFocusTabChange,
  focusGaSearch: focusGaSearchProp,
  onFocusGaSearchChange,
  focusDeviceSearch: focusDeviceSearchProp,
  onFocusDeviceSearchChange,
  focusGaCompact: focusGaCompactProp,
  onFocusGaCompactChange,
  focusDeviceCompact: focusDeviceCompactProp,
  onFocusDeviceCompactChange,
  focusGaVerdichten: focusGaVerdichtenProp,
  onFocusGaVerdichtenChange,
  focusDeviceVerdichten: focusDeviceVerdichtenProp,
  onFocusDeviceVerdichtenChange,
  lastSeenGas: lastSeenGasProp,
  onLastSeenGasChange,
  lastSeenDevices: lastSeenDevicesProp,
  onLastSeenDevicesChange,
  visualizedGas: visualizedGasProp,
  onVisualizedGasChange,
  visualizedDevices: visualizedDevicesProp,
  onVisualizedDevicesChange,
  focusFilterGas: focusFilterGasProp,
  onFocusFilterGasChange,
  focusFilterDevices: focusFilterDevicesProp,
  onFocusFilterDevicesChange,
}) => {
  const targetColors = useTargetColors();
  const [ownSearch, setOwnSearch] = useState('');
  // Hides every entry whose telegram badge is 0.
  const [ownCompact, setOwnCompact] = useState(false);
  const [ownCheckedOnly, setOwnCheckedOnly] = useState(false);
  const [ownFocusGas, setOwnFocusGas] = useState<string[]>([]);
  const [ownFocusDevices, setOwnFocusDevices] = useState<string[]>([]);
  const [ownFocusTab, setOwnFocusTab] = useState<'ga' | 'pa'>('ga');
  const [ownFocusGaSearch, setOwnFocusGaSearch] = useState('');
  const [ownFocusDeviceSearch, setOwnFocusDeviceSearch] = useState('');
  const [ownFocusGaCompact, setOwnFocusGaCompact] = useState(false);
  const [ownFocusDeviceCompact, setOwnFocusDeviceCompact] = useState(false);
  const [ownFocusGaVerdichten, setOwnFocusGaVerdichten] = useState(false);
  const [ownFocusDeviceVerdichten, setOwnFocusDeviceVerdichten] = useState(false);
  const [ownLastSeenGas, setOwnLastSeenGas] = useState<string[]>([]);
  const [ownLastSeenDevices, setOwnLastSeenDevices] = useState<string[]>([]);
  const [ownVisualizedGas, setOwnVisualizedGas] = useState<string[]>([]);
  const [ownVisualizedDevices, setOwnVisualizedDevices] = useState<string[]>([]);
  const [ownFocusFilterGas, setOwnFocusFilterGas] = useState<string[]>([]);
  const [ownFocusFilterDevices, setOwnFocusFilterDevices] = useState<string[]>([]);
  const search = onSearchChange ? (searchProp ?? '') : ownSearch;
  const compact = onCompactChange ? (compactProp ?? false) : ownCompact;
  const checkedOnly = onCheckedOnlyChange ? (checkedOnlyProp ?? false) : ownCheckedOnly;
  const focusGas = onFocusGasChange ? (focusGasProp ?? []) : ownFocusGas;
  const focusDevices = onFocusDevicesChange ? (focusDevicesProp ?? []) : ownFocusDevices;
  const focusTab = onFocusTabChange ? (focusTabProp ?? 'ga') : ownFocusTab;
  const setSearch = (value: string) => (onSearchChange ? onSearchChange(value) : setOwnSearch(value));
  const setCompact = (value: boolean) => (onCompactChange ? onCompactChange(value) : setOwnCompact(value));
  const setCheckedOnly = (value: boolean) => (onCheckedOnlyChange ? onCheckedOnlyChange(value) : setOwnCheckedOnly(value));
  const setFocusGas = (addresses: string[]) => (onFocusGasChange ? onFocusGasChange(addresses) : setOwnFocusGas(addresses));
  const setFocusDevices = (addresses: string[]) => (onFocusDevicesChange ? onFocusDevicesChange(addresses) : setOwnFocusDevices(addresses));
  const setFocusTab = (tab: 'ga' | 'pa') => (onFocusTabChange ? onFocusTabChange(tab) : setOwnFocusTab(tab));
  const focusGaSearch = onFocusGaSearchChange ? (focusGaSearchProp ?? '') : ownFocusGaSearch;
  const focusDeviceSearch = onFocusDeviceSearchChange ? (focusDeviceSearchProp ?? '') : ownFocusDeviceSearch;
  const focusGaCompact = onFocusGaCompactChange ? (focusGaCompactProp ?? false) : ownFocusGaCompact;
  const focusDeviceCompact = onFocusDeviceCompactChange ? (focusDeviceCompactProp ?? false) : ownFocusDeviceCompact;
  const focusGaVerdichten = onFocusGaVerdichtenChange ? (focusGaVerdichtenProp ?? false) : ownFocusGaVerdichten;
  const focusDeviceVerdichten = onFocusDeviceVerdichtenChange ? (focusDeviceVerdichtenProp ?? false) : ownFocusDeviceVerdichten;
  const setFocusGaSearch = (value: string) => (onFocusGaSearchChange ? onFocusGaSearchChange(value) : setOwnFocusGaSearch(value));
  const setFocusDeviceSearch = (value: string) => (onFocusDeviceSearchChange ? onFocusDeviceSearchChange(value) : setOwnFocusDeviceSearch(value));
  const setFocusGaCompact = (value: boolean) => (onFocusGaCompactChange ? onFocusGaCompactChange(value) : setOwnFocusGaCompact(value));
  const setFocusDeviceCompact = (value: boolean) => (onFocusDeviceCompactChange ? onFocusDeviceCompactChange(value) : setOwnFocusDeviceCompact(value));
  const setFocusGaVerdichten = (value: boolean) => (onFocusGaVerdichtenChange ? onFocusGaVerdichtenChange(value) : setOwnFocusGaVerdichten(value));
  const setFocusDeviceVerdichten = (value: boolean) => (onFocusDeviceVerdichtenChange ? onFocusDeviceVerdichtenChange(value) : setOwnFocusDeviceVerdichten(value));
  const lastSeenGas = onLastSeenGasChange ? (lastSeenGasProp ?? []) : ownLastSeenGas;
  const lastSeenDevices = onLastSeenDevicesChange ? (lastSeenDevicesProp ?? []) : ownLastSeenDevices;
  const setLastSeenGas = (addresses: string[]) => (onLastSeenGasChange ? onLastSeenGasChange(addresses) : setOwnLastSeenGas(addresses));
  const setLastSeenDevices = (addresses: string[]) => (onLastSeenDevicesChange ? onLastSeenDevicesChange(addresses) : setOwnLastSeenDevices(addresses));
  const visualizedGas = onVisualizedGasChange ? (visualizedGasProp ?? []) : ownVisualizedGas;
  const visualizedDevices = onVisualizedDevicesChange ? (visualizedDevicesProp ?? []) : ownVisualizedDevices;
  const setVisualizedGas = (addresses: string[]) => (onVisualizedGasChange ? onVisualizedGasChange(addresses) : setOwnVisualizedGas(addresses));
  const setVisualizedDevices = (addresses: string[]) => (onVisualizedDevicesChange ? onVisualizedDevicesChange(addresses) : setOwnVisualizedDevices(addresses));
  const focusFilterGas = onFocusFilterGasChange ? (focusFilterGasProp ?? []) : ownFocusFilterGas;
  const focusFilterDevices = onFocusFilterDevicesChange ? (focusFilterDevicesProp ?? []) : ownFocusFilterDevices;
  const setFocusFilterGas = (addresses: string[]) => (onFocusFilterGasChange ? onFocusFilterGasChange(addresses) : setOwnFocusFilterGas(addresses));
  const setFocusFilterDevices = (addresses: string[]) => (onFocusFilterDevicesChange ? onFocusFilterDevicesChange(addresses) : setOwnFocusFilterDevices(addresses));
  const filterScrollRef = usePersistedScroll('filter');
  const panelRef = useRef<HTMLDivElement>(null);
  const [markReset, setMarkReset] = useState(0);
  const scrollListToTop = (key: string) => {
    writePanelScroll(key, 0);
    const el = panelRef.current?.querySelector(`[data-panel-scroll="${key}"]`);
    if (el instanceof HTMLElement) el.scrollTop = 0;
  };
  // The header is the view switch: Filter (category controls) or Focus (the
  // current set). No auto-inserted active block, so editing never repositions
  // entries (#87). Controlled from the session when a change callback is set.
  const [ownView, setOwnView] = useState<'edit' | 'active'>('edit');
  const view: 'edit' | 'active' = onPanelViewChange ? (panelViewProp === 'focus' ? 'active' : 'edit') : ownView;
  const setView = (next: 'edit' | 'active') => {
    if (onPanelViewChange) onPanelViewChange(next === 'active' ? 'focus' : 'filter');
    else setOwnView(next);
  };
  const showMasterToggle = !!onFiltersEnabledChange;

  // Source/target/DPT options come from the ETS project. Without one, those
  // filters are empty and searching them turns up nothing — surface why.
  const showNoProjectNotice = projectLoaded === false;

  const filteredSources = useMemo(() =>
    options.sources
      .filter(s => matchesAnyText(search, s.address, s.name))
      .sort((a, b) => compareKnxAddress(a.address ?? '', b.address ?? '')),
    [options.sources, search]);

  const filteredTargets = useMemo(() =>
    options.targets
      .filter(s => matchesAnyText(search, s.address, s.name))
      .sort((a, b) => compareKnxAddress(a.address ?? '', b.address ?? '')),
    [options.targets, search]);

  const filteredTypes = useMemo(() =>
    options.types.filter(t => matchesAnyText(search, t)), [options.types, search]);

  const filteredDirections = useMemo(() =>
    DIRECTIONS.filter(d => matchesAnyText(search, d)), [search]);

  const filteredDpts = useMemo(() =>
    options.dpts.filter(d =>
      matchesAnyText(
        search,
        d.label,
        d.main != null ? dptKey(d.main, d.sub) : undefined,
        d.main != null ? dptWidthLabel(d.main) : undefined,
      )
    ), [options.dpts, search]);

  const pinNewlySelected = (category: 'sources' | 'targets', next: string[]) => {
    const added = next.filter(address => !activeFilters[category].includes(address));
    if (added.length === 0) return;
    const current = category === 'targets' ? focusGas : focusDevices;
    const merged = [...current];
    for (const address of added) if (!merged.includes(address)) merged.push(address);
    if (merged.length === current.length) return;
    if (category === 'targets') setFocusGas(merged);
    else setFocusDevices(merged);
  };

  const update = (patch: Partial<ActiveFilters>) => {
    if (patch.sources) pinNewlySelected('sources', patch.sources);
    if (patch.targets) pinNewlySelected('targets', patch.targets);
    onFiltersChange({ ...activeFilters, ...patch });
  };

  const resetFilters = () => {
    onFiltersChange(DEFAULT_FILTERS);
    setSearch('');
    onFiltersEnabledChange?.(true);
    setCompact(false);
    setCheckedOnly(false);
  };

  const resetFocusList = (mode: 'ga' | 'pa') => {
    if (mode === 'ga') {
      setFocusGas([]);
      setFocusGaSearch('');
      setFocusGaVerdichten(false);
      setFocusGaCompact(false);
      setFocusFilterGas([]);
      setLastSeenGas([]);
    } else {
      setFocusDevices([]);
      setFocusDeviceSearch('');
      setFocusDeviceVerdichten(false);
      setFocusDeviceCompact(false);
      setFocusFilterDevices([]);
      setLastSeenDevices([]);
    }
    clearTargetColors(address => mode === 'ga' ? address.includes('/') : !address.includes('/'));
  };

  const liveOf = (total: number | undefined) => (counts != null ? (total ?? 0) : undefined);
  const storedOf = (total: number | undefined) => (dbCounts != null ? (total ?? 0) : undefined);

  // Entries listed under "Active filters" — switched off or not — and the
  // ones actually applied, which is what the badge counts (#437).
  const activeCount = countSelections(activeFilters);
  const badgeMax = useMemo(() => {
    let max = 0;
    const take = (n: number | undefined) => { if (n !== undefined && n > max) max = n; };
    const scan = (block?: FilterCounts | DbTelegramCounts) => {
      if (!block) return;
      for (const map of [block.sources, block.targets, block.types, block.directions, block.dpts]) {
        for (const n of Object.values(map)) take(n);
      }
      take(categoryCount(block.sources));
      take(categoryCount(block.targets));
      take(categoryCount(block.types));
      take(categoryCount(block.directions));
      take(categoryCount(block.dpts, true));
    };
    scan(counts);
    scan(dbCounts);
    return max;
  }, [counts, dbCounts]);
  const sourceVerdichtenKept = useStickyChecked(compact, activeFilters.sources, false);
  const sourceCompactKept = useStickyChecked(checkedOnly, activeFilters.sources);
  const targetVerdichtenKept = useStickyChecked(compact, activeFilters.targets, false);
  const targetCompactKept = useStickyChecked(checkedOnly, activeFilters.targets);
  const typeVerdichtenKept = useStickyChecked(compact, activeFilters.types, false);
  const typeCompactKept = useStickyChecked(checkedOnly, activeFilters.types);
  const directionVerdichtenKept = useStickyChecked(compact, activeFilters.directions, false);
  const directionCompactKept = useStickyChecked(checkedOnly, activeFilters.directions);
  const dptVerdichtenKept = useStickyChecked(compact, activeFilters.dpts, false);
  const dptCompactKept = useStickyChecked(checkedOnly, activeFilters.dpts);
  const categoryShown = (selection: string[], verdichtenKept: Set<string>, compactKept: Set<string>, total: number | undefined) =>
    !(compact && counts != null && (total ?? 0) === 0 && verdichtenKept.size === 0)
    && !(checkedOnly && selection.length === 0 && compactKept.size === 0);
  const appliedCount = countSelections(enabledFilters(activeFilters));

  return (
    <div ref={panelRef} style={{
      height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column',
      borderRight: '1px solid var(--border-color)',
    }}>
      {/* Header: Filter | Focus. The power button replaces the old sliders icon. */}
      <div style={{
        display: 'flex', alignItems: 'stretch', flexShrink: 0,
        height: 40, boxSizing: 'border-box',
        borderBottom: '1px solid var(--border-color)',
      }}>
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', gap: '0.35rem',
          padding: '0.45rem 0.65rem',
          background: view === 'edit' ? 'rgba(99,102,241,0.15)' : 'transparent',
          borderRight: '1px solid var(--border-color)',
        }}>
          {showMasterToggle && (
            <button
              onClick={e => {
                if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
                  e.preventDefault();
                  resetFilters();
                  resetFocusList('ga');
                  resetFocusList('pa');
                  scrollListToTop('filter');
                  scrollListToTop('focus-ga');
                  scrollListToTop('focus-pa');
                  setMarkReset(n => n + 1);
                  setView('edit');
                  return;
                }
                onFiltersEnabledChange!(!filtersEnabled);
              }}
              title={`${filtersEnabled ? 'Disable filters' : 'Enable filters'}. Ctrl-click clears the filters and the focus, turns the filter on, opens the filter, scrolls both lists to the top, and clears their mouse selections`}
              aria-pressed={filtersEnabled}
              style={{
                ...toggleButtonColors(filtersEnabled),
                cursor: 'pointer',
                display: 'flex', alignItems: 'center', padding: '0.2rem', borderRadius: '999px',
                flexShrink: 0,
              }}
            >
              <Power size={13} strokeWidth={2.5} />
            </button>
          )}
          <button
            type="button"
            onClick={() => setView('edit')}
            aria-pressed={view === 'edit'}
            style={{
              flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: '0.45rem',
              padding: '0.35rem 0.25rem', border: 'none', background: 'transparent',
              fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer', textAlign: 'left',
              color: view === 'edit' ? 'var(--accent-primary)' : 'var(--text-dim)',
            }}
          >
            Filter
            {activeCount > 0 && (
              <span
                title={appliedCount === activeCount ? undefined : `${appliedCount} of ${activeCount} filters applied`}
                style={{
                  fontSize: '0.65rem', fontWeight: 700, padding: '0.1rem 0.45rem',
                  borderRadius: '999px',
                  background: appliedCount > 0 ? 'var(--accent-primary)' : 'var(--text-dim)',
                  color: 'white',
                }}
              >
                {appliedCount === activeCount ? activeCount : `${appliedCount}/${activeCount}`}
              </span>
            )}
          </button>
        </div>
        <button
          type="button"
          onClick={() => setView('active')}
          aria-pressed={view === 'active'}
          style={{
            flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 0, border: 'none', cursor: 'pointer', background: view === 'active' ? 'rgba(99,102,241,0.15)' : 'transparent',
            color: view === 'active' ? 'var(--accent-primary)' : 'var(--text-dim)',
            fontSize: '0.75rem', fontWeight: 700,
          }}
        >
          Focus
        </button>
      </div>

      {view === 'active' && (
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '0.35rem', flexShrink: 0,
            margin: '0.925rem 0.75rem 0.175rem',
          }}>
            <div style={{
              flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '0.15rem',
              padding: '0.1rem', borderRadius: '8px',
              background: 'var(--bg-subtle)', border: '1px solid var(--border-color)',
            }}>
              {(['pa', 'ga'] as const).map(tab => {
                const selected = focusTab === tab;
                const label = tab === 'ga' ? 'Targets' : 'Sources';
                return (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setFocusTab(tab)}
                    aria-pressed={selected}
                    style={{
                      flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      padding: '0.35rem 0.3rem', border: 'none', cursor: 'pointer', background: selected ? 'rgba(99,102,241,0.15)' : 'transparent',
                      borderRadius: '6px',
                      fontSize: '0.73rem', fontWeight: 600,
                      color: selected ? 'var(--accent-primary)' : 'var(--text-dim)',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
            <TabReset
              label="Reset focus"
              title="Clear focus, quick filters, last seen and colours for sources and targets, and their search, and turn Compact and Verdichten off"
              onClick={() => { resetFocusList('ga'); resetFocusList('pa'); }}
            />
          </div>
          <FocusList
            mode={focusTab}
            entries={focusTab === 'ga' ? options.targets : options.sources}
            focused={focusTab === 'ga' ? focusGas : focusDevices}
            onFocusedChange={focusTab === 'ga' ? setFocusGas : setFocusDevices}
            writeEnabled={writeEnabled}
            targetColors={targetColors}
            search={focusTab === 'ga' ? focusGaSearch : focusDeviceSearch}
            onSearchChange={focusTab === 'ga' ? setFocusGaSearch : setFocusDeviceSearch}
            compact={focusTab === 'ga' ? focusGaVerdichten : focusDeviceVerdichten}
            onCompactChange={focusTab === 'ga' ? setFocusGaVerdichten : setFocusDeviceVerdichten}
            checkedOnly={focusTab === 'ga' ? focusGaCompact : focusDeviceCompact}
            onCheckedOnlyChange={focusTab === 'ga' ? setFocusGaCompact : setFocusDeviceCompact}
            counts={focusTab === 'ga' ? counts?.targets : counts?.sources}
            bufferCounts={focusTab === 'ga' ? bufferCounts?.targets : bufferCounts?.sources}
            lastSeen={focusTab === 'ga' ? lastSeenGas : lastSeenDevices}
            onLastSeenChange={focusTab === 'ga' ? setLastSeenGas : setLastSeenDevices}
            quickFilter={focusTab === 'ga' ? focusFilterGas : focusFilterDevices}
            onQuickFilterChange={focusTab === 'ga' ? setFocusFilterGas : setFocusFilterDevices}
            visualized={focusTab === 'ga' ? visualizedGas : visualizedDevices}
            onVisualizedChange={focusTab === 'ga' ? setVisualizedGas : setVisualizedDevices}
            onNavigateFocus={() => { setFocusTab(focusTab); setView('active'); }}
            onNavigateList={() => onOpenPanel?.('list')}
            onNavigateVisualizer={() => onOpenPanel?.('visualizer')}
            onNavigateLastSeen={() => onOpenPanel?.('lastseen')}
            markReset={markReset}
            toolbarExtra={(
              <TabReset
                label={focusTab === 'ga' ? 'Reset targets' : 'Reset sources'}
                title={focusTab === 'ga'
                  ? 'Clear target focus, quick filters, last seen and colours, and the search, and turn Compact and Verdichten off'
                  : 'Clear source focus, quick filters, last seen and colours, and the search, and turn Compact and Verdichten off'}
                onClick={() => resetFocusList(focusTab)}
              />
            )}
          />
        </div>
      )}

      {/* Edit filters view: search + category sections */}
      {view === 'edit' && (<BadgeColumnScope max={badgeMax}><>
      {/* Search bar */}
      <div style={{
        padding: '0.75rem', borderBottom: '1px solid var(--border-color)', flexShrink: 0,
        display: 'flex', alignItems: 'center', gap: '0.35rem',
      }}>
        <div style={{
          flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '0.5rem',
          background: 'var(--bg-tag)', border: '1px solid var(--border-color)',
          borderRadius: '7px', padding: '0.45rem 0.65rem',
          transition: 'border-color 0.2s',
        }}>
          <Search size={13} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
          <input
            type="text"
            placeholder="filter..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              background: 'transparent', border: 'none', outline: 'none',
              color: 'var(--text-main)', fontSize: '0.8125rem', flex: 1, minWidth: 0,
              fontFamily: 'inherit',
            }}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-dim)' }}
            >
              <X size={11} />
            </button>
          )}
        </div>
        <button
          type="button"
          aria-label="Compact"
          aria-pressed={checkedOnly}
          disabled={activeCount === 0 && !checkedOnly}
          title={activeCount > 0 || checkedOnly ? 'Show only checked entries' : 'Check an entry to compact the list'}
          onClick={() => setCheckedOnly(!checkedOnly)}
          style={{
            flexShrink: 0, borderRadius: '7px',
            display: 'flex', alignItems: 'center', padding: '0.4rem',
            cursor: activeCount > 0 || checkedOnly ? 'pointer' : 'not-allowed',
            opacity: activeCount > 0 || checkedOnly ? 1 : 0.4,
            ...toggleButtonColors(checkedOnly),
          }}
        >
          <ListChecks size={14} />
        </button>
        <button
          type="button"
          aria-label="Verdichten"
          aria-pressed={compact}
          title="Hide entries with no telegrams"
          onClick={() => setCompact(!compact)}
          style={{
            flexShrink: 0, cursor: 'pointer', borderRadius: '7px',
            display: 'flex', alignItems: 'center', padding: '0.4rem',
            ...toggleButtonColors(compact),
          }}
        >
          <FoldVertical size={14} />
        </button>
        <TabReset
          label="Reset filters"
          title="Clear all filters and the search, turn the filter switch on, and turn Compact and Verdichten off"
          onClick={resetFilters}
        />
      </div>

      {/* Scrollable options */}
      <div ref={filterScrollRef} data-panel-scroll="filter" style={{ flex: 1, overflowY: 'auto' }}>

        {/* No-project notice — source/target/DPT filters need an ETS project */}
        {showNoProjectNotice && (
          <div style={{
            margin: '0.75rem', padding: '0.85rem',
            border: '1px solid var(--border-color)', borderRadius: '8px',
            background: 'var(--bg-subtle)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.4rem' }}>
              <AlertTriangle size={14} style={{ color: 'var(--warning-text)', flexShrink: 0 }} />
              <span style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-main)' }}>
                No ETS project loaded
              </span>
            </div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', lineHeight: 1.5, marginBottom: onUploadProject ? '0.7rem' : 0 }}>
              Filtering by source, target and DPT needs the group and device names
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

        {/* Source */}
        {filteredSources.length > 0 && categoryShown(activeFilters.sources, sourceVerdichtenKept, sourceCompactKept, categoryCount(counts?.sources)) && (
          <Section title="Source" sectionKey="source" defaultOpen selected={activeFilters.sources.length > 0} count={liveOf(categoryCount(counts?.sources))} dbCount={storedOf(categoryCount(dbCounts?.sources))} objects={categoryObjects(counts?.sources)} objectLabel="Sources in the buffer" branchKeys={knxBranchKeys(filteredSources.map(s => s.address), '.')}>
            <KnxAddressTree
              entries={filteredSources}
              selected={activeFilters.sources}
              groupNames={options.pa_line_names ?? {}}
              separator="."
              onToggle={addresses => update({ sources: addresses })}
              counts={counts?.sources}
              bufferCounts={bufferCounts?.sources}
              dbCounts={dbCounts?.sources}
              compact={compact}
              checkedOnly={checkedOnly}
              verdichtenKept={sourceVerdichtenKept}
              compactKept={sourceCompactKept}
              searchQuery={search}
              onLastSeen={onQuickLastSeen ? (addr, gesture, clicked) => onQuickLastSeen(addr, 'pa', gesture, clicked) : undefined}
              focused={focusDevices}
              onOpenList={() => onOpenPanel?.('list')}
              markReset={markReset}
              onFocusToggle={(addresses, turnOn, gesture) => {
                if (gesture.kind === 'toggle') {
                  setFocusDevices(applyToggle(focusDevices, addresses, turnOn, gesture.exclusive));
                  if (!gesture.navigate) return;
                }
                setFocusTab('pa');
                setView('active');
              }}
              filtered={focusFilterDevices}
              onFilterToggle={(addresses, turnOn, gesture) => {
                if (gesture.kind === 'toggle') {
                  setFocusFilterDevices(applyToggle(focusFilterDevices, addresses, turnOn, gesture.exclusive));
                  if (!gesture.navigate) return;
                }
                onOpenPanel?.('list');
              }}
              visualized={visualizedDevices}
              onVisualizeToggle={(addresses, turnOn, gesture) => {
                if (gesture.kind === 'toggle') {
                  setVisualizedDevices(applyToggle(visualizedDevices, addresses, turnOn, gesture.exclusive));
                  if (!gesture.navigate) return;
                }
                onOpenPanel?.('visualizer');
              }}
              lastSeen={lastSeenDevices}
              writeEnabled={writeEnabled}
            />
          </Section>
        )}

        {/* Target */}
        {filteredTargets.length > 0 && categoryShown(activeFilters.targets, targetVerdichtenKept, targetCompactKept, categoryCount(counts?.targets)) && (
          <Section title="Target" sectionKey="target" defaultOpen selected={activeFilters.targets.length > 0} count={liveOf(categoryCount(counts?.targets))} dbCount={storedOf(categoryCount(dbCounts?.targets))} objects={categoryObjects(counts?.targets)} objectLabel="Targets in the buffer" branchKeys={knxBranchKeys(filteredTargets.map(s => s.address), '/')}>
            <KnxAddressTree
              entries={filteredTargets}
              selected={activeFilters.targets}
              groupNames={options.ga_group_names ?? {}}
              separator="/"
              onToggle={addresses => update({ targets: addresses })}
              counts={counts?.targets}
              bufferCounts={bufferCounts?.targets}
              dbCounts={dbCounts?.targets}
              compact={compact}
              checkedOnly={checkedOnly}
              verdichtenKept={targetVerdichtenKept}
              compactKept={targetCompactKept}
              searchQuery={search}
              onLastSeen={onQuickLastSeen ? (addr, gesture, clicked) => onQuickLastSeen(addr, 'ga', gesture, clicked) : undefined}
              focused={focusGas}
              onOpenList={() => onOpenPanel?.('list')}
              markReset={markReset}
              onFocusToggle={(addresses, turnOn, gesture) => {
                if (gesture.kind === 'toggle') {
                  setFocusGas(applyToggle(focusGas, addresses, turnOn, gesture.exclusive));
                  if (!gesture.navigate) return;
                }
                setFocusTab('ga');
                setView('active');
              }}
              filtered={focusFilterGas}
              onFilterToggle={(addresses, turnOn, gesture) => {
                if (gesture.kind === 'toggle') {
                  setFocusFilterGas(applyToggle(focusFilterGas, addresses, turnOn, gesture.exclusive));
                  if (!gesture.navigate) return;
                }
                onOpenPanel?.('list');
              }}
              visualized={visualizedGas}
              onVisualizeToggle={(addresses, turnOn, gesture) => {
                if (gesture.kind === 'toggle') {
                  setVisualizedGas(applyToggle(visualizedGas, addresses, turnOn, gesture.exclusive));
                  if (!gesture.navigate) return;
                }
                onOpenPanel?.('visualizer');
              }}
              lastSeen={lastSeenGas}
              writeEnabled={writeEnabled}
            />
          </Section>
        )}

        {/* Type */}
        {filteredTypes.length > 0 && categoryShown(activeFilters.types, typeVerdichtenKept, typeCompactKept, categoryCount(counts?.types)) && (
          <Section title="Type" sectionKey="type" defaultOpen selected={activeFilters.types.length > 0} count={liveOf(categoryCount(counts?.types))} dbCount={storedOf(categoryCount(dbCounts?.types))} objects={categoryObjects(counts?.types)} objectLabel="Types in the buffer">
            <FilterChoiceList
              ids={filteredTypes}
              selected={activeFilters.types}
              onChange={types => update({ types })}
              onOpenList={() => onOpenPanel?.('list')}
              markReset={markReset}
              row={t => {
                const n = counts ? (counts.types[t] ?? 0) : undefined;
                return {
                  count: n,
                  dbCount: dbCounts ? (dbCounts.types[t] ?? 0) : undefined,
                  emphasized: bufferCounts ? (bufferCounts.types[t] ?? 0) > 0 : false,
                  hidden: (checkedOnly && !activeFilters.types.includes(t) && !typeCompactKept.has(t))
                    || (n === 0 && compact && !typeVerdichtenKept.has(t)),
                };
              }}
            />
          </Section>
        )}

        {/* Direction — orthogonal to Type: incoming bus traffic vs. self-sent telegrams (#194) */}
        {filteredDirections.length > 0 && categoryShown(activeFilters.directions, directionVerdichtenKept, directionCompactKept, categoryCount(counts?.directions)) && (
          <Section title="Direction" sectionKey="direction" defaultOpen selected={activeFilters.directions.length > 0} count={liveOf(categoryCount(counts?.directions))} dbCount={storedOf(categoryCount(dbCounts?.directions))} objects={categoryObjects(counts?.directions)} objectLabel="Directions in the buffer">
            <FilterChoiceList
              ids={[...filteredDirections]}
              selected={activeFilters.directions}
              onChange={directions => update({ directions })}
              onOpenList={() => onOpenPanel?.('list')}
              markReset={markReset}
              row={d => {
                const n = counts ? (counts.directions[d] ?? 0) : undefined;
                return {
                  count: n,
                  dbCount: dbCounts ? (dbCounts.directions[d] ?? 0) : undefined,
                  emphasized: bufferCounts ? (bufferCounts.directions[d] ?? 0) > 0 : false,
                  hidden: (checkedOnly && !activeFilters.directions.includes(d) && !directionCompactKept.has(d))
                    || (n === 0 && compact && !directionVerdichtenKept.has(d)),
                };
              }}
            />
          </Section>
        )}

        {/* DPT — grouped by main data type / bit-byte width (#273) */}
        {filteredDpts.length > 0 && categoryShown(activeFilters.dpts, dptVerdichtenKept, dptCompactKept, categoryCount(counts?.dpts, true)) && (
          <Section title="DPT" sectionKey="dpt" defaultOpen={false} selected={activeFilters.dpts.length > 0} count={liveOf(categoryCount(counts?.dpts, true))} dbCount={storedOf(categoryCount(dbCounts?.dpts, true))} objects={categoryObjects(counts?.dpts, true)} objectLabel="DPTs in the buffer" branchKeys={dptBranchKeys(filteredDpts)}>
            <DptTypeTree
              entries={filteredDpts}
              selected={activeFilters.dpts}
              onChange={dpts => update({ dpts })}
              counts={counts?.dpts}
              bufferCounts={bufferCounts?.dpts}
              dbCounts={dbCounts?.dpts}
              compact={compact}
              checkedOnly={checkedOnly}
              verdichtenKept={dptVerdichtenKept}
              compactKept={dptCompactKept}
              searchQuery={search}
              onOpenList={() => onOpenPanel?.('list')}
              markReset={markReset}
            />
          </Section>
        )}

      </div>
      </></BadgeColumnScope>)}
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
