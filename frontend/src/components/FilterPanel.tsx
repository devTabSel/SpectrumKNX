import React, { useState, useMemo } from 'react';
import { Search, X, Clock, FolderInput, AlertTriangle, Minimize2, List, LineChart } from 'lucide-react';
import {
  type FilterOption,
  type FilterOptions,
  type ActiveFilters,
  type FilterCounts,
} from '../types/filters';
import { compareKnxAddress } from '../utils/knxAddress';
import { SendToGaPopover } from './SendToGaPopover';

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

interface FocusOptionRowProps {
  label: string;
  sublabel?: string;
  checked: boolean;
  count?: number;
  onToggle: () => void;
  /** Borderless write-to-GA action rendered inline after the address text
   * (#406); receives row-hover so it can hide unless pinned or hovered (#407). */
  writeAction?: (hovered: boolean) => React.ReactNode;
  /** Column 3 quick-action icons (#404), spanning both rows; receives
   * row-hover so each icon can compute its own visibility (#407). */
  actions?: (hovered: boolean) => React.ReactNode;
}

// Table-like item (#404): column 1 (checkbox) and columns 3/4 (icons, badge)
// span both rows; column 2 shows the address on row 1 and the name on row 2.
// Only the checkbox (column 1) toggles the pinned state (#405) — the row
// itself, the badge, and the quick-action icons never affect it.
const FocusOptionRow: React.FC<FocusOptionRowProps> = ({ label, sublabel, checked, count, onToggle, writeAction, actions }) => {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto auto auto auto',
        gridTemplateRows: 'auto auto',
        alignItems: 'center',
        columnGap: '0.6rem',
        rowGap: '0.1rem',
        padding: '0.3rem 0.25rem',
        borderRadius: '6px',
        userSelect: 'none',
        transition: 'background 0.15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-hover)'; setHovered(true); }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; setHovered(false); }}
    >
      {/* Column 1: checkbox, spans both rows — the only control that pins/unpins */}
      <div
        role="checkbox"
        aria-checked={checked}
        aria-label={`Pin ${label}`}
        onClick={onToggle}
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

      {/* Column 2, row 1: address (PA/GA), plus the borderless write action */}
      <div style={{ gridColumn: 2, gridRow: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
        <span
          title={label}
          style={{
            minWidth: 0,
            fontSize: '0.8125rem', color: 'var(--text-main)', fontFamily: "'JetBrains Mono', monospace",
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{label}</span>
        {writeAction?.(hovered)}
      </div>
      {/* Column 2, row 2: name */}
      <div
        title={sublabel}
        style={{
          gridColumn: 2, gridRow: 2, minWidth: 0,
          fontSize: '0.65rem', color: 'var(--text-dim)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>{sublabel}</div>

      {/* Column 3-5: quick-action icons, spans both rows — each icon computes
          its own visibility (#407): pinned/hovered, or its own flag is set. */}
      {actions && (
        <div
          style={{
            gridColumn: '3 / span 3', gridRow: '1 / span 2',
            display: 'flex', alignItems: 'center', gap: '0.1rem',
          }}
        >
          {actions(hovered)}
        </div>
      )}

      {/* Column 6: count badge, spans both rows — display only, no toggling */}
      {count !== undefined && (
        <span
          style={{
            gridColumn: 6, gridRow: '1 / span 2',
            fontSize: '0.65rem', fontWeight: 600, minWidth: '1.8rem', textAlign: 'center',
            padding: '0.1rem 0.4rem', borderRadius: '999px',
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
  /** Borderless write-to-GA action rendered inline after the address (#406);
   * `checked` is the row's pinned state, for computing visibility (#407). */
  writeActionFor?: (address: string, entry: FilterOption, checked: boolean, hovered: boolean) => React.ReactNode;
  actionsFor?: (address: string, entry: FilterOption, checked: boolean, hovered: boolean) => React.ReactNode;
  /** Hide entries whose live count badge reads "0" (#400). */
  hideZeroCount?: boolean;
}

const FocusAddressSection: React.FC<FocusAddressSectionProps> = ({
  title, entries, selected, onToggle, counts, mode, writeActionFor, actionsFor, hideZeroCount,
}) => {
  const [search, setSearch] = useState('');
  const q = search.toLowerCase();
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const zeroFilterActive = mode === 'live' && !!hideZeroCount;

  const filtered = useMemo(() =>
    entries
      .filter(e => !q || e.address?.toLowerCase().includes(q) || e.name?.toLowerCase().includes(q))
      .filter(e => !zeroFilterActive || (counts?.[e.address ?? ''] ?? 0) > 0),
    [entries, q, zeroFilterActive, counts]);

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

  const toggle = (address: string) =>
    onToggle(selectedSet.has(address) ? selected.filter(v => v !== address) : [...selected, address]);

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
        display: 'flex', alignItems: 'center', gap: '0.4rem',
        background: 'var(--bg-tag)', border: '1px solid var(--border-color)',
        borderRadius: '6px', padding: '0.35rem 0.55rem', marginBottom: '0.5rem',
      }}>
        <Search size={12} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
        <input
          type="text"
          placeholder={`Search ${title.toLowerCase()}...`}
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            flex: 1, background: 'transparent', border: 'none', outline: 'none',
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

      {/* Reserved for future per-category quick-action icons (#403) */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.3rem', minHeight: '1.25rem', marginBottom: '0.35rem' }} />

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
              count={mode === 'live' ? (counts?.[e.address ?? ''] ?? 0) : undefined}
              onToggle={() => toggle(e.address ?? '')}
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
              count={mode === 'live' ? (counts?.[e.address ?? ''] ?? 0) : undefined}
              onToggle={() => toggle(e.address ?? '')}
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
  const toggleFlag = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, address: string) => {
    setter(prev => {
      const next = new Set(prev);
      if (next.has(address)) next.delete(address); else next.add(address);
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          {mode === 'live' && (
            <button
              onClick={() => setHideZeroCount(v => !v)}
              title={hideZeroCount ? 'Show all entries' : 'Hide entries with no matching telegrams'}
              style={{
                background: 'transparent', border: 'none', cursor: 'pointer',
                color: hideZeroCount ? 'var(--accent-primary)' : 'var(--text-dim)',
                display: 'flex', alignItems: 'center',
                padding: '0.2rem', borderRadius: '4px', transition: 'color 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent-primary)')}
              onMouseLeave={e => (e.currentTarget.style.color = hideZeroCount ? 'var(--accent-primary)' : 'var(--text-dim)')}
            >
              <Minimize2 size={14} />
            </button>
          )}
        </div>
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

      <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem' }}>

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
                <div data-action-column="list" style={{ gridColumn: 3, display: 'flex', alignItems: 'center' }}>
                  <ShowInListButton active={listFlaggedSet.has(address)} visible={listFlaggedSet.has(address) || checked || hovered} onClick={() => toggleListFlag(address)} />
                </div>
                <div data-action-column="visualize" style={{ gridColumn: 4, display: 'flex', alignItems: 'center' }}>
                  <VisualizeButton active={visualizeFlagged.has(address)} visible={visualizeFlagged.has(address) || checked || hovered} onClick={() => toggleFlag(setVisualizeFlagged, address)} />
                </div>
                <div data-action-column="lastSeen" style={{ gridColumn: 5, display: 'flex', alignItems: 'center' }}>
                  <LastSeenButton active={lastSeenFlagged.has(address)} visible={lastSeenFlagged.has(address) || checked || hovered} onClick={() => toggleFlag(setLastSeenFlagged, address)} />
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
            actionsFor={(address, _entry, checked, hovered) => (
              <>
                <div data-action-column="list" style={{ gridColumn: 3, display: 'flex', alignItems: 'center' }}>
                  <ShowInListButton active={listFlaggedSet.has(address)} visible={listFlaggedSet.has(address) || checked || hovered} onClick={() => toggleListFlag(address)} />
                </div>
                <div data-action-column="lastSeen" style={{ gridColumn: 5, display: 'flex', alignItems: 'center' }}>
                  <LastSeenButton active={lastSeenFlagged.has(address)} visible={lastSeenFlagged.has(address) || checked || hovered} onClick={() => toggleFlag(setLastSeenFlagged, address)} />
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

