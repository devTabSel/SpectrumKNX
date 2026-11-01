import React, { useMemo, useRef, useEffect, useLayoutEffect, useState, useCallback } from 'react';
import { format } from 'date-fns';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Telegram } from '../hooks/useWebSocket';
import { ChevronUp, ChevronDown, Filter, LineChart, X, Circle, CircleDot, Download } from 'lucide-react';
import { effectiveDeltaContext, enabledFilters, focusAddressesForList, hasActiveFilters, type ActiveFilters } from '../types/filters';
import { GotoTimeControl } from './GotoTimeControl';
import type { SortKey, SortLevel, SortConfig } from '../utils/sortConfig';
import { activeQuickFilter, compileQuickFilters, DEFAULT_QUICK_FILTER_COLUMN_ENABLED, type QuickCellValue, type QuickFilterColumnEnabled, type QuickPatterns } from '../utils/quickFilter';
import { telegramColor, CONTEXT_MARK_STRIPE, UNCOLORED_MARK_STRIPE, useTargetColors } from '../utils/targetColors';
import { anchorKey } from '../utils/anchorKey';
import { invokeToggle, toggleTitle, type ToggleGesture } from '../utils/toggleClick';
import { downloadTelegramsCsv } from '../utils/telegramCsv';
import { adjacentMark } from '../utils/adjacentMark';
import { peakRate } from '../utils/peakRate';
import { moveColumn, readColumnOrderPref, writeColumnOrderPref } from '../utils/columnOrder';
import { TELEGRAM_COLUMNS as COLUMNS, TelegramColumnHeader, useTelegramColumnWidths, type ColId } from './telegramColumns';
import { CheckMark } from './filterControls';
import { formatDeltaMs, renderAddressActions, renderTelegramCell } from './telegramCell';

const EMPTY_FOCUS_ADDRESSES: readonly string[] = [];

export type { SortKey, SortLevel, SortConfig };

interface TelegramTableProps {
  telegrams: Telegram[];
  visibleColumns: { [key: string]: boolean };
  sortConfig: SortConfig;
  /** `additive` (ctrl/cmd-click) adds/toggles a sort level instead of replacing the whole config (#311). */
  onSort: (key: SortKey, opts?: { additive?: boolean }) => void;
  activeFilters: ActiveFilters;
  /** Master switch of the filter pane. Off, its selections do not narrow the list. */
  filtersEnabled?: boolean;
  onQuickFilter: (key: 'sources' | 'targets' | 'types' | 'dpts', value: string | number) => void;
  /** Toggles these addresses in the Focus list. Does not change the list filters or the Focus-list filter. */
  onFocusFilter?: (address: string | string[], mode: 'ga' | 'pa', gesture?: ToggleGesture, clicked?: string) => void;
  /** Group addresses checked in the Focus list. */
  focusGas?: readonly string[];
  /** Devices checked in the Focus list. */
  focusDevices?: readonly string[];
  /** Group addresses whose Focus-list filter toggle is on. */
  focusFilterGas?: readonly string[];
  /** Devices whose Focus-list filter toggle is on. */
  focusFilterDevices?: readonly string[];
  /** TARGET column: apply `focusFilterGas` to the telegram list. */
  filterFocusedTargets?: boolean;
  onFilterFocusedTargetsChange?: (on: boolean) => void;
  /** SOURCE column: apply `focusFilterDevices` to the telegram list. */
  filterFocusedSources?: boolean;
  onFilterFocusedSourcesChange?: (on: boolean) => void;
  onQuickVisualize: (targetAddress: string | string[], mode?: 'ga' | 'pa', gesture?: ToggleGesture, clicked?: string) => void;
  /** Opens the visualizer for a source device. */
  onQuickVisualizeSource?: (sourceAddress: string | string[], mode?: 'ga' | 'pa', gesture?: ToggleGesture, clicked?: string) => void;
  onQuickLastSeen?: (address: string | string[], mode: 'ga' | 'pa', gesture?: ToggleGesture, clicked?: string) => void;
  /** Group addresses whose Focus-list visualize toggle is on. */
  visualizedGas?: readonly string[];
  /** Devices whose Focus-list visualize toggle is on. */
  visualizedDevices?: readonly string[];
  /** Toggles the Focus-list filter (the funnel), not the panel filter. */
  onFocusAddressFilter?: (address: string | string[], mode: 'ga' | 'pa', gesture?: ToggleGesture, clicked?: string) => void;
  lastSeenGas?: readonly string[];
  lastSeenDevices?: readonly string[];
  /** Enables the per-row "Send to this GA" quick popover; true only when the bus is writable (#214). */
  canSend?: boolean;

  // Lifted Quick-Filter state (#280, #309, #341)
  quickFilterOpen?: boolean;
  onQuickFilterOpenChange?: (open: boolean) => void;
  quickFilterEnabled?: boolean;
  onQuickFilterEnabledChange?: (enabled: boolean) => void;
  quickPatterns?: QuickPatterns;
  onQuickPatternsChange?: (patterns: QuickPatterns) => void;
  /** Per-column quick-filter switches in the lower header row. */
  quickFilterColumnEnabled?: QuickFilterColumnEnabled;
  onQuickFilterColumnEnabledChange?: (columns: QuickFilterColumnEnabled) => void;
  /** Edits the Time-Delta-Context window (#309, #371) — moved here from the
   * filter pane; current values come from `activeFilters.deltaBeforeMs/deltaAfterMs`. */
  onDeltaContextChange?: (deltaBeforeMs: number, deltaAfterMs: number) => void;
  /** Toggles the window on/off without losing the entered values (#318). */
  onDeltaContextEnabledChange?: (enabled: boolean) => void;

  // Lifted Follow / Anchor state (#203, #341)
  listFollow?: boolean;
  onListFollowChange?: (follow: boolean) => void;
  /** Timestamps on screen while scrolled away from the live edge. Null at the edge. */
  onVisibleSpanChange?: (span: { startMs: number; endMs: number } | null) => void;
  listAnchorKey?: string | null;
  onListAnchorKeyChange?: (key: string | null) => void;
  /** Where to place `listAnchorKey` when the list opens. `center` is a one-shot jump. */
  listAnchorAlign?: 'start' | 'center';

  // Lifted row marks (#310): keys of marked telegrams + the most-recently
  // clicked one. Lifted so marks survive main-panel navigation.
  markedKeys?: string[];
  onMarkedKeysChange?: (keys: string[]) => void;
  lastMarkedKey?: string | null;
  onLastMarkedKeyChange?: (key: string | null) => void;
  /** Stripe highlights, separate from the mouse selection. Shared with Last Seen. */
  highlightedKeys?: readonly string[];
  onHighlightedKeysChange?: (keys: string[]) => void;

  // Lifted Quick Info Bar open state (#311, #341)
  infoBarOpen?: boolean;
  onInfoBarOpenChange?: (open: boolean) => void;

  // Lifted per-message Time-Delta-Context flags (#319): keys of telegrams
  // individually flagged to always anchor a context window around themselves.
  flaggedKeys?: string[];
  onFlaggedKeysChange?: (keys: string[]) => void;
  /** Global "all" state of the Time-Delta-Context (#319): every row that is
   * not itself context anchors a window, whether flagged or not. */
  contextForAllMatches?: boolean;
  onContextForAllMatchesChange?: (all: boolean) => void;

  /** Keys (via the same anchor identity) of rows present only as unfiltered
   * Time-Delta-Context around a match/flag, not because they matched the
   * active filters themselves — marked with a distinct background (#343). */
  contextKeys?: ReadonlySet<string>;
}

const EMPTY_CELL: QuickCellValue = { top: '', bottom: '' };

// Keys that scroll a list. Modifiers must not count: ctrl-click on a toolbar
// button is not the user scrolling (#435).
const SCROLL_KEYS = new Set(['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' ']);

type TelegramRow = Telegram & { deltaStr: string | null; deltaNextStr: string | null; deltaMs: number | null };
/** Left-edge icon rail, shared by the info bar, the header, the quick filter and each row. */
const RAIL_WIDTH = '1.75rem';
/** Mark toggle on the left edge of a row. Wider than the old inset bar so it can be clicked. */
const MARK_STRIPE_WIDTH = '10px';

/** The row's own surface. A stripe mark does not recolour a row the focus lists left uncoloured. */
function rowSurface(opts: {
  isContext: boolean;
  targetColor?: string;
  zebraSubtle: boolean;
}): string {
  if (opts.isContext) {
    return 'color-mix(in srgb, var(--warning, #f59e0b) 12%, transparent)';
  }
  if (opts.targetColor) {
    return `color-mix(in srgb, ${opts.targetColor} 9%, transparent)`;
  }
  return opts.zebraSubtle ? 'var(--bg-subtle)' : 'transparent';
}

const ROW_ESTIMATE = 85; // matches the virtualizer's estimateSize

function timeMs(timestamp: string): number {
  return new Date(timestamp).getTime();
}

/**
 * Rows strictly newer than `newestMs` in a list ordered by time.
 * Descending lists (newest first) keep those rows at the start; ascending
 * lists keep them at the end.
 */
function countNewerThan(rows: { timestamp: string }[], newestMs: number, ascending: boolean): number {
  if (!Number.isFinite(newestMs) || rows.length === 0) return 0;
  let lo = 0;
  let hi = rows.length;
  if (ascending) {
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (timeMs(rows[mid].timestamp) <= newestMs) lo = mid + 1;
      else hi = mid;
    }
    return rows.length - lo;
  }
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (timeMs(rows[mid].timestamp) > newestMs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// ── Quick filter bar (#271, #309) ────────────────────────────────────────────
// Two rows per column. Address, DPT, type and name rows take a literal
// substring, a quoted wildcard list (`"a*", "b+"`), or `regex:`. Time and
// value rows are from/to. DELTA edits the Time-Delta-Context window (#371).
// Each column has its own switch in the lower header row.


export const TelegramTable: React.FC<TelegramTableProps> = ({
  telegrams, visibleColumns, sortConfig, onSort, activeFilters, filtersEnabled = true, onFocusFilter, focusGas = EMPTY_FOCUS_ADDRESSES, focusDevices = EMPTY_FOCUS_ADDRESSES, focusFilterGas, focusFilterDevices, filterFocusedTargets: filterFocusedTargetsProp, onFilterFocusedTargetsChange, filterFocusedSources: filterFocusedSourcesProp, onFilterFocusedSourcesChange, onQuickVisualize, onQuickVisualizeSource, onQuickLastSeen, onFocusAddressFilter, lastSeenGas = EMPTY_FOCUS_ADDRESSES, lastSeenDevices = EMPTY_FOCUS_ADDRESSES, visualizedGas = EMPTY_FOCUS_ADDRESSES, visualizedDevices = EMPTY_FOCUS_ADDRESSES, canSend,
  quickFilterOpen, onQuickFilterOpenChange, quickFilterEnabled, onQuickFilterEnabledChange, quickPatterns, onQuickPatternsChange, quickFilterColumnEnabled, onQuickFilterColumnEnabledChange,
  onDeltaContextChange, onDeltaContextEnabledChange,
  listFollow, onListFollowChange, onVisibleSpanChange, listAnchorKey, onListAnchorKeyChange, listAnchorAlign,
  markedKeys, onMarkedKeysChange, lastMarkedKey, onLastMarkedKeyChange,
  highlightedKeys, onHighlightedKeysChange,
  infoBarOpen, onInfoBarOpenChange,
  flaggedKeys, onFlaggedKeysChange,
  contextForAllMatches, onContextForAllMatchesChange,
  contextKeys,
}) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const [ownFilterFocusedSources, setOwnFilterFocusedSources] = useState(false);
  const [ownFilterFocusedTargets, setOwnFilterFocusedTargets] = useState(false);
  const filterFocusedSources = filterFocusedSourcesProp ?? ownFilterFocusedSources;
  const filterFocusedTargets = filterFocusedTargetsProp ?? ownFilterFocusedTargets;
  const setFilterFocusedSources = (on: boolean) => {
    if (filterFocusedSourcesProp === undefined) setOwnFilterFocusedSources(on);
    onFilterFocusedSourcesChange?.(on);
  };
  const setFilterFocusedTargets = (on: boolean) => {
    if (filterFocusedTargetsProp === undefined) setOwnFilterFocusedTargets(on);
    onFilterFocusedTargetsChange?.(on);
  };
  // An inactive checkbox has nothing to filter. Clear it so it does not stay
  // ticked, and does not come back ticked when entries return.
  useEffect(() => {
    if ((focusFilterDevices?.length ?? 0) === 0 && filterFocusedSources) setFilterFocusedSources(false);
  }, [focusFilterDevices, filterFocusedSources]);
  useEffect(() => {
    if ((focusFilterGas?.length ?? 0) === 0 && filterFocusedTargets) setFilterFocusedTargets(false);
  }, [focusFilterGas, filterFocusedTargets]);
  const { gas: focusGasForList, devices: focusDevicesForList } = focusAddressesForList(
    focusFilterGas ?? EMPTY_FOCUS_ADDRESSES,
    focusFilterDevices ?? EMPTY_FOCUS_ADDRESSES,
    filterFocusedSources,
    filterFocusedTargets,
  );

  // Column widths are shared with Last Seen, which reuses this header.
  const { widthFor, gridFor, resizeStart: handleResizeStart, resetWidth: handleResetWidth } = useTelegramColumnWidths();

  // ── Column order (persisted, shared across live & history views) ──
  // Drag a column header onto another to move it before or after that column.
  const [columnOrder, setColumnOrder] = useState<string[]>(() => readColumnOrderPref(COLUMNS.map(c => c.id)));
  const [draggingColumn, setDraggingColumn] = useState<ColId | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: ColId; side: 'before' | 'after' } | null>(null);
  // Where the press that may become a drag started: a drag must not begin from
  // a text field or the resize handle inside a header cell.
  const dragOriginRef = useRef<EventTarget | null>(null);

  const endColumnDrag = useCallback(() => {
    setDraggingColumn(null);
    setDropTarget(null);
  }, []);

  const dropColumn = useCallback((target: ColId, side: 'before' | 'after') => {
    if (draggingColumn && draggingColumn !== target) {
      setColumnOrder(prev => {
        const next = moveColumn(prev, draggingColumn, target, side);
        writeColumnOrderPref(next);
        return next;
      });
    }
    endColumnDrag();
  }, [draggingColumn, endColumnDrag]);

  // ── Quick filter bar (#271): per-column regex/literal filter on top of the
  // complex filter. Expanding enables it, collapsing disables it; the toggle
  // in the bar switches it without losing the patterns.
  const [internalQuickOpen, setInternalQuickOpen] = useState(false);
  const [internalQuickEnabled, setInternalQuickEnabled] = useState(false);
  const [internalQuickPatterns, setInternalQuickPatterns] = useState<QuickPatterns>({});

  const quickOpen = quickFilterOpen ?? internalQuickOpen;
  const setQuickOpen = useCallback((val: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof val === 'function' ? val(quickOpen) : val;
    setInternalQuickOpen(next);
    onQuickFilterOpenChange?.(next);
  }, [quickOpen, onQuickFilterOpenChange]);

  const quickEnabled = quickFilterEnabled ?? internalQuickEnabled;
  const setQuickEnabled = useCallback((val: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof val === 'function' ? val(quickEnabled) : val;
    setInternalQuickEnabled(next);
    onQuickFilterEnabledChange?.(next);
  }, [quickEnabled, onQuickFilterEnabledChange]);

  const currentPatterns = quickPatterns ?? internalQuickPatterns;
  const setQuickPatterns = useCallback((val: QuickPatterns | ((prev: QuickPatterns) => QuickPatterns)) => {
    const next = typeof val === 'function' ? val(currentPatterns) : val;
    setInternalQuickPatterns(next);
    onQuickPatternsChange?.(next);
  }, [currentPatterns, onQuickPatternsChange]);

  /** Updates one row (top/bottom) of a quick-filter cell, preserving the other row. */
  const setQuickCell = useCallback((id: ColId, row: 'top' | 'bottom', text: string) => {
    setQuickPatterns(prev => ({ ...prev, [id]: { ...(prev[id] ?? EMPTY_CELL), [row]: text } }));
  }, [setQuickPatterns]);

  const [internalQuickColumnEnabled, setInternalQuickColumnEnabled] = useState<QuickFilterColumnEnabled>(DEFAULT_QUICK_FILTER_COLUMN_ENABLED);
  const currentQuickColumnEnabled = quickFilterColumnEnabled ?? internalQuickColumnEnabled;
  const setQuickColumnEnabled = useCallback((val: QuickFilterColumnEnabled | ((prev: QuickFilterColumnEnabled) => QuickFilterColumnEnabled)) => {
    const next = typeof val === 'function' ? val(currentQuickColumnEnabled) : val;
    setInternalQuickColumnEnabled(next);
    onQuickFilterColumnEnabledChange?.(next);
  }, [currentQuickColumnEnabled, onQuickFilterColumnEnabledChange]);

  const quickInputClassName = useCallback((value: string | number | null | undefined, kind?: 'datetime') => {
    const empty = value === '' || value == null;
    return `quick-filter-bar-input${empty ? ' quick-filter-bar-input-empty' : ''}${kind === 'datetime' ? ' quick-filter-bar-input-datetime' : ''}`;
  }, []);

  const clearQuickColumnInputs = useCallback((id: ColId) => {
    if (id === 'delta') {
      onDeltaContextChange?.(0, 0);
      return;
    }
    setQuickPatterns(prev => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, [onDeltaContextChange, setQuickPatterns]);

  const clearAllQuickInputs = useCallback(() => {
    setQuickPatterns({});
    onDeltaContextChange?.(0, 0);
  }, [onDeltaContextChange, setQuickPatterns]);

  const isQuickColumnEnabled = useCallback((id: ColId) => currentQuickColumnEnabled[id] !== false, [currentQuickColumnEnabled]);
  const toggleQuickColumnEnabled = useCallback((id: ColId) => {
    setQuickColumnEnabled(prev => ({ ...prev, [id]: prev[id] === false }));
  }, [setQuickColumnEnabled]);

  const handleQuickColumnToggleClick = useCallback((e: React.MouseEvent, id: ColId) => {
    if (e.ctrlKey || e.metaKey) {
      clearQuickColumnInputs(id);
      return;
    }
    toggleQuickColumnEnabled(id);
  }, [clearQuickColumnInputs, toggleQuickColumnEnabled]);

  const handleQuickEnabledToggleClick = useCallback((e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      clearAllQuickInputs();
      setQuickEnabled(true);
      setQuickColumnEnabled({ ...DEFAULT_QUICK_FILTER_COLUMN_ENABLED });
      return;
    }
    setQuickEnabled(prev => !prev);
  }, [clearAllQuickInputs, setQuickColumnEnabled, setQuickEnabled]);

  const toggleQuickOpen = () => {
    const nextOpen = !quickOpen;
    setQuickOpen(nextOpen);
    setQuickEnabled(nextOpen);
  };

  // ── Quick info bar (#311): collapsible summary row above the header. ──────
  const [internalInfoBarOpen, setInternalInfoBarOpen] = useState(false);
  const infoOpen = infoBarOpen ?? internalInfoBarOpen;
  const toggleInfoOpen = useCallback(() => {
    const next = !infoOpen;
    setInternalInfoBarOpen(next);
    onInfoBarOpenChange?.(next);
  }, [infoOpen, onInfoBarOpenChange]);

  // ── Row marks (#310) ─────────────────────────────────────────────────────
  // Controlled when App lifts them (so marks survive navigation), otherwise a
  // local fallback. `lastMarkedKey` may legitimately be null, so distinguish
  // "not lifted" (undefined) from "lifted, nothing last" (null).
  const [internalMarkedKeys, setInternalMarkedKeys] = useState<string[]>([]);
  const [internalLastMarkedKey, setInternalLastMarkedKey] = useState<string | null>(null);

  const markedKeysList = markedKeys ?? internalMarkedKeys;
  const setMarkedKeysList = useCallback((val: string[]) => {
    setInternalMarkedKeys(val);
    onMarkedKeysChange?.(val);
  }, [onMarkedKeysChange]);

  const lastMarked = lastMarkedKey !== undefined ? lastMarkedKey : internalLastMarkedKey;
  const setLastMarked = useCallback((val: string | null) => {
    setInternalLastMarkedKey(val);
    onLastMarkedKeyChange?.(val);
  }, [onLastMarkedKeyChange]);

  const markedSet = useMemo(() => new Set(markedKeysList), [markedKeysList]);
  // Stripe toggle, separate from the mouse selection: it emphasises only the
  // stripe and does not change the selection. The clicked row's new highlight
  // also applies to every mouse-selected row, but only when the clicked row is
  // itself selected.
  // Lifted when Last Seen shares the stripes.
  const [internalHighlightedKeys, setInternalHighlightedKeys] = useState<string[]>([]);
  const highlightedList = highlightedKeys ?? internalHighlightedKeys;
  const setHighlightedList = useCallback((keys: string[]) => {
    setInternalHighlightedKeys(keys);
    onHighlightedKeysChange?.(keys);
  }, [onHighlightedKeysChange]);
  const highlightedSet = useMemo(() => new Set(highlightedList), [highlightedList]);
  // A stripe-marked context row keeps the context colour after the context
  // window no longer covers it, until that stripe mark is removed.
  const retainedContextMarks = useRef(new Set<string>());
  const contextColoredKeys = useMemo(() => {
    const retained = retainedContextMarks.current;
    for (const key of retained) {
      if (!highlightedSet.has(key)) retained.delete(key);
    }
    if (contextKeys) {
      for (const key of highlightedSet) {
        if (contextKeys.has(key)) retained.add(key);
      }
    }
    if (retained.size === 0) return contextKeys;
    const merged = new Set(contextKeys ?? []);
    for (const key of retained) merged.add(key);
    return merged;
  }, [contextKeys, highlightedSet]);
  // The telegram a centered jump landed on — from outside the list, or from the
  // marks pill. The ring fades on its own. A new tick remounts it so the frame
  // restarts when the next mark is the same row.
  const [jumpFlashKey, setJumpFlashKey] = useState<string | null>(null);
  const [jumpFlashTick, setJumpFlashTick] = useState(0);
  const showJumpFrame = (key: string) => {
    setJumpFlashKey(key);
    setJumpFlashTick(tick => tick + 1);
  };
  const toggleHighlight = useCallback((key: string) => {
    const nextOn = !highlightedSet.has(key);
    const targets = markedSet.has(key) ? markedKeysList : [key];
    const next = new Set(highlightedList);
    for (const target of targets) {
      if (nextOn) next.add(target);
      else next.delete(target);
    }
    setHighlightedList([...next]);
    if (nextOn) {
      markCursorRef.current = key;
      setMarkCursorKey(key);
    }
  }, [highlightedSet, highlightedList, markedSet, markedKeysList, setHighlightedList]);
  // Row the prev/next-mark jumps continue from (#442); null after a user scroll.
  const markCursorRef = useRef<string | null>(null);
  const [markCursorKey, setMarkCursorKey] = useState<string | null>(null);
  // Bumped when a scroll with no cursor crosses a mark, so the arrows follow it.
  const [markScrollGen, setMarkScrollGen] = useState(0);
  const canMarkUpRef = useRef(false);
  const canMarkDownRef = useRef(false);
  const refreshMarkNavOnScrollRef = useRef<() => void>(() => {});
  // The selected row for scroll anchoring (#435): the last-clicked one, as long
  // as it is still marked. A ref, because scroll handlers read it outside render.
  const selectedKeyRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    selectedKeyRef.current = lastMarked && markedSet.has(lastMarked) ? lastMarked : null;
  }, [lastMarked, markedSet]);

  // Clears stripe marks and the mouse selection together.
  const clearMarks = useCallback(() => {
    setMarkedKeysList([]);
    setLastMarked(null);
    setHighlightedList([]);
  }, [setMarkedKeysList, setLastMarked, setHighlightedList]);

  // ── Per-message Time-Delta-Context flags (#319) ─────────────────────────
  const [internalFlaggedKeys, setInternalFlaggedKeys] = useState<string[]>([]);
  const flaggedKeysList = flaggedKeys ?? internalFlaggedKeys;
  const setFlaggedKeysList = useCallback((val: string[]) => {
    setInternalFlaggedKeys(val);
    onFlaggedKeysChange?.(val);
  }, [onFlaggedKeysChange]);
  const flaggedSet = useMemo(() => new Set(flaggedKeysList), [flaggedKeysList]);

  // A colour chosen for a group address in the focus list marks its telegrams
  // whether or not that address is also a target filter (#509).
  const activeTargetColors = useTargetColors();
  const [internalContextForAll, setInternalContextForAll] = useState(true);
  const contextForAll = contextForAllMatches ?? internalContextForAll;
  const setContextForAll = useCallback((val: boolean) => {
    setInternalContextForAll(val);
    onContextForAllMatchesChange?.(val);
  }, [onContextForAllMatchesChange]);

  // Whether a row anchors a context window: flagged, or — in the global "all"
  // state — any row that is not itself only there as context.
  const anchorsContext = useCallback(
    (key: string) => flaggedSet.has(key) || (contextForAll && !contextColoredKeys?.has(key)),
    [flaggedSet, contextForAll, contextColoredKeys]
  );

  // Toggles the clicked row's flag and applies that new state to every
  // currently marked row (#310's marks, reused as a multi-select basis).
  // Switching a row off while "all" is on leaves that state: the other rows
  // keep their window as explicit flags.
  const handleFlagClick = useCallback((e: React.MouseEvent, key: string) => {
    e.stopPropagation();
    const nextOn = !anchorsContext(key);
    const targets = new Set<string>(markedKeysList);
    targets.add(key);
    if (nextOn) {
      setFlaggedKeysList([...new Set([...flaggedKeysList, ...targets])]);
      return;
    }
    const current = contextForAll
      ? [...new Set([...flaggedKeysList, ...telegrams.map(anchorKey).filter(k => !contextColoredKeys?.has(k))])]
      : flaggedKeysList;
    if (contextForAll) setContextForAll(false);
    setFlaggedKeysList(current.filter(k => !targets.has(k)));
  }, [anchorsContext, flaggedKeysList, markedKeysList, setFlaggedKeysList, contextForAll, setContextForAll, telegrams, contextColoredKeys]);

  // Context only exists around telegrams a filter left out, inside a time window.
  // The Δt column filter in the lower header closes that window: without it no
  // temporal context can be determined, so the stored before/after do not apply.
  const { before: contextBeforeMs, after: contextAfterMs } = effectiveDeltaContext(activeFilters, currentQuickColumnEnabled.delta !== false);
  const contextWindowSet = contextBeforeMs > 0 || contextAfterMs > 0;
  const listNarrowed = (filtersEnabled && hasActiveFilters(enabledFilters(activeFilters)))
    || activeQuickFilter(quickOpen, quickEnabled, currentPatterns, currentQuickColumnEnabled) != null
    || focusGasForList.length > 0
    || focusDevicesForList.length > 0;
  const showContextButtons = listNarrowed && contextWindowSet;

  // Context rows and flagged anchors are already the result of the
  // Time-Delta-Context expansion, which the parent runs on quick-filter
  // matches too. Filtering them here again would drop the context (#520).
  const quickFiltered = useMemo(() => {
    if (!quickOpen || !quickEnabled) return telegrams;
    const matches = compileQuickFilters(currentPatterns, currentQuickColumnEnabled);
    const quick = activeQuickFilter(quickOpen, quickEnabled, currentPatterns, currentQuickColumnEnabled);
    const focusOrQuick = focusGasForList.length > 0 || focusDevicesForList.length > 0 || quick != null;
    const flagsActive = activeFilters.deltaContextEnabled && contextWindowSet && focusOrQuick;
    return telegrams.filter(t => {
      if (matches(t)) return true;
      const key = anchorKey(t);
      // A stripe mark stays when the pattern misses. A mouse selection does not.
      // A context-button flag does too, but only while a window and a focus or
      // quick filter make that context possible.
      if (highlightedSet.has(key)) return true;
      // The Δt column filter closes the window, so a parent context key no longer
      // keeps the row. A stripe mark above still keeps its row.
      return currentQuickColumnEnabled.delta !== false && (!!contextKeys?.has(key) || (flagsActive && flaggedSet.has(key)));
    });
  }, [telegrams, quickOpen, quickEnabled, currentPatterns, currentQuickColumnEnabled, contextKeys, flaggedSet, highlightedSet, activeFilters.deltaContextEnabled, contextWindowSet, focusGasForList, focusDevicesForList]);

  // A row that leaves the list leaves the mouse selection. Stripe marks, context
  // and flagged rows stay listed, so a selection on them stays.
  useEffect(() => {
    const visible = new Set(quickFiltered.map(anchorKey));
    const next = markedKeysList.filter(key => visible.has(key));
    if (next.length === markedKeysList.length && next.every((key, i) => key === markedKeysList[i])) return;
    setMarkedKeysList(next);
    if (lastMarked && !next.includes(lastMarked)) setLastMarked(next.length ? next[next.length - 1] : null);
  }, [quickFiltered, markedKeysList, lastMarked, setMarkedKeysList, setLastMarked]);

  // Time deltas between consecutive rows, by visual (sorted) order — always
  // computed regardless of sort column, respecting whatever hierarchy is
  // active (#311). Each cell has two lines: the gap to the previous row and
  // the gap to the next. While the list is time-sorted, "-" points at the
  // newer neighbour and "+" at the older one.
  const naturalTelegramRows = useMemo<TelegramRow[]>(() => {
    if (quickFiltered.length === 0) return [];
    const timeSortDirection: 'asc' | 'desc' | null =
      sortConfig[0]?.key === 'timestamp' ? sortConfig[0].direction : null;
    const timestamps = quickFiltered.map(t => new Date(t.timestamp).getTime());
    let minTs = Infinity;
    let maxTs = -Infinity;
    for (const ts of timestamps) {
      if (ts < minTs) minTs = ts;
      if (ts > maxTs) maxTs = ts;
    }
    return quickFiltered.map((t, idx) => {
      let deltaStr: string | null = null;
      let deltaNextStr: string | null = null;
      let deltaMs: number | null = null;
      const currTs = timestamps[idx];
      const hasOlderInList = currTs > minTs;
      const hasYoungerInList = currTs < maxTs;
      if (idx > 0) {
        const prev = timestamps[idx - 1];
        const rawDiff = currTs - prev;
        deltaMs = Math.abs(rawDiff);
        const sign: '+' | '-' = timeSortDirection
          ? (timeSortDirection === 'asc' ? '+' : '-')
          : (rawDiff >= 0 ? '+' : '-');
        const hasRequiredNeighbor = sign === '+' ? hasOlderInList : hasYoungerInList;
        deltaStr = hasRequiredNeighbor ? formatDeltaMs(deltaMs, sign) : null;
      }
      if (idx < quickFiltered.length - 1) {
        const next = timestamps[idx + 1];
        const rawDiffToNext = next - currTs;
        const nextSign: '+' | '-' = timeSortDirection
          ? (timeSortDirection === 'asc' ? '-' : '+')
          : (rawDiffToNext >= 0 ? '-' : '+');
        const hasRequiredNeighbor = nextSign === '+' ? hasOlderInList : hasYoungerInList;
        deltaNextStr = hasRequiredNeighbor ? formatDeltaMs(Math.abs(rawDiffToNext), nextSign) : null;
      }
      return { ...t, deltaStr, deltaNextStr, deltaMs };
    });
  }, [quickFiltered, sortConfig]);

  // ── Delta-sort exclusive mode (#311) ────────────────────────────────────────
  // Sorting by the Δt column is a self-referential operation (deltas are
  // derived from row order), so it freezes a snapshot instead of participating
  // in the normal sortConfig: buffer/live-follow pause, deltas stop
  // recalculating, and only the frozen set's order changes on repeat clicks.
  // Any other column header exits the mode and restores the prior live state.
  const [deltaSortActive, setDeltaSortActive] = useState(false);
  const [deltaSortDirection, setDeltaSortDirection] = useState<'asc' | 'desc'>('desc');
  const [deltaFrozenRows, setDeltaFrozenRows] = useState<TelegramRow[] | null>(null);
  const preDeltaSortFollowRef = useRef<boolean | null>(null);

  const sortByDelta = useCallback((rows: TelegramRow[], direction: 'asc' | 'desc') =>
    [...rows].sort((a, b) => {
      if (a.deltaMs == null && b.deltaMs == null) return 0;
      if (a.deltaMs == null) return 1;
      if (b.deltaMs == null) return -1;
      return direction === 'desc' ? b.deltaMs - a.deltaMs : a.deltaMs - b.deltaMs;
    }), []);

  const handleDeltaHeaderClick = useCallback(() => {
    if (!deltaSortActive) {
      setDeltaFrozenRows(sortByDelta(naturalTelegramRows, 'desc'));
      setDeltaSortDirection('desc');
      setDeltaSortActive(true);
      if (onListFollowChange) {
        preDeltaSortFollowRef.current = listFollow ?? true;
        onListFollowChange(false);
      }
    } else {
      const nextDir = deltaSortDirection === 'desc' ? 'asc' : 'desc';
      setDeltaSortDirection(nextDir);
      setDeltaFrozenRows(prev => (prev ? sortByDelta(prev, nextDir) : prev));
    }
  }, [deltaSortActive, deltaSortDirection, naturalTelegramRows, sortByDelta, listFollow, onListFollowChange]);

  const exitDeltaSort = useCallback(() => {
    if (!deltaSortActive) return;
    setDeltaSortActive(false);
    setDeltaFrozenRows(null);
    if (onListFollowChange && preDeltaSortFollowRef.current !== null) {
      onListFollowChange(preDeltaSortFollowRef.current);
    }
    preDeltaSortFollowRef.current = null;
  }, [deltaSortActive, onListFollowChange]);

  // A real column header click always exits delta-sort before applying its own sort.
  const handleColumnSort = useCallback((key: SortKey, opts?: { additive?: boolean }) => {
    exitDeltaSort();
    onSort(key, opts);
  }, [exitDeltaSort, onSort]);

  const telegramRows = deltaSortActive && deltaFrozenRows ? deltaFrozenRows : naturalTelegramRows;

  // ── Global Time-Delta-Context tristate (#318, #319) ─────────────────────────
  // "all": every filter match anchors a window, including telegrams still to
  // arrive. Otherwise it reflects the per-message flags among the visible
  // rows: "some" or "none". Plain click switches none -> all and some/all ->
  // none, overriding the per-message flags; ctrl/cmd-click instead toggles the
  // window fully on/off (#318), preserving flags and values.
  const deltaFlagState: 'none' | 'some' | 'all' = useMemo(() => {
    if (contextForAll) return 'all';
    if (flaggedSet.size === 0) return 'none';
    return telegramRows.some(t => flaggedSet.has(anchorKey(t))) ? 'some' : 'none';
  }, [telegramRows, flaggedSet, contextForAll]);

  const handleDeltaToggleClick = useCallback((e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      onDeltaContextEnabledChange?.(!activeFilters.deltaContextEnabled);
      return;
    }
    setContextForAll(deltaFlagState === 'none');
    setFlaggedKeysList([]);
  }, [deltaFlagState, activeFilters.deltaContextEnabled, onDeltaContextEnabledChange, setFlaggedKeysList, setContextForAll]);

  // ── Quick info bar metrics (#311) ───────────────────────────────────────────
  // Summarizes the currently visible (sorted + filtered) rows; oldest/newest
  // and min/max Δt jump to their row via gotoIndex regardless of sort order.
  const infoMetrics = useMemo(() => {
    if (telegramRows.length === 0) return null;
    let oldestIdx = 0, newestIdx = 0;
    let minDeltaIdx = -1, maxDeltaIdx = -1;
    const sources = new Set<string>();
    const targets = new Set<string>();
    const dpts = new Set<string>();
    const typeCounts = new Map<string, number>();
    let contextCount = 0;
    const times = telegramRows.map(t => new Date(t.timestamp).getTime());
    telegramRows.forEach((t, i) => {
      if (times[i] < times[oldestIdx]) oldestIdx = i;
      if (times[i] > times[newestIdx]) newestIdx = i;
      if (t.deltaMs != null) {
        if (minDeltaIdx === -1 || t.deltaMs < telegramRows[minDeltaIdx].deltaMs!) minDeltaIdx = i;
        if (maxDeltaIdx === -1 || t.deltaMs > telegramRows[maxDeltaIdx].deltaMs!) maxDeltaIdx = i;
      }
      sources.add(t.source_address);
      targets.add(t.target_address);
      dpts.add(t.dpt_name ?? (t.dpt_main != null ? `DPT ${t.dpt_main}` : 'unknown'));
      const type = t.simplified_type || t.telegram_type;
      typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
      if (contextColoredKeys?.has(anchorKey(t))) contextCount++;
    });
    return {
      count: telegramRows.length,
      oldestIdx, newestIdx,
      minDeltaIdx, maxDeltaIdx,
      // Busiest second of the view (#441); pointless for a single row.
      peak: telegramRows.length > 1 ? peakRate(times) : null,
      sourceCount: sources.size,
      targetCount: targets.size,
      dptCount: dpts.size,
      typeCounts: [...typeCounts.entries()].sort((a, b) => b[1] - a[1]),
      contextCount,
    };
  }, [telegramRows, contextColoredKeys]);

  const virtualizer = useVirtualizer({
    count: telegramRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_ESTIMATE, // Better estimate for multi-line rows
    overscan: 10,
    getItemKey: (index) => {
      const t = telegramRows[index];
      return `${t.timestamp}-${t.source_address}-${t.target_address}-${t.raw_hex || index}`;
    },
  });

  // ── ETS-style scroll anchoring (#202) ───────────────────────────────────────
  // Auto-scroll only while the scrollbar sits at the live edge (top for
  // newest-first, bottom for oldest-first). Scrolled away, the viewed rows are
  // anchored. The jump-to-live pill counts telegrams newer than the newest one
  // on screen, so a filter refill that replaces the list cannot drift the
  // count. It stays hidden while that newest telegram is visible — which is
  // always the case in live mode. Only meaningful for the timestamp sort,
  // where the live edge exists.
  //
  // Rows are dynamically measured (ResizeObserver), so a new row enters the
  // layout at the 85px estimate and later shrinks to its real height. Estimate-
  // based math therefore can't keep an anchored row still. Instead we track a
  // concrete anchor row by key and, after each update, correct scrollTop by the
  // real pixel delta of that row's position — re-run on the next frame so the
  // async re-measure of prepended rows is absorbed too.
  // Only the *primary* level's key matters for the live edge — a secondary
  // TIME tiebreaker doesn't make the list time-ordered top-to-bottom (#311).
  const primarySort = sortConfig[0];
  const isTimeSort = primarySort?.key === 'timestamp' && !deltaSortActive;
  const liveEdge = primarySort?.direction === 'asc' ? 'bottom' : 'top';
  const atEdgeRef = useRef(listFollow ?? true);
  // Mirrors atEdgeRef for render. Live mode never shows the jump pill.
  const [followingLive, setFollowingLive] = useState(listFollow ?? true);
  // The row held still while anchored, and its offset from the scroll-container
  // top: the selected (last-marked) row while it is on screen (#435), otherwise
  // the top-most visible one. Captured from user scrolls and row clicks only.
  // A jump that must land in the middle owns the first placement. Until it
  // has measured the centered offset, pinning would pull the row to the top.
  const centerOnRestoreRef = useRef(listAnchorAlign === 'center' && !!listAnchorKey);
  const anchorRef = useRef<{ key: string; offset: number } | null>(
    listAnchorKey && !centerOnRestoreRef.current ? { key: listAnchorKey, offset: 0 } : null
  );
  const programmaticScrollRef = useRef(false);
  // Whether the user is scrolling right now — wheel, touch, keys, or a held
  // scrollbar. Lets pinAnchor tell "the anchor left the rendered window
  // because the user jumped away" from "because rows were inserted" (#435).
  const scrollbarHeldRef = useRef(false);
  const userScrollUntilRef = useRef(0);
  const noteUserScroll = () => { userScrollUntilRef.current = performance.now() + 300; };
  const userScrolling = () => scrollbarHeldRef.current || performance.now() < userScrollUntilRef.current;
  useEffect(() => {
    const release = () => {
      if (!scrollbarHeldRef.current) return;
      scrollbarHeldRef.current = false;
      noteUserScroll();
    };
    // Keys scroll the list without it holding focus, so listen globally.
    const onKey = (e: KeyboardEvent) => {
      if (SCROLL_KEYS.has(e.key)) userScrollUntilRef.current = performance.now() + 300;
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
      window.removeEventListener('keydown', onKey);
    };
  }, []);
  // The row list the anchor was last seen in. Unchanged list + missing anchor
  // can only mean the viewport moved, never that rows were inserted.
  const anchorRowsRef = useRef<typeof telegramRows | null>(null);
  // Latest rows for callbacks that outlive a render (scroll handlers, frames).
  const telegramRowsRef = useRef(telegramRows);
  useLayoutEffect(() => { telegramRowsRef.current = telegramRows; });
  // Bounds captureAnchor's wait for the virtualizer to draw rows on screen.
  const captureRetriesRef = useRef(0);
  // Set while pinAnchor is bringing back an anchor that left the virtualized
  // window; the scrolls that causes are ours, not the user's.
  const refindingAnchorRef = useRef(false);
  // Zebra stripes must stay with a telegram, not with a row index (#266):
  // prepends at the live edge shift every index by the number of new rows, so
  // this offset accumulates those shifts and is added back to the index parity.
  const [stripeOffset, setStripeOffset] = useState(0);

  // Sync props to refs
  useEffect(() => {
    if (listFollow !== undefined) {
      atEdgeRef.current = listFollow;
      setFollowingLive(listFollow);
    }
  }, [listFollow]);

  useEffect(() => {
    if (listAnchorKey !== undefined) {
      if (listAnchorKey === null) {
        anchorRef.current = null;
      } else if (centerOnRestoreRef.current) {
        // The restore effect scrolls this row to the middle, then records its offset.
      } else if (!anchorRef.current || anchorRef.current.key !== listAnchorKey) {
        anchorRef.current = { key: listAnchorKey, offset: 0 };
      }
    }
  }, [listAnchorKey]);

  // Suppress edge/anchor tracking for scrolls we cause ourselves. Auto-clears on
  // the next frame so a no-op programmatic scroll can't swallow a later real one.
  const markProgrammatic = () => {
    programmaticScrollRef.current = true;
    requestAnimationFrame(() => { programmaticScrollRef.current = false; });
  };

  const rowOffset = (key: string): number | null => {
    const el = parentRef.current;
    if (!el) return null;
    const row = el.querySelector<HTMLElement>(`[data-akey="${CSS.escape(key)}"]`);
    if (!row) return null;
    return row.getBoundingClientRect().top - el.getBoundingClientRect().top;
  };

  const checkAtEdge = () => {
    const el = parentRef.current;
    if (!el) return true;
    // Small threshold to handle precision issues
    return liveEdge === 'top'
      ? el.scrollTop < 20
      : el.scrollTop + el.clientHeight >= el.scrollHeight - 20;
  };

  // Record the row to pin across list updates. `selectedKey` is the row the
  // user is working on; it wins while any part of it is inside the viewport, so
  // rows arriving above it (a reload, Time-Delta-Context) can't push it away
  // (#435). Without one on screen, the top-most visible row is pinned (#202).
  const captureAnchor = (selectedKey: string | null = selectedKeyRef.current) => {
    const el = parentRef.current;
    if (!el) return;
    const cRect = el.getBoundingClientRect();
    const cTop = cRect.top;
    if (selectedKey) {
      const row = el.querySelector<HTMLElement>(`[data-akey="${CSS.escape(selectedKey)}"]`);
      const rr = row?.getBoundingClientRect();
      if (rr && rr.bottom > cTop && rr.top < cRect.bottom) {
        anchorRef.current = { key: selectedKey, offset: rr.top - cTop };
        anchorRowsRef.current = telegramRowsRef.current;
        onListAnchorKeyChange?.(selectedKey);
        return;
      }
    }
    for (const row of el.querySelectorAll<HTMLElement>('.log-row')) {
      const rr = row.getBoundingClientRect();
      if (rr.bottom - cTop > 0 && rr.top < cRect.bottom) {
        const key = row.getAttribute('data-akey');
        if (key) {
          anchorRef.current = { key, offset: rr.top - cTop };
          anchorRowsRef.current = telegramRowsRef.current;
          onListAnchorKeyChange?.(key);
          captureRetriesRef.current = 0;
        }
        return;
      }
    }
    // Nothing rendered is on screen: after a long jump (scrollbar drag) the
    // virtualizer has not drawn the new rows yet. A row from the old position
    // must not become the anchor — pinAnchor would scroll back to it — so
    // wait for the next frames instead.
    anchorRef.current = null;
    if (captureRetriesRef.current < 5) {
      captureRetriesRef.current++;
      requestAnimationFrame(() => {
        if (!atEdgeRef.current && !anchorRef.current) captureAnchor();
      });
    } else {
      captureRetriesRef.current = 0;
    }
  };

  // A context-button click inserts or removes rows around the message under
  // the pointer. Pin that row and leave the live edge, so the change cannot
  // push it out from under the cursor. The mouse mark is left untouched.
  const holdClickedRow = (key: string) => {
    if (isTimeSort && atEdgeRef.current) {
      atEdgeRef.current = false;
      setFollowingLive(false);
      onListFollowChange?.(false);
    }
    if (!atEdgeRef.current) captureAnchor(key);
  };

  const handleScroll = () => {
    // Ignore the scrolls our own compensation triggers.
    if (programmaticScrollRef.current || refindingAnchorRef.current) return;
    refreshMarkNavOnScrollRef.current();
    const atEdge = checkAtEdge();
    if (atEdge !== atEdgeRef.current) {
      atEdgeRef.current = atEdge;
      setFollowingLive(atEdge);
      onListFollowChange?.(atEdge);
    }
    if (atEdge) {
      anchorRef.current = null;
      onListAnchorKeyChange?.(null);
    } else {
      captureAnchor();
    }
  };

  // Clicking a row (a) marks it (#310) and (b) pauses live-following just like
  // scrolling away (#266) — the row being read must not move. The jump-to-live
  // pill is the way back.
  const handleRowClick = (e: React.MouseEvent, key: string, index: number) => {
    // ── Marks (#310) ──
    const additive = e.ctrlKey || e.metaKey;
    const range = e.shiftKey;
    if (additive || range) {
      // A modified click must not also start a native text selection.
      e.preventDefault();
      window.getSelection()?.removeAllRanges();
    }

    let nextKeys: string[];
    if (range) {
      const rangeAnchor = lastMarked && markedSet.has(lastMarked) ? lastMarked : null;
      const anchorIdx = rangeAnchor ? telegramRows.findIndex(r => anchorKey(r) === rangeAnchor) : -1;
      let rangeKeys: string[];
      if (anchorIdx === -1) {
        rangeKeys = [key];
      } else {
        const lo = Math.min(anchorIdx, index);
        const hi = Math.max(anchorIdx, index);
        rangeKeys = telegramRows.slice(lo, hi + 1).map(r => anchorKey(r));
      }
      nextKeys = additive ? [...new Set([...markedKeysList, ...rangeKeys])] : rangeKeys;
    } else if (additive) {
      nextKeys = markedSet.has(key) ? markedKeysList.filter(k => k !== key) : [...markedKeysList, key];
    } else {
      nextKeys = [key];
    }
    setMarkedKeysList(nextKeys);
    setLastMarked(key);
    markCursorRef.current = key;
    setMarkCursorKey(key);
    const selectedKey: string | null = nextKeys.includes(key) ? key : null;

    // ── Pause live-following on an edge click (#266), unchanged ──
    if (isTimeSort && atEdgeRef.current) {
      atEdgeRef.current = false;
      setFollowingLive(false);
      onListFollowChange?.(false);
    }
    // Hold the clicked row still from here on (#435).
    if (!atEdgeRef.current) captureAnchor(selectedKey);
  };

  const scrollToEdge = () => {
    markProgrammatic();
    virtualizer.scrollToOffset(liveEdge === 'top' ? 0 : virtualizer.getTotalSize());
  };

  const jumpToLive = () => {
    atEdgeRef.current = true;
    setFollowingLive(true);
    onListFollowChange?.(true);
    anchorRef.current = null;
    onListAnchorKeyChange?.(null);
    scrollToEdge();
  };

  // Scrolls to a specific row by index and stops live-following, so the
  // viewed rows stay put while new ones accumulate. Used by "quick goto time"
  // and the quick info bar's click-to-jump metrics (#282, #311).
  const gotoIndex = (idx: number) => {
    if (idx < 0 || idx >= telegramRows.length) return;
    atEdgeRef.current = false;
    setFollowingLive(false);
    onListFollowChange?.(false);
    // The old anchor is about to leave the rendered window on purpose.
    anchorRef.current = null;
    markProgrammatic();
    virtualizer.scrollToIndex(idx, { align: 'center' });
    // Pin the row we land on once the virtualizer has settled the scroll (rows
    // are dynamically measured, so give it two frames before capturing).
    requestAnimationFrame(() => requestAnimationFrame(() => {
      captureAnchor();
      atEdgeRef.current = false;
      setFollowingLive(false);
      onListFollowChange?.(false);
    }));
  };

  // Stripe marks and the mouse selection. A telegram that is both counts once,
  // and a row the list no longer shows does not count.
  const pillKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const row of telegramRows) {
      const key = anchorKey(row);
      if (markedSet.has(key) || highlightedSet.has(key)) keys.add(key);
    }
    return keys;
  }, [telegramRows, markedSet, highlightedSet]);

  // Jump between those rows (#442), in display order, without wrapping. The
  // starting point is the mark last jumped to or clicked; once the user scrolls
  // away it is whatever row sits in the middle of the viewport instead.
  const markedIndices = useMemo(() => {
    if (pillKeys.size === 0) return [];
    const out: number[] = [];
    telegramRows.forEach((r, i) => { if (pillKeys.has(anchorKey(r))) out.push(i); });
    return out;
  }, [telegramRows, pillKeys]);

  const viewportCenterIndex = () => {
    const el = parentRef.current;
    if (!el) return 0;
    const center = el.scrollTop + el.clientHeight / 2;
    const item = virtualizer.getVirtualItems().find(v => v.start <= center && center < v.end);
    return item ? item.index : 0;
  };

  const markCursorIdx = markCursorKey ? telegramRows.findIndex(r => anchorKey(r) === markCursorKey) : -1;
  // markScrollGen changes when scrolling, with no cursor, crosses a mark.
  const markOrigin = markCursorIdx !== -1 ? markCursorIdx : (markScrollGen, viewportCenterIndex());
  const canMarkUp = markedIndices.some(i => i < markOrigin);
  const canMarkDown = markedIndices.some(i => i > markOrigin);
  canMarkUpRef.current = canMarkUp;
  canMarkDownRef.current = canMarkDown;
  refreshMarkNavOnScrollRef.current = () => {
    if (markCursorRef.current !== null) {
      markCursorRef.current = null;
      setMarkCursorKey(null);
      return;
    }
    const from = viewportCenterIndex();
    const up = markedIndices.some(i => i < from);
    const down = markedIndices.some(i => i > from);
    if (up !== canMarkUpRef.current || down !== canMarkDownRef.current) setMarkScrollGen(n => n + 1);
  };

  const jumpToMark = (dir: 1 | -1) => {
    if (markedIndices.length === 0) return;
    const cursor = markCursorRef.current;
    const cursorIdx = cursor ? telegramRows.findIndex(r => anchorKey(r) === cursor) : -1;
    const from = cursorIdx !== -1 ? cursorIdx : viewportCenterIndex();
    const further = adjacentMark(markedIndices, from, dir);
    // Nothing further this way. Center the mark already here, or the nearest
    // one on this side, and draw the same white frame as a real jump.
    const target = further ?? (dir === 1
      ? markedIndices.findLast(i => i <= from)
      : markedIndices.find(i => i >= from));
    if (target == null) return;
    const key = anchorKey(telegramRows[target]);
    markCursorRef.current = key;
    setMarkCursorKey(key);
    showJumpFrame(key);
    gotoIndex(target);
  };

  // "Quick goto time" (#282): jump to the telegram nearest a given time. Only
  // meaningful for the timestamp sort, where rows are ordered by time — the
  // info bar's jumps use gotoIndex directly since they already know the index.
  const gotoTime = (targetMs: number) => {
    const rows = telegramRows;
    if (!isTimeSort || rows.length === 0) return;
    let bestIdx = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < rows.length; i++) {
      const diff = Math.abs(new Date(rows[i].timestamp).getTime() - targetMs);
      if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
    }
    gotoIndex(bestIdx);
  };

  // Newest telegram time, used to seed the goto-time input.
  const newestMs = telegramRows.length > 0
    ? new Date(telegramRows[liveEdge === 'top' ? 0 : telegramRows.length - 1].timestamp).getTime()
    : null;

  // Correct scrollTop so the anchored row keeps its recorded viewport offset.
  const pinAnchor = () => {
    const el = parentRef.current;
    const anchor = anchorRef.current;
    if (centerOnRestoreRef.current || !el || !anchor || atEdgeRef.current) return;
    const now = rowOffset(anchor.key);
    if (now == null) {
      // Not rendered. Either the user jumped far away (scrollbar drag) and
      // the scroll handler has not caught up — then the anchor is stale and
      // whatever is on screen now takes over. Or so many rows arrived that the
      // anchor left the virtualized window: it is still in the list, so have
      // the virtualizer bring it back (it copes with unmeasured rows) and then
      // restore its offset.
      if (refindingAnchorRef.current) return;
      const inserted = anchorRowsRef.current !== telegramRows && !userScrolling();
      const idx = inserted ? telegramRows.findIndex(r => anchorKey(r) === anchor.key) : -1;
      if (idx === -1) {
        captureAnchor();
        return;
      }
      refindingAnchorRef.current = true;
      virtualizer.scrollToIndex(idx, { align: 'start' });
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const found = rowOffset(anchor.key);
        if (found != null && anchorRef.current === anchor) {
          el.scrollTop += found - anchor.offset;
          anchorRowsRef.current = telegramRowsRef.current;
        }
        // One more frame for the scroll event to pass before tracking resumes.
        requestAnimationFrame(() => {
          refindingAnchorRef.current = false;
          if (found == null) captureAnchor();
          else pinAnchor();
        });
      }));
      return;
    }
    if (refindingAnchorRef.current) return;
    const delta = now - anchor.offset;
    if (Math.abs(delta) > 0.5) {
      markProgrammatic();
      el.scrollTop += delta;
    }
    anchorRowsRef.current = telegramRows;
  };

  // Changing sort moves (or removes) the live edge — drop the anchor state.
  // Skipped on mount: this effect and the restore-on-mount effect below both
  // run in the same commit, in declaration order, and the DOM has zero
  // scrollTop before either has scrolled anywhere — so without this guard,
  // checkAtEdge() always reads "at edge" here first and clobbers a restored
  // anchor (e.g. a cross-panel goto, #308) before it ever gets applied.
  const sortEffectMounted = useRef(false);
  useEffect(() => {
    if (!sortEffectMounted.current) {
      sortEffectMounted.current = true;
      // Undo the flag on cleanup so StrictMode's dev-only double-invoke
      // (mount → cleanup → mount) still skips on both simulated mounts,
      // instead of treating the second one as a real sortConfig change.
      return () => { sortEffectMounted.current = false; };
    }
    setStripeOffset(0);
    anchorRef.current = null;
    onListAnchorKeyChange?.(null);
    const atEdge = checkAtEdge();
    if (atEdge !== atEdgeRef.current) {
      atEdgeRef.current = atEdge;
      setFollowingLive(atEdge);
      onListFollowChange?.(atEdge);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortConfig]);

  // Restore scroll position/anchor on mount (#203, #341)
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || telegramRows.length === 0) return;
    restoredRef.current = true;

    if (atEdgeRef.current) {
      scrollToEdge();
    } else if (listAnchorKey) {
      const idx = telegramRows.findIndex(t => anchorKey(t) === listAnchorKey);
      if (idx !== -1) {
        const align = centerOnRestoreRef.current ? 'center' : 'start';
        // Hold through the measurement frames. A scroll in between must not
        // replace the centered row with whatever sits at the top.
        if (align === 'center') {
          programmaticScrollRef.current = true;
          showJumpFrame(listAnchorKey);
          // scrollToIndex can no-op before the scroller has a size. Keep
          // correcting from the rendered row until it sits in the middle
          // or the scroll range is clamped.
          const placeCenter = (tries: number) => {
            const el = parentRef.current;
            if (!el) return;
            const row = el.querySelector<HTMLElement>(`[data-akey="${CSS.escape(listAnchorKey)}"]`);
            if (!row || el.clientHeight === 0) {
              virtualizer.scrollToIndex(idx, { align: 'center' });
              if (tries < 8) requestAnimationFrame(() => placeCenter(tries + 1));
              else finishCenter();
              return;
            }
            const rowRect = row.getBoundingClientRect();
            const port = el.getBoundingClientRect();
            const delta = (rowRect.top + rowRect.height / 2) - (port.top + port.height / 2);
            const max = el.scrollHeight - el.clientHeight;
            const next = Math.max(0, Math.min(max, el.scrollTop + delta));
            if (Math.abs(next - el.scrollTop) > 1 && tries < 8) {
              el.scrollTop = next;
              requestAnimationFrame(() => placeCenter(tries + 1));
              return;
            }
            finishCenter();
          };
          const finishCenter = () => {
            const offset = rowOffset(listAnchorKey);
            centerOnRestoreRef.current = false;
            if (offset != null) anchorRef.current = { key: listAnchorKey, offset };
            programmaticScrollRef.current = false;
          };
          placeCenter(0);
        } else {
          markProgrammatic();
          virtualizer.scrollToIndex(idx, { align });
          requestAnimationFrame(() => requestAnimationFrame(() => {
            const offset = rowOffset(listAnchorKey);
            centerOnRestoreRef.current = false;
            if (offset != null) {
              anchorRef.current = { key: listAnchorKey, offset };
              pinAnchor();
            }
          }));
        }
      } else {
        centerOnRestoreRef.current = false;
        jumpToLive();
      }
    } else {
      scrollToEdge();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [telegramRows.length]);

  // React to list updates before paint: follow the live edge, or pin the
  // anchored row by correcting scrollTop by its real pixel shift.
  const prevRowsRef = useRef<{ firstKey: string | null; lastKey: string | null; len: number }>({
    firstKey: null, lastKey: null, len: 0,
  });
  useLayoutEffect(() => {
    const rows = telegramRows;
    const prev = prevRowsRef.current;
    const firstKey = rows.length > 0 ? anchorKey(rows[0]) : null;
    const lastKey = rows.length > 0 ? anchorKey(rows[rows.length - 1]) : null;
    prevRowsRef.current = { firstKey, lastKey, len: rows.length };

    if (rows.length === 0) setStripeOffset(0);
    if (!isTimeSort || prev.len === 0 || rows.length === 0) return;

    const edgeKey = liveEdge === 'top' ? firstKey : lastKey;
    const prevEdgeKey = liveEdge === 'top' ? prev.firstKey : prev.lastKey;
    if (!prevEdgeKey || edgeKey === prevEdgeKey) return; // nothing new at the live edge

    let added = -1;
    if (liveEdge === 'top') {
      for (let i = 0; i < rows.length; i++) if (anchorKey(rows[i]) === prevEdgeKey) { added = i; break; }
    } else {
      for (let i = rows.length - 1; i >= 0; i--) if (anchorKey(rows[i]) === prevEdgeKey) { added = rows.length - 1 - i; break; }
    }

    if (added <= 0) {
      // The previous edge row is gone — the list was replaced or refiltered
      // (e.g. Time-Delta-Context switched off). Keep holding the anchor if its
      // row survived (#435); otherwise start over.
      const anchor = anchorRef.current;
      if (anchor && !atEdgeRef.current && rows.some(r => anchorKey(r) === anchor.key)) {
        setStripeOffset(0);
        pinAnchor();
        return;
      }
      anchorRef.current = null;
      onListAnchorKeyChange?.(null);
      setStripeOffset(0);
      return;
    }

    const dropped = prev.len + added - rows.length;
    const indexShift = liveEdge === 'top' ? added : -dropped;
    setStripeOffset(o => (((o + indexShift) % 2) + 2) % 2);

    if (atEdgeRef.current) {
      scrollToEdge();
      return;
    }

    pinAnchor();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [telegramRows]);

  const totalSize = virtualizer.getTotalSize();
  useLayoutEffect(() => {
    pinAnchor();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalSize]);

  // Visible columns in order, and the matching CSS grid template.
  // The delta column is always shown when enabled, regardless of sort (#311) —
  // it's computed from the visible row order under any sort hierarchy.
  const visibleCols = useMemo(
    () => columnOrder
      .map(id => COLUMNS.find(c => c.id === id)!)
      .filter(c => !c.visibleKey || visibleColumns[c.visibleKey]),
    [visibleColumns, columnOrder],
  );

  const gridTemplate = useMemo(
    () => gridFor(visibleCols),
    [visibleCols, gridFor],
  );

  // Multi-level sort indicator (#311): the chevron shows this column's own
  // direction; a small numbered badge additionally marks its position in the
  // hierarchy once more than one level is active (ctrl/cmd-click adds levels).
  const renderSortArrow = (key: SortKey) => {
    const idx = sortConfig.findIndex(l => l.key === key);
    if (idx === -1) return null;
    const icon = sortConfig[idx].direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />;
    if (sortConfig.length <= 1) return icon;
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.15rem' }}>
        {icon}
        <span
          title={`Sort level ${idx + 1} of ${sortConfig.length}`}
          style={{
            fontSize: '0.6rem', fontWeight: 700, minWidth: '1rem', textAlign: 'center',
            padding: '0 0.2rem', borderRadius: '3px', background: 'var(--bg-tag)', color: 'var(--text-dim)',
          }}
        >
          {idx + 1}
        </span>
      </span>
    );
  };

  const markedAddresses = (t: TelegramRow, mode: 'ga' | 'pa') => {
    const clicked = mode === 'pa' ? t.source_address : t.target_address;
    if (!markedSet.has(anchorKey(t))) return { addresses: [clicked], clicked };
    const addresses: string[] = [];
    const seen = new Set<string>();
    for (const row of telegramRows) {
      if (!markedSet.has(anchorKey(row))) continue;
      const address = mode === 'pa' ? row.source_address : row.target_address;
      if (seen.has(address)) continue;
      seen.add(address);
      addresses.push(address);
    }
    return { addresses, clicked };
  };

  const renderCell = (id: ColId, t: TelegramRow): React.ReactNode => renderTelegramCell(id, {
    telegram: t,
    deltaTop: t.deltaStr,
    deltaBottom: t.deltaNextStr,
    showSourceName: visibleColumns.sourceName,
    showTargetName: visibleColumns.targetName,
    showRaw: visibleColumns.data,
    sourceActions: renderAddressActions({
      mode: 'pa',
      address: t.source_address,
      focusOn: focusDevices.includes(t.source_address),
      filterOn: (focusFilterDevices ?? EMPTY_FOCUS_ADDRESSES).includes(t.source_address),
      visualizeOn: visualizedDevices.includes(t.source_address),
      lastSeenOn: lastSeenDevices.includes(t.source_address),
      onFocus: onFocusFilter
        ? (_address, mode, gesture) => {
            const picked = markedAddresses(t, mode);
            onFocusFilter(picked.addresses, mode, gesture, picked.clicked);
          }
        : undefined,
      onFilter: onFocusAddressFilter
        ? (_address, mode, gesture) => {
            const picked = markedAddresses(t, mode);
            onFocusAddressFilter(picked.addresses, mode, gesture, picked.clicked);
          }
        : undefined,
      onVisualize: onQuickVisualizeSource
        ? (_address, mode, gesture) => {
            const picked = markedAddresses(t, mode);
            onQuickVisualizeSource(picked.addresses, mode, gesture, picked.clicked);
          }
        : undefined,
      onLastSeen: onQuickLastSeen
        ? (_address, mode, gesture) => {
            const picked = markedAddresses(t, mode);
            onQuickLastSeen(picked.addresses, mode, gesture, picked.clicked);
          }
        : undefined,
    }),
    targetActions: renderAddressActions({
      mode: 'ga',
      address: t.target_address,
      name: t.target_name,
      dptMain: t.dpt_main,
      dptSub: t.dpt_sub,
      focusOn: focusGas.includes(t.target_address),
      filterOn: (focusFilterGas ?? EMPTY_FOCUS_ADDRESSES).includes(t.target_address),
      visualizeOn: visualizedGas.includes(t.target_address),
      lastSeenOn: lastSeenGas.includes(t.target_address),
      onFocus: onFocusFilter
        ? (_address, mode, gesture) => {
            const picked = markedAddresses(t, mode);
            onFocusFilter(picked.addresses, mode, gesture, picked.clicked);
          }
        : undefined,
      onFilter: onFocusAddressFilter
        ? (_address, mode, gesture) => {
            const picked = markedAddresses(t, mode);
            onFocusAddressFilter(picked.addresses, mode, gesture, picked.clicked);
          }
        : undefined,
      onVisualize: (_address, mode, gesture) => {
        const picked = markedAddresses(t, mode);
        onQuickVisualize(picked.addresses, mode, gesture, picked.clicked);
      },
      onLastSeen: onQuickLastSeen
        ? (_address, mode, gesture) => {
            const picked = markedAddresses(t, mode);
            onQuickLastSeen(picked.addresses, mode, gesture, picked.clicked);
          }
        : undefined,
      canSend,
    }),
    valueAction: (
      <button
        className="quick-visualize-btn"
        onClick={e => {
          e.stopPropagation();
          invokeToggle(e, (gesture) => {
            const picked = markedAddresses(t, 'ga');
            onQuickVisualize(picked.addresses, 'ga', gesture, picked.clicked);
          });
        }}
        aria-label="Visualize this target"
        title={toggleTitle('Visualize this target', 'Visualization')}
      >
        <LineChart size={14} />
      </button>
    ),
  });

  // Tell the buffer which timestamps are on screen so a refill cannot evict them.
  // At the live edge the buffer keeps dropping the oldest entry.
  const visibleItems = isTimeSort && listFollow === false ? virtualizer.getVirtualItems() : [];
  let spanStart = Number.POSITIVE_INFINITY;
  let spanEnd = Number.NEGATIVE_INFINITY;
  for (const item of visibleItems) {
    const row = telegramRows[item.index];
    if (!row) continue;
    const ms = new Date(row.timestamp).getTime();
    if (ms < spanStart) spanStart = ms;
    if (ms > spanEnd) spanEnd = ms;
  }
  const visibleSpanKey = Number.isFinite(spanStart) ? `${spanStart}:${spanEnd}` : '';
  useEffect(() => {
    if (!onVisibleSpanChange) return;
    if (!visibleSpanKey) {
      onVisibleSpanChange(null);
      return;
    }
    const [startMs, endMs] = visibleSpanKey.split(':').map(Number);
    onVisibleSpanChange({ startMs, endMs });
  }, [visibleSpanKey, onVisibleSpanChange]);

  const infoChipStyle: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
    background: 'var(--bg-tag)', border: '1px solid var(--border-subtle)', borderRadius: '4px',
    padding: '0.15rem 0.45rem', fontSize: '0.68rem', color: 'var(--text-dim)',
  };
  const infoChipBtnStyle: React.CSSProperties = {
    ...infoChipStyle, cursor: 'pointer', background: 'transparent',
  };

  // Count telegrams strictly newer than the newest one on screen. Overscan
  // rows are rendered but not on screen. A range computed while every row
  // still has size 0 is meaningless: the virtualizer's binary search treats
  // every start offset as equal and lands on an arbitrary middle index.
  // Deriving the count from the visible rows keeps it correct when a filter
  // refill replaces the list instead of prepending at the live edge.
  const virtualItems = virtualizer.getVirtualItems();
  const visibleRange = virtualizer.range;
  let newerCount = 0;
  const rangeMeasured = virtualItems.some(item => item.size > 0);
  if (isTimeSort && visibleRange && rangeMeasured && telegramRows.length > 0 && virtualizer.getTotalSize() > 0) {
    const start = Math.max(0, visibleRange.startIndex);
    const end = Math.min(telegramRows.length - 1, visibleRange.endIndex);
    if (end >= start) {
      let newest = -Infinity;
      for (let i = start; i <= end; i++) {
        const ms = timeMs(telegramRows[i].timestamp);
        if (ms > newest) newest = ms;
      }
      newerCount = countNewerThan(telegramRows, newest, liveEdge === 'bottom');
    }
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Quick info bar (#311): collapsible summary directly above the header. */}
      {infoOpen && infoMetrics && (
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-subtle)', flexShrink: 0 }}>
          <div aria-hidden style={{ width: MARK_STRIPE_WIDTH, flexShrink: 0 }} />
          <div style={{ width: RAIL_WIDTH, flexShrink: 0, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '0.35rem' }}>
            <button className="quick-filter-bar-toggle open" onClick={toggleInfoOpen} title="Hide info bar">
              <ChevronDown size={13} />
            </button>
          </div>
          <div style={{
            flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.3rem',
            padding: '0.4rem 0.75rem 0.4rem 0',
          }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center' }}>
            <button
              style={infoChipBtnStyle} title="Jump to the oldest telegram in the current view"
              onClick={() => gotoIndex(infoMetrics.oldestIdx)}
            >
              Oldest: {format(new Date(telegramRows[infoMetrics.oldestIdx].timestamp), 'yyyy-MM-dd HH:mm:ss.SS')}
            </button>
            <button
              style={infoChipBtnStyle} title="Jump to the newest telegram in the current view"
              onClick={() => gotoIndex(infoMetrics.newestIdx)}
            >
              Newest: {format(new Date(telegramRows[infoMetrics.newestIdx].timestamp), 'yyyy-MM-dd HH:mm:ss.SS')}
            </button>
            {infoMetrics.minDeltaIdx !== -1 && (
              <button
                style={infoChipBtnStyle} title="Jump to the smallest time gap in the current view"
                onClick={() => gotoIndex(infoMetrics.minDeltaIdx)}
              >
                Min Δt: {telegramRows[infoMetrics.minDeltaIdx].deltaStr}
              </button>
            )}
            {infoMetrics.maxDeltaIdx !== -1 && (
              <button
                style={infoChipBtnStyle} title="Jump to the largest time gap in the current view"
                onClick={() => gotoIndex(infoMetrics.maxDeltaIdx)}
              >
                Max Δt: {telegramRows[infoMetrics.maxDeltaIdx].deltaStr}
              </button>
            )}
            {infoMetrics.peak && (
              <button
                style={infoChipBtnStyle} title="Most telegrams within one second in the current view — jump to the start of that burst"
                onClick={() => gotoIndex(infoMetrics.peak!.startIdx)}
              >
                Max rate: {infoMetrics.peak.count}/s
              </button>
            )}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', alignItems: 'center' }}>
            <span style={infoChipStyle}>{infoMetrics.count} telegram{infoMetrics.count !== 1 ? 's' : ''}</span>
            <span style={infoChipStyle}>{infoMetrics.sourceCount} source{infoMetrics.sourceCount !== 1 ? 's' : ''}</span>
            <span style={infoChipStyle}>{infoMetrics.targetCount} target{infoMetrics.targetCount !== 1 ? 's' : ''}</span>
            <span style={infoChipStyle}>{infoMetrics.dptCount} DPT{infoMetrics.dptCount !== 1 ? 's' : ''}</span>
            {infoMetrics.typeCounts.map(([type, n]) => (
              <span key={type} style={infoChipStyle}>{type}: {n}</span>
            ))}
            {infoMetrics.contextCount > 0 && (
              <span style={infoChipStyle} title="Rows shown only as unfiltered Time-Delta-Context, not real filter matches (#343)">
                {infoMetrics.contextCount} context
              </span>
            )}
            <button
              style={infoChipBtnStyle}
              title="Download the telegrams in the current view (all filters applied, in list order) as CSV"
              onClick={() => downloadTelegramsCsv(telegramRows)}
            >
              <Download size={11} /> CSV
            </button>
          </div>
          </div>
        </div>
      )}

      {/* Header: a left icon rail and three rows per column. The label sits in the middle row. */}
      <div style={{
        display: 'flex',
        background: 'linear-gradient(180deg, color-mix(in srgb, var(--bg-panel) 82%, var(--accent-primary) 18%) 0%, color-mix(in srgb, var(--bg-panel) 92%, black 8%) 100%)',
        zIndex: 10,
        backdropFilter: 'blur(12px)',
        borderTop: '1px solid color-mix(in srgb, var(--accent-primary) 18%, var(--border-color))',
        borderBottom: '1px solid color-mix(in srgb, var(--accent-primary) 22%, var(--border-color))',
        boxShadow: 'inset 0 1px 0 color-mix(in srgb, white 6%, transparent), inset 0 -1px 0 color-mix(in srgb, black 18%, transparent)',
        flexShrink: 0,
      }}>
        <div aria-hidden style={{ width: MARK_STRIPE_WIDTH, flexShrink: 0 }} />
        <div style={{ width: RAIL_WIDTH, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
            {!infoOpen && (
              <button className="quick-filter-bar-toggle" onClick={toggleInfoOpen} title="Show info bar">
                <ChevronUp size={13} />
              </button>
            )}
          </div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {isTimeSort && <GotoTimeControl seedMs={newestMs} onGoto={gotoTime} />}
          </div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
            {quickOpen ? (
              <button
                className={`quick-filter-bar-toggle ${quickEnabled ? 'open' : ''}`}
                onClick={handleQuickEnabledToggleClick}
                title={quickEnabled
                  ? 'Disable quick filter (keeps patterns) · ctrl/cmd-click clears all quick-filter cells and enables every column'
                  : 'Enable quick filter · ctrl/cmd-click clears all quick-filter cells and enables every column'}
              >
                <Filter size={13} />
              </button>
            ) : (
              <button className="quick-filter-bar-toggle" onClick={toggleQuickOpen} title="Show quick filter bar">
                <ChevronDown size={13} />
              </button>
            )}
          </div>
        </div>
        <TelegramColumnHeader
          columns={visibleCols}
          gridTemplate={gridTemplate}
          stacked
          onResizeStart={handleResizeStart}
          onResetWidth={handleResetWidth}
          renderAbove={c => {
            if (c.id !== 'source' && c.id !== 'target') return null;
            const sources = c.id === 'source';
            const hasEntries = (sources ? focusFilterDevices : focusFilterGas)?.length ? true : false;
            const checked = hasEntries && (sources ? filterFocusedSources : filterFocusedTargets);
            return (
              <div
                className={`filter-focused${hasEntries ? '' : ' is-inactive'}`}
                onClick={() => {
                  if (!hasEntries) return;
                  (sources ? setFilterFocusedSources : setFilterFocusedTargets)(!checked);
                }}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '0.35rem', minWidth: 0, maxWidth: '100%',
                  textTransform: 'none', letterSpacing: 0, fontSize: '0.68rem', fontWeight: 600,
                  color: 'var(--text-dim)', cursor: hasEntries ? 'pointer' : 'default',
                  userSelect: 'none',
                }}
              >
                <div
                  role="checkbox"
                  aria-checked={checked}
                  aria-disabled={!hasEntries}
                  aria-label="filter focused"
                  style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}
                >
                  <CheckMark state={checked ? 'checked' : 'unchecked'} />
                </div>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: hasEntries ? 1 : 0.45 }}>filter focused</span>
              </div>
            );
          }}
          renderBelow={c => quickOpen && quickEnabled ? (
            <button
              className={`quick-filter-bar-toggle ${isQuickColumnEnabled(c.id) ? 'open' : ''}`}
              onClick={e => handleQuickColumnToggleClick(e, c.id)}
              title={isQuickColumnEnabled(c.id)
                ? `Disable quick filter for ${c.label} · ctrl/cmd-click clears this column's quick-filter cells`
                : `Enable quick filter for ${c.label} · ctrl/cmd-click clears this column's quick-filter cells`}
            >
              <Filter size={12} />
            </button>
          ) : null}
          renderLabel={c => c.id === 'delta' ? (
            <button
              className="sort-header"
              onClick={handleDeltaHeaderClick}
              title={deltaSortActive
                ? 'Sorted by time delta — click to flip direction; click any other column to return to live order'
                : 'Sort by time delta (exclusive — pauses live scrolling and freezes the current order)'}
            >
              {c.label} {deltaSortActive && (deltaSortDirection === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />)}
            </button>
          ) : c.sortKey ? (
            <button
              className="sort-header"
              onClick={e => handleColumnSort(c.sortKey!, { additive: e.ctrlKey || e.metaKey })}
              title="Click to sort · ctrl/cmd-click to add as a further sort level (TIME is always the deepest tiebreaker)"
            >
              {c.label} {renderSortArrow(c.sortKey)}
            </button>
          ) : (
            <span>{c.label}</span>
          )}
          bindCell={c => ({
            className: `header-col${draggingColumn === c.id ? ' drag-source' : ''}${dropTarget?.id === c.id ? ` drop-${dropTarget.side}` : ''}`,
            draggable: true,
            onMouseDownCapture: e => { dragOriginRef.current = e.target; },
            onDragStart: e => {
              const origin = dragOriginRef.current;
              if (origin instanceof Element && origin.closest('input, textarea, select, .col-resize-handle, .filter-focused, .quick-filter-bar-toggle')) {
                e.preventDefault();
                return;
              }
              setDraggingColumn(c.id);
              e.dataTransfer.setData('text/plain', c.id);
              e.dataTransfer.effectAllowed = 'move';
            },
            onDragOver: e => {
              if (!draggingColumn || draggingColumn === c.id) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              const rect = e.currentTarget.getBoundingClientRect();
              const side = e.clientX - rect.left < rect.width / 2 ? 'before' : 'after';
              if (dropTarget?.id !== c.id || dropTarget.side !== side) setDropTarget({ id: c.id, side });
            },
            onDrop: e => {
              e.preventDefault();
              dropColumn(c.id, dropTarget?.id === c.id ? dropTarget.side : 'before');
            },
            onDragEnd: endColumnDrag,
          })}
        />
      </div>

      {/* Quick filter bar (#271, #309) — two rows per column. TYPE is a type
          pattern and a direction pattern. DELTA edits the Time-Delta-Context
          window (#371) and does not go through the pattern pipeline. */}
      {quickOpen && (
        <>
        <div style={{ display: 'flex', background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border-color)', flexShrink: 0, opacity: quickEnabled ? 1 : 0.5 }}>
          <div aria-hidden style={{ width: MARK_STRIPE_WIDTH, flexShrink: 0 }} />
          <div style={{ width: RAIL_WIDTH, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <button
                className={`quick-filter-bar-toggle ${deltaFlagState !== 'none' ? 'open' : ''}`}
                onClick={handleDeltaToggleClick}
                title={[
                  deltaFlagState === 'all'
                    ? 'Time-Delta-Context: around all messages. Click to switch it off for all of them.'
                    : deltaFlagState === 'some'
                      ? 'Time-Delta-Context: around the flagged messages only. Click to clear the flags.'
                      : 'Time-Delta-Context: around no message. Click to show it around all messages.',
                  activeFilters.deltaContextEnabled
                    ? 'Ctrl/cmd-click to disable the window (keeps flags and values).'
                    : 'Ctrl/cmd-click to re-enable the window.',
                ].join(' ')}
                style={{
                  opacity: activeFilters.deltaContextEnabled ? 1 : 0.5,
                  color: deltaFlagState === 'all' ? 'var(--accent-primary)' : undefined,
                }}
              >
                {deltaFlagState === 'all' ? <CircleDot size={12} /> : <Circle size={12} />}
              </button>
            </div>
            <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
              <button className="quick-filter-bar-toggle open" onClick={toggleQuickOpen} title="Hide quick filter bar">
                <ChevronUp size={12} />
              </button>
            </div>
          </div>
          <div style={{
            flex: 1, minWidth: 0, display: 'grid', gridTemplateColumns: gridTemplate,
            paddingRight: '8px',
          }}>
          {visibleCols.map(c => (
            <div key={c.id} style={{ padding: '0.35rem 0.5rem', display: 'flex', alignItems: 'flex-start', gap: '0.35rem', minWidth: 0, opacity: isQuickColumnEnabled(c.id) ? 1 : 0.45 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', minWidth: 0, flex: 1 }}>
                {c.id === 'delta' ? (
                  <>
                    <input
                      className={quickInputClassName(activeFilters.deltaBeforeMs || '')}
                      type="number" min={0} step={10}
                      value={activeFilters.deltaBeforeMs || ''}
                      placeholder="before ms"
                      aria-label="Time-Delta-Context before (ms)"
                      style={{ opacity: isQuickColumnEnabled(c.id) ? (activeFilters.deltaContextEnabled ? 1 : 0.5) : 0.45 }}
                      disabled={!isQuickColumnEnabled(c.id)}
                      onChange={e => onDeltaContextChange?.(Math.max(0, Number(e.target.value) || 0), activeFilters.deltaAfterMs)}
                    />
                    <input
                      className={quickInputClassName(activeFilters.deltaAfterMs || '')}
                      type="number" min={0} step={10}
                      value={activeFilters.deltaAfterMs || ''}
                      placeholder="after ms"
                      aria-label="Time-Delta-Context after (ms)"
                      style={{ opacity: isQuickColumnEnabled(c.id) ? (activeFilters.deltaContextEnabled ? 1 : 0.5) : 0.45 }}
                      disabled={!isQuickColumnEnabled(c.id)}
                      onChange={e => onDeltaContextChange?.(activeFilters.deltaBeforeMs, Math.max(0, Number(e.target.value) || 0))}
                    />
                  </>
                ) : c.id === 'type' ? (
                  <>
                    <input
                      className={quickInputClassName(currentPatterns.type?.top ?? '')}
                      type="text"
                      value={currentPatterns.type?.top ?? ''}
                      placeholder="type regex…"
                      aria-label="Quick filter TYPE"
                      disabled={!isQuickColumnEnabled(c.id)}
                      onChange={e => setQuickCell('type', 'top', e.target.value)}
                    />
                    <input
                      className={quickInputClassName(currentPatterns.type?.bottom ?? '')}
                      type="text"
                      value={currentPatterns.type?.bottom ?? ''}
                      placeholder="direction regex…"
                      aria-label="Quick filter TYPE direction"
                      disabled={!isQuickColumnEnabled(c.id)}
                      onChange={e => setQuickCell('type', 'bottom', e.target.value)}
                    />
                  </>
                ) : c.id === 'time' ? (
                  <>
                    <input
                      className={quickInputClassName(currentPatterns.time?.top ?? '', 'datetime')}
                      type="datetime-local" step="1"
                      value={currentPatterns.time?.top ?? ''}
                      aria-label="Quick filter TIME from"
                      disabled={!isQuickColumnEnabled(c.id)}
                      onChange={e => setQuickCell('time', 'top', e.target.value)}
                    />
                    <input
                      className={quickInputClassName(currentPatterns.time?.bottom ?? '', 'datetime')}
                      type="datetime-local" step="1"
                      value={currentPatterns.time?.bottom ?? ''}
                      aria-label="Quick filter TIME to"
                      disabled={!isQuickColumnEnabled(c.id)}
                      onChange={e => setQuickCell('time', 'bottom', e.target.value)}
                    />
                  </>
                ) : c.id === 'value' ? (
                  <>
                    <input
                      className={quickInputClassName(currentPatterns.value?.top ?? '')}
                      type="text"
                      value={currentPatterns.value?.top ?? ''}
                      placeholder="from / 0x.. / 0b.. / &quot;regex&quot;"
                      aria-label="Quick filter VALUE from"
                      disabled={!isQuickColumnEnabled(c.id)}
                      onChange={e => setQuickCell('value', 'top', e.target.value)}
                    />
                    <input
                      className={quickInputClassName(currentPatterns.value?.bottom ?? '')}
                      type="text"
                      value={currentPatterns.value?.bottom ?? ''}
                      placeholder="to / pattern…"
                      aria-label="Quick filter VALUE to"
                      disabled={!isQuickColumnEnabled(c.id)}
                      onChange={e => setQuickCell('value', 'bottom', e.target.value)}
                    />
                  </>
                ) : (
                  // source / target / dpt: top = address/DPT-key pattern, bottom = name/description pattern
                  <>
                    <input
                      className={quickInputClassName(currentPatterns[c.id]?.top ?? '')}
                      type="text"
                      value={currentPatterns[c.id]?.top ?? ''}
                      placeholder={c.id === 'dpt' ? '1.008-1.011, 16.*' : c.id === 'source' ? '*.1.*, 1.2.12-1.2.91' : '1/5/*, 3/1/1-3/1/127'}
                      aria-label={`Quick filter ${c.label} pattern`}
                      disabled={!isQuickColumnEnabled(c.id)}
                      onChange={e => setQuickCell(c.id, 'top', e.target.value)}
                    />
                    <input
                      className={quickInputClassName(currentPatterns[c.id]?.bottom ?? '')}
                      type="text"
                      value={currentPatterns[c.id]?.bottom ?? ''}
                      placeholder={c.id === 'dpt' ? 'description regex…' : 'name regex…'}
                      aria-label={`Quick filter ${c.label} name`}
                      disabled={!isQuickColumnEnabled(c.id)}
                      onChange={e => setQuickCell(c.id, 'bottom', e.target.value)}
                    />
                  </>
                )}
              </div>
            </div>
          ))}
          </div>
        </div>
        <div
          data-testid="quick-filter-divider"
          style={{
            height: '2px',
            flexShrink: 0,
            background: !quickEnabled || !Object.values(currentQuickColumnEnabled).some(Boolean) ? '#000000' : '#6b7280',
          }}
        />
        </>
      )}

      {/* Body area — relative wrapper so the jump-to-live pill (#202) anchors
          below the header, not over it. */}
      <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Jump-to-live pill — telegrams newer than the newest one on screen.
          Hidden in live mode, where that telegram is always visible. */}
      {isTimeSort && !followingLive && newerCount > 0 && (
        <button
          onClick={jumpToLive}
          className="jump-to-live-pill"
          style={{
            position: 'absolute', left: '50%', transform: 'translateX(-50%)',
            [liveEdge]: '1rem', zIndex: 20,
          }}
          title="Jump back to the live edge"
        >
          {liveEdge === 'top' ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {newerCount.toLocaleString()} {newerCount === 1 ? 'new telegram' : 'newer telegrams'}
        </button>
      )}

      {/* Marks pill — stripe marks and the mouse selection, each telegram once. */}
      {pillKeys.size > 0 && (
        <div
          className="marks-pill"
          style={{ position: 'absolute', right: '1rem', top: '0.75rem', zIndex: 20 }}
        >
          <button onClick={() => jumpToMark(-1)} aria-disabled={!canMarkUp} title="Jump to previous mark">
            <ChevronUp size={14} />
          </button>
          <button onClick={() => jumpToMark(1)} aria-disabled={!canMarkDown} title="Jump to next mark">
            <ChevronDown size={14} />
          </button>
          <button onClick={clearMarks} className="marks-pill-clear" title="Clear all marks">
            <X size={13} /> Clear {pillKeys.size} mark{pillKeys.size === 1 ? '' : 's'}
          </button>
        </div>
      )}

      {/* Virtualized Body */}
      <div
        ref={parentRef}
        onScroll={handleScroll}
        onWheel={noteUserScroll}
        onTouchMove={noteUserScroll}
        // A press on the container itself (not on a row) is the scrollbar.
        onPointerDown={e => { if (e.target === e.currentTarget) scrollbarHeldRef.current = true; }}
        // overflow-anchor off: we compensate scrollTop manually on prepend (#202),
        // so the browser's native anchoring must not also move the viewport.
        style={{ flex: 1, overflowY: 'auto', position: 'relative', overflowAnchor: 'none' }}
        className="custom-scrollbar"
      >
        {telegramRows.length === 0 ? (
          <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.875rem' }}>
            No data available.
          </div>
        ) : (
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative'
            }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const t = telegramRows[virtualRow.index];
              const key = anchorKey(t);
              const marked = markedSet.has(key);
              // The most-recently-clicked row is the most prominent (#310).
              const latest = marked && key === lastMarked;
              // Present only as unfiltered Time-Delta-Context, not a real filter
              // match. A mouse selection paints the body; the stripe mark of a
              // context telegram only emphasises the context colour on the stripe.
              const inContext = currentQuickColumnEnabled.delta !== false && !!contextColoredKeys?.has(key);
              const isContext = !marked && inContext;
              const flagged = anchorsContext(key);
              const targetColor = telegramColor(activeTargetColors, t);
              const highlighted = highlightedSet.has(key);
              const zebraSubtle = (virtualRow.index + stripeOffset) % 2 === 0;
              const baseSurface = rowSurface({ isContext, targetColor, zebraSubtle });
              // A focus colour stays on the stripe only. A row the focus lists
              // left uncoloured keeps its resting background; the stripe carries the mark.
              const contextMark = highlighted && inContext;
              const mouseWash = latest
                ? 'color-mix(in srgb, var(--accent-primary) 34%, transparent)'
                : marked
                  ? 'color-mix(in srgb, var(--accent-primary) 16%, transparent)'
                  : undefined;
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  data-akey={key}
                  onClick={(e) => handleRowClick(e, key, virtualRow.index)}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                    display: 'flex',
                    borderBottom: '1px solid var(--border-color)',
                    fontSize: '0.8125rem',
                    // Resting surface. A context stripe and a focus colour leave this
                    // wash alone. A mouse selection is painted on the body.
                    background: baseSurface,
                    minHeight: '60px' // Ensure a minimum touch/visual target
                  }}
                  title={isContext ? 'Unfiltered Time-Delta-Context — this telegram did not match the active filters' : undefined}
                  className={`log-row${marked ? ' marked' : ''}${latest ? ' latest' : ''}${isContext ? ' context' : ''}${jumpFlashKey === key ? ' jump-flash' : ''}`}
                >
                  {jumpFlashKey === key && (
                    <span key={jumpFlashTick} className="jump-flash-ring" aria-hidden="true" />
                  )}
                  <button
                    type="button"
                    className="mark-stripe"
                    aria-pressed={highlighted}
                    title={marked
                      ? (highlighted
                        ? 'Remove the highlight from this row and every marked row'
                        : 'Highlight this row and every marked row')
                      : (highlighted
                        ? 'Remove the highlight from this row'
                        : 'Highlight this row')}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleHighlight(key);
                    }}
                    style={{
                      width: MARK_STRIPE_WIDTH,
                      flexShrink: 0,
                      alignSelf: 'stretch',
                      padding: 0,
                      border: 'none',
                      cursor: 'pointer',
                      // Active and coloured: the focus-list colour itself. Context, uncoloured
                      // stripes use a solid of their own hue at that same weight.
                      // Inactive: the dim wash of the row.
                      background: highlighted && targetColor
                        ? targetColor
                        : contextMark
                          ? CONTEXT_MARK_STRIPE
                          : highlighted
                            ? UNCOLORED_MARK_STRIPE
                            : (mouseWash ?? baseSurface),
                    }}
                  />
                  <div className="log-row-body" style={{ flex: 1, minWidth: 0, display: 'flex', background: mouseWash }}>
                  <div style={{ width: RAIL_WIDTH, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {showContextButtons && (
                      <button
                        style={{
                          background: 'transparent', border: 'none', cursor: 'pointer', padding: '0.15rem',
                          borderRadius: '4px', display: 'flex', alignItems: 'center', flexShrink: 0,
                          color: flagged ? 'var(--accent-primary)' : 'var(--text-dim)',
                          opacity: activeFilters.deltaContextEnabled ? (flagged ? 1 : 0.35) : 0.25,
                        }}
                        title={flagged
                          ? 'Context is shown around this message — click to switch it off for this message and every marked row'
                          : 'Show context around this message, regardless of the active filters (also applies to every marked row)'}
                        onClick={e => {
                          holdClickedRow(key);
                          handleFlagClick(e, key);
                        }}
                      >
                        {flagged ? <CircleDot size={12} /> : <Circle size={12} />}
                      </button>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0, display: 'grid', gridTemplateColumns: gridTemplate, alignItems: 'start' }}>
                    {visibleCols.map(c => (
                      <React.Fragment key={c.id}>{renderCell(c.id, t)}</React.Fragment>
                    ))}
                  </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      </div>
    </div>
  );
};

// Add styles for quick filter buttons and resize handles
const style = document.createElement('style');
style.textContent = `
  .quick-filter-btn, .quick-visualize-btn, .quick-last-seen-btn, .quick-send-btn {
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--text-dim);
    padding: 0.2rem;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: all 0.2s;
    position: relative;
  }

  .quick-filter-btn.active,
  .quick-visualize-btn.active,
  .quick-last-seen-btn.active,
  .quick-send-btn.active {
    opacity: 1;
    color: var(--accent-primary);
  }

  .address-actions-inline .quick-filter-btn,
  .address-actions-inline .quick-visualize-btn,
  .address-actions-inline .quick-last-seen-btn,
  .address-actions-inline .quick-send-btn {
    opacity: 0.75;
  }

  .quick-filter-btn .cancel-icon {
    display: none;
  }

  .quick-filter-btn.active:hover .filter-icon {
    display: none;
  }

  .quick-filter-btn.focus-filter-btn.active:hover .filter-icon {
    display: block;
  }

  .quick-filter-btn.active:hover .cancel-icon {
    display: block;
    color: var(--error); /* red for cancel */
  }

  .mark-stripe:hover {
    filter: brightness(1.35);
  }

  .log-row:hover .quick-filter-btn:not(.active),
  .last-seen-group:hover .quick-filter-btn:not(.active),
  .log-row:hover .quick-visualize-btn,
  .last-seen-group:hover .quick-visualize-btn,
  .log-row:hover .quick-last-seen-btn,
  .last-seen-group:hover .quick-last-seen-btn,
  .log-row:hover .quick-send-btn,
  .last-seen-group:hover .quick-send-btn {
    opacity: 0.6;
  }

  .quick-filter-btn:hover, .quick-visualize-btn:hover, .quick-last-seen-btn:hover, .quick-send-btn:hover {
    opacity: 1 !important;
    background: var(--bg-hover);
    color: var(--accent-primary);
    transform: scale(1.1);
  }

  .quick-visualize-btn:hover {
    color: var(--success);
  }

  .quick-last-seen-btn:hover {
    color: var(--accent-primary);
  }

  .jump-to-live-pill {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.35rem 0.85rem;
    border: 1px solid var(--accent-primary);
    border-radius: 999px;
    background: var(--accent-primary);
    color: white;
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    box-shadow: var(--shadow-lg);
    transition: transform 0.15s, filter 0.15s;
  }

  .jump-to-live-pill:hover {
    filter: brightness(1.08);
    transform: translateX(-50%) scale(1.03);
  }

  .marks-pill {
    display: flex;
    align-items: stretch;
    border: 1px solid var(--border-color);
    border-radius: 999px;
    background: var(--bg-panel);
    box-shadow: var(--shadow-lg);
    overflow: hidden;
  }

  .marks-pill button {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.3rem 0.45rem;
    border: none;
    background: transparent;
    color: var(--text-dim);
    font-size: 0.72rem;
    font-weight: 600;
    cursor: pointer;
    transition: color 0.15s, background 0.15s;
  }

  .marks-pill button:first-child {
    padding-left: 0.6rem;
  }

  .marks-pill .marks-pill-clear {
    padding-right: 0.7rem;
    border-left: 1px solid var(--border-color);
  }

  .marks-pill button:hover:not(:disabled):not([aria-disabled="true"]) {
    color: var(--accent-primary);
    background: var(--bg-hover);
  }

  .marks-pill button:disabled,
  .marks-pill button[aria-disabled="true"] {
    opacity: 0.4;
    cursor: default;
  }

  .quick-filter-bar-toggle {
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--text-dim);
    padding: 0.15rem;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: all 0.15s;
  }

  .quick-filter-bar-toggle:hover {
    background: var(--bg-hover);
    color: var(--accent-primary);
  }

  .quick-filter-bar-toggle.open {
    color: var(--accent-primary);
  }

  .quick-filter-bar-input {
    width: 100%;
    min-width: 0;
    background: var(--bg-tag);
    border: 1px solid var(--border-color);
    border-radius: 5px;
    padding: 0.25rem 0.45rem;
    color: var(--text-main);
    font-size: 0.72rem;
    font-family: var(--font-mono, monospace);
    outline: none;
    transition: border-color 0.15s;
  }

  .quick-filter-bar-input::placeholder {
    color: color-mix(in srgb, var(--text-dim) 18%, transparent);
    opacity: 1;
  }

  .quick-filter-bar-input-empty {
    color: color-mix(in srgb, var(--text-dim) 14%, transparent);
  }

  .quick-filter-bar-input-datetime.quick-filter-bar-input-empty::-webkit-datetime-edit,
  .quick-filter-bar-input-datetime.quick-filter-bar-input-empty::-webkit-datetime-edit-fields-wrapper,
  .quick-filter-bar-input-datetime.quick-filter-bar-input-empty::-webkit-datetime-edit-text,
  .quick-filter-bar-input-datetime.quick-filter-bar-input-empty::-webkit-datetime-edit-month-field,
  .quick-filter-bar-input-datetime.quick-filter-bar-input-empty::-webkit-datetime-edit-day-field,
  .quick-filter-bar-input-datetime.quick-filter-bar-input-empty::-webkit-datetime-edit-year-field,
  .quick-filter-bar-input-datetime.quick-filter-bar-input-empty::-webkit-datetime-edit-hour-field,
  .quick-filter-bar-input-datetime.quick-filter-bar-input-empty::-webkit-datetime-edit-minute-field,
  .quick-filter-bar-input-datetime.quick-filter-bar-input-empty::-webkit-datetime-edit-second-field {
    color: color-mix(in srgb, var(--text-dim) 14%, transparent);
  }

  .quick-filter-bar-input-datetime::-webkit-calendar-picker-indicator,
  .goto-time-input::-webkit-calendar-picker-indicator {
    opacity: 1;
    filter: brightness(1.35);
  }

  .quick-filter-bar-input:focus {
    border-color: var(--accent-primary);
  }

  .goto-time-popover {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem;
    background: var(--bg-panel);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    box-shadow: var(--shadow-lg);
  }

  .goto-time-input {
    background: var(--bg-tag);
    border: 1px solid var(--border-color);
    border-radius: 5px;
    padding: 0.25rem 0.45rem;
    color: var(--text-main);
    font-size: 0.75rem;
    font-family: var(--font-mono, monospace);
    outline: none;
    transition: border-color 0.15s;
  }

  .goto-time-input:focus {
    border-color: var(--accent-primary);
  }

  .goto-time-go {
    background: var(--accent-primary);
    border: none;
    border-radius: 5px;
    padding: 0.3rem 0.7rem;
    color: white;
    font-size: 0.72rem;
    font-weight: 600;
    cursor: pointer;
    transition: filter 0.15s;
  }

  .goto-time-go:hover:not(:disabled) {
    filter: brightness(1.08);
  }

  .goto-time-go:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .jump-flash-ring {
    position: absolute;
    inset: 0;
    border: 2px solid var(--jump-flash, #fff);
    pointer-events: none;
    z-index: 3;
    animation: jump-flash-fade 3s linear forwards;
  }

  @keyframes jump-flash-fade {
    0%, 30% { opacity: 1; }
    100% { opacity: 0; }
  }

`;
document.head.appendChild(style);
