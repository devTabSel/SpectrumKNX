import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { TelegramTable, type SortConfig, type SortKey } from './TelegramTable';
import { GotoBufferProvider } from './GotoBufferContext';
import { readSortConfigPref, writeSortConfigPref, toggleSortLevel, sortTelegrams } from '../utils/sortConfig';
import type { QuickPatterns } from '../utils/quickFilter';
import type { Telegram } from '../hooks/useWebSocket';
import { History, AlertTriangle, Trash2, SlidersHorizontal, LineChart, RefreshCw } from 'lucide-react';
import { Visualizer } from './Visualizer';
import { FilterPanel } from './FilterPanel';
import { ResizablePane } from './ResizablePane';
import { HistoryRangeBar } from './HistoryRangeBar';
import {
  isAbortError,
  loadHistoryTelegrams,
  mergeHistoryWindow,
  msToLocalInput,
  rangeToMs,
  replaceHistoryWindow,
  retainLoadedJumpTargets,
  type LoadedRange,
} from '../utils/historyLoad';
import { windowFromRange } from '../utils/rangeWindow';
import { filtersWithQfContext, type ContextBounds } from '../utils/contextWindow';
import {
  historyCounts,
  historyDisplayFilters,
  sidePanelPending,
} from '../utils/historyView';
import { selectVisibleTelegrams } from '../utils/selectVisibleTelegrams';
import { buildViewUrl, type VizViewState } from '../utils/viewUrl';
import {
  countFilterOptions,
  countSelections,
  enabledFilters,
  withoutSelections,
  hasActiveFilters,
  type ActiveFilters,
  type FilterOptions,
} from '../types/filters';

interface HistorySearchProps {
  visibleColumns: { [key: string]: boolean };
  loadLimit: number;
  onLoadLimitChange?: (n: number) => void;
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
  /** Forwarded to TelegramTable so filter edits pin + flash the preferred row. */
  viewChangeToken?: number;
}

const DEFAULT_RANGE_MS = 3_600_000;

export const HistorySearch: React.FC<HistorySearchProps> = ({
  visibleColumns, loadLimit, onLoadLimitChange, filterOptions, activeFilters, onFiltersChange, onOpenSettings,
  projectLoaded, selectedVisualizationTargets, onVisualizationTargetsChange, initialView,
  filtersEnabled = true, onFiltersEnabledChange, viewChangeToken,
}) => {
  const [telegrams, setTelegrams] = useState<Telegram[]>([]);
  const [loading, setLoading] = useState(false);
  const [metadata, setMetadata] = useState<{ total_count: number; limit_reached: boolean } | null>(null);
  const [sortConfig, setSortConfig] = useState<SortConfig>(readSortConfigPref);
  const [flaggedBeforeKeys, setFlaggedBeforeKeys] = useState<string[]>([]);
  const [flaggedAfterKeys, setFlaggedAfterKeys] = useState<string[]>([]);
  const [markedKeys, setMarkedKeys] = useState<string[]>([]);
  const [mouseSelectedKeys, setMouseSelectedKeys] = useState<string[]>([]);
  const [lastSelectedKey, setLastSelectedKey] = useState<string | null>(null);
  const [jumpTargetKeys, setJumpTargetKeys] = useState<string[]>([]);
  const [quickFilterOpen, setQuickFilterOpen] = useState(false);
  const [quickFilterEnabled, setQuickFilterEnabled] = useState(false);
  const [quickPatterns, setQuickPatterns] = useState<QuickPatterns>({});
  /** Explicit quick-filter context. Null follows the applied side-panel window. */
  const [qfContext, setQfContext] = useState<ContextBounds | null>(null);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [isVisualizerOpen, setIsVisualizerOpen] = useState(false);

  // Backward keeps newest, forward keeps oldest. Range edits use that anchor.
  const [readDirection, setReadDirection] = useState<'forward' | 'backward'>('backward');
  const [endMs, setEndMs] = useState(() => Date.now());
  const [startMs, setStartMs] = useState(() => Date.now() - DEFAULT_RANGE_MS);

  // Side panel that the loaded rows were fetched with. Live edits stay pending.
  const [filtersAtLoad, setFiltersAtLoad] = useState<ActiveFilters | null>(null);
  const [loadedRange, setLoadedRange] = useState<LoadedRange | null>(null);

  const loadGen = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const telegramsRef = useRef(telegrams);
  const boundsRef = useRef({ startMs, endMs });
  const directionRef = useRef(readDirection);
  useEffect(() => { telegramsRef.current = telegrams; }, [telegrams]);
  useEffect(() => { boundsRef.current = { startMs, endMs }; }, [startMs, endMs]);
  useEffect(() => { directionRef.current = readDirection; }, [readDirection]);

  const initialViewLoaded = useRef(false);
  useEffect(() => {
    if (!initialView || initialViewLoaded.current) return;
    initialViewLoaded.current = true;
    const bounds = rangeToMs(initialView.range);
    setStartMs(bounds.startMs);
    setEndMs(bounds.endMs);
    const gen = ++loadGen.current;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    const limit = initialView.limit ?? loadLimit;
    loadHistoryTelegrams(initialView.range, limit, initialView.filters, ctrl.signal, 'desc')
      .then(({ telegrams: loaded, metadata: meta }) => {
        if (gen !== loadGen.current) return;
        const next = replaceHistoryWindow(loaded, limit, 'backward');
        telegramsRef.current = next;
        setTelegrams(next);
        setMetadata(meta);
        setFiltersAtLoad(initialView.filters);
        setLoadedRange(initialView.range);
        setJumpTargetKeys(prev => retainLoadedJumpTargets(prev, next));
        setIsVisualizerOpen(true);
      })
      .catch(err => {
        if (isAbortError(err)) return;
        console.error('Failed to load shared view:', err);
      })
      .finally(() => {
        if (gen === loadGen.current) setLoading(false);
      });
  }, [initialView, loadLimit]);

  const effectiveFilters = useMemo(
    () => (filtersEnabled ? enabledFilters(activeFilters) : withoutSelections(activeFilters)),
    [filtersEnabled, activeFilters],
  );
  const spPending = sidePanelPending(filtersAtLoad, effectiveFilters);

  const runLoad = useCallback(async (
    bounds: { startMs: number; endMs: number },
    mode: 'merge' | 'replace',
    queryFilters: ActiveFilters,
    direction: 'forward' | 'backward',
  ) => {
    const gen = ++loadGen.current;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const prevBounds = boundsRef.current;
    const prevDirection = directionRef.current;
    directionRef.current = direction;
    setReadDirection(direction);
    setStartMs(bounds.startMs);
    setEndMs(bounds.endMs);
    setLoading(true);
    const range: LoadedRange = {
      kind: 'absolute',
      startTime: msToLocalInput(bounds.startMs),
      endTime: msToLocalInput(bounds.endMs),
    };
    const order = direction === 'forward' ? 'asc' : 'desc';
    try {
      const { telegrams: loaded, metadata: meta } = await loadHistoryTelegrams(
        range, loadLimit, queryFilters, ctrl.signal, order,
      );
      if (gen !== loadGen.current) return;
      const next = mode === 'replace'
        ? replaceHistoryWindow(loaded, loadLimit, direction)
        : mergeHistoryWindow(
          telegramsRef.current, loaded, bounds.startMs, bounds.endMs, loadLimit, direction,
        );
      telegramsRef.current = next;
      setTelegrams(next);
      setMetadata(meta);
      setLoadedRange(range);
      setJumpTargetKeys(prev => retainLoadedJumpTargets(prev, next));
      if (mode === 'replace') setFiltersAtLoad(queryFilters);
    } catch (err) {
      if (isAbortError(err)) {
        if (gen === loadGen.current) {
          directionRef.current = prevDirection;
          setReadDirection(prevDirection);
          setStartMs(prevBounds.startMs);
          setEndMs(prevBounds.endMs);
        }
        return;
      }
      console.error('Failed to load history:', err);
    } finally {
      if (gen === loadGen.current) setLoading(false);
    }
  }, [loadLimit]);

  const cancelLoad = () => {
    abortRef.current?.abort();
  };

  const queryFiltersForWindow = () => filtersAtLoad ?? effectiveFilters;

  const handleSort = (key: SortKey, opts?: { additive?: boolean }) => {
    setSortConfig(prev => {
      const next = toggleSortLevel(prev, key, !!opts?.additive);
      writeSortConfigPref(next);
      return next;
    });
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

  const handleQuickVisualize = (targetAddress: string) => {
    onVisualizationTargetsChange(prev =>
      prev.includes(targetAddress) ? prev : [...prev, targetAddress]
    );
    setIsVisualizerOpen(true);
    setIsFilterOpen(false);
  };

  const handleDeltaContextEnabledChange = (deltaContextEnabled: boolean) => {
    onFiltersChange({ ...activeFilters, deltaContextEnabled });
  };

  const sortedTelegrams = useMemo(
    () => sortTelegrams(telegrams, sortConfig),
    [telegrams, sortConfig]
  );

  // Quick filter applies at once, capped to the context window from the last load.
  // The side panel, including that window, stays at the last load until refresh.
  const displayFilters = useMemo(
    () => (filtersAtLoad ? historyDisplayFilters(filtersAtLoad) : effectiveFilters),
    [filtersAtLoad, effectiveFilters],
  );
  const visibleFilters = useMemo(
    () => filtersWithQfContext(displayFilters, qfContext),
    [displayFilters, qfContext],
  );
  const visibleOpts = useMemo(() => ({
    filters: visibleFilters,
    filtersEnabled: true,
    quickFilterOpen,
    quickFilterEnabled,
    quickPatterns,
    flaggedBeforeKeys,
    flaggedAfterKeys,
    markedKeys,
    mouseSelectedKeys,
    lastSelectedKey,
    jumpTargetKeys,
  }), [
    visibleFilters, quickFilterOpen, quickFilterEnabled, quickPatterns,
    flaggedBeforeKeys, flaggedAfterKeys, markedKeys, mouseSelectedKeys,
    lastSelectedKey, jumpTargetKeys,
  ]);
  const visible = useMemo(
    () => selectVisibleTelegrams(sortedTelegrams, visibleOpts),
    [sortedTelegrams, visibleOpts],
  );
  const counts = useMemo(
    () => historyCounts(sortedTelegrams, visibleOpts),
    [sortedTelegrams, visibleOpts],
  );
  const loadedSpan = useMemo(() => {
    let oldest: number | null = null;
    let newest: number | null = null;
    for (const t of telegrams) {
      const ms = Date.parse(t.timestamp);
      if (!Number.isFinite(ms)) continue;
      if (oldest == null || ms < oldest) oldest = ms;
      if (newest == null || ms > newest) newest = ms;
    }
    return { oldest, newest };
  }, [telegrams]);

  const filterCounts = useMemo(
    () => (telegrams.length > 0 ? countFilterOptions(telegrams) : undefined),
    [telegrams]
  );

  const activeFilterCount = countSelections(enabledFilters(activeFilters));
  const refreshTitle = loading
    ? 'Cancel loading'
    : spPending
      ? 'Side panel changed — click to reload this range with the current filters'
      : 'Reload this range with the current side panel';

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{
        padding: '0 1.25rem', height: '3.5rem', borderBottom: '1px solid var(--border-color)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, gap: '0.75rem',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0 }}>
          {telegrams.length > 0 && (
            <span style={{
              fontSize: '0.75rem', color: 'var(--text-dim)', background: 'var(--bg-tag)',
              padding: '0.2rem 0.6rem', borderRadius: '999px', border: '1px solid var(--border-color)',
              flexShrink: 0,
            }}>
              {counts.quickActive
                ? <>{counts.x.toLocaleString()}<span style={{ color: 'var(--text-dim)', fontWeight: 400 }}> / {counts.y.toLocaleString()}</span></>
                : counts.y.toLocaleString()
              } telegrams
            </span>
          )}
          <button
            type="button"
            className="icon-button"
            data-sp-pending={spPending ? 'true' : 'false'}
            aria-label={loading ? 'Cancel loading' : 'Reload history'}
            title={refreshTitle}
            onClick={() => {
              if (loading) {
                cancelLoad();
                return;
              }
              void runLoad({ startMs, endMs }, 'replace', effectiveFilters, readDirection);
            }}
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0.35rem',
              border: '1px solid var(--border-color)',
              borderRadius: '7px',
              color: spPending && !loading ? 'var(--warning-text)' : 'var(--text-dim)',
              flexShrink: 0,
            }}
          >
            {loading
              ? <span className="chip-spinner" style={{ width: 16, height: 16, display: 'inline-block' }} />
              : <RefreshCw size={16} />}
            {spPending && !loading && (
              <span
                aria-hidden
                data-sp-pending-dot=""
                style={{
                  position: 'absolute',
                  top: 2,
                  right: 2,
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: 'var(--warning-text)',
                }}
              />
            )}
          </button>
          {metadata?.limit_reached && (
            <span
              style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', color: 'var(--warning-text)' }}
              title={`Limit reached (${loadLimit.toLocaleString()}). Raise it in the range field.`}
            >
              <AlertTriangle size={13} /> Limit reached
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', minWidth: 0 }}>
          <HistoryRangeBar
            startMs={startMs}
            endMs={endMs}
            loadLimit={loadLimit}
            onLoadLimitChange={onLoadLimitChange}
            readDirection={readDirection}
            onReadDirectionChange={dir => {
              const span = Math.max(0, endMs - startMs);
              const anchor = dir === 'forward' ? startMs : endMs;
              void runLoad(
                windowFromRange(dir, anchor, span),
                'replace',
                queryFiltersForWindow(),
                dir,
              );
            }}
            onCommitStart={ms => {
              if (ms >= endMs) return;
              void runLoad({ startMs: ms, endMs }, 'merge', queryFiltersForWindow(), readDirection);
            }}
            onCommitEnd={ms => {
              const span = Math.max(1000, endMs - startMs);
              void runLoad(windowFromRange('backward', ms, span), 'merge', queryFiltersForWindow(), readDirection);
            }}
            onCommitRange={rangeMs => {
              const anchor = readDirection === 'forward' ? startMs : endMs;
              void runLoad(
                windowFromRange(readDirection, anchor, rangeMs),
                'merge',
                queryFiltersForWindow(),
                readDirection,
              );
            }}
          />
          <button
            className="icon-button"
            onClick={() => setIsFilterOpen(o => { const next = !o; if (next) setIsVisualizerOpen(false); return next; })}
            title="Toggle filter panel"
            style={{
              position: 'relative',
              color: isFilterOpen || hasActiveFilters(effectiveFilters) ? 'var(--accent-primary)' : 'var(--text-dim)',
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
              onClick={() => setIsVisualizerOpen(v => { const next = !v; if (next) setIsFilterOpen(false); return next; })}
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
              onClick={() => {
                loadGen.current += 1;
                abortRef.current?.abort();
                setLoading(false);
                setTelegrams([]);
                telegramsRef.current = [];
                setMetadata(null);
                setJumpTargetKeys([]);
                setFiltersAtLoad(null);
              }}
              title="Clear results"
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.85rem', border: '1px solid var(--border-color)', borderRadius: '7px', fontSize: '0.8125rem', color: 'var(--text-dim)' }}
            >
              <Trash2 size={16} /> Clear
            </button>
          )}
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        <ResizablePane open={isFilterOpen} prefKey="filter-pane-width">
            <FilterPanel
              options={filterOptions}
              activeFilters={activeFilters}
              onFiltersChange={onFiltersChange}
              counts={filterCounts}
              filtersEnabled={filtersEnabled}
              onFiltersEnabledChange={onFiltersEnabledChange}
              projectLoaded={projectLoaded}
              onUploadProject={onOpenSettings}
            />
        </ResizablePane>

        <div style={{ flex: 1, overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column' }}>
          {isVisualizerOpen && telegrams.length > 0 ? (
            <Visualizer
              telegrams={sortedTelegrams}
              selectedTargets={selectedVisualizationTargets}
              onTargetsChange={onVisualizationTargetsChange}
              onClose={() => setIsVisualizerOpen(false)}
              getShareLink={loadedRange ? () => buildViewUrl({
                plot: selectedVisualizationTargets,
                filters: filtersAtLoad ?? enabledFilters(activeFilters),
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
                  Choose a time range, then refresh to load it.
                </div>
              </div>
            </div>
          ) : (
            <GotoBufferProvider
              scope="history"
              oldestMs={loadedSpan.oldest}
              newestMs={loadedSpan.newest}
              readDirection={readDirection}
            >
            <TelegramTable
              telegrams={visible.items}
              gotoScope="history"
              bufferOldestMs={loadedSpan.oldest}
              bufferNewestMs={loadedSpan.newest}
              jumpTargetKeys={jumpTargetKeys}
              onJumpTarget={(key, mode) => {
                setJumpTargetKeys(prev => (
                  mode === 'add' ? (prev.includes(key) ? prev : [...prev, key]) : [key]
                ));
              }}
              forceIncludeFrom={sortedTelegrams}
              visibleColumns={visibleColumns}
              sortConfig={sortConfig}
              onSort={handleSort}
              activeFilters={activeFilters}
              projectTargets={filterOptions.targets}
              filtersEnabled={filtersEnabled}
              sidePanelFilters={filtersAtLoad ?? undefined}
              onQuickFilter={handleQuickFilter}
              onQuickVisualize={handleQuickVisualize}
              quickFilterOpen={quickFilterOpen}
              onQuickFilterOpenChange={setQuickFilterOpen}
              quickFilterEnabled={quickFilterEnabled}
              onQuickFilterEnabledChange={setQuickFilterEnabled}
              quickPatterns={quickPatterns}
              onQuickPatternsChange={setQuickPatterns}
              qfContext={qfContext}
              onQfContextChange={setQfContext}
              onDeltaContextEnabledChange={handleDeltaContextEnabledChange}
              flaggedBeforeKeys={flaggedBeforeKeys}
              onFlaggedBeforeKeysChange={setFlaggedBeforeKeys}
              flaggedAfterKeys={flaggedAfterKeys}
              onFlaggedAfterKeysChange={setFlaggedAfterKeys}
              markedKeys={markedKeys}
              onMarkedKeysChange={setMarkedKeys}
              mouseSelectedKeys={mouseSelectedKeys}
              onMouseSelectedKeysChange={setMouseSelectedKeys}
              lastSelectedKey={lastSelectedKey}
              onLastSelectedKeyChange={setLastSelectedKey}
              contextKeys={visible.contextKeys}
              contextParents={visible.contextParents}
              viewChangeToken={viewChangeToken}
            />
            </GotoBufferProvider>
          )}
        </div>
      </div>
    </div>
  );
};
