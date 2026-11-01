import React, { useState, useMemo, useEffect, useRef } from 'react';
import { TelegramTable, type SortConfig, type SortKey } from './TelegramTable';
import { readSortConfigPref, writeSortConfigPref, toggleSortLevel, sortTelegrams } from '../utils/sortConfig';
import { expandWithDeltaContext } from '../utils/deltaContextExpansion';
import { activeQuickFilter, DEFAULT_QUICK_FILTER_COLUMN_ENABLED, type QuickFilterColumnEnabled, type QuickPatterns } from '../utils/quickFilter';
import { anchorKey } from '../utils/anchorKey';
import { applyToggle, PLAIN_TOGGLE, toggleTurnOn, type ToggleGesture } from '../utils/toggleClick';
import type { Telegram } from '../hooks/useWebSocket';
import { History, Download, AlertTriangle, Trash2, SlidersHorizontal, LineChart, RefreshCw } from 'lucide-react';
import { HistoryLoader } from './HistoryLoader';
import { Visualizer } from './Visualizer';
import { FilterPanel } from './FilterPanel';
import { ResizablePane } from './ResizablePane';
import { loadHistoryTelegrams, type LoadedRange } from '../utils/historyLoad';
import type { DbTelegramCounts } from '../hooks/useDbTelegramCounts';
import { buildViewUrl, type VizViewState } from '../utils/viewUrl';
import {
  countAppliedFilterOptions,
  countFilterOptions,
  countSelections,
  enabledFilters,
  effectiveDeltaContext,
  withoutSelections,
  hasActiveFilters,
  matchesTelegram,
  focusAddressesForList,
  passesFocusAddressFilter,
  type ActiveFilters,
  type FilterOptions,
} from '../types/filters';

// Stable identity so passing "no flags" doesn't churn memo deps (#319).
const EMPTY_FLAG_SET: ReadonlySet<string> = new Set();

export type LoaderTimeRange = {
  relValue: number;
  relUnit: 'seconds' | 'minutes' | 'hours' | 'days';
  startTime: string;
  endTime: string;
};

interface HistorySearchProps {
  visibleColumns: { [key: string]: boolean };
  loadLimit: number;
  filterOptions: FilterOptions;
  activeFilters: ActiveFilters;
  onFiltersChange: (f: ActiveFilters) => void;
  onOpenSettings: () => void;
  projectLoaded?: boolean;
  selectedVisualizationTargets: string[];
  onVisualizationTargetsChange: (targets: string[] | ((prev: string[]) => string[])) => void;
  /** Shared-view state parsed from the URL — triggers an auto-load on mount (#150). */
  initialView?: VizViewState | null;
  /** Master filter switch, shared with the Group Monitor (#370, #436). */
  filtersEnabled?: boolean;
  onFiltersEnabledChange?: (enabled: boolean) => void;
  /** Shared option search and compact toggle, persisted with the UI session. */
  filterSearch?: string;
  onFilterSearchChange?: (search: string) => void;
  filterCompact?: boolean;
  onFilterCompactChange?: (compact: boolean) => void;
  filterCheckedOnly?: boolean;
  onFilterCheckedOnlyChange?: (checkedOnly: boolean) => void;
  /** Shared Filter/Focus header, persisted with the UI session. */
  panelView?: 'filter' | 'focus';
  onPanelViewChange?: (view: 'filter' | 'focus') => void;
  focusTab?: 'ga' | 'pa';
  onFocusTabChange?: (tab: 'ga' | 'pa') => void;
  focusGas?: string[];
  onFocusGasChange?: (addresses: string[]) => void;
  focusDevices?: string[];
  onFocusDevicesChange?: (addresses: string[]) => void;
  focusGaSearch?: string;
  onFocusGaSearchChange?: (search: string) => void;
  focusDeviceSearch?: string;
  onFocusDeviceSearchChange?: (search: string) => void;
  focusGaCompact?: boolean;
  onFocusGaCompactChange?: (compact: boolean) => void;
  focusDeviceCompact?: boolean;
  onFocusDeviceCompactChange?: (compact: boolean) => void;
  focusGaVerdichten?: boolean;
  onFocusGaVerdichtenChange?: (compact: boolean) => void;
  focusDeviceVerdichten?: boolean;
  onFocusDeviceVerdichtenChange?: (compact: boolean) => void;
  lastSeenGas?: string[];
  onLastSeenGasChange?: (addresses: string[]) => void;
  lastSeenDevices?: string[];
  onLastSeenDevicesChange?: (addresses: string[]) => void;
  /** Visualization toggles. These do not change the focus checkboxes. */
  visualizedGas?: string[];
  onVisualizedGasChange?: (addresses: string[]) => void;
  visualizedDevices?: string[];
  onVisualizedDevicesChange?: (addresses: string[]) => void;
  focusFilterGas?: string[];
  onFocusFilterGasChange?: (addresses: string[]) => void;
  focusFilterDevices?: string[];
  onFocusFilterDevicesChange?: (addresses: string[]) => void;
  filterFocusedSources?: boolean;
  onFilterFocusedSourcesChange?: (on: boolean) => void;
  filterFocusedTargets?: boolean;
  onFilterFocusedTargetsChange?: (on: boolean) => void;
  /** Database totals for the gray filter badge. */
  dbCounts?: DbTelegramCounts;
  /** Shift or alt on a last-seen toggle leaves History for the Last Seen panel. */
  onOpenLastSeen?: () => void;
  writeEnabled?: boolean;
}

export const HistorySearch: React.FC<HistorySearchProps> = ({
  visibleColumns, loadLimit, filterOptions, activeFilters, onFiltersChange, onOpenSettings,
  projectLoaded, selectedVisualizationTargets, onVisualizationTargetsChange, initialView,
  filtersEnabled = true, onFiltersEnabledChange,
  filterSearch, onFilterSearchChange, filterCompact, onFilterCompactChange, filterCheckedOnly, onFilterCheckedOnlyChange,
  panelView, onPanelViewChange,
  focusTab, onFocusTabChange, focusGas, onFocusGasChange, focusDevices, onFocusDevicesChange,
  focusGaSearch, onFocusGaSearchChange, focusDeviceSearch, onFocusDeviceSearchChange,
  focusGaCompact, onFocusGaCompactChange, focusDeviceCompact, onFocusDeviceCompactChange,
  focusGaVerdichten, onFocusGaVerdichtenChange, focusDeviceVerdichten, onFocusDeviceVerdichtenChange,
  lastSeenGas, onLastSeenGasChange, lastSeenDevices, onLastSeenDevicesChange,
  visualizedGas, onVisualizedGasChange, visualizedDevices, onVisualizedDevicesChange,
  focusFilterGas, onFocusFilterGasChange, focusFilterDevices, onFocusFilterDevicesChange,
  filterFocusedSources = false, onFilterFocusedSourcesChange, filterFocusedTargets = false, onFilterFocusedTargetsChange,
  dbCounts, onOpenLastSeen, writeEnabled = false,
}) => {
  const [telegrams, setTelegrams] = useState<Telegram[]>([]);
  const [isLoaderOpen, setIsLoaderOpen] = useState(false);
  const [metadata, setMetadata] = useState<{ total_count: number; limit_reached: boolean } | null>(null);
  const [sortConfig, setSortConfig] = useState<SortConfig>(readSortConfigPref);
  // Per-message Time-Delta-Context flags (#319) — local to this view, like marks.
  const [flaggedKeys, setFlaggedKeys] = useState<string[]>([]);
  const [contextForAllMatches, setContextForAllMatches] = useState(true);
  // Quick filter bar state, lifted so its matches anchor the context (#520).
  const [quickFilterOpen, setQuickFilterOpen] = useState(false);
  const [quickFilterEnabled, setQuickFilterEnabled] = useState(false);
  const [quickPatterns, setQuickPatterns] = useState<QuickPatterns>({});
  const [quickFilterColumns, setQuickFilterColumns] = useState<QuickFilterColumnEnabled>(DEFAULT_QUICK_FILTER_COLUMN_ENABLED);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isVisualizerOpen, setIsVisualizerOpen] = useState(false);

  // Persisted time range — survives HistoryLoader open/close cycles
  const [timeRange, setTimeRange] = useState<LoaderTimeRange>({
    relValue: 1, relUnit: 'hours', startTime: '', endTime: '',
  });

  // Snapshot of filters at the time of the last load — used to detect stale results
  const [filtersAtLoad, setFiltersAtLoad] = useState<ActiveFilters | null>(null);

  // The time window of the last load — basis for shareable links (#150)
  const [loadedRange, setLoadedRange] = useState<LoadedRange | null>(null);

  // Auto-load a view shared via URL exactly once on mount (#150)
  const initialViewLoaded = useRef(false);
  useEffect(() => {
    if (!initialView || initialViewLoaded.current) return;
    initialViewLoaded.current = true;
    const limit = initialView.limit ?? loadLimit;
    loadHistoryTelegrams(initialView.range, limit, initialView.filters)
      .then(({ telegrams: loaded, metadata: meta }) => {
        setTelegrams(loaded);
        setMetadata(meta);
        setFiltersAtLoad(initialView.filters);
        setLoadedRange(initialView.range);
        setIsVisualizerOpen(true);
      })
      .catch(err => console.error('Failed to load shared view:', err));
  }, [initialView, loadLimit]);

  const handleSort = (key: SortKey, opts?: { additive?: boolean }) => {
    setSortConfig(prev => {
      const next = toggleSortLevel(prev, key, !!opts?.additive);
      writeSortConfigPref(next);
      return next;
    });
  };

  const toggleFocusMembership = (
    address: string | string[],
    mode: 'ga' | 'pa',
    gesture: ToggleGesture = PLAIN_TOGGLE,
    clicked?: string,
  ) => {
    if (gesture.kind === 'none') return;
    const addresses = typeof address === 'string' ? [address] : address;
    if (gesture.kind === 'toggle') {
      const current = mode === 'ga' ? (focusGas ?? []) : (focusDevices ?? []);
      const next = applyToggle(
        current,
        addresses,
        toggleTurnOn(current, addresses, clicked ?? (addresses.length === 1 ? addresses[0] : undefined)),
        gesture.exclusive,
      );
      if (mode === 'ga') onFocusGasChange?.(next);
      else onFocusDevicesChange?.(next);
      if (!gesture.navigate) return;
    }
    onFocusTabChange?.(mode);
    onPanelViewChange?.('focus');
    setIsFilterOpen(true);
  };

  const toggleFocusFilter = (
    address: string | string[],
    mode: 'ga' | 'pa',
    gesture: ToggleGesture = PLAIN_TOGGLE,
    clicked?: string,
  ) => {
    if (gesture.kind === 'none') return;
    const addresses = typeof address === 'string' ? [address] : address;
    if (gesture.kind === 'toggle') {
      const current = mode === 'ga' ? (focusFilterGas ?? []) : (focusFilterDevices ?? []);
      const next = applyToggle(
        current,
        addresses,
        toggleTurnOn(current, addresses, clicked ?? (addresses.length === 1 ? addresses[0] : undefined)),
        gesture.exclusive,
      );
      if (mode === 'ga') onFocusFilterGasChange?.(next);
      else onFocusFilterDevicesChange?.(next);
      if (!gesture.navigate) return;
    }
    onFocusTabChange?.(mode);
    onPanelViewChange?.('focus');
    setIsFilterOpen(true);
    setIsVisualizerOpen(false);
  };

  const handleQuickLastSeen = (
    address: string | string[],
    mode: 'ga' | 'pa',
    gesture: ToggleGesture = PLAIN_TOGGLE,
    clicked?: string,
  ) => {
    if (gesture.kind === 'none') return;
    const addresses = typeof address === 'string' ? [address] : address;
    if (gesture.kind === 'toggle') {
      const current = mode === 'ga' ? (lastSeenGas ?? []) : (lastSeenDevices ?? []);
      const next = applyToggle(
        current,
        addresses,
        toggleTurnOn(current, addresses, clicked ?? (addresses.length === 1 ? addresses[0] : undefined)),
        gesture.exclusive,
      );
      if (mode === 'ga') onLastSeenGasChange?.(next);
      else onLastSeenDevicesChange?.(next);
      if (!gesture.navigate) return;
    }
    onOpenLastSeen?.();
  };

  const handleQuickFilter = (key: 'sources' | 'targets' | 'types' | 'dpts', value: string | number) => {
    const current = activeFilters[key] as (string | number)[];
    const isPresent = current.includes(value as never);
    onFiltersChange({
      ...activeFilters,
      [key]: isPresent ? current.filter(v => v !== value) : [...current, value]
    });
    setIsFilterOpen(true);
  };

  const handleQuickVisualize = (
    targetAddress: string | string[],
    _mode: 'ga' | 'pa' = 'ga',
    gesture: ToggleGesture = PLAIN_TOGGLE,
    clicked?: string,
  ) => {
    if (gesture.kind === 'none') return;
    const addresses = typeof targetAddress === 'string' ? [targetAddress] : targetAddress;
    if (gesture.kind === 'toggle') {
      const next = applyToggle(
        selectedVisualizationTargets,
        addresses,
        toggleTurnOn(selectedVisualizationTargets, addresses, clicked ?? (addresses.length === 1 ? addresses[0] : undefined)),
        gesture.exclusive,
      );
      onVisualizationTargetsChange(next);
      if (!gesture.navigate) return;
    }
    setIsVisualizerOpen(true);
  };

  const handleVisualizeDevice = (
    sourceAddress: string | string[],
    _mode: 'ga' | 'pa' = 'pa',
    gesture: ToggleGesture = PLAIN_TOGGLE,
    clicked?: string,
  ) => {
    if (gesture.kind === 'none') return;
    const addresses = typeof sourceAddress === 'string' ? [sourceAddress] : sourceAddress;
    if (gesture.kind === 'toggle') {
      const current = visualizedDevices ?? [];
      onVisualizedDevicesChange?.(applyToggle(
        current,
        addresses,
        toggleTurnOn(current, addresses, clicked ?? (addresses.length === 1 ? addresses[0] : undefined)),
        gesture.exclusive,
      ));
      if (!gesture.navigate) return;
    }
    setIsVisualizerOpen(true);
  };

  // Time-Delta-Context window, edited from the telegram list's DELTA TIME
  // quick-filter cell rather than the filter pane (#309, #371).
  const handleDeltaContextChange = (deltaBeforeMs: number, deltaAfterMs: number) => {
    onFiltersChange({ ...activeFilters, deltaBeforeMs, deltaAfterMs });
  };

  // Toggles the window on/off without losing the entered values (#318).
  const handleDeltaContextEnabledChange = (deltaContextEnabled: boolean) => {
    onFiltersChange({ ...activeFilters, deltaContextEnabled });
  };

  const sortedTelegrams = useMemo(
    () => sortTelegrams(telegrams, sortConfig),
    [telegrams, sortConfig]
  );

  // Master switch off (#436): behave as if no filter were set — for the rows
  // shown and for what the next load asks the server for — but keep the set.
  // Entries switched off one by one (#437) are left out as well.
  const effectiveFilters = useMemo(
    () => (filtersEnabled ? enabledFilters(activeFilters) : withoutSelections(activeFilters)),
    [filtersEnabled, activeFilters]
  );
  const filtering = hasActiveFilters(effectiveFilters);

  const handleLoad = (loaded: Telegram[], meta?: { total_count: number; limit_reached: boolean }, range?: LoadedRange) => {
    setTelegrams(prev => {
      const existingTs = new Set(prev.map(t => t.timestamp));
      const newUnique = loaded.filter(t => !existingTs.has(t.timestamp));
      const seenNew = new Set<string>();
      const deduped = newUnique.filter(t => {
        if (seenNew.has(t.timestamp)) return false;
        seenNew.add(t.timestamp);
        return true;
      });
      const next = [...prev, ...deduped];
      return next.length > loadLimit ? next.slice(0, loadLimit) : next;
    });
    setMetadata(meta || null);
    // Snapshot the filters at load time so we can detect when they diverge
    setFiltersAtLoad(effectiveFilters);
    if (range) setLoadedRange(range);
  };

  // In-memory filter pass — mirrors live view filtering so changing filters
  // immediately applies to already-loaded data without a re-fetch. Also
  // applies the Time-Delta-Context window client-side (#309/#319), since
  // per-message flags are set after the historical load already happened.
  const deltaExpandedHistory = useMemo(() => {
    const noFilter = !filtering;
    const quick = activeQuickFilter(quickFilterOpen, quickFilterEnabled, quickPatterns, quickFilterColumns);
    const appliedFocus = focusAddressesForList(focusFilterGas ?? [], focusFilterDevices ?? [], filterFocusedSources, filterFocusedTargets);
    const matches = sortedTelegrams.map(t =>
      (noFilter || matchesTelegram(t, effectiveFilters))
      && passesFocusAddressFilter(t, appliedFocus.gas, appliedFocus.devices)
      && (!quick || quick(t))
    );
    const { before, after } = effectiveDeltaContext(activeFilters, quickFilterColumns.delta !== false);
    // Same rule as the live list: a context-button flag does not keep a
    // non-match unless a window is set and a focus or quick filter narrows the list.
    const focusOrQuick = appliedFocus.gas.length > 0 || appliedFocus.devices.length > 0 || quick != null;
    const flags = activeFilters.deltaContextEnabled && (before > 0 || after > 0) && focusOrQuick
      ? new Set(flaggedKeys)
      : EMPTY_FLAG_SET;
    return expandWithDeltaContext(sortedTelegrams, matches, anchorKey, flags, before, after, contextForAllMatches);
  }, [sortedTelegrams, activeFilters, effectiveFilters, filtering, flaggedKeys, contextForAllMatches, quickFilterOpen, quickFilterEnabled, quickPatterns, quickFilterColumns, focusFilterGas, focusFilterDevices, filterFocusedSources, filterFocusedTargets]);
  const filteredSortedTelegrams = deltaExpandedHistory.items;
  // Keys of rows shown only as unfiltered context around a match/flag (#343).
  const contextTelegramKeys = deltaExpandedHistory.contextKeys;

  // True when current filters are less restrictive than what was used to fetch,
  // meaning some telegrams may be missing from the loaded set.
  const filtersLessRestrictive = useMemo(() => {
    const atLoad = filtersAtLoad;
    if (!atLoad || telegrams.length === 0) return false;
    // A category became less restrictive if it had selections at load time
    // but now has fewer (or none) — data for the removed entries was never fetched.
    const wasFiltered = (arr: (string | number)[]) => arr.length > 0;
    const nowHasFewer = (now: (string | number)[], then: (string | number)[]) =>
      then.some(v => !now.includes(v as never));
    return (
      (wasFiltered(atLoad.sources) && nowHasFewer(effectiveFilters.sources, atLoad.sources)) ||
      (wasFiltered(atLoad.targets) && nowHasFewer(effectiveFilters.targets, atLoad.targets)) ||
      (wasFiltered(atLoad.types)   && nowHasFewer(effectiveFilters.types,   atLoad.types))   ||
      (wasFiltered(atLoad.dpts)    && nowHasFewer(effectiveFilters.dpts,    atLoad.dpts)) ||
      (wasFiltered(atLoad.directions) && nowHasFewer(effectiveFilters.directions, atLoad.directions))
    );
  }, [effectiveFilters, filtersAtLoad, telegrams.length]);

  // Same rule as the Group Monitor: selections count even while the master
  // switch is off, so the pane does not follow that switch.
  const filterCounts = useMemo(
    () => (telegrams.length > 0 ? countAppliedFilterOptions(telegrams, activeFilters) : undefined),
    [telegrams, activeFilters]
  );
  const bufferCounts = useMemo(
    () => (telegrams.length > 0 ? countFilterOptions(telegrams) : undefined),
    [telegrams]
  );

  const activeFilterCount = countSelections(enabledFilters(activeFilters));

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header / Sub-toolbar */}
      <div style={{
        padding: '0 1.25rem', height: '3.5rem', borderBottom: '1px solid var(--border-color)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {telegrams.length > 0 && (
            <span style={{
              fontSize: '0.75rem', color: 'var(--text-dim)', background: 'var(--bg-tag)',
              padding: '0.2rem 0.6rem', borderRadius: '999px', border: '1px solid var(--border-color)',
            }}>
              {filtering
                ? <>{filteredSortedTelegrams.length.toLocaleString()}<span style={{ color: 'var(--text-dim)', fontWeight: 400 }}> / {telegrams.length.toLocaleString()}</span></>
                : telegrams.length.toLocaleString()
              } telegrams
            </span>
          )}
          {filtersLessRestrictive && (
            <span
              style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', color: 'var(--warning-text)', cursor: 'pointer' }}
              onClick={() => setIsLoaderOpen(true)}
              title="Filters were broadened after the last load — some matching telegrams may not be in the loaded set. Click to reload."
            >
              <RefreshCw size={13} /> Reload for full results
            </span>
          )}
          {metadata?.limit_reached && (
            <span
              style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', color: 'var(--warning-text)', cursor: 'pointer' }}
              onClick={onOpenSettings}
              title={`Limit reached (${loadLimit.toLocaleString()}). Click to adjust in settings.`}
            >
              <AlertTriangle size={13} /> Limit reached
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {/* Filter toggle */}
          <button
            className="icon-button"
            onClick={() => setIsFilterOpen(o => !o)}
            title="Toggle filter panel"
            style={{
              position: 'relative',
              color: isFilterOpen || filtering ? 'var(--accent-primary)' : 'var(--text-dim)',
            }}
          >
            <SlidersHorizontal size={18} />
            {activeFilterCount > 0 && (
              <span style={{
                position: 'absolute', top: -5, right: -5,
                fontSize: '0.55rem', fontWeight: 700, minWidth: 14, height: 14,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: filtersEnabled ? 'var(--accent-primary)' : 'var(--text-dim)',
                color: 'white', borderRadius: '999px',
              }}>{activeFilterCount}</span>
            )}
          </button>

          {telegrams.length > 0 && (
            <button
              className="icon-button"
              onClick={() => {
                if (!isVisualizerOpen) {
                  setIsFilterOpen(true);
                  onPanelViewChange?.('focus');
                  onFocusTabChange?.('ga');
                }
                setIsVisualizerOpen(v => !v);
              }}
              title="Visualize data"
              style={{
                display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.85rem',
                border: '1px solid var(--border-color)', borderRadius: '7px', fontSize: '0.8125rem',
                color: isVisualizerOpen ? 'var(--accent-primary)' : 'var(--text-dim)'
              }}
            >
              <LineChart size={16} /> Visualize
            </button>
          )}

          {telegrams.length > 0 && (
            <button
              className="icon-button"
              onClick={() => { setTelegrams([]); setMetadata(null); }}
              title="Clear results"
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.85rem', border: '1px solid var(--border-color)', borderRadius: '7px', fontSize: '0.8125rem', color: 'var(--text-dim)' }}
            >
              <Trash2 size={16} /> Clear
            </button>
          )}
          <button
            className="icon-button"
            onClick={() => setIsLoaderOpen(true)}
            title="Load history"
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.85rem', border: '1px solid var(--border-color)', borderRadius: '7px', fontSize: '0.8125rem', color: 'var(--text-dim)' }}
          >
            <Download size={16} />
            {telegrams.length > 0 ? 'Load more' : 'Load history'}
          </button>
        </div>
      </div>

      {/* Content row: filter panel + table */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        {/* Filter panel (slide-in) */}
        <ResizablePane open={isFilterOpen} prefKey="filter-pane-width">
            <FilterPanel
              options={filterOptions}
              activeFilters={activeFilters}
              onFiltersChange={onFiltersChange}
              counts={filterCounts}
              bufferCounts={bufferCounts}
              dbCounts={dbCounts}
              filtersEnabled={filtersEnabled}
              onFiltersEnabledChange={onFiltersEnabledChange}
              search={filterSearch}
              onSearchChange={onFilterSearchChange}
              compact={filterCompact}
              onCompactChange={onFilterCompactChange}
              checkedOnly={filterCheckedOnly}
              onCheckedOnlyChange={onFilterCheckedOnlyChange}
              panelView={panelView}
              onPanelViewChange={onPanelViewChange}
              focusTab={focusTab}
              onFocusTabChange={onFocusTabChange}
              focusGas={focusGas}
              onFocusGasChange={onFocusGasChange}
              focusDevices={focusDevices}
              onFocusDevicesChange={onFocusDevicesChange}
              focusGaSearch={focusGaSearch}
              onFocusGaSearchChange={onFocusGaSearchChange}
              focusDeviceSearch={focusDeviceSearch}
              onFocusDeviceSearchChange={onFocusDeviceSearchChange}
              focusGaCompact={focusGaCompact}
              onFocusGaCompactChange={onFocusGaCompactChange}
              focusDeviceCompact={focusDeviceCompact}
              onFocusDeviceCompactChange={onFocusDeviceCompactChange}
              focusGaVerdichten={focusGaVerdichten}
              onFocusGaVerdichtenChange={onFocusGaVerdichtenChange}
              focusDeviceVerdichten={focusDeviceVerdichten}
              onFocusDeviceVerdichtenChange={onFocusDeviceVerdichtenChange}
              lastSeenGas={lastSeenGas}
              onLastSeenGasChange={onLastSeenGasChange}
              lastSeenDevices={lastSeenDevices}
              onLastSeenDevicesChange={onLastSeenDevicesChange}
              visualizedGas={visualizedGas ?? selectedVisualizationTargets}
              onVisualizedGasChange={onVisualizedGasChange ?? onVisualizationTargetsChange}
              visualizedDevices={visualizedDevices}
              onVisualizedDevicesChange={onVisualizedDevicesChange}
              focusFilterGas={focusFilterGas}
              onFocusFilterGasChange={onFocusFilterGasChange}
              focusFilterDevices={focusFilterDevices}
              onFocusFilterDevicesChange={onFocusFilterDevicesChange}
              projectLoaded={projectLoaded}
              onUploadProject={onOpenSettings}
              onOpenPanel={panel => {
                if (panel === 'visualizer') { setIsVisualizerOpen(true); return; }
                if (panel === 'list') { setIsVisualizerOpen(false); return; }
                onOpenLastSeen?.();
              }}
            />
        </ResizablePane>

        {/* Table/Chart area */}
        <div style={{ flex: 1, overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column' }}>
          {isVisualizerOpen && telegrams.length > 0 ? (
            <Visualizer
              telegrams={sortedTelegrams}
              selectedTargets={selectedVisualizationTargets}
              onTargetsChange={onVisualizationTargetsChange}
              onClose={() => setIsVisualizerOpen(false)}
              getShareLink={loadedRange ? () => buildViewUrl({
                plot: selectedVisualizationTargets,
                // A shared link carries what is applied, not what is parked.
                filters: enabledFilters(activeFilters),
                range: loadedRange,
                limit: loadLimit,
              }) : undefined}
            />
          ) : telegrams.length === 0 ? (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1.5rem' }}>
              <History size={52} style={{ color: 'var(--accent-primary)', opacity: 0.35 }} />
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.4rem' }}>No data loaded</div>
                <div style={{ color: 'var(--text-dim)', fontSize: '0.875rem' }}>
                  {filtering
                    ? 'Filters are set — click "Load history" to fetch matching data.'
                    : 'Select a time range to search historical bus traffic.'}
                </div>
              </div>
              <button
                onClick={() => setIsLoaderOpen(true)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.75rem',
                  padding: '0.875rem 2rem', background: 'var(--accent-primary)',
                  border: 'none', borderRadius: '10px', color: 'white',
                  fontWeight: 600, fontSize: '1rem', cursor: 'pointer',
                  boxShadow: '0 0 24px rgba(99,102,241,0.35)', transition: 'filter 0.2s',
                }}
              >
                <Download size={20} /> Load History
              </button>
            </div>
          ) : (
            <TelegramTable
              telegrams={filteredSortedTelegrams}
              visibleColumns={visibleColumns}
              sortConfig={sortConfig}
              onSort={handleSort}
              activeFilters={activeFilters}
              filtersEnabled={filtersEnabled}
              onQuickFilter={handleQuickFilter}
              onFocusFilter={toggleFocusMembership}
              focusGas={focusGas}
              focusDevices={focusDevices}
              focusFilterGas={focusFilterGas}
              focusFilterDevices={focusFilterDevices}
              filterFocusedSources={filterFocusedSources}
              onFilterFocusedSourcesChange={onFilterFocusedSourcesChange}
              filterFocusedTargets={filterFocusedTargets}
              onFilterFocusedTargetsChange={onFilterFocusedTargetsChange}
              onQuickVisualize={handleQuickVisualize}
              onQuickVisualizeSource={handleVisualizeDevice}
              onQuickLastSeen={handleQuickLastSeen}
              onFocusAddressFilter={toggleFocusFilter}
              lastSeenGas={lastSeenGas}
              lastSeenDevices={lastSeenDevices}
              visualizedGas={visualizedGas ?? selectedVisualizationTargets}
              visualizedDevices={visualizedDevices}
              canSend={writeEnabled}
              quickFilterOpen={quickFilterOpen}
              onQuickFilterOpenChange={setQuickFilterOpen}
              quickFilterEnabled={quickFilterEnabled}
              onQuickFilterEnabledChange={setQuickFilterEnabled}
              quickPatterns={quickPatterns}
              onQuickPatternsChange={setQuickPatterns}
              quickFilterColumnEnabled={quickFilterColumns}
              onQuickFilterColumnEnabledChange={setQuickFilterColumns}
              onDeltaContextChange={handleDeltaContextChange}
              onDeltaContextEnabledChange={handleDeltaContextEnabledChange}
              flaggedKeys={flaggedKeys}
              onFlaggedKeysChange={setFlaggedKeys}
              contextForAllMatches={contextForAllMatches}
              onContextForAllMatchesChange={setContextForAllMatches}
              contextKeys={contextTelegramKeys}
            />
          )}
        </div>
      </div>

      {isLoaderOpen && (
        <HistoryLoader
          onClose={() => setIsLoaderOpen(false)}
          onLoad={handleLoad}
          limit={loadLimit}
          filters={effectiveFilters}
          timeRange={timeRange}
          onTimeRangeChange={setTimeRange}
        />
      )}
    </div>
  );
};
