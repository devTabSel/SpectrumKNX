import React, { Fragment, useMemo, useRef, useEffect, useLayoutEffect, useState, useCallback } from 'react';
import { format } from 'date-fns';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Telegram } from '../hooks/useWebSocket';
import { ChevronUp, ChevronDown, Filter, LineChart, X, Clock, Circle, PlusCircle, Download, List, Search } from 'lucide-react';
import { effectiveDeltaContext, type ActiveFilters } from '../types/filters';
import { contextRailSigns } from '../utils/deltaContextExpansion';
import { SendToGaPopover } from './SendToGaPopover';
import { GotoTimeControl } from './GotoTimeControl';
import { getPref, setPref } from '../utils/prefs';
import type { SortKey, SortLevel, SortConfig } from '../utils/sortConfig';
import {
  compileQuickFilters,
  DEFAULT_QUICK_FILTER_COLUMN_ENABLED,
  type QuickCellValue,
  type QuickPatterns,
  type QuickFilterColumnEnabled,
} from '../utils/quickFilter';
import { useTargetColors } from '../utils/targetColors';
import { anchorKey } from '../utils/anchorKey';
import { downloadTelegramsCsv } from '../utils/telegramCsv';
import { adjacentMark } from '../utils/adjacentMark';
import { forceIncludeKeys } from '../utils/forceIncludeKeys';
import { peakRate } from '../utils/peakRate';
import { moveColumn, readColumnOrderPref, writeColumnOrderPref } from '../utils/columnOrder';
import { dptDescriptionLabel, dptKeyLabel } from '../utils/dpt';
import {
  actionableMarkedKeysFrom,
  addMarkReason,
  clearHiddenReasons,
  clearNonHiddenReasons,
  hasMarkReason,
  hiddenKeysFrom,
  markedKeysFrom,
  removeMarkReason,
  setSoleMarkReason,
  syncAutoMarkReason,
  syncContextMarkReasons,
  toggleMarkReason,
  visibleMarkedKeysFrom,
  type MarkReasonsMap,
} from '../utils/markReasons';
import {
  clearAllMarkColorIndices,
  getMarkColorIndex,
  markColorFromIndex,
  nextMarkColorIndex,
  setMarkColorIndex,
  type MarkColorIndexMap,
} from '../utils/markColors';

export type { SortKey, SortLevel, SortConfig };

interface TelegramTableProps {
  telegrams: Telegram[];
  /**
   * Full (unfiltered) buffer used to force-include marked/selected rows that
   * the parent already dropped. Defaults to `telegrams`.
   */
  forceIncludeFrom?: Telegram[];
  visibleColumns: { [key: string]: boolean };
  sortConfig: SortConfig;
  /** `additive` (ctrl/cmd-click) adds/toggles a sort level instead of replacing the whole config (#311). */
  onSort: (key: SortKey, opts?: { additive?: boolean }) => void;
  activeFilters: ActiveFilters;
  onQuickFilter: (key: 'sources' | 'targets' | 'types' | 'dpts', value: string | number) => void;
  onQuickVisualize: (targetAddress: string) => void;
  onQuickLastSeen?: (address: string, mode: 'ga' | 'pa') => void;
  /** Enables the per-row "Send to this GA" quick popover; true only when the bus is writable (#214). */
  canSend?: boolean;

  // Lifted Quick-Filter state (#280, #309, #341)
  quickFilterOpen?: boolean;
  onQuickFilterOpenChange?: (open: boolean) => void;
  quickFilterEnabled?: boolean;
  onQuickFilterEnabledChange?: (enabled: boolean) => void;
  quickPatterns?: QuickPatterns;
  onQuickPatternsChange?: (patterns: QuickPatterns) => void;
  /** Edits the Time-Delta-Context window (#309, #371) — moved here from the
   * filter pane; current values come from `activeFilters.deltaBeforeMs/deltaAfterMs`. */
  onDeltaContextChange?: (deltaBeforeMs: number, deltaAfterMs: number) => void;
  /** Toggles the window on/off without losing the entered values (#318). */
  onDeltaContextEnabledChange?: (enabled: boolean) => void;

  // Lifted Follow / Anchor state (#203, #341)
  listFollow?: boolean;
  onListFollowChange?: (follow: boolean) => void;
  listAnchorKey?: string | null;
  onListAnchorKeyChange?: (key: string | null) => void;
  /** Buffer snapshot is frozen; pause backlog feeds the jump-to-live pill via pillTelegrams. */
  isPaused?: boolean;
  /** User latched Pause (manual); blocks auto live-follow from newest visibility. */
  isManualPause?: boolean;
  /** Telegrams ingested since the buffer snapshot was frozen. */
  pausedCount?: number;
  /**
   * Pause backlog as telegrams (newest first). Used with `pillTelegrams` so the
   * newer-pill and scrollbar thumb count only filter-visible backlog rows.
   */
  pausedTelegrams?: Telegram[];
  /**
   * App-visible published∪paused pool (main filter + context + marks). The
   * table applies Focus/QF/Hidden on top for the newer-pill and thumb. Defaults
   * to `telegrams` (no pause backlog in the count).
   */
  pillTelegrams?: Telegram[];
  /** Reach the frozen live edge while auto-paused: flush without forcing follow. */
  onPauseFlush?: () => void;
  /**
   * Metered flush while auto-paused: reveal the oldest `n` backlog telegrams
   * (snapshot stays frozen otherwise). The table feeds the backlog in a few
   * rows per fill-axis gesture so it scrolls in line by line; the parent
   * resumes playing once the backlog is empty. Without it, the whole backlog
   * is flushed via `onPauseFlush`.
   */
  onPauseReveal?: (n: number) => void;
  /** Newer-pill: force Play + follow + flush so the jump includes the pause buffer. */
  onJumpToLive?: () => void;

  // Lifted row marks (#310): keys of marked telegrams + the most-recently
  // clicked one. Lifted so marks survive main-panel navigation.
  markReasons?: MarkReasonsMap;
  onMarkReasonsChange?: (reasons: MarkReasonsMap) => void;
  /** Per-row colour index into MARK_COLOR_PALETTE (parallel to mark reasons). */
  markColorIndices?: MarkColorIndexMap;
  onMarkColorIndicesChange?: (indices: MarkColorIndexMap) => void;
  lastMarkedKey?: string | null;
  onLastMarkedKeyChange?: (key: string | null) => void;

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

  /** Keys of visible rows that do not match the active filters (context
   * classification). Independent of per-row context flags — flagging only
   * anchors a window, it does not clear this membership (#343). */
  contextKeys?: ReadonlySet<string>;

  /** Center this telegram in the visible list. `id` changes on every request
   * so repeating the same telegram jumps again. The row is marked only when
   * that exact telegram is still in the filtered list. */
  gotoRequest?: ListGotoRequest | null;

  /**
   * Bumped by the parent when an outside action changes what the list shows
   * (e.g. main filter on/off or filter edits). Each bump pins + flashes the
   * preferred row (last selected → first selected → top).
   */
  viewChangeToken?: number;

  /** Switches the Focus panel to Devices (`pa`) or Group Addresses (`ga`). */
  onFocusCategorySelect?: (category: 'ga' | 'pa') => void;
  /** Addresses flagged for the Telegram List in the Focus panel. */
  focusListAddresses?: string[];
  sourceFocusOnly?: boolean;
  onSourceFocusOnlyChange?: (enabled: boolean) => void;
  targetFocusOnly?: boolean;
  onTargetFocusOnlyChange?: (enabled: boolean) => void;
  /** Disables the source/target focus filter toggles (Focus panel reset). */
  focusFilterDisabled?: boolean;
}

export interface ListGotoRequest {
  id: number;
  telegram: Telegram;
}

type ColId = 'time' | 'delta' | 'source' | 'target' | 'type' | 'dpt' | 'value';

const EMPTY_CELL: QuickCellValue = { top: '', bottom: '' };

interface ColumnDef {
  id: ColId;
  label: string;
  sortKey?: SortKey;
  defaultWidth: number;
  minWidth: number;
  /** key in visibleColumns that toggles this column (undefined = always visible) */
  visibleKey?: string;
}

// Ordered column definitions — drives both header and body so they cannot drift.
const COLUMNS: ColumnDef[] = [
  { id: 'time', label: 'TIME', sortKey: 'timestamp', defaultWidth: 120, minWidth: 90 },
  { id: 'delta', label: 'Δt', defaultWidth: 100, minWidth: 60, visibleKey: 'delta' },
  { id: 'source', label: 'SOURCE', sortKey: 'source_address', defaultWidth: 190, minWidth: 90 },
  { id: 'target', label: 'TARGET', sortKey: 'target_address', defaultWidth: 230, minWidth: 90 },
  { id: 'type', label: 'TYPE', sortKey: 'simplified_type', defaultWidth: 95, minWidth: 70, visibleKey: 'type' },
  { id: 'dpt', label: 'DPT', sortKey: 'dpt_name', defaultWidth: 150, minWidth: 80, visibleKey: 'dpt' },
  { id: 'value', label: 'VALUE', sortKey: 'value_numeric', defaultWidth: 220, minWidth: 120 },
];

const COLUMN_WIDTHS_PREF = 'columnWidths';

// Fixed width of the left-edge icon rail, shared by quickinfo/header/quickfilter/rows.
// Wide enough for the centred colour swatch (14px) in the middle third.
const RAIL_WIDTH = '1.25rem';
const RAIL_COLOR_SWATCH_SIZE = 14;
// Mouse-selection washes: stronger for the last selected row.
const MOUSE_LATEST_WASH = 'color-mix(in srgb, var(--accent-primary) 34%, transparent)';
const MOUSE_SELECTED_WASH = 'color-mix(in srgb, var(--accent-primary) 16%, transparent)';
// Soft Time-Delta-Context row wash — also the rail when a context mark is highlighted.
const CONTEXT_WASH = 'color-mix(in srgb, var(--warning, #f59e0b) 12%, transparent)';

// Keys that scroll a list. Modifiers must not count: ctrl-click on a toolbar
// button is not the user scrolling (#435).
const SCROLL_KEYS = new Set(['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' ']);

const getTypeColor = (type?: string | null) => {
  switch (type) {
    case 'Write': return 'var(--accent-primary)';
    case 'Read': return 'var(--warning-text)';
    case 'Response': return 'var(--success)';
    default: return 'var(--text-dim)';
  }
};

const getDPTColor = (dpt_main: number | null) => {
  if (dpt_main === 1) return 'var(--dpt-1, #818cf8)';
  if (dpt_main === 5) return 'var(--dpt-5, #34d399)';
  if (dpt_main === 9) return 'var(--dpt-9, #fb923c)';
  return 'var(--dpt-unknown, #6b7280)';
};

const getDPTLabel = (dpt_main: number | null) => {
  if (dpt_main === 1) return 'DPT 1.x – Binary / Switch';
  if (dpt_main === 5) return 'DPT 5.x – 8-bit unsigned';
  if (dpt_main === 9) return 'DPT 9.x – 2-byte float';
  if (dpt_main != null) return `DPT ${dpt_main}.x`;
  return 'Unknown DPT';
};

const SOURCE_NAME_TEXT_STYLE: React.CSSProperties = {
  fontSize: '0.7rem',
  color: 'var(--text-main)',
  fontWeight: 500,
  marginTop: '0.15rem',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

type TelegramRow = Telegram & { deltaStr: string | null; deltaNextStr: string | null; deltaMs: number | null };

const formatDeltaMs = (diffMs: number, sign: '+' | '-'): string => {
  const mm = String(Math.floor(diffMs / 60000)).padStart(2, '0');
  const ss = String(Math.floor((diffMs % 60000) / 1000)).padStart(2, '0');
  const ms = String(diffMs % 1000).padStart(3, '0');
  return `${sign} ${mm}:${ss}.${ms}`;
};

const cellPadding = '0.75rem 1rem'; // Unified padding for all cells

const ROW_ESTIMATE = 85; // matches the virtualizer's estimateSize
/** Fill-axis overscroll rubber; rubber-bands back to the edge telegram. */
const FILL_RUBBER_PX = Math.round(ROW_ESTIMATE / 2);
const EDGE_SCROLL_EPS = 20;
/**
 * Most pause-backlog rows revealed per step. Must stay below the virtualizer's
 * overscan so the row pinned across the insert is still rendered and can be
 * re-positioned from its real DOM rect (no estimate-based refind).
 */
const REVEAL_MAX = 8;
/** Visual scrollbar track width (matches header paddingRight / index.css). */
const LIST_SB_WIDTH_PX = 8;
const LIST_SB_MIN_THUMB_PX = 20;
// Floating edge pills (newer / marks): inset from the live edge, then half a
// single-line pill height so 1- and 2-line marks stay on the same center as newer.
const EDGE_PILL_INSET = '1rem';
const EDGE_PILL_HALF = '0.85rem';
const EDGE_PILL_CENTER = `calc(${EDGE_PILL_INSET} + ${EDGE_PILL_HALF})`;

function timeMs(timestamp: string): number {
  return new Date(timestamp).getTime();
}

/**
 * Merged rows completely scrolled out of the viewport toward the fill axis
 * (partial overlap does not count). `liveEdge === 'top'` → rows fully above
 * the viewport; `'bottom'` → fully below. Walks from the fill edge so
 * unmeasured sizes stop the scan rather than inventing offsets.
 */
function countFillAxisScrolledOut(
  rowCount: number,
  liveEdge: 'top' | 'bottom',
  scrollTop: number,
  clientHeight: number,
  getStart: (index: number) => number | undefined,
  getSize: (index: number) => number | undefined,
): number {
  if (rowCount === 0 || clientHeight <= 0) return 0;
  const viewTop = scrollTop;
  const viewBottom = scrollTop + clientHeight;
  let count = 0;
  if (liveEdge === 'top') {
    for (let i = 0; i < rowCount; i++) {
      const start = getStart(i);
      const size = getSize(i);
      if (start === undefined || size === undefined || size <= 0) break;
      if (start + size <= viewTop) count++;
      else break;
    }
  } else {
    for (let i = rowCount - 1; i >= 0; i--) {
      const start = getStart(i);
      const size = getSize(i);
      if (start === undefined || size === undefined || size <= 0) break;
      if (start >= viewBottom) count++;
      else break;
    }
  }
  return count;
}

// ── Quick filter bar (#271, #309) ────────────────────────────────────────────
// Two rows per applicable column: a top pattern row (address/DPT-key patterns
// with wildcards and ranges, or a from/range bound) and a bottom text row
// (regex/literal, or a to/range bound). TYPE only uses the top row (a
// comma-separated fixed-value list); DELTA doesn't participate here at all —
// it edits the Time-Delta-Context window instead (#371).


export const TelegramTable: React.FC<TelegramTableProps> = ({
  telegrams, forceIncludeFrom, visibleColumns, sortConfig, onSort, activeFilters, onQuickFilter, onQuickVisualize, onQuickLastSeen, canSend,
  quickFilterOpen, onQuickFilterOpenChange, quickFilterEnabled, onQuickFilterEnabledChange, quickPatterns, onQuickPatternsChange,
  onDeltaContextChange,
  onDeltaContextEnabledChange,
  listFollow, onListFollowChange, listAnchorKey, onListAnchorKeyChange,
  isPaused = false, isManualPause = false, pausedCount = 0,
  pausedTelegrams = [], pillTelegrams,
  onPauseFlush, onPauseReveal, onJumpToLive,
  markReasons: markReasonsProp, onMarkReasonsChange,
  markColorIndices: markColorIndicesProp, onMarkColorIndicesChange,
  lastMarkedKey, onLastMarkedKeyChange,
  infoBarOpen, onInfoBarOpenChange,
  flaggedKeys, onFlaggedKeysChange,
  contextForAllMatches, onContextForAllMatchesChange,
  contextKeys,
  gotoRequest,
  viewChangeToken,
  onFocusCategorySelect,
  focusListAddresses,
  sourceFocusOnly: sourceFocusOnlyProp,
  onSourceFocusOnlyChange,
  targetFocusOnly: targetFocusOnlyProp,
  onTargetFocusOnlyChange,
  focusFilterDisabled = false,
}) => {
  const parentRef = useRef<HTMLDivElement>(null);
  /** Inner virtualizer canvas — used for clamped-pin settle transforms. */
  const listContentRef = useRef<HTMLDivElement>(null);
  // Bumped by display-changing actions; layout effect restores the pending pin.
  const [displayPinNonce, setDisplayPinNonce] = useState(0);
  /** Viewport snapshot taken before a display change (key + offset from list top). */
  const pendingDisplayPinRef = useRef<{ key: string; offset: number } | null>(null);
  /** Last known viewport offset of the preferred selection (survives App-driven refilters). */
  const lastKnownPreferredPinRef = useRef<{ key: string; offset: number } | null>(null);
  /** Skip destructive refilter handling in the list-update layout effect once. */
  const suppressListRefilterEffectRef = useRef(false);
  const requestDisplayPinRef = useRef<() => void>(() => {});

  // ── Column widths (persisted, shared across live & history views) ──
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    const defaults: Record<string, number> = {};
    for (const c of COLUMNS) defaults[c.id] = c.defaultWidth;
    try {
      const saved = getPref(COLUMN_WIDTHS_PREF);
      if (saved) return { ...defaults, ...JSON.parse(saved) };
    } catch {
      // Ignore malformed stored value
    }
    return defaults;
  });

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

  const widthFor = useCallback(
    (id: ColId) => columnWidths[id] ?? COLUMNS.find(c => c.id === id)!.defaultWidth,
    [columnWidths],
  );

  const persistWidths = useCallback((widths: Record<string, number>) => {
    setPref(COLUMN_WIDTHS_PREF, JSON.stringify(widths));
  }, []);

  const handleResizeStart = useCallback((e: React.MouseEvent, col: ColumnDef) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = widthFor(col.id);
    const onMove = (ev: MouseEvent) => {
      const next = Math.max(col.minWidth, Math.round(startWidth + (ev.clientX - startX)));
      setColumnWidths(prev => ({ ...prev, [col.id]: next }));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      setColumnWidths(prev => { persistWidths(prev); return prev; });
    };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [widthFor, persistWidths]);

  // Double-click a handle to reset that column to its default width.
  const handleResetWidth = useCallback((col: ColumnDef) => {
    setColumnWidths(prev => {
      const next = { ...prev, [col.id]: col.defaultWidth };
      persistWidths(next);
      return next;
    });
  }, [persistWidths]);

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

  const [quickColumnEnabled, setQuickColumnEnabled] = useState<QuickFilterColumnEnabled>(
    () => ({ ...DEFAULT_QUICK_FILTER_COLUMN_ENABLED }),
  );

  /** Updates one row (top/bottom) of a quick-filter cell, preserving the other row. */
  const patternPinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setQuickCell = useCallback((id: ColId, row: 'top' | 'bottom', text: string) => {
    setQuickPatterns(prev => ({ ...prev, [id]: { ...(prev[id] ?? EMPTY_CELL), [row]: text } }));
    // Debounce pin/flash while typing so each keystroke does not thrash the list.
    if (patternPinTimerRef.current) clearTimeout(patternPinTimerRef.current);
    patternPinTimerRef.current = setTimeout(() => requestDisplayPinRef.current(), 250);
  }, [setQuickPatterns]);

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

  const isQuickColumnEnabled = useCallback(
    (id: ColId) => quickColumnEnabled[id] !== false,
    [quickColumnEnabled],
  );

  const toggleQuickColumnEnabled = useCallback((id: ColId) => {
    setQuickColumnEnabled(prev => ({ ...prev, [id]: prev[id] === false }));
  }, []);

  const handleQuickColumnToggleClick = useCallback((e: React.MouseEvent, id: ColId) => {
    if (e.ctrlKey || e.metaKey) {
      // DELTA: ctrl toggles the Time-Delta-Context window without clearing values (#318).
      if (id === 'delta') {
        onDeltaContextEnabledChange?.(!activeFilters.deltaContextEnabled);
        requestDisplayPinRef.current();
        return;
      }
      clearQuickColumnInputs(id);
      requestDisplayPinRef.current();
      return;
    }
    toggleQuickColumnEnabled(id);
    requestDisplayPinRef.current();
  }, [clearQuickColumnInputs, toggleQuickColumnEnabled, onDeltaContextEnabledChange, activeFilters.deltaContextEnabled]);

  const handleQuickEnabledToggleClick = useCallback((e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      clearAllQuickInputs();
      requestDisplayPinRef.current();
      return;
    }
    setQuickEnabled(prev => !prev);
    requestDisplayPinRef.current();
  }, [clearAllQuickInputs, setQuickEnabled]);

  const toggleQuickOpen = () => {
    const nextOpen = !quickOpen;
    setQuickOpen(nextOpen);
    setQuickEnabled(nextOpen);
    requestDisplayPinRef.current();
  };

  // ── Quick info bar (#311): collapsible summary row above the header. ──────
  const [internalInfoBarOpen, setInternalInfoBarOpen] = useState(false);
  const infoOpen = infoBarOpen ?? internalInfoBarOpen;
  const toggleInfoOpen = useCallback(() => {
    const next = !infoOpen;
    setInternalInfoBarOpen(next);
    onInfoBarOpenChange?.(next);
  }, [infoOpen, onInfoBarOpenChange]);
  const showInfoBarToggle = !infoOpen;

  // ── Focus filter toggles (header SOURCE/TARGET) ───────────────────────────
  const [internalSourceFocusOnly, setInternalSourceFocusOnly] = useState(
    () => getPref('telegramTable.sourceFocusOnly') === '1',
  );
  const [internalTargetFocusOnly, setInternalTargetFocusOnly] = useState(
    () => getPref('telegramTable.targetFocusOnly') === '1',
  );
  const sourceFocusOnly = sourceFocusOnlyProp ?? internalSourceFocusOnly;
  const targetFocusOnly = targetFocusOnlyProp ?? internalTargetFocusOnly;
  const setSourceFocusOnly = useCallback((next: boolean) => {
    if (onSourceFocusOnlyChange) onSourceFocusOnlyChange(next);
    else setInternalSourceFocusOnly(next);
  }, [onSourceFocusOnlyChange]);
  const setTargetFocusOnly = useCallback((next: boolean) => {
    if (onTargetFocusOnlyChange) onTargetFocusOnlyChange(next);
    else setInternalTargetFocusOnly(next);
  }, [onTargetFocusOnlyChange]);
  useEffect(() => {
    setPref('telegramTable.sourceFocusOnly', sourceFocusOnly ? '1' : '0');
  }, [sourceFocusOnly]);
  useEffect(() => {
    setPref('telegramTable.targetFocusOnly', targetFocusOnly ? '1' : '0');
  }, [targetFocusOnly]);

  // ── Hide repeated values when a non-time column is sorted (alt-click) ─────
  const [hideRepeatedOverrides, setHideRepeatedOverrides] = useState<Partial<Record<ColId, boolean>>>({});
  const isHideRepeatedWhenSortedEnabled = useCallback((id: ColId): boolean => {
    const override = hideRepeatedOverrides[id];
    if (override !== undefined) return override;
    return true;
  }, [hideRepeatedOverrides]);
  const toggleHideRepeatedWhenSortedForColumn = useCallback((id: ColId) => {
    if (id === 'time' || id === 'delta') return;
    setHideRepeatedOverrides(prev => {
      const current = prev[id] ?? true;
      return { ...prev, [id]: !current };
    });
  }, []);

  // ── Row marks (#310) ─────────────────────────────────────────────────────
  // Controlled when App lifts them (so marks survive navigation), otherwise a
  // local fallback. Keys carry one or more MarkReasons (mouse / goto /
  // context / manual). `lastMarkedKey` may legitimately be null, so distinguish
  // "not lifted" (undefined) from "lifted, nothing last" (null).
  const [internalMarkReasons, setInternalMarkReasons] = useState<MarkReasonsMap>({});
  const [internalLastMarkedKey, setInternalLastMarkedKey] = useState<string | null>(null);

  const markReasons = markReasonsProp ?? internalMarkReasons;
  const markReasonsRef = useRef(markReasons);
  markReasonsRef.current = markReasons;
  const setMarkReasons = useCallback((val: MarkReasonsMap | ((prev: MarkReasonsMap) => MarkReasonsMap)) => {
    const prev = markReasonsRef.current;
    const next = typeof val === 'function' ? val(prev) : val;
    if (next === prev) return;
    markReasonsRef.current = next;
    setInternalMarkReasons(next);
    onMarkReasonsChange?.(next);
  }, [onMarkReasonsChange]);

  const [internalMarkColorIndices, setInternalMarkColorIndices] = useState<MarkColorIndexMap>({});
  const markColorIndices = markColorIndicesProp ?? internalMarkColorIndices;
  const markColorIndicesRef = useRef(markColorIndices);
  markColorIndicesRef.current = markColorIndices;
  const setMarkColorIndices = useCallback((val: MarkColorIndexMap | ((prev: MarkColorIndexMap) => MarkColorIndexMap)) => {
    const prev = markColorIndicesRef.current;
    const next = typeof val === 'function' ? val(prev) : val;
    if (next === prev) return;
    markColorIndicesRef.current = next;
    setInternalMarkColorIndices(next);
    onMarkColorIndicesChange?.(next);
  }, [onMarkColorIndicesChange]);

  const lastMarked = lastMarkedKey !== undefined ? lastMarkedKey : internalLastMarkedKey;
  const lastMarkedRef = useRef(lastMarked);
  lastMarkedRef.current = lastMarked;
  const setLastMarked = useCallback((val: string | null) => {
    setInternalLastMarkedKey(val);
    onLastMarkedKeyChange?.(val);
  }, [onLastMarkedKeyChange]);

  // `auto` mark on the latest selected row; cleared when latest moves away
  // unless the user promoted it to `manual` via the rail. Colour stays.
  const syncAutoForLatest = useCallback((
    map: MarkReasonsMap,
    newLatest: string | null,
  ): MarkReasonsMap => syncAutoMarkReason(map, newLatest), []);

  const markedKeysList = useMemo(() => markedKeysFrom(markReasons), [markReasons]);
  // Mouse-selected keys — rail colour / mark / context actions apply to this set
  // when the clicked row is part of the selection.
  const mouseSelectedKeys = useMemo(
    () => Object.keys(markReasons).filter(k => hasMarkReason(markReasons, k, 'mouse')),
    [markReasons],
  );
  const targetsForSelectionAction = useCallback((key: string) => {
    if (mouseSelectedKeys.includes(key)) return new Set(mouseSelectedKeys);
    return new Set([key]);
  }, [mouseSelectedKeys]);
  const actionableMarkedKeys = useMemo(
    () => actionableMarkedKeysFrom(markReasons),
    [markReasons],
  );
  const visibleMarkedKeys = useMemo(
    () => visibleMarkedKeysFrom(markReasons),
    [markReasons],
  );
  const hiddenMarkedKeys = useMemo(
    () => hiddenKeysFrom(markReasons),
    [markReasons],
  );
  const markedSet = useMemo(() => new Set(markedKeysList), [markedKeysList]);
  const actionableMarkedSet = useMemo(
    () => new Set(actionableMarkedKeys),
    [actionableMarkedKeys],
  );
  const visibleMarkedSet = useMemo(() => new Set(visibleMarkedKeys), [visibleMarkedKeys]);
  const hiddenMarkedSet = useMemo(() => new Set(hiddenMarkedKeys), [hiddenMarkedKeys]);
  // Two-line pill: one nav button per row; single-line keeps prev+next.
  const twoLineMarksPill = actionableMarkedKeys.length > 0 && hiddenMarkedKeys.length > 0;
  // Row the prev/next-mark jumps continue from (#442); null after a user scroll.
  const markCursorRef = useRef<string | null>(null);
  // Plain mousedrag is text selection: record pointer down so click can skip
  // marking when the pointer moved (a mark re-render would wipe the selection).
  const markPointerRef = useRef<{ x: number; y: number } | null>(null);
  // The selected row for scroll anchoring (#435): the last-clicked one, as long
  // as it is still marked. A ref, because scroll handlers read it outside render.
  const selectedKeyRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    selectedKeyRef.current = lastMarked && visibleMarkedSet.has(lastMarked) ? lastMarked : null;
  }, [lastMarked, visibleMarkedSet]);

  // Context keys dismissed by Clear — stay unmarked until they leave the
  // soft context window (then a later re-entry can sync again).
  const dismissedContextKeysRef = useRef<Set<string>>(new Set());

  // Clear visible marks; keep `hidden`. Soft context is dismissed until the window changes.
  const clearMarks = useCallback(() => {
    if (contextKeys) {
      for (const k of contextKeys) dismissedContextKeysRef.current.add(k);
    }
    setMarkReasons(prev => clearNonHiddenReasons(prev));
    setMarkColorIndices(clearAllMarkColorIndices);
    setLastMarked(null);
    requestDisplayPinRef.current();
  }, [setMarkReasons, setMarkColorIndices, setLastMarked, contextKeys]);

  const clearHidden = useCallback(() => {
    setMarkReasons(prev => clearHiddenReasons(prev));
    requestDisplayPinRef.current();
  }, [setMarkReasons]);

  // Keep `context` reasons in sync with the soft context window (#319),
  // skipping keys the user cleared via the marks pill.
  useEffect(() => {
    const dismissed = dismissedContextKeysRef.current;
    for (const k of [...dismissed]) {
      if (!contextKeys?.has(k)) dismissed.delete(k);
    }
    const syncKeys = new Set<string>();
    if (contextKeys) {
      for (const k of contextKeys) {
        if (!dismissed.has(k)) syncKeys.add(k);
      }
    }
    setMarkReasons(prev => {
      const next = syncContextMarkReasons(prev, syncKeys);
      return next === prev ? prev : next;
    });
  }, [contextKeys, setMarkReasons]);

  // ── Per-message Time-Delta-Context flags (#319) ─────────────────────────
  const [internalFlaggedKeys, setInternalFlaggedKeys] = useState<string[]>([]);
  const flaggedKeysList = flaggedKeys ?? internalFlaggedKeys;
  const setFlaggedKeysList = useCallback((val: string[]) => {
    setInternalFlaggedKeys(val);
    onFlaggedKeysChange?.(val);
  }, [onFlaggedKeysChange]);
  const flaggedSet = useMemo(() => new Set(flaggedKeysList), [flaggedKeysList]);

  // Colours given to target filters (#509) apply while the address is in the
  // filter, switched off or not; a colour of a removed filter is kept for when
  // it comes back, but marks nothing meanwhile.
  const targetColors = useTargetColors();
  const activeTargetColors = useMemo(() => {
    const active: Record<string, string> = {};
    for (const address of activeFilters.targets) {
      if (targetColors[address]) active[address] = targetColors[address];
    }
    return active;
  }, [targetColors, activeFilters.targets]);
  const [internalContextForAll, setInternalContextForAll] = useState(true);
  const contextForAll = contextForAllMatches ?? internalContextForAll;
  const setContextForAll = useCallback((val: boolean) => {
    setInternalContextForAll(val);
    onContextForAllMatchesChange?.(val);
  }, [onContextForAllMatchesChange]);

  // Whether a row anchors a context window: flagged, or — in the global "all"
  // state — any row that is not itself only there as context.
  const anchorsContext = useCallback(
    (key: string) => flaggedSet.has(key) || (contextForAll && !contextKeys?.has(key)),
    [flaggedSet, contextForAll, contextKeys]
  );

  const { before: deltaBeforeMs, after: deltaAfterMs } = effectiveDeltaContext(activeFilters);

  // Focus filter runs before quick-filter once the parent supplies a focus list.
  // Without `focusListAddresses` the header toggles stay visual-only (no Focus
  // panel wired yet). An empty list means no matches.
  const focusFilteringActive =
    (sourceFocusOnly || targetFocusOnly) && !focusFilterDisabled && focusListAddresses != null;

  // Context rows and flagged anchors are already the result of the
  // Time-Delta-Context expansion, which the parent runs on quick-filter
  // matches too. Filtering them here again would drop the context (#520).
  // Visible marks (≠ hidden) are always kept; `hidden` marks are always dropped.
  // Prefer `forceIncludeFrom` (full buffer) so marks survive even when the parent
  // already dropped them from `telegrams`. List pool stays published-only so
  // pause backlog never leaks into rows; pill pool adds paused for mark restore.
  const applyTableVisibility = useCallback((rows: Telegram[], pool: Telegram[]) => {
    let list = rows;
    if (focusFilteringActive) {
      const focusListSet = new Set(focusListAddresses);
      list = list.filter(t =>
        (!sourceFocusOnly || focusListSet.has(t.source_address)) &&
        (!targetFocusOnly || focusListSet.has(t.target_address)),
      );
    }
    if (quickOpen && quickEnabled) {
      const matches = compileQuickFilters(currentPatterns, quickColumnEnabled);
      const flagsActive = activeFilters.deltaContextEnabled;
      list = list.filter(t => {
        if (matches(t)) return true;
        const key = anchorKey(t);
        return !!contextKeys?.has(key) || (flagsActive && flaggedSet.has(key));
      });
    }
    list = list.filter(t => !hiddenMarkedSet.has(anchorKey(t)));
    return forceIncludeKeys(pool, list, anchorKey, visibleMarkedSet)
      .filter(t => !hiddenMarkedSet.has(anchorKey(t)));
  }, [
    focusFilteringActive, focusListAddresses, sourceFocusOnly, targetFocusOnly,
    quickOpen, quickEnabled, currentPatterns, quickColumnEnabled, contextKeys,
    flaggedSet, activeFilters.deltaContextEnabled, hiddenMarkedSet, visibleMarkedSet,
  ]);

  const listForcePool = forceIncludeFrom ?? telegrams;
  // Zebra parity follows this pool index (not the compacted visible index), so
  // filter / QF toggles do not recolour surviving telegrams.
  const stripeIndexByKey = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < listForcePool.length; i++) {
      map.set(anchorKey(listForcePool[i]), i);
    }
    return map;
  }, [listForcePool]);
  const quickFiltered = useMemo(
    () => applyTableVisibility(telegrams, listForcePool),
    [applyTableVisibility, telegrams, listForcePool],
  );

  const pillForcePool = useMemo(() => {
    if (pausedTelegrams.length === 0) return listForcePool;
    const seen = new Set(listForcePool.map(anchorKey));
    const extra = pausedTelegrams.filter(t => !seen.has(anchorKey(t)));
    return extra.length === 0 ? listForcePool : listForcePool.concat(extra);
  }, [listForcePool, pausedTelegrams]);

  const pillVisible = useMemo(
    () => applyTableVisibility(pillTelegrams ?? telegrams, pillForcePool),
    [applyTableVisibility, pillTelegrams, telegrams, pillForcePool],
  );

  const pausedKeySet = useMemo(
    () => new Set(pausedTelegrams.map(anchorKey)),
    [pausedTelegrams],
  );

  const visiblePausedCount = useMemo(() => {
    if (pausedKeySet.size === 0) return 0;
    let n = 0;
    for (const t of pillVisible) {
      if (pausedKeySet.has(anchorKey(t))) n++;
    }
    return n;
  }, [pillVisible, pausedKeySet]);

  const timeSortDirection: 'asc' | 'desc' | null =
    sortConfig[0]?.key === 'timestamp' ? sortConfig[0].direction : null;

  // Time deltas between consecutive rows, by visual (sorted) order — always
  // computed regardless of sort column, respecting whatever hierarchy is
  // active (#311). Top row = gap to previous, bottom = gap to next.
  const naturalTelegramRows = useMemo<TelegramRow[]>(() => {
    if (quickFiltered.length === 0) return [];
    const timestamps = quickFiltered.map(t => new Date(t.timestamp).getTime());
    const minTs = Math.min(...timestamps);
    const maxTs = Math.max(...timestamps);

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
  }, [quickFiltered, timeSortDirection]);

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
    requestDisplayPinRef.current();
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
  // The sortConfig effect pins + flashes once the new order is committed.
  const handleColumnSort = useCallback((key: SortKey, opts?: { additive?: boolean }) => {
    exitDeltaSort();
    onSort(key, opts);
  }, [exitDeltaSort, onSort]);

  const telegramRows = deltaSortActive && deltaFrozenRows ? deltaFrozenRows : naturalTelegramRows;

  // Timestamps of rows that currently anchor a context window (active context
  // button / all-matches). Used for ∧/∨ rail signs on context-only rows.
  const contextAnchorTimestamps = useMemo(() => {
    if (!contextKeys?.size || (deltaBeforeMs <= 0 && deltaAfterMs <= 0)) return [] as number[];
    const out: number[] = [];
    for (const t of telegramRows) {
      if (anchorsContext(anchorKey(t))) out.push(new Date(t.timestamp).getTime());
    }
    return out;
  }, [telegramRows, contextKeys, anchorsContext, deltaBeforeMs, deltaAfterMs]);

  // ── Global Time-Delta-Context tristate (#318, #319) ─────────────────────────
  // "all": every filter match anchors a window, including telegrams still to
  // arrive. Otherwise it reflects the per-message flags among the visible
  // rows: "some" or "none". Plain click switches none -> all and some/all ->
  // none, overriding the per-message flags. Ctrl/cmd-click on mixed ("some")
  // promotes to all; on "all" with unflagged visible context rows, flags those
  // context rows so their buttons are set too. Never toggles the window on/off.
  const deltaFlagState: 'none' | 'some' | 'all' = useMemo(() => {
    if (contextForAll) return 'all';
    if (flaggedSet.size === 0) return 'none';
    return telegramRows.some(t => flaggedSet.has(anchorKey(t))) ? 'some' : 'none';
  }, [telegramRows, flaggedSet, contextForAll]);

  const handleDeltaToggleClick = useCallback((e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      if (deltaFlagState === 'some') {
        setContextForAll(true);
        setFlaggedKeysList([]);
        requestDisplayPinRef.current();
        return;
      }
      if (deltaFlagState === 'all' && contextKeys?.size) {
        const unflaggedContext = telegramRows
          .map(t => anchorKey(t))
          .filter(k => contextKeys.has(k) && !flaggedSet.has(k));
        if (unflaggedContext.length > 0) {
          setFlaggedKeysList([...new Set([...flaggedKeysList, ...unflaggedContext])]);
          requestDisplayPinRef.current();
        }
      }
      return;
    }
    setContextForAll(deltaFlagState === 'none');
    setFlaggedKeysList([]);
    requestDisplayPinRef.current();
  }, [
    deltaFlagState,
    setFlaggedKeysList,
    setContextForAll,
    contextKeys,
    telegramRows,
    flaggedSet,
    flaggedKeysList,
  ]);

  // ── Quick info bar metrics (#311) ───────────────────────────────────────────
  // Summarizes the currently visible (sorted + filtered) rows; oldest/newest
  // and min/max Δt jump to their row via gotoIndex regardless of sort order.
  const infoMetrics = useMemo(() => {
    // Keep the bar usable when the view is empty (no rows / all filtered out).
    if (telegramRows.length === 0) {
      return {
        count: 0,
        oldestIdx: -1,
        newestIdx: -1,
        minDeltaIdx: -1,
        maxDeltaIdx: -1,
        peak: null,
        sourceCount: 0,
        targetCount: 0,
        dptCount: 0,
        typeCounts: [] as [string, number][],
        contextCount: 0,
      };
    }
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
      if (contextKeys?.has(anchorKey(t))) contextCount++;
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
  }, [telegramRows, contextKeys]);

  // ── ETS-style scroll anchoring (#202) ───────────────────────────────────────
  // Auto-scroll only while the scrollbar sits at the live edge (top for
  // newest-first, bottom for oldest-first). Scrolled away, the viewed rows are
  // anchored. The jump-to-live pill counts telegrams newer than the newest one
  // on screen, so it stays hidden while that newest telegram is visible —
  // which is always the case in live mode. Only meaningful for the timestamp
  // sort, where the live edge exists.
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

  // Fill-axis rubber (½ row) as virtualizer padding — pause backlog stays in the
  // newer-pill only, not in scrollHeight / thumb.
  const liveFillRubberPx = telegramRows.length > 0 ? FILL_RUBBER_PX : 0;

  // Opposite-edge spacer (DOM sibling): settle pad when the list is shorter than
  // the viewport (keep ≥1 full row) + ½-row rubber overscroll.
  const [viewportHeight, setViewportHeight] = useState(0);
  useLayoutEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const measure = () => setViewportHeight(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  type ScrollGeom = {
    fillRubberPx: number;
    oppositeSpacerPx: number;
    /** Virtualizer block height at lock — keeps scrollHeight stable on prepend. */
    virtTotalPx: number;
  };
  // Snapshot while scrollbar is held or rubber is active so scrollHeight / spacer
  // do not wobble from live prepend or remeasure mid-gesture.
  const [frozenGeom, setFrozenGeom] = useState<ScrollGeom | null>(null);
  const fillRubberPx = frozenGeom?.fillRubberPx ?? liveFillRubberPx;

  const virtualizer = useVirtualizer({
    count: telegramRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_ESTIMATE, // Better estimate for multi-line rows
    overscan: 10,
    paddingStart: liveEdge === 'top' ? fillRubberPx : 0,
    paddingEnd: liveEdge === 'bottom' ? fillRubberPx : 0,
    getItemKey: (index) => {
      const t = telegramRows[index];
      // Match `anchorKey` — falsy `raw_hex` must not fall back to index or
      // filter/reorders recycle the wrong virtual row identity.
      return anchorKey(t);
    },
  });

  const liveVirtTotalPx = virtualizer.getTotalSize();
  const virtTotalPx = frozenGeom?.virtTotalPx ?? liveVirtTotalPx;
  const rowsHeight = Math.max(0, liveVirtTotalPx - fillRubberPx);
  const contentWithFill = fillRubberPx + rowsHeight;
  const oppositeSettlePadPx =
    viewportHeight > 0 && contentWithFill < viewportHeight
      ? Math.max(0, viewportHeight - ROW_ESTIMATE)
      : 0;
  const oppositeRubberPx = telegramRows.length > 0 ? FILL_RUBBER_PX : 0;
  const liveOppositeSpacerPx = oppositeSettlePadPx + oppositeRubberPx;
  const liveGeomRef = useRef<ScrollGeom>({
    fillRubberPx: liveFillRubberPx,
    oppositeSpacerPx: liveOppositeSpacerPx,
    virtTotalPx: liveVirtTotalPx,
  });
  liveGeomRef.current = {
    fillRubberPx: liveFillRubberPx,
    oppositeSpacerPx: liveOppositeSpacerPx,
    virtTotalPx: liveVirtTotalPx,
  };
  // Short-list settle pad held across a metered reveal: the pad drops to 0 the
  // moment the growing list exceeds the viewport, which would clamp scrollTop
  // and snap the viewport. Kept until scrollTop fits the live geometry again.
  const [stickyOppositeSpacerPx, setStickyOppositeSpacerPx] = useState(0);
  const oppositeSpacerPx =
    frozenGeom?.oppositeSpacerPx ?? Math.max(liveOppositeSpacerPx, stickyOppositeSpacerPx);
  const rubberBandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rubberBandRafRef = useRef<number | null>(null);
  /** Active rubber-band animation; survives live prepends (no retarget). */
  const rubberAnimRef = useRef<{
    side: 'fill' | 'opposite';
    from: number;
    to: number;
    t0: number;
    duration: number;
  } | null>(null);
  const atEdgeRef = useRef(listFollow ?? true);
  // After an intentional unfollow, ignore newestFullyVisible until the newest
  // row has left full visibility once — otherwise a short list or edge-row
  // click would re-enable follow immediately.
  const detachedFromEdgeRef = useRef(!(listFollow ?? true));
  // Last positive newer-pill count; held across the flush gap until a real
  // newerCount is measured again. Overlay thumb reads the same value.
  const stickyNewerCountRef = useRef(0);
  const displayNewerCountRef = useRef(0);
  // Mirrors atEdgeRef for render. Pill still shows when a backlog exists.
  const [followingLive, setFollowingLive] = useState(listFollow ?? true);
  // Armed on every pause flush; forces pin (never scrollToEdge) until the
  // merged list actually changes the live-edge key.
  const flushPinRef = useRef(false);
  // In-flight metered reveal: backlog size when requested and rows asked for.
  // Lets the merge effect tell "reveal landed but every row was filtered out"
  // (pausedCount dropped, edge key unchanged) from an unrelated publish.
  const revealRef = useRef<{ before: number; n: number } | null>(null);
  // Newer-pill jump: next merge must scrollToEdge (not pin) after Play/flush.
  const jumpToLiveRef = useRef(false);
  // The row held still while anchored, and its offset from the scroll-container
  // top: the selected (last-marked) row while it is on screen (#435), otherwise
  // the top-most visible one. Captured from user scrolls and row clicks only.
  const anchorRef = useRef<{ key: string; offset: number } | null>(
    listAnchorKey ? { key: listAnchorKey, offset: 0 } : null
  );
  const programmaticScrollRef = useRef(false);
  // Whether the user is scrolling right now — wheel, touch, keys, or a held
  // scrollbar. Lets pinAnchor tell "the anchor left the rendered window
  // because the user jumped away" from "because rows were inserted" (#435).
  const scrollbarHeldRef = useRef(false);
  const userScrollUntilRef = useRef(0);
  const noteUserScroll = () => { userScrollUntilRef.current = performance.now() + 300; };
  const userScrolling = () => scrollbarHeldRef.current || performance.now() < userScrollUntilRef.current;
  // Wheel/key delta to apply into the merged list after a pause-buffer flush pin.
  const pendingFlushScrollDeltaRef = useRef<number | null>(null);
  // Latest toward-newer live-edge helpers for the global key listener (empty deps).
  const engageLiveTowardNewerRef = useRef<(deltaY: number) => void>(() => {});
  const keyTowardNewerRef = useRef<(key: string) => boolean>(() => false);
  const syncOverlayScrollbarRef = useRef(() => {});
  const keyScrollDeltaRef = useRef<(key: string) => number>(() => 0);
  const scheduleRubberBandRef = useRef(() => {});
  const unlockScrollGeometryIfSettledRef = useRef(() => {});
  const inFillRubberZoneRef = useRef<() => boolean>(() => false);
  const inOppositeRubberZoneRef = useRef<() => boolean>(() => false);
  // Thumb drag state: only the last pointer Y. Each move becomes an incremental
  // scroll delta (live geometry), exactly like successive wheel events.
  const sbDragRef = useRef<{
    pointerId: number;
    lastY: number;
  } | null>(null);
  useEffect(() => {
    const release = () => {
      if (!scrollbarHeldRef.current) return;
      scrollbarHeldRef.current = false;
      if (sbDragRef.current) sbDragRef.current = null;
      noteUserScroll();
      if (inFillRubberZoneRef.current() || inOppositeRubberZoneRef.current()) {
        scheduleRubberBandRef.current();
      } else {
        unlockScrollGeometryIfSettledRef.current();
      }
      syncOverlayScrollbarRef.current();
    };
    // Keys scroll the list without it holding focus, so listen globally.
    const onKey = (e: KeyboardEvent) => {
      if (!SCROLL_KEYS.has(e.key)) return;
      userScrollUntilRef.current = performance.now() + 300;
      if (keyTowardNewerRef.current(e.key)) {
        engageLiveTowardNewerRef.current(keyScrollDeltaRef.current(e.key));
      }
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
  // After an action pins a row: keep it still via instant scroll when possible.
  // Only if the scroll edge clamps (row must move) do we ease that visual shift.
  const animateNextPinRef = useRef(false);
  const pinAnimRafRef = useRef(0);
  useEffect(() => () => {
    if (pinAnimRafRef.current) cancelAnimationFrame(pinAnimRafRef.current);
    if (listContentRef.current) listContentRef.current.style.transform = '';
  }, []);

  // Temporary inner-border flash on a row (scheme-aware via --row-flash-border).
  // Clearing first then re-setting restarts the CSS animation for the same key.
  const [rowFlash, setRowFlash] = useState<{ key: string; gen: number } | null>(null);
  const flashRow = useCallback((key: string) => {
    setRowFlash(null);
    requestAnimationFrame(() => {
      setRowFlash(prev => ({ key, gen: (prev?.gen ?? 0) + 1 }));
    });
  }, []);
  // Zebra stripes stay with a telegram (#266): colour uses the unfiltered pool
  // index (stripeIndexByKey) so filter/QF compaction cannot flip survivors.
  // Live-edge prepends/drops still shift every pool index uniformly — this
  // offset accumulates that shift and is added back to the pool-index parity.
  const [stripeOffset, setStripeOffset] = useState(0);
  const prevPoolEdgeRef = useRef<{ firstKey: string | null; lastKey: string | null; len: number }>({
    firstKey: null, lastKey: null, len: 0,
  });
  useLayoutEffect(() => {
    const pool = listForcePool;
    const prev = prevPoolEdgeRef.current;
    const firstKey = pool.length > 0 ? anchorKey(pool[0]) : null;
    const lastKey = pool.length > 0 ? anchorKey(pool[pool.length - 1]) : null;
    prevPoolEdgeRef.current = { firstKey, lastKey, len: pool.length };

    if (pool.length === 0) {
      setStripeOffset(0);
      return;
    }
    if (!isTimeSort || prev.len === 0) return;

    const edgeKey = liveEdge === 'top' ? firstKey : lastKey;
    const prevEdgeKey = liveEdge === 'top' ? prev.firstKey : prev.lastKey;
    if (!prevEdgeKey || edgeKey === prevEdgeKey) return;

    let added = -1;
    if (liveEdge === 'top') {
      for (let i = 0; i < pool.length; i++) {
        if (anchorKey(pool[i]) === prevEdgeKey) { added = i; break; }
      }
    } else {
      for (let i = pool.length - 1; i >= 0; i--) {
        if (anchorKey(pool[i]) === prevEdgeKey) { added = pool.length - 1 - i; break; }
      }
    }
    if (added <= 0) {
      setStripeOffset(0);
      return;
    }
    const dropped = prev.len + added - pool.length;
    const indexShift = liveEdge === 'top' ? added : -dropped;
    setStripeOffset(o => (((o + indexShift) % 2) + 2) % 2);
  }, [listForcePool, isTimeSort, liveEdge]);

  // Sync follow prop. Unfollow always leaves the live edge and arms the detach
  // latch; follow from the parent clears the latch. Follow must NOT claim we
  // are at the edge — that would scrollToEdge on the next pause-buffer flush.
  // jumpToLive / handleScroll set atEdge themselves.
  useEffect(() => {
    if (listFollow === undefined) return;
    setFollowingLive(listFollow);
    if (!listFollow) {
      atEdgeRef.current = false;
      detachedFromEdgeRef.current = true;
    } else {
      detachedFromEdgeRef.current = false;
    }
  }, [listFollow]);

  useEffect(() => {
    if (listAnchorKey !== undefined) {
      if (listAnchorKey === null) {
        anchorRef.current = null;
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

  /** Settled live-edge scrollTop (edge telegram flush; not into the fill rubber). */
  const settledEdgeScrollTop = () => {
    const el = parentRef.current;
    if (!el) return fillRubberPx;
    if (liveEdge === 'top') return fillRubberPx;
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    return Math.max(0, max - fillRubberPx);
  };

  /** Settled opposite-edge scrollTop (not into the opposite rubber overscroll). */
  const settledOppositeScrollTop = () => {
    const el = parentRef.current;
    if (!el) return 0;
    // Opposite spacer sits away from the live edge: bottom for newest-on-top,
    // top for oldest-on-top.
    if (liveEdge === 'bottom') return oppositeRubberPx;
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    return Math.max(0, max - oppositeRubberPx);
  };

  /** True while overscrolled into the fill-axis rubber zone (outer fillRubber only). */
  const inFillRubberZone = () => {
    const el = parentRef.current;
    if (!el || fillRubberPx <= 0) return false;
    if (liveEdge === 'top') return el.scrollTop < fillRubberPx - 0.5;
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    return el.scrollTop > max - fillRubberPx + 0.5;
  };

  /**
   * Auto-paused with a backlog the parent can meter out: the fill padding is
   * then the insert slot for the next backlog rows, not a rubber band.
   */
  const backlogFeedActive = () =>
    isPaused && !isManualPause && pausedCount > 0 && !!onPauseReveal;

  /**
   * Manually paused with a backlog: the fill spacer is a hard stop that stays
   * on screen (with its "...paused manually..." labels) instead of rubber-
   * banding away; switching to auto pause fills it with the oldest backlog row.
   */
  const manualHoldActive = () => isManualPause && pausedCount > 0;

  /** Fill overscroll that should rubber-band back (nothing waiting to fill it). */
  const inFillRubberBand = () =>
    inFillRubberZone() && !backlogFeedActive() && !manualHoldActive();

  /**
   * Scroll range a pin may land in. A pin never pushes the viewport into a
   * rubber zone: that overscroll only settles on a user scroll, so the spacer
   * would stay open when the pinned row cannot hold its place. A viewport
   * already inside a zone keeps the raw range — except for action pins
   * (filter / QF toggle), which settle unless a manual-pause hold parks the
   * fill spacer on screen.
   */
  const pinScrollBounds = (el: HTMLElement, action: boolean) => {
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    const fillAtStart = liveEdge === 'top';
    const lo = Math.min(max, fillAtStart ? fillRubberPx : oppositeRubberPx);
    const hi = Math.max(lo, max - (fillAtStart ? oppositeRubberPx : fillRubberPx));
    const keepRaw = (inZone: boolean, fillSide: boolean) =>
      inZone && (!action || (fillSide && manualHoldActive()));
    return {
      lo: keepRaw(el.scrollTop < lo - 0.5, fillAtStart) ? 0 : lo,
      hi: keepRaw(el.scrollTop > hi + 0.5, !fillAtStart) ? max : hi,
    };
  };

  /** Fill spacer fully in the viewport (not partially scrolled away). */
  const fillRubberFullyVisible = () => {
    const el = parentRef.current;
    if (!el || fillRubberPx <= 0) return false;
    if (liveEdge === 'top') return el.scrollTop <= 0.5;
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    return el.scrollTop >= max - 0.5;
  };

  const [showFillPauseLabels, setShowFillPauseLabels] = useState(false);
  /** Bumps to remount labels so the highlight→dim fade restarts. */
  const [fillPauseFadeKey, setFillPauseFadeKey] = useState(0);
  const fillPauseLabelsShownRef = useRef(false);
  /** One highlight pulse per scrollbar drag past the fill hard-stop. */
  const fillPauseSbPulsedRef = useRef(false);
  const pulseFillPauseLabels = () => {
    setFillPauseFadeKey(k => k + 1);
  };
  const syncFillPauseLabels = () => {
    const next = !!isManualPause && fillRubberFullyVisible();
    if (next && !fillPauseLabelsShownRef.current) {
      pulseFillPauseLabels();
    }
    if (!next) fillPauseSbPulsedRef.current = false;
    fillPauseLabelsShownRef.current = next;
    setShowFillPauseLabels(next);
  };
  useLayoutEffect(() => {
    syncFillPauseLabels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isManualPause, fillRubberPx, liveEdge, telegramRows.length]);

  /** True while overscrolled into the opposite-axis rubber zone. */
  const inOppositeRubberZone = () => {
    const el = parentRef.current;
    if (!el || oppositeRubberPx <= 0) return false;
    const settle = settledOppositeScrollTop();
    if (liveEdge === 'top') return el.scrollTop > settle + 0.5;
    return el.scrollTop < settle - 0.5;
  };

  const lockScrollGeometry = () => {
    // A metered reveal needs the live virtualizer height: a frozen scrollHeight
    // would clamp the pin and snap the viewport.
    if (flushPinRef.current) return;
    setFrozenGeom(prev => prev ?? { ...liveGeomRef.current });
  };

  const unlockScrollGeometryIfSettled = () => {
    if (scrollbarHeldRef.current) return;
    if (rubberAnimRef.current) return;
    if (inOppositeRubberZone() || inFillRubberBand()) return;
    setFrozenGeom(null);
  };

  /** Drop the sticky short-list pad once scrollTop fits the live geometry. */
  const releaseStickySpacerIfFits = () => {
    if (stickyOppositeSpacerPx <= 0 || flushPinRef.current) return;
    const el = parentRef.current;
    if (!el) return;
    const liveMax = Math.max(0, liveVirtTotalPx + liveOppositeSpacerPx - el.clientHeight);
    if (el.scrollTop <= liveMax + 0.5) setStickyOppositeSpacerPx(0);
  };

  const checkAtEdge = () => {
    const el = parentRef.current;
    if (!el) return true;
    // Settled edge or fill-rubber overscroll both count as at the live edge.
    if (liveEdge === 'top') return el.scrollTop <= fillRubberPx + EDGE_SCROLL_EPS;
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    return el.scrollTop >= Math.max(0, max - fillRubberPx) - EDGE_SCROLL_EPS;
  };

  /**
   * How far (px, ≥ 0) a fill-axis move of `deltaY` would carry the viewport
   * past the settled live edge into the fill slot. 0 when it stays on rows.
   */
  const fillOverrunFor = (deltaY: number) => {
    const el = parentRef.current;
    if (!el) return 0;
    const target = el.scrollTop + deltaY;
    const settled = settledEdgeScrollTop();
    return Math.max(0, liveEdge === 'top' ? settled - target : target - settled);
  };

  const cancelRubberBand = () => {
    if (rubberBandTimerRef.current != null) {
      clearTimeout(rubberBandTimerRef.current);
      rubberBandTimerRef.current = null;
    }
    if (rubberBandRafRef.current != null) {
      cancelAnimationFrame(rubberBandRafRef.current);
      rubberBandRafRef.current = null;
    }
    rubberAnimRef.current = null;
  };

  /** Opposite rubber must always finish — ignore pause-flush pins. */
  const oppositeRubberBusy = () =>
    rubberAnimRef.current?.side === 'opposite' || inOppositeRubberZone();

  /** Animate scrollTop to `target` on the given rubber side (ease + settle timer). */
  const startRubberBandTo = (
    target: number,
    side: 'fill' | 'opposite',
    onDone?: () => void,
  ) => {
    const el = parentRef.current;
    if (!el) return;
    // Opposite rubber always runs to completion, including during pause flush.
    if (
      side !== 'opposite'
      && (flushPinRef.current || pendingFlushScrollDeltaRef.current != null)
    ) return;
    if (jumpToLiveRef.current) return;
    const start = el.scrollTop;
    const delta = target - start;
    let finished = false;
    const finish = (node: HTMLElement, to: number) => {
      if (finished) return;
      finished = true;
      markProgrammatic();
      node.scrollTop = to;
      rubberAnimRef.current = null;
      if (rubberBandTimerRef.current != null) {
        clearTimeout(rubberBandTimerRef.current);
        rubberBandTimerRef.current = null;
      }
      if (rubberBandRafRef.current != null) {
        cancelAnimationFrame(rubberBandRafRef.current);
        rubberBandRafRef.current = null;
      }
      unlockScrollGeometryIfSettled();
      onDone?.();
    };
    lockScrollGeometry();
    if (Math.abs(delta) < 0.5) {
      finish(el, target);
      return;
    }

    // Keep side/progress; replace timers/frames only.
    if (rubberBandTimerRef.current != null) {
      clearTimeout(rubberBandTimerRef.current);
      rubberBandTimerRef.current = null;
    }
    if (rubberBandRafRef.current != null) {
      cancelAnimationFrame(rubberBandRafRef.current);
      rubberBandRafRef.current = null;
    }

    markProgrammatic();
    const duration = 180;
    const t0 = performance.now();
    rubberAnimRef.current = { side, from: start, to: target, t0, duration };
    const step = (now: number) => {
      const node = parentRef.current;
      const anim = rubberAnimRef.current;
      if (!node || !anim) {
        rubberBandRafRef.current = null;
        return;
      }
      markProgrammatic();
      const t = Math.min(1, Math.max(0, (now - anim.t0) / anim.duration));
      const ease = 1 - (1 - t) ** 3;
      node.scrollTop = anim.from + (anim.to - anim.from) * ease;
      if (t < 1) {
        rubberBandRafRef.current = requestAnimationFrame(step);
      } else {
        rubberBandRafRef.current = null;
        finish(node, anim.to);
      }
    };
    rubberBandRafRef.current = requestAnimationFrame(step);
    rubberBandTimerRef.current = setTimeout(() => {
      rubberBandTimerRef.current = null;
      if (rubberBandRafRef.current != null) {
        cancelAnimationFrame(rubberBandRafRef.current);
        rubberBandRafRef.current = null;
      }
      const node = parentRef.current;
      const anim = rubberAnimRef.current;
      if (!node || !anim) return;
      finish(node, anim.to);
    }, duration);
  };

  const rubberBandFromZone = () => {
    if (inFillRubberBand()) {
      startRubberBandTo(settledEdgeScrollTop(), 'fill');
      return;
    }
    if (inOppositeRubberZone()) {
      startRubberBandTo(settledOppositeScrollTop(), 'opposite');
    }
  };

  const scheduleRubberBand = () => {
    // Do not fight a held scrollbar thumb — rubber runs on pointerup instead.
    if (scrollbarHeldRef.current) return;
    if (fillRubberPx <= 0 && oppositeRubberPx <= 0) return;
    if (rubberBandTimerRef.current != null) clearTimeout(rubberBandTimerRef.current);
    rubberBandTimerRef.current = setTimeout(() => {
      rubberBandTimerRef.current = null;
      rubberBandFromZone();
    }, 90);
  };
  scheduleRubberBandRef.current = scheduleRubberBand;
  unlockScrollGeometryIfSettledRef.current = unlockScrollGeometryIfSettled;
  inFillRubberZoneRef.current = inFillRubberBand;
  inOppositeRubberZoneRef.current = inOppositeRubberZone;

  useEffect(() => () => cancelRubberBand(), []);

  // Newest live-edge row fully inside the scrollport. Empty list → false.
  // When layout boxes are unreliable (jsdom), fall back to checkAtEdge().
  const newestFullyVisible = () => {
    const rows = telegramRowsRef.current;
    if (rows.length === 0) return false;
    const el = parentRef.current;
    if (!el) return false;
    const key = anchorKey(rows[liveEdge === 'top' ? 0 : rows.length - 1]);
    const row = el.querySelector<HTMLElement>(`[data-akey="${CSS.escape(key)}"]`);
    if (!row) return false;
    const rr = row.getBoundingClientRect();
    const pr = el.getBoundingClientRect();
    const eps = 2;
    const layoutReliable =
      Math.abs(rr.height - pr.height) > 1 || Math.abs(rr.top - pr.top) > 1;
    if (!layoutReliable) return checkAtEdge();
    return rr.top >= pr.top - eps && rr.bottom <= pr.bottom + eps;
  };

  const enableLiveFollow = () => {
    detachedFromEdgeRef.current = false;
    atEdgeRef.current = true;
    setFollowingLive(true);
    onListFollowChange?.(true);
    anchorRef.current = null;
    onListAnchorKeyChange?.(null);
  };

  const syncFollowFromNewestVisibility = () => {
    if (isManualPause) return;
    if (detachedFromEdgeRef.current) return;
    // A backlog still waits: following would flush it all at once.
    if (backlogFeedActive()) return;
    if (!newestFullyVisible()) return;
    enableLiveFollow();
  };

  /**
   * Backlog rows to reveal for a fill-axis move of `px`: enough to cover the
   * move plus the fill slot (so the viewport never runs into blank padding),
   * one spare for rows measuring shorter than the estimate, capped so the
   * pinned row stays rendered. Any shortfall is topped up by the merge effect.
   */
  const revealCountFor = (px: number) => {
    const need = Math.ceil((Math.abs(px) + fillRubberPx) / ROW_ESTIMATE) + 1;
    return Math.max(1, Math.min(pausedCount, need, REVEAL_MAX));
  };

  /**
   * Ask the parent for the next metered slice. The edge-most visible row is
   * pinned (selection ignored: a marked row elsewhere must not steer the
   * flush); the gesture delta is applied once the rows have landed.
   */
  const requestReveal = (deltaY: number, n: number) => {
    flushPinRef.current = true;
    captureAnchor(null, { ignoreSelection: true });
    pendingFlushScrollDeltaRef.current = deltaY;
    revealRef.current = { before: pausedCount, n };
    onPauseReveal?.(n);
  };

  /**
   * Start a metered step from rest: a few rows inserted into the fill slot.
   * Rows must grow scrollHeight, so no frozen geometry; a short list keeps its
   * settle pad until the viewport fits the live geometry again.
   */
  const armMeteredReveal = (deltaY: number, n: number) => {
    setFrozenGeom(null);
    setStickyOppositeSpacerPx(prev => Math.max(prev, liveGeomRef.current.oppositeSpacerPx));
    requestReveal(deltaY, n);
  };

  // Scroll along the pause-buffer fill axis (toward the live edge) at the frozen
  // fill end: feed the backlog and continue the gesture seamlessly. Against
  // the fill axis never flushes (handleScroll has no flush). Empty list: no-op.
  // Without backlog, follow re-engages; fill-rubber overscroll rubber-bands back.
  const engageLiveTowardNewer = (deltaY: number) => {
    if (telegramRowsRef.current.length === 0) return;
    if (flushPinRef.current) {
      // Rows of the previous step have not landed yet: fold this move into the
      // pending delta; the merge effect tops the reveal up if the slot is
      // still open afterwards.
      pendingFlushScrollDeltaRef.current = (pendingFlushScrollDeltaRef.current ?? 0) + deltaY;
      return;
    }
    // A move that would run past the settled edge into the fill slot counts
    // too while a backlog waits (e.g. right after a slot fill left the edge
    // row 73px in): the browser clamps that part of the scroll, so without a
    // reveal the gesture would lose it.
    const overrun = fillOverrunFor(deltaY);
    if (!checkAtEdge() && !(backlogFeedActive() && overrun > 0)) return;
    if (isPaused && pausedCount > 0) {
      // Manual pause: the fill edge is a hard stop (labels pulse instead).
      if (isManualPause) return;
      detachedFromEdgeRef.current = false;
      // Flush must never claim the live edge — that would scrollToEdge on merge.
      // Pin + pending delta keep the viewport moving line-wise into the backlog.
      // Opposite rubber always finishes — do not cancel it for pause flush.
      if (!oppositeRubberBusy()) cancelRubberBand();
      atEdgeRef.current = false;
      if (onPauseReveal) {
        armMeteredReveal(deltaY, revealCountFor(overrun));
        return;
      }
      flushPinRef.current = true;
      if (!anchorRef.current) captureAnchor();
      pendingFlushScrollDeltaRef.current = deltaY;
      onPauseFlush?.();
      return;
    }
    detachedFromEdgeRef.current = false;
    enableLiveFollow();
    scheduleRubberBand();
  };
  const wheelTowardNewer = (deltaY: number) =>
    liveEdge === 'top' ? deltaY < 0 : deltaY > 0;
  const keyTowardNewer = (key: string) => {
    if (liveEdge === 'top') return key === 'ArrowUp' || key === 'PageUp' || key === 'Home';
    return key === 'ArrowDown' || key === 'PageDown' || key === 'End' || key === ' ';
  };
  const keyScrollDelta = (key: string) => {
    const page = parentRef.current?.clientHeight ?? 800;
    const sign = liveEdge === 'top' ? -1 : 1;
    if (key === 'PageUp' || key === 'PageDown' || key === 'Home' || key === 'End' || key === ' ') {
      return sign * page;
    }
    return sign * 40;
  };
  engageLiveTowardNewerRef.current = engageLiveTowardNewer;
  keyTowardNewerRef.current = keyTowardNewer;
  keyScrollDeltaRef.current = keyScrollDelta;

  // Record the row to pin across list updates. `selectedKey` is the row the
  // user is working on; it wins while any part of it is inside the viewport, so
  // rows arriving above it (a reload, Time-Delta-Context) can't push it away
  // (#435). Without one on screen, the top-most visible row is pinned (#202).
  const captureAnchor = (
    selectedKey: string | null = selectedKeyRef.current,
    opts?: { ignoreSelection?: boolean },
  ) => {
    const el = parentRef.current;
    if (!el) return;
    const cRect = el.getBoundingClientRect();
    const cTop = cRect.top;
    if (selectedKey && !opts?.ignoreSelection) {
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

  // Paint-only overlay thumb — mutate DOM (no useState) so sync cannot trigger
  // an extra render that would clear the sticky newer-pill across a flush gap.
  const sbTrackRef = useRef<HTMLDivElement | null>(null);
  const sbThumbRef = useRef<HTMLDivElement | null>(null);

  /**
   * Virtual backlog px for the overlay thumb — same basis as the newer pill:
   * displayNewerCount minus merged rows already in scrollHeight (fill-offscreen).
   * Equals filter-visible pause rows in the steady state; keeps sticky count
   * during a flush gap so thumb and pill stay aligned.
   */
  const overlayBacklogPx = (scrollTop: number, clientHeight: number) => {
    const newer = Math.max(0, displayNewerCountRef.current);
    if (telegramRows.length === 0) return newer * ROW_ESTIMATE;
    if (!isTimeSort) return Math.max(0, visiblePausedCount) * ROW_ESTIMATE;
    const mergedOut = countFillAxisScrolledOut(
      telegramRows.length,
      liveEdge,
      scrollTop,
      clientHeight,
      (i) => virtualizer.measurementsCache[i]?.start
        ?? virtualizer.getOffsetForIndex(i, 'start')?.[0],
      (i) => virtualizer.measurementsCache[i]?.size ?? ROW_ESTIMATE,
    );
    return Math.max(0, newer - mergedOut) * ROW_ESTIMATE;
  };

  /**
   * Paint-only thumb: size/position from the newer-pill backlog (not raw
   * pausedCount). Always computed from live state — also while the thumb is held.
   */
  const syncOverlayScrollbar = () => {
    const el = parentRef.current;
    const track = sbTrackRef.current;
    const thumb = sbThumbRef.current;
    if (!el || !track || !thumb) return;
    const { clientHeight, scrollHeight, scrollTop } = el;
    const backlogPx = overlayBacklogPx(scrollTop, clientHeight);
    const virtSH = scrollHeight + backlogPx;
    if (virtSH <= clientHeight + 0.5) {
      track.style.display = 'none';
      return;
    }
    track.style.display = '';
    const thumbHeight = Math.max(LIST_SB_MIN_THUMB_PX, (clientHeight * clientHeight) / virtSH);
    const virtMaxScroll = Math.max(0, virtSH - clientHeight);
    const trackTravel = Math.max(0, clientHeight - thumbHeight);
    const virtScrollTop = liveEdge === 'top'
      ? Math.min(virtMaxScroll, Math.max(0, scrollTop + backlogPx))
      : Math.min(virtMaxScroll, Math.max(0, scrollTop));
    const top = virtMaxScroll > 0 ? (virtScrollTop / virtMaxScroll) * trackTravel : 0;
    thumb.style.top = `${top}px`;
    thumb.style.height = `${thumbHeight}px`;
  };
  syncOverlayScrollbarRef.current = syncOverlayScrollbar;

  /**
   * One user scroll gesture of `deltaY` px along the scroll axis — the single
   * entry for wheel and scrollbar-thumb drag. Runs BEFORE the actual scroll
   * (native for wheel, explicit for thumb) so the pause-buffer step arms its
   * pin/anchor while the viewport is still at rest.
   */
  const handleScrollGesture = (deltaY: number, opts?: { pulseOnce?: boolean }) => {
    noteUserScroll();
    if (wheelTowardNewer(deltaY)) {
      engageLiveTowardNewer(deltaY);
      // Hard-stop overscroll: scrollTop may not change, so remount to
      // restart the pause-label highlight fade on each attempt.
      if (isManualPause && fillRubberFullyVisible()) {
        if (!opts?.pulseOnce) {
          pulseFillPauseLabels();
        } else if (!fillPauseSbPulsedRef.current) {
          fillPauseSbPulsedRef.current = true;
          pulseFillPauseLabels();
        }
      }
    }
    // While a backlog step is pending the geometry must stay live.
    if (flushPinRef.current) return;
    if (inOppositeRubberZone() || inFillRubberBand()) {
      lockScrollGeometry();
    } else {
      unlockScrollGeometryIfSettled();
    }
    if (inFillRubberBand() || inOppositeRubberZone()) scheduleRubberBand();
  };

  /**
   * Thumb pixels → scroll pixels with the CURRENT virtual geometry (recomputed
   * on every move, never frozen), so the handle always spans what is painted.
   */
  const thumbPxToScrollPx = (thumbDy: number) => {
    const el = parentRef.current;
    if (!el) return 0;
    const { clientHeight, scrollHeight, scrollTop } = el;
    const virtSH = scrollHeight + overlayBacklogPx(scrollTop, clientHeight);
    const thumbHeight = Math.max(LIST_SB_MIN_THUMB_PX, (clientHeight * clientHeight) / Math.max(virtSH, 1));
    const trackTravel = Math.max(0, clientHeight - thumbHeight);
    const virtMaxScroll = Math.max(0, virtSH - clientHeight);
    if (trackTravel <= 0 || virtMaxScroll <= 0) return 0;
    return (thumbDy / trackTravel) * virtMaxScroll;
  };

  const onSbThumbPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const el = parentRef.current;
    if (!el) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    scrollbarHeldRef.current = true;
    lockScrollGeometry();
    sbDragRef.current = { pointerId: e.pointerId, lastY: e.clientY };
  };

  // Each move is one wheel-equivalent delta: same gesture handler (metered
  // pause-buffer mixing, pending-step accumulation, hard stop), then the scroll
  // itself, then an immediate live repaint of the handle.
  const onSbThumbPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = sbDragRef.current;
    const el = parentRef.current;
    if (!drag || drag.pointerId !== e.pointerId || !el) return;
    const dy = e.clientY - drag.lastY;
    drag.lastY = e.clientY;
    if (dy === 0) return;
    const scrollDelta = thumbPxToScrollPx(dy);
    if (scrollDelta === 0) return;
    handleScrollGesture(scrollDelta, { pulseOnce: true });
    const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
    el.scrollTop = Math.max(0, Math.min(maxScroll, el.scrollTop + scrollDelta));
    syncOverlayScrollbar();
  };

  const onSbThumbPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = sbDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    sbDragRef.current = null;
    fillPauseSbPulsedRef.current = false;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    syncOverlayScrollbar();
    // Global pointerup listener also clears scrollbarHeldRef + rubber/unlock.
  };

  const onSbTrackPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const el = parentRef.current;
    const thumb = sbThumbRef.current;
    if (!el || !thumb || thumb.clientHeight <= 0) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const thumbTop = thumb.offsetTop;
    const thumbHeight = thumb.offsetHeight;
    const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
    if (maxScroll <= 0) return;
    noteUserScroll();
    // Page toward the click; keep real scroll range (no virtual backlog travel).
    // A page toward the fill from the live edge feeds the backlog like PageUp/Down.
    const before = el.scrollTop;
    if (y < thumbTop) {
      // Arm before the native move so the anchor is captured at rest.
      if (liveEdge === 'top' && backlogFeedActive()) engageLiveTowardNewer(-el.clientHeight);
      el.scrollTop = Math.max(0, el.scrollTop - el.clientHeight);
      if (isManualPause && liveEdge === 'top' && before === el.scrollTop && fillRubberFullyVisible()) {
        pulseFillPauseLabels();
      }
    } else if (y > thumbTop + thumbHeight) {
      if (liveEdge === 'bottom' && backlogFeedActive()) engageLiveTowardNewer(el.clientHeight);
      el.scrollTop = Math.min(maxScroll, el.scrollTop + el.clientHeight);
      if (isManualPause && liveEdge === 'bottom' && before === el.scrollTop && fillRubberFullyVisible()) {
        pulseFillPauseLabels();
      }
    }
  };

  useLayoutEffect(() => {
    syncOverlayScrollbar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visiblePausedCount, telegramRows.length, virtTotalPx, oppositeSpacerPx, liveEdge, fillRubberPx, viewportHeight]);

  const handleScroll = () => {
    // Labels track fill visibility even for programmatic rubber/settle scrolls.
    syncFillPauseLabels();
    syncOverlayScrollbar();
    // Ignore the scrolls our own compensation triggers.
    if (programmaticScrollRef.current || refindingAnchorRef.current) return;
    // A pending backlog step owns the anchor until its rows land: the native
    // scroll of the gesture that armed it must not re-anchor or re-follow.
    if (flushPinRef.current) return;
    markCursorRef.current = null;
    releaseStickySpacerIfFits();
    if (inOppositeRubberZone() || inFillRubberBand() || scrollbarHeldRef.current) {
      lockScrollGeometry();
    } else {
      unlockScrollGeometryIfSettled();
    }
    // Keep a viewport snapshot of the preferred selection for App-driven refilters.
    const pref = lastMarkedRef.current;
    if (pref) {
      const o = rowOffset(pref);
      if (o != null) lastKnownPreferredPinRef.current = { key: pref, offset: o };
    }
    if (inFillRubberBand() || inOppositeRubberZone()) scheduleRubberBand();
    if (inFillRubberZone() && backlogFeedActive()) {
      // The empty fill slot is on screen with a backlog waiting: fill it.
      engageLiveTowardNewer(0);
      return;
    }
    const newestVisible = newestFullyVisible();

    if (detachedFromEdgeRef.current) {
      // Stay unfollowed until newest has left full visibility at least once.
      // Flush is fill-axis-only (engageLiveTowardNewer), never from scroll alone.
      if (!newestVisible) {
        detachedFromEdgeRef.current = false;
        atEdgeRef.current = false;
      }
      captureAnchor();
      return;
    }

    // Returning to the newest row re-follows — unless a backlog waits, which
    // would flush all at once; it is fed in by fill-axis gestures instead.
    if (newestVisible && !isManualPause && !backlogFeedActive()) {
      enableLiveFollow();
      return;
    }

    if (atEdgeRef.current) {
      atEdgeRef.current = false;
      setFollowingLive(false);
      onListFollowChange?.(false);
      detachedFromEdgeRef.current = true;
    }
    captureAnchor();
  };

  // Pin a row for a user action. Prefer keeping it visually still (instant
  // scroll correction). Only animate when the scroll edge clamps and the row
  // must move (e.g. context collapse while already scrolled to the top).
  const pinForAction = (key: string) => {
    if (atEdgeRef.current) {
      atEdgeRef.current = false;
      detachedFromEdgeRef.current = true;
      setFollowingLive(false);
      onListFollowChange?.(false);
    }
    captureAnchor(key);
    animateNextPinRef.current = true;
  };

  // Preferred pin target after a display-changing action: last selected →
  // first selected (list order) → topmost visible row.
  const preferredPinKey = (rows: typeof telegramRowsRef.current = telegramRowsRef.current): string | null => {
    if (rows.length === 0) return null;
    const present = new Set(rows.map(anchorKey));
    const latest = lastMarkedRef.current;
    if (latest && present.has(latest)) return latest;
    for (const r of rows) {
      const key = anchorKey(r);
      if (hasMarkReason(markReasonsRef.current, key, 'mouse')) return key;
    }
    return anchorKey(rows[0]);
  };

  // Snapshot the preferred row's viewport offset from the CURRENT DOM, then
  // schedule a restore after the upcoming display update. Call this in the
  // same event turn as setState, before React commits the new list.
  const requestDisplayPin = () => {
    // Prefer lastMarked / mouse selection even if the current rows snapshot is
    // about to be replaced — the key must survive via force-include.
    const rows = telegramRowsRef.current;
    const latest = lastMarkedRef.current;
    let key: string | null = null;
    if (latest) key = latest;
    else {
      for (const r of rows) {
        const k = anchorKey(r);
        if (hasMarkReason(markReasonsRef.current, k, 'mouse')) { key = k; break; }
      }
    }
    if (!key) key = preferredPinKey(rows);
    if (key) {
      const live = rowOffset(key);
      const known = lastKnownPreferredPinRef.current;
      const offset = live ?? (known?.key === key ? known.offset : 0);
      pendingDisplayPinRef.current = { key, offset };
      lastKnownPreferredPinRef.current = { key, offset };
    } else {
      pendingDisplayPinRef.current = null;
    }
    if (atEdgeRef.current) {
      atEdgeRef.current = false;
      setFollowingLive(false);
      onListFollowChange?.(false);
    }
    // Drop any in-flight seek/settle so the layout-effect pin is not skipped
    // by `refindingAnchorRef` / `pinAnimRafRef` guards.
    refindingAnchorRef.current = false;
    if (pinAnimRafRef.current) {
      cancelAnimationFrame(pinAnimRafRef.current);
      pinAnimRafRef.current = 0;
    }
    if (listContentRef.current) listContentRef.current.style.transform = '';
    suppressListRefilterEffectRef.current = true;
    setDisplayPinNonce(n => n + 1);
  };
  requestDisplayPinRef.current = requestDisplayPin;

  // Restore the pre-change viewport offset once the new list has painted.
  useLayoutEffect(() => {
    if (displayPinNonce === 0) return;
    const pending = pendingDisplayPinRef.current;
    pendingDisplayPinRef.current = null;
    const rows = telegramRowsRef.current;
    if (rows.length === 0) return;

    let key = pending?.key ?? null;
    if (!key || !rows.some(r => anchorKey(r) === key)) {
      key = preferredPinKey(rows);
    }
    if (!key) return;

    const offset = pending && pending.key === key ? pending.offset : 0;
    if (atEdgeRef.current) {
      atEdgeRef.current = false;
      setFollowingLive(false);
      onListFollowChange?.(false);
    }
    anchorRef.current = { key, offset };
    // Keep anchorRowsRef on the *previous* list identity. pinAnchor only
    // scrollToIndex's a missing row when it sees a list change; assigning the
    // new rows here made QF/filter pins no-op and left the row off-screen.
    onListAnchorKeyChange?.(key);
    animateNextPinRef.current = true;
    pinAnchor();
    flashRow(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayPinNonce]);

  // Parent-driven view changes (main filter toggle / edits). Snapshot from
  // lastKnown — the DOM may already reflect the new filtered list.
  const viewChangeSeenRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (viewChangeToken == null) return;
    if (viewChangeSeenRef.current === undefined) {
      viewChangeSeenRef.current = viewChangeToken;
      return;
    }
    if (viewChangeSeenRef.current === viewChangeToken) return;
    viewChangeSeenRef.current = viewChangeToken;
    const known = lastKnownPreferredPinRef.current;
    const key = lastMarkedRef.current ?? known?.key ?? preferredPinKey();
    if (key) {
      const offset = known?.key === key ? known.offset : 0;
      pendingDisplayPinRef.current = { key, offset };
    }
    if (atEdgeRef.current) {
      atEdgeRef.current = false;
      setFollowingLive(false);
      onListFollowChange?.(false);
    }
    suppressListRefilterEffectRef.current = true;
    setDisplayPinNonce(n => n + 1);
  }, [viewChangeToken]);

  // Toggles context flags for the clicked row, or every mouse-selected row
  // when the click is inside the selection. Context-only rows use the same
  // control to get (or drop) their own window without tearing down global
  // "all". Switching an "all"-mode match off still materializes the others
  // as explicit flags. Pin the preferred selection so context churn doesn't
  // slide the working row away.
  const handleFlagClick = useCallback((e: React.MouseEvent, key: string) => {
    e.stopPropagation();
    requestDisplayPinRef.current();

    const nextOn = !anchorsContext(key);
    const targets = targetsForSelectionAction(key);
    if (nextOn) {
      // Context rows and matches alike: personal flag → own context window.
      setFlaggedKeysList([...new Set([...flaggedKeysList, ...targets])]);
      return;
    }

    // Turning off. Personal flags (incl. a context row that was given its own
    // window) drop quietly and leave "all" intact. Only an "all"-mode match
    // anchor (not personally flagged) materializes the rest and exits "all".
    const turningOffAllModeAnchor = contextForAll && [...targets].some(
      k => !flaggedSet.has(k) && !contextKeys?.has(k),
    );
    if (turningOffAllModeAnchor) {
      const current = [...new Set([
        ...flaggedKeysList,
        ...telegrams.map(anchorKey).filter(k => !contextKeys?.has(k)),
      ])];
      setContextForAll(false);
      setFlaggedKeysList(current.filter(k => !targets.has(k)));
      return;
    }
    setFlaggedKeysList(flaggedKeysList.filter(k => !targets.has(k)));
  }, [anchorsContext, flaggedKeysList, targetsForSelectionAction, setFlaggedKeysList, contextForAll, setContextForAll, telegrams, contextKeys, flaggedSet]);

  // Stop browser text selection before it starts on shift/ctrl range marks
  // (selection begins on mousedown, not click). Always record the pointer so
  // a later plain click can tell click-to-mark from drag-to-select-text.
  const MARK_DRAG_THRESHOLD_PX = 4;
  const handleMarkMouseDown = (e: React.MouseEvent) => {
    markPointerRef.current = { x: e.clientX, y: e.clientY };
    if (!(e.shiftKey || e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    window.getSelection()?.removeAllRanges();
  };

  // Mouse selection updates the `mouse` reason (#310): plain click makes this
  // the sole mouse-marked row; ctrl/cmd toggles `mouse` on the row; shift
  // ranges. Same handler for row body and the rail hit-target.
  const handleMarkClick = (e: React.MouseEvent, key: string, index: number) => {
    const origin = markPointerRef.current;
    markPointerRef.current = null;
    const additive = e.ctrlKey || e.metaKey;
    const range = e.shiftKey;
    // Drag without modifiers = text selection; leave the row unmarked so the
    // selection isn't destroyed by a mark-state re-render.
    if (!additive && !range && origin) {
      const dx = e.clientX - origin.x;
      const dy = e.clientY - origin.y;
      if (dx * dx + dy * dy > MARK_DRAG_THRESHOLD_PX * MARK_DRAG_THRESHOLD_PX) {
        return;
      }
    }
    if (additive || range) {
      e.preventDefault();
      window.getSelection()?.removeAllRanges();
    }

    let next = markReasons;
    if (range) {
      const anchorIdx = lastMarked ? telegramRows.findIndex(r => anchorKey(r) === lastMarked) : -1;
      let rangeKeys: string[];
      if (anchorIdx === -1) {
        rangeKeys = [key];
      } else {
        const lo = Math.min(anchorIdx, index);
        const hi = Math.max(anchorIdx, index);
        rangeKeys = telegramRows.slice(lo, hi + 1).map(r => anchorKey(r));
      }
      if (additive) {
        for (const k of rangeKeys) next = addMarkReason(next, k, 'mouse');
      } else {
        next = setSoleMarkReason(next, 'mouse', rangeKeys);
      }
    } else if (additive) {
      next = toggleMarkReason(next, key, 'mouse');
    } else {
      next = setSoleMarkReason(next, 'mouse', [key]);
    }
    // Latest selected row gets `auto` (unless already `manual`); previous `auto` drops.
    next = syncAutoForLatest(next, key);
    setMarkReasons(next);
    setLastMarked(key);
    markCursorRef.current = key;
    // Scroll-anchor follows mouse selection, not the auto rail mark.
    const selectedKey = hasMarkReason(next, key, 'mouse') ? key : null;

    if (isTimeSort && atEdgeRef.current) {
      atEdgeRef.current = false;
      detachedFromEdgeRef.current = true;
      setFollowingLive(false);
      onListFollowChange?.(false);
    }
    if (!atEdgeRef.current) captureAnchor(selectedKey);
    if (selectedKey) {
      const o = rowOffset(selectedKey);
      if (o != null) lastKnownPreferredPinRef.current = { key: selectedKey, offset: o };
    }
  };

  // Rail: `auto` ⇄ `manual` on the latest row; elsewhere toggle `manual`.
  // When the clicked row is mouse-selected, the same action applies to the
  // whole selection. User `manual` survives when latest moves away.
  const handleRailMarkClick = (e: React.MouseEvent, key: string) => {
    e.stopPropagation();
    const targets = targetsForSelectionAction(key);
    const hasAuto = hasMarkReason(markReasons, key, 'auto');
    const hasManual = hasMarkReason(markReasons, key, 'manual');

    if (!hasAuto && !hasManual) {
      let next = markReasons;
      for (const k of targets) {
        next = removeMarkReason(next, k, 'auto');
        next = addMarkReason(next, k, 'manual');
      }
      setMarkReasons(next);
      markCursorRef.current = key;
      return;
    }

    if (hasAuto) {
      // Promote auto → manual for the whole target set.
      let next = markReasons;
      for (const k of targets) {
        next = removeMarkReason(next, k, 'auto');
        next = addMarkReason(next, k, 'manual');
      }
      setMarkReasons(next);
      markCursorRef.current = key;
      return;
    }

    // has manual
    if (targets.size === 1 && key === lastMarkedRef.current) {
      // Demote manual → auto on the latest row only.
      let next = removeMarkReason(markReasons, key, 'manual');
      next = addMarkReason(next, key, 'auto');
      setMarkReasons(next);
      markCursorRef.current = key;
      return;
    }

    let next = markReasons;
    for (const k of targets) {
      next = removeMarkReason(next, k, 'manual');
      next = removeMarkReason(next, k, 'auto');
    }
    setMarkReasons(next);
  };

  // Colour swatch: cycle colour only (does not mark); applies to the mouse
  // selection when the clicked row is selected. Ctrl/Cmd clears; Alt toggles `hidden`.
  const handleRailColorClick = (e: React.MouseEvent, key: string) => {
    e.stopPropagation();
    const targets = targetsForSelectionAction(key);
    if (e.altKey) {
      const turnOn = !hasMarkReason(markReasons, key, 'hidden');
      let next = markReasons;
      for (const k of targets) {
        next = turnOn ? addMarkReason(next, k, 'hidden') : removeMarkReason(next, k, 'hidden');
      }
      setMarkReasons(next);
      requestDisplayPinRef.current();
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      setMarkColorIndices(prev => {
        let colors = prev;
        for (const k of targets) colors = setMarkColorIndex(colors, k, null);
        return colors;
      });
      return;
    }
    setMarkColorIndices(prev => {
      const index = nextMarkColorIndex(prev, key);
      let colors = prev;
      for (const k of targets) colors = setMarkColorIndex(colors, k, index);
      return colors;
    });
  };

  const scrollToEdge = () => {
    cancelRubberBand();
    markProgrammatic();
    const el = parentRef.current;
    if (!el) return;
    // Settled edge: edge telegram flush with the viewport — not into fill rubber.
    el.scrollTop = settledEdgeScrollTop();
  };

  const jumpToLive = () => {
    // Pill path wants the jump to the merged newest — not a seamless pin.
    flushPinRef.current = false;
    pendingFlushScrollDeltaRef.current = null;
    revealRef.current = null;
    setStickyOppositeSpacerPx(0);
    jumpToLiveRef.current = true;
    enableLiveFollow();
    onJumpToLive?.();
    scrollToEdge();
  };

  // Scrolls to a specific row by index and stops live-following, so the
  // viewed rows stay put while new ones accumulate. Used by "quick goto time"
  // and the quick info bar's click-to-jump metrics (#282, #311).
  const gotoIndex = (idx: number) => {
    if (idx < 0 || idx >= telegramRows.length) return;
    atEdgeRef.current = false;
    detachedFromEdgeRef.current = true;
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
      detachedFromEdgeRef.current = true;
      setFollowingLive(false);
      onListFollowChange?.(false);
    }));
  };

  // Jump between marked rows (#442), in display order and wrapping around. The
  // starting point is the mark last jumped to or clicked; once the user scrolls
  // away it is whatever row sits in the middle of the viewport instead.
  // Prev/next jump every actionable mark (including context).
  const markedIndices = useMemo(() => {
    if (actionableMarkedSet.size === 0) return [];
    const out: number[] = [];
    telegramRows.forEach((r, i) => {
      if (actionableMarkedSet.has(anchorKey(r))) out.push(i);
    });
    return out;
  }, [telegramRows, actionableMarkedSet]);

  const viewportCenterIndex = () => {
    const el = parentRef.current;
    if (!el) return 0;
    const center = el.scrollTop + el.clientHeight / 2;
    const item = virtualizer.getVirtualItems().find(v => v.start <= center && center < v.end);
    return item ? item.index : 0;
  };

  const markNavFromIndex = () => {
    const cursor = markCursorRef.current;
    const cursorIdx = cursor ? telegramRows.findIndex(r => anchorKey(r) === cursor) : -1;
    return cursorIdx !== -1 ? cursorIdx : viewportCenterIndex();
  };

  const jumpToMark = (dir: 1 | -1) => {
    if (markedIndices.length === 0) return;
    const target = adjacentMark(markedIndices, markNavFromIndex(), dir);
    if (target == null) return;
    const key = anchorKey(telegramRows[target]);
    markCursorRef.current = key;
    gotoIndex(target);
    flashRow(key);
  };

  const markNavFrom = markNavFromIndex();
  const canJumpMarkPrev = adjacentMark(markedIndices, markNavFrom, -1) != null;
  const canJumpMarkNext = adjacentMark(markedIndices, markNavFrom, 1) != null;

  // "Quick goto time" (#282): jump to the telegram nearest a given time. Only
  // meaningful for the timestamp sort, where rows are ordered by time — the
  // info bar's jumps use gotoIndex directly since they already know the index.
  const gotoTime = (targetMs: number): number | null => {
    const rows = telegramRows;
    if (rows.length === 0) return null;
    let bestIdx = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < rows.length; i++) {
      const diff = Math.abs(new Date(rows[i].timestamp).getTime() - targetMs);
      if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
    }
    gotoIndex(bestIdx);
    return bestIdx;
  };

  // Hidden rows are absent from telegramRows; jump to the nearest visible time.
  const hiddenCursorRef = useRef<string | null>(null);
  const hiddenTelegramIndices = useMemo(() => {
    if (hiddenMarkedSet.size === 0) return [] as number[];
    const out: number[] = [];
    telegrams.forEach((t, i) => {
      if (hiddenMarkedSet.has(anchorKey(t))) out.push(i);
    });
    return out;
  }, [telegrams, hiddenMarkedSet]);

  const hiddenNavFromIndex = () => {
    const cursor = hiddenCursorRef.current;
    const cursorIdx = cursor ? telegrams.findIndex(r => anchorKey(r) === cursor) : -1;
    return cursorIdx !== -1 ? cursorIdx : 0;
  };

  const jumpToHidden = (dir: 1 | -1) => {
    if (hiddenTelegramIndices.length === 0) return;
    const target = adjacentMark(hiddenTelegramIndices, hiddenNavFromIndex(), dir);
    if (target == null) return;
    const tg = telegrams[target];
    if (!tg) return;
    hiddenCursorRef.current = anchorKey(tg);
    const ms = new Date(tg.timestamp).getTime();
    if (Number.isNaN(ms)) return;
    const landed = gotoTime(ms);
    if (landed != null) flashRow(anchorKey(telegramRows[landed]));
  };

  const hiddenNavFrom = hiddenNavFromIndex();
  const canJumpHiddenPrev = adjacentMark(hiddenTelegramIndices, hiddenNavFrom, -1) != null;
  const canJumpHiddenNext = adjacentMark(hiddenTelegramIndices, hiddenNavFrom, 1) != null;

  // Newest telegram time, used to seed the goto-time input.
  const newestMs = telegramRows.length > 0
    ? new Date(telegramRows[liveEdge === 'top' ? 0 : telegramRows.length - 1].timestamp).getTime()
    : null;

  const cancelPinAnim = () => {
    if (pinAnimRafRef.current) {
      cancelAnimationFrame(pinAnimRafRef.current);
      pinAnimRafRef.current = 0;
    }
    if (listContentRef.current) listContentRef.current.style.transform = '';
  };

  // Slow cubic ease-out, no overshoot — only for clamped (unavoidable) pin moves.
  const pinSettleEase = (t: number) => 1 - (1 - t) ** 3;

  /** Ease a visual remainder the scroll edge could not absorb (transform settle). */
  const animatePinVisualError = (visualError: number, flashKey?: string) => {
    const content = listContentRef.current;
    if (!content) {
      animateNextPinRef.current = false;
      return;
    }
    cancelPinAnim();
    animateNextPinRef.current = false;
    if (flashKey) flashRow(flashKey);
    // Row is `visualError` px away from the pin; shift content so it looks pinned,
    // then ease that fake offset away.
    const startY = -visualError;
    content.style.transform = `translateY(${startY}px)`;
    const durationMs = 700;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / durationMs);
      const y = startY * (1 - pinSettleEase(t));
      programmaticScrollRef.current = true;
      content.style.transform = Math.abs(y) < 0.5 ? '' : `translateY(${y}px)`;
      if (t < 1) {
        pinAnimRafRef.current = requestAnimationFrame(tick);
        return;
      }
      pinAnimRafRef.current = 0;
      content.style.transform = '';
      anchorRowsRef.current = telegramRowsRef.current;
      const anchor = anchorRef.current;
      if (anchor) {
        const o = rowOffset(anchor.key);
        if (o != null) anchor.offset = o;
      }
      requestAnimationFrame(() => { programmaticScrollRef.current = false; });
    };
    pinAnimRafRef.current = requestAnimationFrame(tick);
  };

  /**
   * Keep the pinned row still via scrollTop when possible. If an action-pin
   * cannot be restored because the scroll edge clamps, ease the remaining
   * visual jump; never animate a correctable (still-holding) pin.
   */
  const applyPinDelta = (el: HTMLElement, delta: number) => {
    if (Math.abs(delta) <= 0.5) {
      // Layout may still be settling after an action — keep the flag briefly.
      if (animateNextPinRef.current) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (animateNextPinRef.current && !pinAnimRafRef.current) {
              animateNextPinRef.current = false;
            }
          });
        });
      }
      return;
    }

    const wantClampAnim = animateNextPinRef.current;
    const { lo, hi } = pinScrollBounds(el, wantClampAnim);
    const clamped = Math.min(hi, Math.max(lo, el.scrollTop + delta));
    markProgrammatic();
    el.scrollTop = clamped;

    if (!wantClampAnim) return;

    const anchor = anchorRef.current;
    const after = anchor ? rowOffset(anchor.key) : null;
    if (!anchor || after == null) {
      animateNextPinRef.current = false;
      return;
    }
    const visualError = after - anchor.offset;
    if (Math.abs(visualError) > 0.5) {
      animatePinVisualError(visualError, anchor.key);
    } else {
      animateNextPinRef.current = false;
    }
  };

  /**
   * Jump the virtualizer so `anchor` lands at its saved viewport offset.
   * Used after list identity changes (QF/filter): set scrollTop from measured
   * item offsets in this layout turn so the row is not missing for a frame.
   */
  const seekPinnedRow = (el: HTMLElement, anchor: { key: string; offset: number }, idx: number) => {
    cancelPinAnim();
    refindingAnchorRef.current = true;
    // Ensure measurement cache is warm before reading offsets.
    void virtualizer.getTotalSize();
    // Prefer measurementsCache: getOffsetForIndex clamps to virtTotal-viewport,
    // which is 0 for short lists and would hide the fill-rubber start (43px).
    // The range comes from the scrollport (it includes the DOM opposite
    // spacer) minus the rubber zones — see pinScrollBounds.
    const itemStart =
      virtualizer.measurementsCache[idx]?.start
      ?? virtualizer.getOffsetForIndex(idx, 'start')?.[0]
      ?? fillRubberPx + idx * ROW_ESTIMATE;
    const { lo, hi } = pinScrollBounds(el, animateNextPinRef.current);
    const target = Math.min(hi, Math.max(lo, itemStart - anchor.offset));
    markProgrammatic();
    // Set scrollTop directly: scrollToOffset can re-clamp against virtTotal
    // (excluding the opposite spacer) and undo the short-list target.
    el.scrollTop = target;

    const finish = (found: number | null) => {
      if (found != null && anchorRef.current === anchor) {
        applyPinDelta(el, found - anchor.offset);
        if (!pinAnimRafRef.current) anchorRowsRef.current = telegramRowsRef.current;
      } else {
        animateNextPinRef.current = false;
      }
      requestAnimationFrame(() => {
        refindingAnchorRef.current = false;
        if (found == null) captureAnchor();
        else if (!pinAnimRafRef.current) pinAnchor();
      });
    };

    // Scroll notify often mounts the row before paint; fine-tune immediately.
    const immediate = rowOffset(anchor.key);
    if (immediate != null) {
      finish(immediate);
      return;
    }
    // Otherwise wait for the virtualizer to paint the new window.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      finish(rowOffset(anchor.key));
    }));
  };

  // Correct scrollTop so the anchored row keeps its recorded viewport offset.
  const pinAnchor = () => {
    const el = parentRef.current;
    const anchor = anchorRef.current;
    if (!el || !anchor || atEdgeRef.current) return;
    const listChanged = anchorRowsRef.current !== telegramRows;
    // Action pins cancel an in-flight clamp settle so QF/filter is not dropped.
    if (pinAnimRafRef.current) {
      if (!animateNextPinRef.current) return;
      cancelPinAnim();
    }
    const now = rowOffset(anchor.key);
    // After a list change, even a non-null offset can be a stale virtual cell —
    // always re-seek so the preferred row keeps its place on the first paint.
    const needsSeek = now == null || (animateNextPinRef.current && listChanged);
    if (needsSeek) {
      if (refindingAnchorRef.current) return;
      // A changed row list means rows were inserted, even while the user's
      // gesture that triggered the flush still counts as scrolling. Only an
      // unchanged list with a missing anchor is the user having jumped away.
      const inserted = listChanged || !userScrolling();
      const idx = inserted ? telegramRows.findIndex(r => anchorKey(r) === anchor.key) : -1;
      if (idx === -1) {
        animateNextPinRef.current = false;
        captureAnchor();
        return;
      }
      // Metered flush: pin from the virtualizer layout before paint — an async
      // scrollToIndex would flash the live edge. Display pins keep seekPinnedRow
      // (optional clamp animation).
      if (flushPinRef.current) {
        const start = virtualizer.measurementsCache[idx]?.start
          ?? virtualizer.getOffsetForIndex(idx, 'start')?.[0];
        if (start != null) {
          const max = Math.max(0, el.scrollHeight - el.clientHeight);
          markProgrammatic();
          el.scrollTop = Math.min(max, Math.max(0, start - anchor.offset));
          anchorRowsRef.current = telegramRows;
          refindingAnchorRef.current = true;
          requestAnimationFrame(() => requestAnimationFrame(() => {
            refindingAnchorRef.current = false;
            if (anchorRef.current !== anchor) return;
            const found = rowOffset(anchor.key);
            if (found == null) captureAnchor();
            else if (Math.abs(found - anchor.offset) > 0.5) {
              markProgrammatic();
              el.scrollTop += found - anchor.offset;
            }
          }));
          return;
        }
      }
      if (!listChanged && userScrolling()) return;
      seekPinnedRow(el, anchor, idx);
      return;
    }
    if (refindingAnchorRef.current) return;
    const delta = now - anchor.offset;
    applyPinDelta(el, delta);
    if (!pinAnimRafRef.current) anchorRowsRef.current = telegramRows;
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
    // Sort reorders the list — pin + flash the preferred working row.
    requestDisplayPinRef.current();
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
        markProgrammatic();
        virtualizer.scrollToIndex(idx, { align: 'start' });
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const offset = rowOffset(listAnchorKey);
          if (offset != null) {
            anchorRef.current = { key: listAnchorKey, offset };
            pinAnchor();
          }
        }));
      } else {
        jumpToLive();
      }
    } else {
      scrollToEdge();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [telegramRows.length]);

  // Write-to-bus last value: center that telegram. Mark it only when the exact
  // telegram survived the current filters; otherwise land on the nearest row
  // at that time and leave the marks alone.
  const appliedGotoId = useRef<number | null>(null);
  useEffect(() => {
    if (!gotoRequest || appliedGotoId.current === gotoRequest.id) return;
    if (telegramRows.length === 0) return;
    appliedGotoId.current = gotoRequest.id;
    const key = anchorKey(gotoRequest.telegram);
    const idx = telegramRows.findIndex(t => anchorKey(t) === key);
    if (idx !== -1) {
      gotoIndex(idx);
      setMarkReasons(prev => syncAutoForLatest(setSoleMarkReason(prev, 'goto', [key]), key));
      setLastMarked(key);
      markCursorRef.current = key;
      return;
    }
    const ms = new Date(gotoRequest.telegram.timestamp).getTime();
    if (!Number.isNaN(ms)) gotoTime(ms);
    // gotoIndex/gotoTime close over the rows of this render; appliedGotoId
    // keeps a later row update from jumping again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gotoRequest, telegramRows]);

  // React to list updates before paint: follow the live edge, or pin the
  // anchored row by correcting scrollTop by its real pixel shift.
  // Pause-buffer flush (isPaused true→false): always keep the viewport still
  // via pinAnchor — never scrollToEdge. A toward-newer gesture may then apply
  // its delta into the merged buffer so the pause rows blend in seamlessly.
  const prevRowsRef = useRef<{ firstKey: string | null; lastKey: string | null; len: number }>({
    firstKey: null, lastKey: null, len: 0,
  });
  const wasPausedRef = useRef(!!isPaused);
  /**
   * Apply the gesture delta held since the flush was armed. Returns the part
   * the scroll range clamped away (0 when it fit). The anchor is re-captured
   * at the new position, so later pins (remeasure, totalSize) hold it there
   * instead of undoing the gesture.
   */
  const applyPendingFlushScroll = (): number => {
    const delta = pendingFlushScrollDeltaRef.current;
    if (delta == null) return 0;
    pendingFlushScrollDeltaRef.current = null;
    const el = parentRef.current;
    if (!el) return 0;
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    const before = el.scrollTop;
    const target = Math.min(max, Math.max(0, before + delta));
    if (target === before) return delta;
    markProgrammatic();
    el.scrollTop = target;
    const applied = el.scrollTop - before;
    if (applied !== 0) {
      // Keep the (already measured) anchor row, at its new offset. Capturing a
      // freshly inserted row instead would pin an estimate: its remeasure then
      // shifts everything below it.
      const anchor = anchorRef.current;
      const now = anchor ? rowOffset(anchor.key) : null;
      if (anchor && now != null) anchorRef.current = { key: anchor.key, offset: now };
      else captureAnchor(null, { ignoreSelection: true });
    }
    return delta - applied;
  };
  const pinFlushViewport = () => {
    atEdgeRef.current = false;
    if (!anchorRef.current) captureAnchor(null, { ignoreSelection: true });
    pinAnchor();
  };
  /**
   * After a metered step landed: top the slice up while the fill slot is still
   * on screen (gesture outran the rows, or every revealed row was filtered
   * out). Returns true when another step was requested.
   */
  const continueRevealIfSlotOpen = (leftover: number, rowsLanded: boolean): boolean => {
    if (!backlogFeedActive()) return false;
    const el = parentRef.current;
    if (!el) return false;
    const overshoot = Math.abs(el.scrollTop - settledEdgeScrollTop());
    if (rowsLanded && !inFillRubberZone() && leftover === 0) return false;
    // Nothing visible came of the last slice: widen it so a filtered backlog
    // does not need one render per row.
    const prevN = revealRef.current?.n ?? 1;
    const n = rowsLanded
      ? revealCountFor(overshoot + Math.abs(leftover))
      : Math.max(1, Math.min(pausedCount, prevN * 2, REVEAL_MAX));
    requestReveal(leftover, n);
    return true;
  };
  useLayoutEffect(() => {
    const rows = telegramRows;
    const prev = prevRowsRef.current;
    const firstKey = rows.length > 0 ? anchorKey(rows[0]) : null;
    const lastKey = rows.length > 0 ? anchorKey(rows[rows.length - 1]) : null;
    prevRowsRef.current = { firstKey, lastKey, len: rows.length };

    const flushing = wasPausedRef.current && !isPaused;
    wasPausedRef.current = !!isPaused;
    const jumpingToLive = jumpToLiveRef.current;
    const pinArmed =
      !jumpingToLive
      && (flushing || flushPinRef.current || pendingFlushScrollDeltaRef.current != null);
    // A metered slice has landed when the backlog shrank since it was asked for.
    const reveal = revealRef.current;
    const revealLanded = reveal != null && pausedCount < reveal.before;
    const finishFlush = () => {
      flushPinRef.current = false;
      revealRef.current = null;
      syncFollowFromNewestVisibility();
      releaseStickySpacerIfFits();
    };

    if (isTimeSort && prev.len === 0 && rows.length > 0 && restoredRef.current) {
      // First rows after the list was emptied (buffer clear): the mount-time
      // restore does not run again, so scrollTop still sits at 0 — inside the
      // fill padding. Settle on the edge telegram when following or jumping,
      // otherwise the spacer stays on screen until the next telegram arrives.
      if (jumpToLiveRef.current || atEdgeRef.current) {
        jumpToLiveRef.current = false;
        atEdgeRef.current = true;
        scrollToEdge();
      }
      return;
    }
    // A display-pin (QF/filter toggle) already restored the preferred row —
    // do not clear that anchor because the live-edge key changed under us.
    if (suppressListRefilterEffectRef.current) {
      suppressListRefilterEffectRef.current = false;
      return;
    }
    if (!isTimeSort || prev.len === 0 || rows.length === 0) return;

    const edgeKey = liveEdge === 'top' ? firstKey : lastKey;
    const prevEdgeKey = liveEdge === 'top' ? prev.firstKey : prev.lastKey;
    if (!prevEdgeKey || edgeKey === prevEdgeKey) {
      if (jumpingToLive) {
        // Wait for the pause buffer to merge; keep the jump arm.
        return;
      }
      if (pinArmed && revealLanded) {
        // The slice landed but no row of it is visible (all filtered out):
        // ask for the next one, or settle the gesture if the backlog is gone.
        if (continueRevealIfSlotOpen(pendingFlushScrollDeltaRef.current ?? 0, false)) return;
        pinFlushViewport();
        applyPendingFlushScroll();
        finishFlush();
        return;
      }
      if (pinArmed) {
        // Intermediate unpause before rows merge — pin only; keep flush arm.
        pinFlushViewport();
      }
      return;
    }

    let added = -1;
    if (liveEdge === 'top') {
      for (let i = 0; i < rows.length; i++) if (anchorKey(rows[i]) === prevEdgeKey) { added = i; break; }
    } else {
      for (let i = rows.length - 1; i >= 0; i--) if (anchorKey(rows[i]) === prevEdgeKey) { added = rows.length - 1 - i; break; }
    }

    if (added <= 0) {
      // The previous edge row is gone — the list was replaced or refiltered
      // (e.g. Time-Delta-Context switched off). Keep holding the anchor if its
      // row survived (#435); otherwise start over. Zebra parity is tracked on
      // listForcePool, not here.
      const anchor = anchorRef.current;
      if (anchor && rows.some(r => anchorKey(r) === anchor.key)) {
        pinAnchor();
        return;
      }
      if (jumpingToLive) {
        jumpToLiveRef.current = false;
        scrollToEdge();
        return;
      }
      if (oppositeRubberBusy()) {
        return;
      }
      if (pinArmed) {
        pinFlushViewport();
        return;
      }
      anchorRef.current = null;
      onListAnchorKeyChange?.(null);
      return;
    }

    if (jumpingToLive) {
      jumpToLiveRef.current = false;
      atEdgeRef.current = true;
      scrollToEdge();
      return;
    }

    // Opposite rubber always finishes — ahead of pause-flush pin/delta.
    if (oppositeRubberBusy()) {
      return;
    }

    if (pinArmed) {
      // Seamless flush: pin + gesture delta only — never scrollToEdge.
      // Follow only if newest is still fully visible after the delta (user
      // landed on the live edge); a mid-backlog delta must not snap to edge.
      pinFlushViewport();
      const leftover = applyPendingFlushScroll();
      if (revealLanded && continueRevealIfSlotOpen(leftover, true)) return;
      finishFlush();
      return;
    }

    // Live prepend: only show the new row. Leave spacer / rubber / scrollTop alone
    // while overscrolled or mid-animation (no scrollToEdge, pin, or cancel).
    if (rubberAnimRef.current || inFillRubberZone() || inOppositeRubberZone()) {
      return;
    }

    if (atEdgeRef.current) {
      scrollToEdge();
      return;
    }

    pinAnchor();
    // pausedCount: a metered slice may land without changing the row list
    // (every revealed row filtered out) and still needs to be continued.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [telegramRows, isPaused, pausedCount]);

  const totalSize = virtualizer.getTotalSize();
  useLayoutEffect(() => {
    // Do not fight rubber overscroll / animation when rows remeasure / prepend.
    if (rubberAnimRef.current || inFillRubberBand() || inOppositeRubberZone()) return;
    pinAnchor();
    // Remeasured (shorter) rows can leave the fill slot open again while a
    // backlog waits: fill it rather than showing blank padding. Not before the
    // mount-time restore has placed the viewport (scrollTop is 0 until then).
    if (restoredRef.current && !flushPinRef.current && inFillRubberZone() && backlogFeedActive()) {
      engageLiveTowardNewer(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalSize]);

  // The opposite spacer sits above the rows when the live edge is at the
  // bottom: a change in its height (short-list pad, sticky release) shifts
  // every row, so hold the anchor across it.
  useLayoutEffect(() => {
    if (liveEdge !== 'bottom') return;
    if (rubberAnimRef.current || inFillRubberBand() || inOppositeRubberZone()) return;
    pinAnchor();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oppositeSpacerPx]);

  // Manual → auto pause while the fill spacer is on screen: the held spacer
  // becomes the slot for the oldest backlog telegram, which slides in next to
  // the edge row without moving it. The rest stays in the pause buffer and is
  // fed in line by line as the user keeps scrolling toward the live edge.
  const prevManualPauseRef = useRef(isManualPause);
  useLayoutEffect(() => {
    const wasManual = prevManualPauseRef.current;
    prevManualPauseRef.current = isManualPause;
    if (!wasManual || isManualPause) return;
    if (flushPinRef.current || !isTimeSort) return;
    if (!inFillRubberZone() || !backlogFeedActive()) return;
    if (!oppositeRubberBusy()) cancelRubberBand();
    atEdgeRef.current = false;
    armMeteredReveal(0, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isManualPause]);

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
    () => visibleCols
      .map((c, i) => {
        const w = widthFor(c.id);
        // Final column absorbs remaining horizontal space.
        return i === visibleCols.length - 1 ? `minmax(${w}px, 1fr)` : `${w}px`;
      })
      .join(' '),
    [visibleCols, widthFor],
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

  const isSameSortKeyValue = useCallback((a: TelegramRow, b: TelegramRow, key: SortKey): boolean => {
    const av = a[key];
    const bv = b[key];
    if (key === 'timestamp') {
      return new Date(av as string).getTime() === new Date(bv as string).getTime();
    }
    return av === bv;
  }, []);

  const shouldHideRepeatedOnSortLevel = useCallback((id: ColId, rowIndex: number, forceShow = false): boolean => {
    if (forceShow || rowIndex <= 0) return false;
    if (id === 'time' || id === 'delta') return false;
    if (!isHideRepeatedWhenSortedEnabled(id)) return false;
    const sortKey = COLUMNS.find(c => c.id === id)?.sortKey;
    if (!sortKey || sortKey === 'timestamp') return false;
    const levelIdx = sortConfig.findIndex(level => level.key === sortKey);
    if (levelIdx === -1) return false;
    const prev = telegramRows[rowIndex - 1];
    const curr = telegramRows[rowIndex];
    if (!prev || !curr) return false;
    for (let i = 0; i <= levelIdx; i++) {
      if (!isSameSortKeyValue(prev, curr, sortConfig[i].key)) return false;
    }
    return true;
  }, [isHideRepeatedWhenSortedEnabled, sortConfig, telegramRows, isSameSortKeyValue]);

  // ── Per-cell body content (keyed switch keeps body aligned with header order) ──
  const renderCell = (id: ColId, t: TelegramRow, rowIndex: number, forceShow = false): React.ReactNode => {
    if (shouldHideRepeatedOnSortLevel(id, rowIndex, forceShow)) {
      return <div style={{ padding: cellPadding, minWidth: 0, overflow: 'hidden' }} className="filterable-cell" />;
    }
    switch (id) {
      case 'time':
        return (
          <div style={{ padding: cellPadding }}>
            <div className="mono-addr" style={{ color: 'var(--text-main)', fontVariantNumeric: 'tabular-nums', fontWeight: 500 }}>
              {format(new Date(t.timestamp), 'HH:mm:ss.SS')}
            </div>
            <div className="subtitle-name" style={{ fontSize: '0.65rem', color: 'var(--text-dim)', marginTop: '0.15rem', fontVariantNumeric: 'tabular-nums' }}>
              {format(new Date(t.timestamp), 'yyyy-MM-dd')}
            </div>
          </div>
        );

      case 'delta': {
        // The "+" side (sort-dependent) hosts the per-row context flag instead
        // of a plus sign — only while QF is enabled and a context window is set.
        // Otherwise the plus glyph is shown, matching the minus side.
        const topSign = (t.deltaStr ?? '')[0];
        const bottomSign = (t.deltaNextStr ?? '')[0];
        let plusOnTop = timeSortDirection === 'asc';
        if (timeSortDirection === 'desc') plusOnTop = false;
        else if (timeSortDirection == null) {
          if (topSign === '+') plusOnTop = true;
          else if (bottomSign === '+') plusOnTop = false;
          else plusOnTop = false;
        }
        // Hide while QF is off, the ΔT column filter is disabled, delta-t is
        // toggled off, or both before/after are empty.
        const showContextControls = quickEnabled
          && isQuickColumnEnabled('delta')
          && activeFilters.deltaContextEnabled
          && (activeFilters.deltaBeforeMs > 0 || activeFilters.deltaAfterMs > 0);
        const rowKey = anchorKey(t);
        const flagged = anchorsContext(rowKey);
        const isContextRow = !!contextKeys?.has(rowKey);
        // Personal flag on a (former) context row — owns its own window even
        // while global "all" still covers filter matches.
        const personallyFlagged = flaggedSet.has(rowKey);
        const contextBtn = (
          <button
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer', padding: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              // Active: blue circle+plus; inactive: same glyph in the minus colour.
              color: flagged ? 'var(--accent-primary)' : 'var(--text-dim)',
            }}
            title={
              isContextRow && !personallyFlagged
                ? 'Show context around this message — give this context row its own window (applies to all selected rows)'
                : flagged
                  ? 'Context is shown around this message — click to switch it off (applies to all selected rows)'
                  : 'Show context around this message, regardless of the active filters (applies to all selected rows)'
            }
            onClick={e => handleFlagClick(e, rowKey)}
          >
            <PlusCircle size={12} />
          </button>
        );
        const lineParts = (text: string) => ({
          sign: text ? text[0] : '',
          value: text.length > 2 ? text.slice(2) : '',
        });
        const top = lineParts(t.deltaStr ?? '');
        const bottom = lineParts(t.deltaNextStr ?? '');
        const leading = (isPlusSlot: boolean, sign: string) => {
          if (isPlusSlot && showContextControls) return contextBtn;
          const glyph = isPlusSlot ? '+' : (sign === '-' ? '-' : '');
          return <span style={{ justifySelf: 'center' }}>{glyph}</span>;
        };
        return (
          <div
            className="mono-addr"
            style={{
              padding: cellPadding,
              display: 'grid',
              gridTemplateColumns: '12px 1fr',
              columnGap: '0.35rem',
              rowGap: '0.18rem',
              alignItems: 'center',
              fontSize: '0.65rem',
              color: 'var(--text-dim)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {leading(plusOnTop, top.sign)}
            <span>{top.value}</span>
            {leading(!plusOnTop, bottom.sign)}
            <span>{bottom.value}</span>
          </div>
        );
      }

      case 'source':
        return (
          <div style={{ padding: cellPadding, minWidth: 0, overflow: 'hidden' }} className="filterable-cell">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0 }}>
              <div className="mono-addr highlight" style={{ color: 'var(--text-dim)', fontWeight: 400 }}>
                {t.source_address}
              </div>
              <button
                className={`quick-filter-btn ${activeFilters.sources.includes(t.source_address) ? 'active' : ''}`}
                onClick={(e) => { e.stopPropagation(); onQuickFilter('sources', t.source_address); }}
                title="focus device"
              >
                <Search className="filter-icon" size={12} />
                <X className="cancel-icon" size={12} />
              </button>
              <button
                className="quick-visualize-btn"
                onClick={(e) => { e.stopPropagation(); onQuickVisualize(t.source_address); }}
                title="visualize this device"
              >
                <LineChart size={14} />
              </button>
              {onQuickLastSeen && (
                <button
                  className="quick-last-seen-btn"
                  onClick={(e) => { e.stopPropagation(); onQuickLastSeen(t.source_address, 'pa'); }}
                  title="show last seen values for this device"
                >
                  <Clock size={12} />
                </button>
              )}
            </div>
            {visibleColumns.sourceName && (
              <div className="subtitle-name" title={t.source_name || undefined} style={SOURCE_NAME_TEXT_STYLE}>
                {t.source_name || '-'}
              </div>
            )}
          </div>
        );

      case 'target':
        return (
          <div style={{ padding: cellPadding, minWidth: 0, overflow: 'hidden' }} className="filterable-cell">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0 }}>
              <div className="mono-addr highlight-target" style={{ color: 'var(--accent-primary)', fontWeight: 500 }}>
                {t.target_address}
              </div>
              <button
                className={`quick-filter-btn ${activeFilters.targets.includes(t.target_address) ? 'active' : ''}`}
                onClick={(e) => { e.stopPropagation(); onQuickFilter('targets', t.target_address); }}
                title="focus GA"
              >
                <Search className="filter-icon" size={12} />
                <X className="cancel-icon" size={12} />
              </button>
              <button
                className="quick-visualize-btn"
                onClick={(e) => { e.stopPropagation(); onQuickVisualize(t.target_address); }}
                title="visualize this GA"
              >
                <LineChart size={14} />
              </button>
              {onQuickLastSeen && (
                <button
                  className="quick-last-seen-btn"
                  onClick={(e) => { e.stopPropagation(); onQuickLastSeen(t.target_address, 'ga'); }}
                  title="show last seen values for this GA"
                >
                  <Clock size={12} />
                </button>
              )}
              {canSend && (
                <SendToGaPopover
                  address={t.target_address}
                  name={t.target_name}
                  dptMain={t.dpt_main}
                  dptSub={t.dpt_sub}
                  buttonClassName="quick-send-btn"
                />
              )}
            </div>
            {visibleColumns.targetName && (
              <div className="subtitle-name" title={t.target_name || undefined} style={SOURCE_NAME_TEXT_STYLE}>
                {t.target_name || '-'}
              </div>
            )}
          </div>
        );

      case 'type':
        return (
          <div style={{ padding: cellPadding, minWidth: 0, overflow: 'hidden' }} className="filterable-cell">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0 }}>
              <div style={{ color: getTypeColor(t.simplified_type), fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase' }}>
                {t.simplified_type || t.telegram_type}
              </div>
            </div>
            <div style={{ fontSize: '0.65rem', color: t.direction === 'Outgoing' ? 'var(--warning-text)' : 'var(--success)', marginTop: '0.1rem', opacity: 0.8 }}>
              {t.direction === 'Outgoing' ? 'Outgoing' : 'Incoming'}
            </div>
          </div>
        );

      case 'dpt':
        return (
          <div style={{ padding: cellPadding, minWidth: 0, overflow: 'hidden' }} className="filterable-cell">
            {t.dpt_main != null ? (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', minWidth: 0 }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0 }}>
                    <div title={getDPTLabel(t.dpt_main)} style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: getDPTColor(t.dpt_main), flexShrink: 0 }} />
                    <div
                      title={dptKeyLabel(t.dpt_main, t.dpt_sub) ?? undefined}
                      style={{ fontSize: '0.75rem', color: 'var(--text-main)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}
                    >
                      {dptKeyLabel(t.dpt_main, t.dpt_sub) ?? '-'}
                    </div>
                  </div>
                  <div
                    title={dptDescriptionLabel(t.dpt_name, t.unit) ?? undefined}
                    style={{ fontSize: '0.68rem', color: 'var(--text-dim)', marginTop: '0.12rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {dptDescriptionLabel(t.dpt_name, t.unit) ?? '-'}
                  </div>
                </div>
              </div>
            ) : '-'}
          </div>
        );

      case 'value':
        return (
          <div style={{ padding: cellPadding }} className="filterable-cell">
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 700, color: 'var(--accent-primary)', fontSize: '0.9375rem', wordBreak: 'break-all', whiteSpace: 'normal', lineHeight: 1.2 }}>
                {t.value_formatted || (t.value_numeric !== null ? String(t.value_numeric) : '-')}
              </span>
              {t.unit && <span style={{ fontSize: '0.7rem', color: 'var(--text-dim)', fontWeight: 500 }}>{t.unit}</span>}
            </div>
            {visibleColumns.data && t.raw_hex && (
              <div style={{ marginTop: '0.18rem', fontSize: '0.65rem', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                {t.raw_hex}
              </div>
            )}
          </div>
        );
    }
  };

  // Chips fill their column cell like quick-filter inputs (two rows / column).
  const infoChipStyle: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
    width: '100%', minWidth: 0, boxSizing: 'border-box',
    background: 'var(--bg-tag)', border: '1px solid var(--border-subtle)', borderRadius: '4px',
    padding: '0.15rem 0.45rem', fontSize: '0.68rem', color: 'var(--text-dim)',
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
  };
  const infoChipBtnStyle: React.CSSProperties = {
    ...infoChipStyle, cursor: 'pointer', background: 'transparent',
  };
  const infoColStyle: React.CSSProperties = {
    padding: '0.35rem 0.5rem', display: 'flex', flexDirection: 'column',
    gap: '0.25rem', minWidth: 0,
  };

  // Newer pill = filter-visible unmerged (pause backlog) + filter-visible
  // merged rows completely scrolled out toward the fill axis. Partial overlap
  // with the viewport does not count as out. `telegramRows` is already the
  // on-list (filter) set; `visiblePausedCount` is the filtered backlog.
  const virtualItems = virtualizer.getVirtualItems();
  let newerCount = 0;
  const rangeMeasured = virtualItems.some(item => item.size > 0);
  const scrollEl = parentRef.current;
  if (isTimeSort) {
    if (telegramRows.length === 0) {
      // Empty list: every filter-visible pill row (usually pause backlog) counts.
      newerCount = pillVisible.length;
    } else {
      let mergedOut = 0;
      if (rangeMeasured && scrollEl && virtualizer.getTotalSize() > 0) {
        mergedOut = countFillAxisScrolledOut(
          telegramRows.length,
          liveEdge,
          scrollEl.scrollTop,
          scrollEl.clientHeight,
          (i) => virtualizer.measurementsCache[i]?.start
            ?? virtualizer.getOffsetForIndex(i, 'start')?.[0],
          // Fall back to the estimate so fill-offscreen rows outside the
          // overscan window still count when the filter is off / list is long.
          (i) => virtualizer.measurementsCache[i]?.size ?? ROW_ESTIMATE,
        );
      }
      // Always add the filtered pause backlog — do not use Math.max (that
      // dropped unmerged rows whenever merged-out already exceeded them).
      newerCount = mergedOut + visiblePausedCount;
    }
  } else {
    newerCount = visiblePausedCount;
  }
  // Across a pause-buffer flush the measured count can briefly drop to 0 —
  // keep sticky only for that unpause frame or while the virtualizer is
  // unmeasured. Show the pill whenever there is a filter-visible backlog,
  // including manual pause while live-follow is still on. Empty list: no
  // sticky phantom after clear; pillVisible alone may still show arrivals.
  const rawNewerCount = newerCount;
  const justUnpaused = wasPausedRef.current && !isPaused;
  if (telegramRows.length === 0) {
    stickyNewerCountRef.current = 0;
  } else if (rawNewerCount > 0) {
    stickyNewerCountRef.current = rawNewerCount;
  } else if (followingLive || (rangeMeasured && !justUnpaused)) {
    stickyNewerCountRef.current = 0;
  }
  const displayNewerCount = rawNewerCount > 0
    ? rawNewerCount
    : (telegramRows.length > 0 && (!rangeMeasured || justUnpaused) ? stickyNewerCountRef.current : 0);
  displayNewerCountRef.current = displayNewerCount;

  // Thumb follows the same newer count as the pill (incl. sticky across flush).
  useLayoutEffect(() => {
    syncOverlayScrollbar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayNewerCount]);

  // Escape clears the mouse selection and drops OS focus (e.g. colour-swatch ring)
  // while focus is inside the table (not in an input).
  const tableRootRef = useRef<HTMLDivElement>(null);
  const handleTableKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    const target = e.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;

    const hadSelection = mouseSelectedKeys.length > 0
      || Object.keys(markReasons).some(k => hasMarkReason(markReasons, k, 'auto'));
    const ae = document.activeElement as HTMLElement | null;
    const focusInside = !!(ae && tableRootRef.current?.contains(ae));
    if (!hadSelection && !focusInside) return;

    e.preventDefault();
    e.stopPropagation();
    if (hadSelection) {
      setMarkReasons(prev => syncAutoForLatest(setSoleMarkReason(prev, 'mouse', []), null));
      setLastMarked(null);
    }
    // Park focus on the outline-less table root so the OS focus ring disappears
    // but Escape stays available for further clears.
    if (focusInside && ae !== tableRootRef.current) {
      ae.blur();
      tableRootRef.current?.focus({ preventScroll: true });
    }
  };

  return (
    <div
      ref={tableRootRef}
      tabIndex={-1}
      onKeyDown={handleTableKeyDown}
      onPointerDown={e => {
        // Keep the table keyboard-focusable for Escape without stealing focus from form controls.
        const t = e.target as HTMLElement | null;
        if (t?.closest('input, textarea, select, button, [contenteditable="true"]')) return;
        tableRootRef.current?.focus({ preventScroll: true });
      }}
      style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', outline: 'none' }}
    >
      {/* Quick info bar (#311): same column grid as the quick filter — two rows
          per column (oldest/newest, min/max Δt, counts, …). */}
      {infoOpen && infoMetrics && (
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-panel)', flexShrink: 0 }}>
          <div style={{ width: RAIL_WIDTH, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1, display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
              <button
                className="quick-filter-bar-toggle open"
                onClick={toggleInfoOpen}
                title="Hide info bar"
              >
                <ChevronDown size={13} />
              </button>
            </div>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }} />
          </div>
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: 'grid',
              gridTemplateColumns: gridTemplate,
              paddingRight: '8px',
            }}
          >
          {visibleCols.map(c => {
            if (c.id === 'time') {
              if (infoMetrics.count === 0) {
                return <div key={c.id} style={infoColStyle} />;
              }
              const oldestTs = format(new Date(telegramRows[infoMetrics.oldestIdx].timestamp), 'yyyy-MM-dd HH:mm:ss.SS');
              const newestTs = format(new Date(telegramRows[infoMetrics.newestIdx].timestamp), 'yyyy-MM-dd HH:mm:ss.SS');
              return (
                <div key={c.id} style={infoColStyle}>
                  <button
                    style={infoChipBtnStyle}
                    title={`Jump to the oldest telegram in the current view (${oldestTs})`}
                    onClick={() => gotoIndex(infoMetrics.oldestIdx)}
                  >
                    Oldest: {oldestTs}
                  </button>
                  <button
                    style={infoChipBtnStyle}
                    title={`Jump to the newest telegram in the current view (${newestTs})`}
                    onClick={() => gotoIndex(infoMetrics.newestIdx)}
                  >
                    Newest: {newestTs}
                  </button>
                </div>
              );
            }
            if (c.id === 'delta') {
              return (
                <div key={c.id} style={infoColStyle}>
                  {infoMetrics.minDeltaIdx !== -1 ? (
                    <button
                      style={infoChipBtnStyle} title="Jump to the smallest time gap in the current view"
                      onClick={() => gotoIndex(infoMetrics.minDeltaIdx)}
                    >
                      Min Δt: {telegramRows[infoMetrics.minDeltaIdx].deltaStr}
                    </button>
                  ) : <span style={{ ...infoChipStyle, visibility: 'hidden' }} aria-hidden>&nbsp;</span>}
                  {infoMetrics.maxDeltaIdx !== -1 ? (
                    <button
                      style={infoChipBtnStyle} title="Jump to the largest time gap in the current view"
                      onClick={() => gotoIndex(infoMetrics.maxDeltaIdx)}
                    >
                      Max Δt: {telegramRows[infoMetrics.maxDeltaIdx].deltaStr}
                    </button>
                  ) : <span style={{ ...infoChipStyle, visibility: 'hidden' }} aria-hidden>&nbsp;</span>}
                </div>
              );
            }
            if (c.id === 'source') {
              return (
                <div key={c.id} style={infoColStyle}>
                  <span style={infoChipStyle}>{infoMetrics.sourceCount} source{infoMetrics.sourceCount !== 1 ? 's' : ''}</span>
                  <span style={{ ...infoChipStyle, visibility: 'hidden' }} aria-hidden>&nbsp;</span>
                </div>
              );
            }
            if (c.id === 'target') {
              return (
                <div key={c.id} style={infoColStyle}>
                  <span style={infoChipStyle}>{infoMetrics.targetCount} target{infoMetrics.targetCount !== 1 ? 's' : ''}</span>
                  <span style={{ ...infoChipStyle, visibility: 'hidden' }} aria-hidden>&nbsp;</span>
                </div>
              );
            }
            if (c.id === 'type') {
              const types = infoMetrics.typeCounts;
              const allTitle = types.map(([t, n]) => `${t}: ${n}`).join(', ') || undefined;
              const top = types[0];
              const bottom = types[1];
              return (
                <div key={c.id} style={infoColStyle}>
                  {top
                    ? <span style={infoChipStyle} title={allTitle}>{top[0]}: {top[1]}</span>
                    : <span style={infoChipStyle}>0 types</span>}
                  {bottom
                    ? (
                      <span style={infoChipStyle} title={allTitle}>
                        {bottom[0]}: {bottom[1]}{types.length > 2 ? ` +${types.length - 2}` : ''}
                      </span>
                    )
                    : <span style={{ ...infoChipStyle, visibility: 'hidden' }} aria-hidden>&nbsp;</span>}
                </div>
              );
            }
            if (c.id === 'dpt') {
              return (
                <div key={c.id} style={infoColStyle}>
                  <span style={infoChipStyle}>{infoMetrics.dptCount} DPT{infoMetrics.dptCount !== 1 ? 's' : ''}</span>
                  <span style={{ ...infoChipStyle, visibility: 'hidden' }} aria-hidden>&nbsp;</span>
                </div>
              );
            }
            return (
              <div key={c.id} style={infoColStyle}>
                <span
                  style={infoChipStyle}
                  title={infoMetrics.contextCount > 0
                    ? 'Rows shown only as unfiltered Time-Delta-Context, not real filter matches (#343)'
                    : undefined}
                >
                  {infoMetrics.count} telegram{infoMetrics.count !== 1 ? 's' : ''}
                  {infoMetrics.contextCount > 0 ? ` · ${infoMetrics.contextCount} context` : ''}
                </span>
                {infoMetrics.count > 0 ? (
                  <div style={{ display: 'flex', gap: '0.25rem', minWidth: 0 }}>
                    {infoMetrics.peak && (
                      <button
                        style={{ ...infoChipBtnStyle, width: 'auto', flex: 1 }}
                        title="Most telegrams within one second in the current view — jump to the start of that burst"
                        onClick={() => gotoIndex(infoMetrics.peak!.startIdx)}
                      >
                        Max rate: {infoMetrics.peak.count}/s
                      </button>
                    )}
                    <button
                      style={{ ...infoChipBtnStyle, width: infoMetrics.peak ? 'auto' : '100%', flex: infoMetrics.peak ? undefined : 1 }}
                      title="Download the telegrams in the current view (all filters applied, in list order) as CSV"
                      onClick={() => downloadTelegramsCsv(telegramRows)}
                    >
                      <Download size={11} /> CSV
                    </button>
                  </div>
                ) : (
                  <span style={{ ...infoChipStyle, visibility: 'hidden' }} aria-hidden>&nbsp;</span>
                )}
              </div>
            );
          })}
          </div>
        </div>
      )}

      {/* Header */}
      <div
        style={{
          display: 'flex',
          background: 'var(--bg-tag)',
          zIndex: 10,
          backdropFilter: 'var(--glass-blur)',
          borderBottom: '1px solid var(--border-color)',
          flexShrink: 0,
        }}
      >
        {/* Left icon rail: show info / GotoTime / quick filter */}
        <div style={{ width: RAIL_WIDTH, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', gap: '0.15rem' }}>
            {showInfoBarToggle && (
              <button
                className="quick-filter-bar-toggle"
                onClick={toggleInfoOpen}
                title="Show info bar"
              >
                <ChevronUp size={13} />
              </button>
            )}
          </div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {isTimeSort && (
              <GotoTimeControl seedMs={newestMs} onGoto={gotoTime} />
            )}
          </div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
            {quickOpen ? (
              <button
                className={`quick-filter-bar-toggle ${quickEnabled ? 'open' : ''}`}
                onClick={handleQuickEnabledToggleClick}
                title={quickEnabled
                  ? 'Disable quick filter (keeps patterns) · ctrl/cmd-click clears all quick-filter cells'
                  : 'Enable quick filter · ctrl/cmd-click clears all quick-filter cells'}
              >
                <Filter size={13} />
              </button>
            ) : (
              <button
                className="quick-filter-bar-toggle"
                onClick={toggleQuickOpen}
                title="Show quick filter bar"
              >
                <ChevronDown size={13} />
              </button>
            )}
          </div>
        </div>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'grid',
            gridTemplateColumns: gridTemplate,
            color: 'var(--text-main)',
            fontSize: '0.65rem',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            fontWeight: 700,
            paddingRight: '8px',
          }}
        >
        {visibleCols.map((c, i) => (
          <div
            key={c.id}
            className={`header-col${draggingColumn === c.id ? ' drag-source' : ''}${dropTarget?.id === c.id ? ` drop-${dropTarget.side}` : ''}`}
            style={{ position: 'relative', display: 'flex', flexDirection: 'column', minWidth: 0 }}
            draggable
            onMouseDownCapture={e => { dragOriginRef.current = e.target; }}
            onDragStart={e => {
              const origin = dragOriginRef.current;
              if (origin instanceof Element && origin.closest('input, textarea, select, .col-resize-handle')) {
                e.preventDefault();
                return;
              }
              setDraggingColumn(c.id);
              e.dataTransfer.setData('text/plain', c.id);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={e => {
              if (!draggingColumn || draggingColumn === c.id) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              const rect = e.currentTarget.getBoundingClientRect();
              const side = e.clientX - rect.left < rect.width / 2 ? 'before' : 'after';
              if (dropTarget?.id !== c.id || dropTarget.side !== side) setDropTarget({ id: c.id, side });
            }}
            onDrop={e => {
              e.preventDefault();
              dropColumn(c.id, dropTarget?.id === c.id ? dropTarget.side : 'before');
            }}
            onDragEnd={endColumnDrag}
          >
            <div style={{ flex: 1, minHeight: '1.3rem', padding: '0 1rem', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: '0.4rem' }}>
              {c.id === 'delta' && quickEnabled
                && isQuickColumnEnabled('delta')
                && activeFilters.deltaContextEnabled
                && (activeFilters.deltaBeforeMs > 0 || activeFilters.deltaAfterMs > 0) && (
                <span
                  onClick={e => {
                    e.stopPropagation();
                    handleDeltaToggleClick(e);
                  }}
                  title={
                    deltaFlagState === 'all'
                      ? 'Time-Delta-Context: around all messages. Click to switch it off for all of them. Ctrl/cmd-click to also set the button on visible context rows.'
                      : deltaFlagState === 'some'
                        ? 'Time-Delta-Context: around the flagged messages only. Click to clear the flags. Ctrl/cmd-click to show it around all messages.'
                        : 'Time-Delta-Context: around no message. Click to show it around all messages.'
                  }
                  style={{
                    display: 'flex', alignItems: 'center', userSelect: 'none',
                    cursor: 'pointer',
                    // all: blue +circle; none/some: empty circle (grey / blue)
                    color: deltaFlagState === 'none' ? 'var(--text-dim)' : 'var(--accent-primary)',
                  }}
                >
                  {deltaFlagState === 'all'
                    ? <PlusCircle size={12} />
                    : <Circle size={12} />}
                </span>
              )}
              {(c.id === 'source' || c.id === 'target') && (() => {
                const focusChecked = c.id === 'source' ? sourceFocusOnly : targetFocusOnly;
                const focusCategory = c.id === 'source' ? 'pa' : 'ga';
                return (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', opacity: focusFilterDisabled ? 0.4 : 1 }}>
                    <span
                      onClick={e => {
                        e.stopPropagation();
                        if (focusFilterDisabled) return;
                        if (c.id === 'source') setSourceFocusOnly(!sourceFocusOnly);
                        else setTargetFocusOnly(!targetFocusOnly);
                        requestDisplayPinRef.current();
                      }}
                      title={c.id === 'source'
                        ? 'Show only telegrams whose source is flagged for the Telegram List in the Focus panel'
                        : 'Show only telegrams whose target is flagged for the Telegram List in the Focus panel'}
                      style={{
                        display: 'flex', alignItems: 'center', userSelect: 'none',
                        cursor: focusFilterDisabled ? 'default' : 'pointer',
                        color: focusChecked ? 'var(--accent-primary)' : 'var(--text-dim)',
                      }}
                    >
                      <List size={12} />
                    </span>
                    <span
                      onClick={e => {
                        e.stopPropagation();
                        onFocusCategorySelect?.(focusCategory);
                      }}
                      title={c.id === 'source'
                        ? 'Switch the Focus panel to Devices'
                        : 'Switch the Focus panel to Group Addresses'}
                      style={{
                        fontWeight: 400, fontSize: '0.68rem', color: 'var(--text-dim)',
                        textTransform: 'none', letterSpacing: 'normal', userSelect: 'none',
                        cursor: onFocusCategorySelect ? 'pointer' : 'default',
                      }}
                    >
                      focus
                    </span>
                  </span>
                );
              })()}
            </div>
            <div style={{ flex: 1, minHeight: '1.3rem', padding: '0 1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              {c.id === 'delta' ? (
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
                  onClick={(e) => {
                    if (e.altKey && c.id !== 'time' && c.id !== 'delta') {
                      e.preventDefault();
                      toggleHideRepeatedWhenSortedForColumn(c.id);
                      return;
                    }
                    handleColumnSort(c.sortKey!, { additive: e.ctrlKey || e.metaKey });
                  }}
                  title="Click to sort · ctrl/cmd-click to add as a further sort level (TIME is always the deepest tiebreaker) · alt-click toggles repeated-value hiding"
                >
                  {c.label} {renderSortArrow(c.sortKey)}
                </button>
              ) : (
                <span>{c.label}</span>
              )}
            </div>
            <div style={{ flex: 1, minHeight: '1.3rem', padding: '0 1rem', display: 'flex', alignItems: 'flex-end', justifyContent: 'flex-start', gap: '0.4rem' }}>
              {quickOpen && quickEnabled && (
                <button
                  className={`quick-filter-bar-toggle ${isQuickColumnEnabled(c.id) ? 'open' : ''}`}
                  onClick={(e) => handleQuickColumnToggleClick(e, c.id)}
                  title={c.id === 'delta'
                    ? (activeFilters.deltaContextEnabled
                      ? 'Time-Delta-Context: on · ctrl/cmd-click disables the window (keeps values)'
                      : 'Time-Delta-Context: off · ctrl/cmd-click enables the window')
                    : isQuickColumnEnabled(c.id)
                      ? `Disable quick filter for ${c.label} · ctrl/cmd-click clears this column's quick-filter cells`
                      : `Enable quick filter for ${c.label} · ctrl/cmd-click clears this column's quick-filter cells`}
                >
                  <Filter size={12} />
                </button>
              )}
            </div>
            {i < visibleCols.length - 1 && (
              <div
                className="col-resize-handle"
                onMouseDown={(e) => handleResizeStart(e, c)}
                onDoubleClick={() => handleResetWidth(c)}
                title="Drag to resize · double-click to reset"
              />
            )}
          </div>
        ))}
        </div>
      </div>

      {/* Quick filter bar (#271, #309) — two rows per column.
          Disabled opacity applies to inputs/delta only; the hide toggle stays
          full-strength like the info-bar hide control. */}
      {quickOpen && (
        <div style={{ display: 'flex', background: 'var(--bg-panel)', borderBottom: '1px solid var(--border-color)', flexShrink: 0 }}>
          <div style={{ width: RAIL_WIDTH, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }} />
            <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
              <button
                className="quick-filter-bar-toggle open"
                onClick={toggleQuickOpen}
                title="Hide quick filter bar"
              >
                <ChevronUp size={13} />
              </button>
            </div>
          </div>
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: 'grid',
              gridTemplateColumns: gridTemplate,
              paddingRight: '8px',
              opacity: quickEnabled ? 1 : 0.5,
            }}
          >
          {visibleCols.map(c => (
            <div key={c.id} style={{
              padding: '0.35rem 0.5rem',
              display: 'flex',
              alignItems: 'flex-start',
              gap: '0.35rem',
              minWidth: 0,
              opacity: isQuickColumnEnabled(c.id) ? 1 : 0.45,
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', minWidth: 0, flex: 1 }}>
                {c.id === 'delta' ? (
                  <>
                    <input
                      className="quick-filter-bar-input"
                      type="number" min={0} step={10}
                      value={activeFilters.deltaBeforeMs || ''}
                      placeholder="before ms"
                      aria-label="Time-Delta-Context before (ms)"
                      disabled={!isQuickColumnEnabled(c.id)}
                      style={{ opacity: isQuickColumnEnabled(c.id) ? (activeFilters.deltaContextEnabled ? 1 : 0.5) : 0.45 }}
                      onChange={e => onDeltaContextChange?.(Math.max(0, Number(e.target.value) || 0), activeFilters.deltaAfterMs)}
                    />
                    <input
                      className="quick-filter-bar-input"
                      type="number" min={0} step={10}
                      value={activeFilters.deltaAfterMs || ''}
                      placeholder="after ms"
                      aria-label="Time-Delta-Context after (ms)"
                      disabled={!isQuickColumnEnabled(c.id)}
                      style={{ opacity: isQuickColumnEnabled(c.id) ? (activeFilters.deltaContextEnabled ? 1 : 0.5) : 0.45 }}
                      onChange={e => onDeltaContextChange?.(activeFilters.deltaBeforeMs, Math.max(0, Number(e.target.value) || 0))}
                    />
                  </>
                ) : c.id === 'type' ? (
                  <>
                    <input
                      className="quick-filter-bar-input"
                      type="text"
                      value={currentPatterns.type?.top ?? ''}
                      placeholder="type regex…"
                      aria-label="Quick filter TYPE"
                      disabled={!isQuickColumnEnabled(c.id)}
                      onChange={e => setQuickCell('type', 'top', e.target.value)}
                    />
                    <input
                      className="quick-filter-bar-input"
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
                      className="quick-filter-bar-input"
                      type="datetime-local" step="1"
                      value={currentPatterns.time?.top ?? ''}
                      aria-label="Quick filter TIME from"
                      disabled={!isQuickColumnEnabled(c.id)}
                      onChange={e => setQuickCell('time', 'top', e.target.value)}
                    />
                    <input
                      className="quick-filter-bar-input"
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
                      className="quick-filter-bar-input"
                      type="text"
                      value={currentPatterns.value?.top ?? ''}
                      placeholder={'from / 0x.. / 0b.. / "regex"'}
                      aria-label="Quick filter VALUE from"
                      disabled={!isQuickColumnEnabled(c.id)}
                      onChange={e => setQuickCell('value', 'top', e.target.value)}
                    />
                    <input
                      className="quick-filter-bar-input"
                      type="text"
                      value={currentPatterns.value?.bottom ?? ''}
                      placeholder="to / pattern…"
                      aria-label="Quick filter VALUE to"
                      disabled={!isQuickColumnEnabled(c.id)}
                      onChange={e => setQuickCell('value', 'bottom', e.target.value)}
                    />
                  </>
                ) : (
                  <>
                    <input
                      className="quick-filter-bar-input"
                      type="text"
                      value={currentPatterns[c.id]?.top ?? ''}
                      placeholder={c.id === 'dpt' ? '1.008-1.011, 16.*' : c.id === 'source' ? '*.1.*, 1.2.12-1.2.91' : '1/5/*, 3/1/1-3/1/127'}
                      aria-label={`Quick filter ${c.label} pattern`}
                      disabled={!isQuickColumnEnabled(c.id)}
                      onChange={e => setQuickCell(c.id, 'top', e.target.value)}
                    />
                    <input
                      className="quick-filter-bar-input"
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
      )}

      {/* Body area — relative wrapper so the jump-to-live pill (#202) anchors
          below the header, not over it. */}
      <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Jump-to-live pill — telegrams newer than the newest one on screen
          (including pause-buffer backlog while follow is still on). */}
      {isTimeSort && displayNewerCount > 0 && (
        <button
          onClick={jumpToLive}
          className="jump-to-live-pill"
          data-edge={liveEdge}
          style={{
            position: 'absolute', left: '50%', zIndex: 20,
            ...(liveEdge === 'top'
              ? { top: EDGE_PILL_CENTER, transform: 'translate(-50%, -50%)' }
              : { bottom: EDGE_PILL_CENTER, transform: 'translate(-50%, 50%)' }),
          }}
          title="Jump back to the live edge"
        >
          {liveEdge === 'top' ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {displayNewerCount.toLocaleString()} {displayNewerCount === 1 ? 'newer telegram' : 'newer telegrams'}
        </button>
      )}

      {/* Fill-spacer overlay: Pause tooltip copy, only while manually paused and
          the fill rubber band is fully on screen. */}
      {showFillPauseLabels && fillRubberPx > 0 && (
        <Fragment key={fillPauseFadeKey}>
          <div
            aria-hidden
            className="fill-rubber-pause-label"
            data-testid="fill-rubber-pause-label-left"
            style={{
              left: 0,
              width: '50%',
              height: fillRubberPx,
              [liveEdge]: 0,
              zIndex: 19,
            }}
          >
            ...paused manually...
          </div>
          <div
            aria-hidden
            className="fill-rubber-pause-label"
            data-testid="fill-rubber-pause-label-right"
            style={{
              right: 0,
              width: '50%',
              height: fillRubberPx,
              [liveEdge]: 0,
              zIndex: 19,
            }}
          >
            ...paused manually...
          </div>
        </Fragment>
      )}

      {/* Marks pill — visible marks (top) and hidden marks (bottom) when present.
          Vertically centered on the same edge band as the newer pill (1- and 2-line).
          Pointer events stay on the pill so the row underneath is never selected. */}
      {(actionableMarkedKeys.length > 0 || hiddenMarkedKeys.length > 0) && (
        <div
          className="marks-pill"
          style={{
            position: 'absolute',
            right: EDGE_PILL_INSET,
            top: EDGE_PILL_CENTER,
            transform: 'translateY(-50%)',
            zIndex: 20,
          }}
          onPointerDown={e => e.stopPropagation()}
          onMouseDown={e => {
            e.stopPropagation();
            e.preventDefault();
          }}
          onClick={e => e.stopPropagation()}
        >
          {actionableMarkedKeys.length > 0 && (
            <div className="marks-pill-row">
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  if (!canJumpMarkPrev) return;
                  jumpToMark(-1);
                }}
                aria-disabled={!canJumpMarkPrev}
                title="Jump to previous mark"
              >
                <ChevronUp size={14} />
              </button>
              {!twoLineMarksPill && (
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    if (!canJumpMarkNext) return;
                    jumpToMark(1);
                  }}
                  aria-disabled={!canJumpMarkNext}
                  title="Jump to next mark"
                >
                  <ChevronDown size={14} />
                </button>
              )}
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  clearMarks();
                }}
                className="marks-pill-clear"
                title="Clear all marks"
              >
                <X size={13} /> Clear {actionableMarkedKeys.length} mark{actionableMarkedKeys.length === 1 ? '' : 's'}
              </button>
            </div>
          )}
          {hiddenMarkedKeys.length > 0 && (
            <div className="marks-pill-row">
              {!twoLineMarksPill && (
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    if (!canJumpHiddenPrev) return;
                    jumpToHidden(-1);
                  }}
                  aria-disabled={!canJumpHiddenPrev}
                  title="Jump to previous hidden"
                >
                  <ChevronUp size={14} />
                </button>
              )}
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  if (!canJumpHiddenNext) return;
                  jumpToHidden(1);
                }}
                aria-disabled={!canJumpHiddenNext}
                title="Jump to next hidden"
              >
                <ChevronDown size={14} />
              </button>
              <button
                type="button"
                onClick={e => {
                  e.stopPropagation();
                  clearHidden();
                }}
                className="marks-pill-clear"
                title="Clear all hidden"
              >
                <X size={13} /> Clear {hiddenMarkedKeys.length} hidden
              </button>
            </div>
          )}
        </div>
      )}

      {/* Virtualized Body */}
      <div
        ref={parentRef}
        onScroll={handleScroll}
        onWheel={e => handleScrollGesture(e.deltaY)}
        onTouchMove={noteUserScroll}
        // A press on the container itself (not on a row) is the scrollbar.
        onPointerDown={e => {
          if (e.target !== e.currentTarget) return;
          scrollbarHeldRef.current = true;
          lockScrollGeometry();
        }}
        // overflow-anchor off: we compensate scrollTop manually on prepend (#202),
        // so the browser's native anchoring must not also move the viewport.
        // paddingRight reserves space for the visual overlay scrollbar track.
        style={{
          flex: 1,
          overflowY: 'auto',
          position: 'relative',
          overflowAnchor: 'none',
          paddingRight: LIST_SB_WIDTH_PX,
        }}
        className="custom-scrollbar"
      >
        {telegramRows.length === 0 ? (
          <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-dim)', fontSize: '0.875rem' }}>
            No data available.
          </div>
        ) : (
          <>
            {/* Opposite short-list travel sits outside the virtualizer; fill rubber is paddingStart/End. */}
            {liveEdge === 'bottom' && oppositeSpacerPx > 0 && (
              <div aria-hidden style={{ height: `${oppositeSpacerPx}px`, width: '100%' }} />
            )}
            <div
              ref={listContentRef}
              style={{
                height: `${virtTotalPx}px`,
                width: '100%',
                position: 'relative'
              }}
            >
            {(() => {
              const virtualItems = virtualizer.getVirtualItems();
              const firstVisibleRowIndex = virtualItems[0]?.index ?? -1;
              return virtualItems.map((virtualRow) => {
              const t = telegramRows[virtualRow.index];
              const key = anchorKey(t);
              // Row wash follows mouse (multi)selection only — not manual/goto marks.
              const mouseSelected = hasMarkReason(markReasons, key, 'mouse');
              const manualMarked = hasMarkReason(markReasons, key, 'manual');
              const autoMarked = hasMarkReason(markReasons, key, 'auto');
              const railMarked = manualMarked || autoMarked;
              const inContext = !!contextKeys?.has(key);
              const latest = mouseSelected && key === lastMarked;
              // Context wash stays for every context row (soft `context` reason).
              const isContext = !mouseSelected && inContext;
              const railSigns = inContext && contextAnchorTimestamps.length > 0
                ? contextRailSigns(
                  new Date(t.timestamp).getTime(),
                  contextAnchorTimestamps,
                  deltaBeforeMs,
                  deltaAfterMs,
                )
                : { before: false, after: false };
              // Row colour index (if set) takes precedence over address-based colours.
              const markColor = markColorFromIndex(markColorIndices[key]);
              const targetColor = markColor ?? activeTargetColors[t.target_address];
              const railTitle = railMarked ? 'Unmark this message' : 'Mark this message';
              // Rail fill: colour when set; else context wash; user `manual` on
              // the latest row uses latest wash; `auto` / other manuals use
              // selected-but-not-latest wash. Body only.
              const railBackground = !railMarked
                ? undefined
                : markColor
                  ? `color-mix(in srgb, ${markColor} 34%, transparent)`
                  : inContext
                    ? CONTEXT_WASH
                    : (latest && manualMarked)
                      ? MOUSE_LATEST_WASH
                      : MOUSE_SELECTED_WASH;
              const poolIndex = stripeIndexByKey.get(key);
              const zebra = ((poolIndex ?? virtualRow.index) + stripeOffset) % 2 === 0
                ? 'var(--bg-subtle)'
                : 'transparent';
              const rowWash = latest
                ? MOUSE_LATEST_WASH
                : mouseSelected
                  ? MOUSE_SELECTED_WASH
                  : isContext
                    ? CONTEXT_WASH
                    : targetColor
                      ? `color-mix(in srgb, ${targetColor} 9%, transparent)`
                      : zebra;
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  data-akey={key}
                  onMouseDown={handleMarkMouseDown}
                  onClick={e => handleMarkClick(e, key, virtualRow.index)}
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
                    background: zebra,
                    alignItems: 'start',
                    minHeight: '60px', // Ensure a minimum touch/visual target
                    userSelect: 'text',
                  }}
                  title={inContext ? 'Unfiltered Time-Delta-Context — this telegram did not match the active filters' : undefined}
                  className={`log-row${mouseSelected ? ' marked' : ''}${latest ? ' latest' : ''}${isContext ? ' context' : ''}${rowFlash?.key === key ? ' row-flash' : ''}`}
                  data-flash-gen={rowFlash?.key === key ? rowFlash.gen : undefined}
                  onAnimationEnd={e => {
                    if (e.animationName !== 'row-flash-fade') return;
                    if (e.target !== e.currentTarget) return;
                    setRowFlash(prev => (prev?.key === key ? null : prev));
                  }}
                >
                  {/* Rail: click anywhere to mark; colour swatch also cycles colour. */}
                  <div
                    role="button"
                    tabIndex={0}
                    title={railTitle}
                    onClick={e => handleRailMarkClick(e, key)}
                    onKeyDown={e => {
                      if (e.key !== 'Enter' && e.key !== ' ') return;
                      e.preventDefault();
                      handleRailMarkClick(e as unknown as React.MouseEvent, key);
                    }}
                    style={{
                      width: RAIL_WIDTH,
                      flexShrink: 0,
                      alignSelf: 'stretch',
                      display: 'grid',
                      gridTemplateRows: '1fr auto 1fr',
                      background: railBackground,
                      cursor: 'pointer',
                    }}
                  >
                    <div
                      aria-label={railSigns.before ? 'Context before an anchored telegram' : undefined}
                      data-context-rail={railSigns.before ? 'before' : undefined}
                      style={{
                        minHeight: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--text-dim)',
                        fontSize: '0.7rem',
                        fontVariantNumeric: 'tabular-nums',
                        lineHeight: 1,
                      }}
                    >
                      {railSigns.before ? '∧' : null}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '0.15rem 0',
                      }}
                    >
                      <button
                        type="button"
                        aria-label={markColor ? 'Row colour' : 'Set row colour'}
                        title={markColor
                          ? 'Row colour — click for the next colour (Ctrl-click to clear, Alt-click to hide)'
                          : 'Set a row colour (Alt-click to hide)'}
                        onClick={e => handleRailColorClick(e, key)}
                        style={{
                          width: RAIL_COLOR_SWATCH_SIZE,
                          height: RAIL_COLOR_SWATCH_SIZE,
                          flexShrink: 0,
                          padding: 0,
                          borderRadius: '50%',
                          cursor: 'pointer',
                          background: markColor ?? 'transparent',
                          border: markColor
                            ? `1.5px solid ${markColor}`
                            : '1.5px dashed var(--text-dim)',
                          // Colour without a manual mark stays visible but dimmed.
                          opacity: !markColor ? 0.45 : railMarked ? 1 : 0.45,
                        }}
                      />
                    </div>
                    <div
                      aria-label={railSigns.after ? 'Context after an anchored telegram' : undefined}
                      data-context-rail={railSigns.after ? 'after' : undefined}
                      style={{
                        minHeight: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--text-dim)',
                        fontSize: '0.7rem',
                        fontVariantNumeric: 'tabular-nums',
                        lineHeight: 1,
                      }}
                    >
                      {railSigns.after ? '∨' : null}
                    </div>
                  </div>
                  <div
                    style={{
                      flex: 1,
                      minWidth: 0,
                      display: 'grid',
                      gridTemplateColumns: gridTemplate,
                      alignItems: 'start',
                      alignSelf: 'stretch',
                      background: rowWash,
                    }}
                  >
                    {visibleCols.map(c => (
                      <React.Fragment key={c.id}>
                        {renderCell(c.id, t, virtualRow.index, virtualRow.index === firstVisibleRowIndex)}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              );
            });
            })()}
            </div>
            {liveEdge === 'top' && oppositeSpacerPx > 0 && (
              <div aria-hidden style={{ height: `${oppositeSpacerPx}px`, width: '100%' }} />
            )}
          </>
        )}
      </div>

      {/* Visual scrollbar only — thumb sized as if pausedCount rows were in
          scrollHeight; real scrollHeight / scroll behavior unchanged.
          Always mounted; syncOverlayScrollbar toggles display. */}
      <div
        ref={sbTrackRef}
        className="list-sb-track"
        data-testid="list-scrollbar-track"
        aria-hidden
        style={{ display: 'none' }}
        onPointerDown={onSbTrackPointerDown}
      >
        <div
          ref={sbThumbRef}
          className="list-sb-thumb"
          data-testid="list-scrollbar-thumb"
          onPointerDown={onSbThumbPointerDown}
          onPointerMove={onSbThumbPointerMove}
          onPointerUp={onSbThumbPointerUp}
          onPointerCancel={onSbThumbPointerUp}
        />
      </div>
      </div>
    </div>
  );
};

// Add styles for quick filter buttons and resize handles.
// Replace by id so HMR does not leave stale rules (e.g. old user-select:none).
const TELEGRAM_TABLE_STYLE_ID = 'telegram-table-injected-styles';
const style = (document.getElementById(TELEGRAM_TABLE_STYLE_ID) as HTMLStyleElement | null)
  ?? document.createElement('style');
style.id = TELEGRAM_TABLE_STYLE_ID;
style.textContent = `
  /* Hide native scrollbar on the telegram list port — overlay thumb paints instead. */
  .custom-scrollbar {
    scrollbar-width: none;
  }
  .custom-scrollbar::-webkit-scrollbar {
    width: 0;
    height: 0;
  }

  .list-sb-track {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: ${LIST_SB_WIDTH_PX}px;
    z-index: 15;
    pointer-events: auto;
  }

  .list-sb-thumb {
    position: absolute;
    left: 0;
    width: 100%;
    background: var(--scrollbar-thumb);
    border-radius: 10px;
    cursor: default;
    pointer-events: auto;
  }

  .list-sb-thumb:hover {
    background: var(--scrollbar-thumb-hover);
  }

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

  .quick-filter-btn.active {
    opacity: 1;
    color: var(--accent-primary);
  }

  .quick-filter-btn .cancel-icon {
    display: none;
  }

  .quick-filter-btn.active:hover .filter-icon {
    display: none;
  }

  .quick-filter-btn.active:hover .cancel-icon {
    display: block;
    color: var(--error); /* red for cancel */
  }

  .log-row:hover .quick-filter-btn:not(.active),
  .log-row:hover .quick-visualize-btn,
  .log-row:hover .quick-last-seen-btn,
  .log-row:hover .quick-send-btn {
    opacity: 0.6;
  }

  /* Temporary inner outline — colour from --row-flash-border (theme). */
  .log-row.row-flash {
    animation: row-flash-fade 1.4s ease-out forwards;
  }

  @keyframes row-flash-fade {
    0%, 35% {
      box-shadow: inset 0 0 0 1px var(--row-flash-border);
    }
    100% {
      box-shadow: inset 0 0 0 1px transparent;
    }
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

  @keyframes fill-pause-label-fade {
    from { color: var(--text-main); }
    to { color: var(--text-dim); }
  }

  .fill-rubber-pause-label {
    position: absolute;
    display: flex;
    justify-content: center;
    align-items: center;
    font-style: italic;
    font-size: 0.75rem;
    font-weight: 500;
    pointer-events: none;
    white-space: nowrap;
    overflow: hidden;
    color: var(--text-dim);
    animation: fill-pause-label-fade 550ms ease-out forwards;
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
  }
  .jump-to-live-pill[data-edge="top"]:hover {
    transform: translate(-50%, -50%) scale(1.03);
  }
  .jump-to-live-pill[data-edge="bottom"]:hover {
    transform: translate(-50%, 50%) scale(1.03);
  }

  .marks-pill {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    border: 1px solid var(--border-color);
    border-radius: 12px;
    background: var(--bg-panel);
    box-shadow: var(--shadow-lg);
    overflow: hidden;
  }

  .marks-pill-row {
    display: flex;
    align-items: stretch;
  }

  .marks-pill-row + .marks-pill-row {
    border-top: 1px solid var(--border-color);
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

  .marks-pill-row button:first-child {
    padding-left: 0.6rem;
  }

  .marks-pill .marks-pill-clear {
    padding-right: 0.7rem;
    border-left: 1px solid var(--border-color);
  }

  .marks-pill button:hover:not([aria-disabled="true"]) {
    color: var(--accent-primary);
    background: var(--bg-hover);
  }

  .marks-pill button[aria-disabled="true"] {
    opacity: 0.4;
    cursor: default;
  }

  .quick-filter-bar-toggle {
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--text-dim);
    padding: 0.05rem;
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

  .quick-filter-bar-input:focus {
    border-color: var(--accent-primary);
  }

  .goto-time-popover {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.4rem;
    /* Opaque — --bg-panel is glassy/translucent and lets the list show through. */
    background: var(--bg-dark);
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

  /* Column reordering: the dragged header dims, and a bar on the hovered
     header shows the side the column will land on. */
  .header-col {
    cursor: grab;
  }

  .header-col.drag-source {
    opacity: 0.4;
  }

  .header-col.drop-before {
    box-shadow: inset 3px 0 0 var(--accent-primary);
  }

  .header-col.drop-after {
    box-shadow: inset -3px 0 0 var(--accent-primary);
  }

  .col-resize-handle {
    position: absolute;
    top: 0;
    right: -4px;
    width: 8px;
    height: 100%;
    cursor: col-resize;
    z-index: 2;
    user-select: none;
  }

  .col-resize-handle::after {
    content: '';
    position: absolute;
    top: 20%;
    right: 3px;
    width: 2px;
    height: 60%;
    background: transparent;
    border-radius: 1px;
    transition: background 0.15s;
  }

  .col-resize-handle:hover::after {
    background: var(--accent-primary);
  }
`;
if (!style.parentNode) document.head.appendChild(style);
