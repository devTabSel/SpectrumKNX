import React, { useMemo, useRef, useEffect, useLayoutEffect, useState, useCallback } from 'react';
import { format } from 'date-fns';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Telegram } from '../hooks/useWebSocket';
import { ChevronUp, ChevronDown, Filter, LineChart, X, Clock, Power, Circle, CircleDot } from 'lucide-react';
import { dptKey, type ActiveFilters } from '../types/filters';
import { SendToGaPopover } from './SendToGaPopover';
import { GotoTimeControl } from './GotoTimeControl';
import { getPref, setPref } from '../utils/prefs';
import type { SortKey, SortLevel, SortConfig } from '../utils/sortConfig';
import { anchorKey } from '../utils/anchorKey';
import {
  compileQuickFilters,
  DEFAULT_QUICK_FILTER_COLUMN_ENABLED,
  type ColId,
  type QuickCellValue,
  type QuickFilterColumnEnabled,
} from '../utils/quickFilter';

export type { SortKey, SortLevel, SortConfig };

export interface TelegramTableFeatures {
  quickInfo?: boolean;
  quickFilter?: boolean;
  columnResize?: boolean;
  rowMarks?: boolean;
  rowFlags?: boolean;
}

export interface TelegramTableQuickFilterConfig {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  enabled?: boolean;
  onEnabledChange?: (enabled: boolean) => void;
  patterns?: Partial<Record<ColId, QuickCellValue>>;
  onPatternsChange?: (patterns: Partial<Record<ColId, QuickCellValue>>) => void;
  columnEnabled?: QuickFilterColumnEnabled;
  onColumnEnabledChange?: (enabled: QuickFilterColumnEnabled) => void;
}

export interface TelegramTableRowMarksConfig {
  markedKeys?: string[];
  onMarkedKeysChange?: (keys: string[]) => void;
  lastMarkedKey?: string | null;
  onLastMarkedKeyChange?: (key: string | null) => void;
}

export interface TelegramTableRowFlagsConfig {
  flaggedKeys?: string[];
  onFlaggedKeysChange?: (keys: string[]) => void;
}

export interface TelegramTableGroupingLevel {
  key: string;
  direction: 'asc' | 'desc';
}

export interface TelegramTableColumnCellContent {
  top?: (row: Telegram) => React.ReactNode;
  bottom?: (row: Telegram) => React.ReactNode;
}

export interface TelegramTableColumnLineStyles {
  top?: React.CSSProperties;
  bottom?: React.CSSProperties;
}

export interface TelegramTableColumnConfig {
  order?: number;
  visible?: boolean;
  width?: number;
  content?: TelegramTableColumnCellContent;
  lineStyles?: TelegramTableColumnLineStyles;
}

export interface TelegramTableConfig {
  sortConfig: SortConfig;
  onSort: (key: SortKey, opts?: { additive?: boolean }) => void;
  visibleColumns: { [key: string]: boolean };
  columnOrder?: ColId[];
  grouping?: TelegramTableGroupingLevel[];
  columns?: Partial<Record<ColId, TelegramTableColumnConfig>>;
  features?: TelegramTableFeatures;
  quickFilter?: TelegramTableQuickFilterConfig;
  rowMarks?: TelegramTableRowMarksConfig;
  rowFlags?: TelegramTableRowFlagsConfig;
  infoBarOpen?: boolean;
  onInfoBarOpenChange?: (open: boolean) => void;
}

interface TelegramTableProps {
  /** Unique table instance ID used to scope persisted local preferences. */
  instanceId?: string;
  /** Reusable instance configuration for table/sort/columns/features/state. */
  tableConfig?: TelegramTableConfig;
  telegrams: Telegram[];
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
  quickPatterns?: Partial<Record<ColId, QuickCellValue>>;
  onQuickPatternsChange?: (patterns: Partial<Record<ColId, QuickCellValue>>) => void;
  quickFilterColumnEnabled?: QuickFilterColumnEnabled;
  onQuickFilterColumnEnabledChange?: (enabled: QuickFilterColumnEnabled) => void;
  /** Optional upstream signal: true when quick filter hides at least one message
   * from the full source set (before context rows are re-introduced). */
  quickFilterFiltersOutAny?: boolean;
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

  // Lifted row marks (#310): keys of marked telegrams + the most-recently
  // clicked one. Lifted so marks survive main-panel navigation.
  markedKeys?: string[];
  onMarkedKeysChange?: (keys: string[]) => void;
  lastMarkedKey?: string | null;
  onLastMarkedKeyChange?: (key: string | null) => void;

  // Lifted Quick Info Bar open state (#311, #341)
  infoBarOpen?: boolean;
  onInfoBarOpenChange?: (open: boolean) => void;

  // Lifted per-message Time-Delta-Context flags (#319): keys of telegrams
  // individually flagged to always anchor a context window around themselves.
  flaggedKeys?: string[];
  onFlaggedKeysChange?: (keys: string[]) => void;

  /** Keys (via the same anchor identity) of rows present only as unfiltered
   * Time-Delta-Context around a match/flag, not because they matched the
   * active filters themselves — marked with a distinct background (#343). */
  contextKeys?: ReadonlySet<string>;
}

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

const columnWidthsPrefKey = (instanceId: string) => `columnWidths:${instanceId}`;

const getTypeColor = (type?: string | null) => {
  switch (type) {
    case 'Write': return 'var(--accent-primary)';
    case 'Read': return '#fbbf24';
    case 'Response': return '#10b981';
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

const dptKeyLabel = (dptMain: number | null, dptSub: number | null): string | null => {
  if (dptMain == null) return null;
  if (dptSub == null) return `${dptMain}.x`;
  return `${dptMain}.${String(dptSub).padStart(3, '0')}`;
};

const dptDescriptionLabel = (dptName: string | null, unit: string | null | undefined): string | null => {
  if (!dptName) return unit ? `(${unit})` : null;
  const cleaned = dptName.trim();
  // Stored names often look like "1.001 - Switch"; keep only the description row.
  const withoutCode = cleaned
    .replace(/^\d+(?:\.\d+)?\s*[-–:]\s*/u, '')
    .trim();
  const base = withoutCode.length > 0 ? withoutCode : cleaned;
  return unit ? `${base} (${unit})` : base;
};

type TelegramRow = Telegram & { deltaStr: string | null; deltaMs: number | null };

const formatDeltaMs = (diffMs: number, sign: '+' | '-'): string => {
  const mm = String(Math.floor(diffMs / 60000)).padStart(2, '0');
  const ss = String(Math.floor((diffMs % 60000) / 1000)).padStart(2, '0');
  const ms = String(diffMs % 1000).padStart(3, '0');
  return `${sign} ${mm}:${ss}.${ms}`;
};

const cellPadding = '0.75rem 1rem'; // Unified padding for all cells
const RAIL_WIDTH = '1.75rem'; // Fixed width of the left-edge icon rail, shared by quickinfo/header/quickfilter/rows

// Default two-line styles per column. These are the built-in render defaults
// and can be overridden per column via tableConfig.columns[col].lineStyles.
const DEFAULT_COLUMN_LINE_STYLES: Partial<Record<ColId, TelegramTableColumnLineStyles>> = {
  time: {
    top: { color: 'var(--text-main)', fontVariantNumeric: 'tabular-nums', fontWeight: 500 },
    bottom: { fontSize: '0.65rem', color: 'var(--text-dim)', marginTop: '0.15rem', fontVariantNumeric: 'tabular-nums' },
  },
  source: {
    // Device name style aligned to GA name style by default.
    bottom: { fontSize: '0.7rem', color: 'var(--text-main)', fontWeight: 500, marginTop: '0.15rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  },
  target: {
    bottom: { fontSize: '0.7rem', color: 'var(--text-main)', fontWeight: 500, marginTop: '0.15rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  },
  dpt: {
    top: { fontSize: '0.75rem', color: 'var(--text-main)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 },
    bottom: { fontSize: '0.68rem', color: 'var(--text-dim)', marginTop: '0.12rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  },
};

const ROW_ESTIMATE = 85; // matches the virtualizer's estimateSize

// ── Quick filter bar (#271, #309) ────────────────────────────────────────────
// Two rows per applicable column: a top pattern row (address/DPT-key patterns
// with wildcards and ranges, or a from/range bound) and a bottom text row
// (regex/literal, or a to/range bound). TYPE only uses the top row (a
// comma-separated fixed-value list); DELTA doesn't participate here at all —
// it edits the Time-Delta-Context window instead (#371).


export const TelegramTable: React.FC<TelegramTableProps> = ({
  instanceId = 'default',
  tableConfig,
  telegrams, visibleColumns, sortConfig, onSort, activeFilters, onQuickFilter, onQuickVisualize, onQuickLastSeen, canSend,
  quickFilterOpen, onQuickFilterOpenChange, quickFilterEnabled, onQuickFilterEnabledChange, quickPatterns, onQuickPatternsChange,
  quickFilterColumnEnabled, onQuickFilterColumnEnabledChange,
  quickFilterFiltersOutAny,
  onDeltaContextChange, onDeltaContextEnabledChange,
  listFollow, onListFollowChange, listAnchorKey, onListAnchorKeyChange,
  markedKeys, onMarkedKeysChange, lastMarkedKey, onLastMarkedKeyChange,
  infoBarOpen, onInfoBarOpenChange,
  flaggedKeys, onFlaggedKeysChange,
  contextKeys,
}) => {
  const parentRef = useRef<HTMLDivElement>(null);

  const effectiveSortConfig = tableConfig?.sortConfig ?? sortConfig;
  const effectiveOnSort = tableConfig?.onSort ?? onSort;
  const effectiveVisibleColumns = tableConfig?.visibleColumns ?? visibleColumns;
  const features = tableConfig?.features;
  const quickInfoEnabled = features?.quickInfo !== false;
  const quickFilterFeatureEnabled = features?.quickFilter !== false;
  const columnResizeEnabled = features?.columnResize !== false;
  const rowMarksEnabled = features?.rowMarks !== false;
  const rowFlagsEnabled = features?.rowFlags !== false;

  const effectiveQuickFilterOpen = tableConfig?.quickFilter?.open ?? quickFilterOpen;
  const effectiveOnQuickFilterOpenChange = tableConfig?.quickFilter?.onOpenChange ?? onQuickFilterOpenChange;
  const effectiveQuickFilterEnabled = tableConfig?.quickFilter?.enabled ?? quickFilterEnabled;
  const effectiveOnQuickFilterEnabledChange = tableConfig?.quickFilter?.onEnabledChange ?? onQuickFilterEnabledChange;
  const effectiveQuickPatterns = tableConfig?.quickFilter?.patterns ?? quickPatterns;
  const effectiveOnQuickPatternsChange = tableConfig?.quickFilter?.onPatternsChange ?? onQuickPatternsChange;
  const effectiveQuickFilterColumnEnabled = tableConfig?.quickFilter?.columnEnabled ?? quickFilterColumnEnabled;
  const effectiveOnQuickFilterColumnEnabledChange = tableConfig?.quickFilter?.onColumnEnabledChange ?? onQuickFilterColumnEnabledChange;

  const effectiveMarkedKeys = tableConfig?.rowMarks?.markedKeys ?? markedKeys;
  const effectiveOnMarkedKeysChange = tableConfig?.rowMarks?.onMarkedKeysChange ?? onMarkedKeysChange;
  const effectiveLastMarkedKey = tableConfig?.rowMarks?.lastMarkedKey ?? lastMarkedKey;
  const effectiveOnLastMarkedKeyChange = tableConfig?.rowMarks?.onLastMarkedKeyChange ?? onLastMarkedKeyChange;

  const effectiveFlaggedKeys = tableConfig?.rowFlags?.flaggedKeys ?? flaggedKeys;
  const effectiveOnFlaggedKeysChange = tableConfig?.rowFlags?.onFlaggedKeysChange ?? onFlaggedKeysChange;

  const effectiveInfoBarOpen = tableConfig?.infoBarOpen ?? infoBarOpen;
  const effectiveOnInfoBarOpenChange = tableConfig?.onInfoBarOpenChange ?? onInfoBarOpenChange;

  const lineStyle = useCallback((colId: ColId, line: 'top' | 'bottom'): React.CSSProperties | undefined => {
    const base = DEFAULT_COLUMN_LINE_STYLES[colId]?.[line];
    const override = tableConfig?.columns?.[colId]?.lineStyles?.[line];
    if (!base && !override) return undefined;
    return { ...(base ?? {}), ...(override ?? {}) };
  }, [tableConfig?.columns]);

  const loadColumnWidths = useCallback((): Record<string, number> => {
    const defaults: Record<string, number> = {};
    for (const c of COLUMNS) defaults[c.id] = c.defaultWidth;
    try {
      const scoped = getPref(columnWidthsPrefKey(instanceId));
      const raw = scoped ?? getPref('columnWidths');
      if (raw) return { ...defaults, ...JSON.parse(raw) };
    } catch {
      // Ignore malformed stored value
    }
    return defaults;
  }, [instanceId]);

  // ── Column widths (persisted per table instance) ──
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(loadColumnWidths);

  useEffect(() => {
    setColumnWidths(loadColumnWidths());
  }, [loadColumnWidths]);

  const widthFor = useCallback(
    (id: ColId) => columnWidths[id] ?? COLUMNS.find(c => c.id === id)!.defaultWidth,
    [columnWidths],
  );

  const persistWidths = useCallback((widths: Record<string, number>) => {
    setPref(columnWidthsPrefKey(instanceId), JSON.stringify(widths));
  }, [instanceId]);

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
  const [internalQuickPatterns, setInternalQuickPatterns] = useState<Partial<Record<ColId, QuickCellValue>>>({});
  const [internalQuickColumnEnabled, setInternalQuickColumnEnabled] = useState<QuickFilterColumnEnabled>(DEFAULT_QUICK_FILTER_COLUMN_ENABLED);

  const quickOpen = effectiveQuickFilterOpen ?? internalQuickOpen;
  const setQuickOpen = useCallback((val: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof val === 'function' ? val(quickOpen) : val;
    setInternalQuickOpen(next);
    effectiveOnQuickFilterOpenChange?.(next);
  }, [quickOpen, effectiveOnQuickFilterOpenChange]);

  const quickEnabled = effectiveQuickFilterEnabled ?? internalQuickEnabled;
  const setQuickEnabled = useCallback((val: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof val === 'function' ? val(quickEnabled) : val;
    setInternalQuickEnabled(next);
    effectiveOnQuickFilterEnabledChange?.(next);
  }, [quickEnabled, effectiveOnQuickFilterEnabledChange]);

  const currentPatterns = effectiveQuickPatterns ?? internalQuickPatterns;
  const setQuickPatterns = useCallback((val: Partial<Record<ColId, QuickCellValue>> | ((prev: Partial<Record<ColId, QuickCellValue>>) => Partial<Record<ColId, QuickCellValue>>)) => {
    const next = typeof val === 'function' ? val(currentPatterns) : val;
    setInternalQuickPatterns(next);
    effectiveOnQuickPatternsChange?.(next);
  }, [currentPatterns, effectiveOnQuickPatternsChange]);
  const currentQuickColumnEnabled = effectiveQuickFilterColumnEnabled ?? internalQuickColumnEnabled;
  const setQuickColumnEnabled = useCallback((val: QuickFilterColumnEnabled | ((prev: QuickFilterColumnEnabled) => QuickFilterColumnEnabled)) => {
    const next = typeof val === 'function' ? val(currentQuickColumnEnabled) : val;
    setInternalQuickColumnEnabled(next);
    effectiveOnQuickFilterColumnEnabledChange?.(next);
  }, [currentQuickColumnEnabled, effectiveOnQuickFilterColumnEnabledChange]);

  /** Updates one row (top/bottom) of a quick-filter cell, preserving the other row. */
  const setQuickCell = useCallback((id: ColId, row: 'top' | 'bottom', text: string) => {
    setQuickPatterns(prev => ({ ...prev, [id]: { ...(prev[id] ?? EMPTY_CELL), [row]: text } }));
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
      return;
    }
    setQuickEnabled(prev => !prev);
  }, [clearAllQuickInputs, setQuickEnabled]);

  const toggleQuickOpen = () => {
    const nextOpen = !quickOpen;
    setQuickOpen(nextOpen);
    setQuickEnabled(nextOpen);
  };

  // ── Quick info bar (#311): collapsible summary row above the header. ──────
  const [internalInfoBarOpen, setInternalInfoBarOpen] = useState(false);
  const infoOpen = effectiveInfoBarOpen ?? internalInfoBarOpen;
  const toggleInfoOpen = useCallback(() => {
    const next = !infoOpen;
    setInternalInfoBarOpen(next);
    effectiveOnInfoBarOpenChange?.(next);
  }, [infoOpen, effectiveOnInfoBarOpenChange]);

  // ── Row marks (#310) ─────────────────────────────────────────────────────
  // Controlled when App lifts them (so marks survive navigation), otherwise a
  // local fallback. `lastMarkedKey` may legitimately be null, so distinguish
  // "not lifted" (undefined) from "lifted, nothing last" (null).
  const [internalMarkedKeys, setInternalMarkedKeys] = useState<string[]>([]);
  const [internalLastMarkedKey, setInternalLastMarkedKey] = useState<string | null>(null);

  const markedKeysList = effectiveMarkedKeys ?? internalMarkedKeys;
  const setMarkedKeysList = useCallback((val: string[]) => {
    setInternalMarkedKeys(val);
    effectiveOnMarkedKeysChange?.(val);
  }, [effectiveOnMarkedKeysChange]);

  const lastMarked = effectiveLastMarkedKey !== undefined ? effectiveLastMarkedKey : internalLastMarkedKey;
  const setLastMarked = useCallback((val: string | null) => {
    setInternalLastMarkedKey(val);
    effectiveOnLastMarkedKeyChange?.(val);
  }, [effectiveOnLastMarkedKeyChange]);

  const markedSet = useMemo(() => new Set(markedKeysList), [markedKeysList]);

  const clearMarks = useCallback(() => {
    setMarkedKeysList([]);
    setLastMarked(null);
  }, [setMarkedKeysList, setLastMarked]);

  // ── Per-message Time-Delta-Context flags (#319) ─────────────────────────
  const [internalFlaggedKeys, setInternalFlaggedKeys] = useState<string[]>([]);
  const flaggedKeysList = effectiveFlaggedKeys ?? internalFlaggedKeys;
  const setFlaggedKeysList = useCallback((val: string[]) => {
    setInternalFlaggedKeys(val);
    effectiveOnFlaggedKeysChange?.(val);
  }, [effectiveOnFlaggedKeysChange]);
  const flaggedSet = useMemo(() => new Set(flaggedKeysList), [flaggedKeysList]);
  const lastFlaggedKeyRef = useRef<string | null>(null);

  const quickMatches = useMemo(
    () => compileQuickFilters(currentPatterns, currentQuickColumnEnabled),
    [currentPatterns, currentQuickColumnEnabled],
  );
  const quickFiltered = useMemo(() => {
    if (!quickFilterFeatureEnabled || !quickOpen || !quickEnabled) return telegrams;
    return telegrams.filter(t => quickMatches(t) || !!contextKeys?.has(anchorKey(t)));
  }, [telegrams, quickFilterFeatureEnabled, quickOpen, quickEnabled, quickMatches, contextKeys]);

  const anyQuickColumnEnabled = useMemo(
    () => Object.values(currentQuickColumnEnabled).some(Boolean),
    [currentQuickColumnEnabled],
  );
  const quickFilterFiltersOutAnyMessage = quickFilterFiltersOutAny ?? (
    quickEnabled &&
    anyQuickColumnEnabled &&
    telegrams.some(t => !quickMatches(t))
  );
  const quickFilterDividerColor = !quickEnabled || !anyQuickColumnEnabled
    ? '#000000'
    : (quickFilterFiltersOutAnyMessage ? '#f59e0b' : '#6b7280');

  const hasNonInitialDeltaWindow = activeFilters.deltaBeforeMs !== 0 || activeFilters.deltaAfterMs !== 0;
  const showRowMessageContextControl =
    rowFlagsEnabled &&
    quickEnabled &&
    isQuickColumnEnabled('delta') &&
    hasNonInitialDeltaWindow;

  const timeSortDirection: 'asc' | 'desc' | null =
    effectiveSortConfig[0]?.key === 'timestamp' ? effectiveSortConfig[0].direction : null;

  // Time deltas between consecutive rows, by visual (sorted) order — always
  // computed regardless of sort column, respecting whatever hierarchy is
  // active (#311).
  const naturalTelegramRows = useMemo<TelegramRow[]>(() => {
    return quickFiltered.map((t, idx) => {
      let deltaStr: string | null = null;
      let deltaMs: number | null = null;
      if (idx > 0) {
        const curr = new Date(t.timestamp).getTime();
        const prev = new Date(quickFiltered[idx - 1].timestamp).getTime();
        const rawDiff = curr - prev;
        deltaMs = Math.abs(rawDiff);
        const sign: '+' | '-' = timeSortDirection
          ? (timeSortDirection === 'asc' ? '+' : '-')
          : (rawDiff >= 0 ? '+' : '-');
        deltaStr = formatDeltaMs(deltaMs, sign);
      }
      return { ...t, deltaStr, deltaMs };
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
    effectiveOnSort(key, opts);
  }, [exitDeltaSort, effectiveOnSort]);

  const telegramRows = deltaSortActive && deltaFrozenRows ? deltaFrozenRows : naturalTelegramRows;

  const applyRowMarkSelection = useCallback((e: React.MouseEvent, key: string, index: number) => {
    if (!rowMarksEnabled) return;
    const additive = e.ctrlKey || e.metaKey;
    const range = e.shiftKey;
    if (additive || range) {
      e.preventDefault();
      window.getSelection()?.removeAllRanges();
    }

    let nextKeys: string[];
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
      nextKeys = additive ? [...new Set([...markedKeysList, ...rangeKeys])] : rangeKeys;
    } else if (additive) {
      nextKeys = markedSet.has(key) ? markedKeysList.filter(markedKey => markedKey !== key) : [...markedKeysList, key];
    } else {
      nextKeys = [key];
    }

    setMarkedKeysList(nextKeys);
    setLastMarked(key);
  }, [lastMarked, markedKeysList, markedSet, rowMarksEnabled, setLastMarked, setMarkedKeysList, telegramRows]);

  // Message-context flags follow the row-click semantics: plain click sets only
  // this row, ctrl/cmd toggles just this row, shift sets a range, and
  // ctrl/cmd+shift applies the range-begin flag state to the whole range.
  const handleFlagClick = useCallback((e: React.MouseEvent, key: string) => {
    if (!rowFlagsEnabled) return;
    e.stopPropagation();
    const additive = e.ctrlKey || e.metaKey;
    const range = e.shiftKey;
    if (additive || range) {
      e.preventDefault();
      window.getSelection()?.removeAllRanges();
    }
    const el = parentRef.current;
    const row = el?.querySelector<HTMLElement>(`[data-akey="${CSS.escape(key)}"]`);
    if (el && row) {
      anchorRef.current = {
        key,
        offset: row.getBoundingClientRect().top - el.getBoundingClientRect().top,
      };
      atEdgeRef.current = false;
      onListFollowChange?.(false);
      onListAnchorKeyChange?.(key);
      setNewSinceAnchor(0);
    }
    const currentIdx = telegramRows.findIndex(r => anchorKey(r) === key);
    if (currentIdx !== -1) {
      applyRowMarkSelection(e, key, currentIdx);
    }

    let nextKeys: string[];
    if (range) {
      const anchorKeyForRange = lastFlaggedKeyRef.current;
      const anchorIdx = anchorKeyForRange ? telegramRows.findIndex(r => anchorKey(r) === anchorKeyForRange) : -1;
      const currentIdx = telegramRows.findIndex(r => anchorKey(r) === key);
      const rangeKeys = anchorIdx === -1 || currentIdx === -1
        ? [key]
        : telegramRows
          .slice(Math.min(anchorIdx, currentIdx), Math.max(anchorIdx, currentIdx) + 1)
          .map(r => anchorKey(r));

      if (additive) {
        const anchorFlagState = anchorKeyForRange ? flaggedSet.has(anchorKeyForRange) : flaggedSet.has(key);
        nextKeys = anchorFlagState
          ? [...new Set([...flaggedKeysList, ...rangeKeys])]
          : flaggedKeysList.filter(flaggedKey => !rangeKeys.includes(flaggedKey));
      } else {
        nextKeys = [...new Set(rangeKeys)];
      }
    } else if (additive) {
      nextKeys = flaggedSet.has(key)
        ? flaggedKeysList.filter(flaggedKey => flaggedKey !== key)
        : [...flaggedKeysList, key];
    } else {
      nextKeys = [key];
    }

    setFlaggedKeysList(nextKeys);
    lastFlaggedKeyRef.current = key;
  }, [applyRowMarkSelection, flaggedSet, flaggedKeysList, onListAnchorKeyChange, onListFollowChange, rowFlagsEnabled, setFlaggedKeysList, telegramRows]);

  // ── Global Time-Delta-Context tristate (#318, #319) ─────────────────────────
  // Reflects the per-message flags among the currently visible rows: none set,
  // all set, or some. Plain click cycles the flags (none/some -> flag every
  // visible row is "all", i.e. none<->all, some->none); ctrl/cmd-click instead
  // toggles the window fully on/off (#318), preserving flags and values.
  const deltaFlagState: 'none' | 'some' | 'all' = useMemo(() => {
    if (telegramRows.length === 0 || flaggedSet.size === 0) return 'none';
    const flaggedCount = telegramRows.reduce((n, t) => n + (flaggedSet.has(anchorKey(t)) ? 1 : 0), 0);
    if (flaggedCount === 0) return 'none';
    return flaggedCount === telegramRows.length ? 'all' : 'some';
  }, [telegramRows, flaggedSet]);

  const handleDeltaToggleClick = useCallback((e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      onDeltaContextEnabledChange?.(!activeFilters.deltaContextEnabled);
      return;
    }
    setFlaggedKeysList(deltaFlagState === 'none' ? telegramRows.map(t => anchorKey(t)) : []);
  }, [deltaFlagState, telegramRows, activeFilters.deltaContextEnabled, onDeltaContextEnabledChange, setFlaggedKeysList]);

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
    telegramRows.forEach((t, i) => {
      if (new Date(t.timestamp) < new Date(telegramRows[oldestIdx].timestamp)) oldestIdx = i;
      if (new Date(t.timestamp) > new Date(telegramRows[newestIdx].timestamp)) newestIdx = i;
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
      sourceCount: sources.size,
      targetCount: targets.size,
      dptCount: dpts.size,
      typeCounts: [...typeCounts.entries()].sort((a, b) => b[1] - a[1]),
      contextCount,
    };
  }, [telegramRows, contextKeys]);

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
  // anchored — new telegrams keep filling the list and a pill offers the way
  // back. Only meaningful for the timestamp sort, where the live edge exists.
  //
  // Rows are dynamically measured (ResizeObserver), so a new row enters the
  // layout at the 85px estimate and later shrinks to its real height. Estimate-
  // based math therefore can't keep an anchored row still. Instead we track a
  // concrete anchor row by key and, after each update, correct scrollTop by the
  // real pixel delta of that row's position — re-run on the next frame so the
  // async re-measure of prepended rows is absorbed too.
  // Only the *primary* level's key matters for the live edge — a secondary
  // TIME tiebreaker doesn't make the list time-ordered top-to-bottom (#311).
  const primarySort = effectiveSortConfig[0];
  const isTimeSort = primarySort?.key === 'timestamp' && !deltaSortActive;
  const liveEdge = primarySort?.direction === 'asc' ? 'bottom' : 'top';
  const atEdgeRef = useRef(listFollow ?? true);
  const [newSinceAnchor, setNewSinceAnchor] = useState(0);
  // The row pinned to the top of the viewport while anchored, and its offset
  // from the scroll-container top. Captured from user scrolls only.
  const anchorRef = useRef<{ key: string; offset: number } | null>(
    listAnchorKey ? { key: listAnchorKey, offset: 0 } : null
  );
  const programmaticScrollRef = useRef(false);
  // Zebra stripes must stay with a telegram, not with a row index (#266):
  // prepends at the live edge shift every index by the number of new rows, so
  // this offset accumulates those shifts and is added back to the index parity.
  const [stripeOffset, setStripeOffset] = useState(0);

  // Sync props to refs
  useEffect(() => {
    if (listFollow !== undefined) {
      atEdgeRef.current = listFollow;
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

  const checkAtEdge = () => {
    const el = parentRef.current;
    if (!el) return true;
    // Small threshold to handle precision issues
    return liveEdge === 'top'
      ? el.scrollTop < 20
      : el.scrollTop + el.clientHeight >= el.scrollHeight - 20;
  };

  // Record the top-most visible row so we can pin it across list updates.
  const captureAnchor = () => {
    const el = parentRef.current;
    if (!el) return;
    const cTop = el.getBoundingClientRect().top;
    for (const row of el.querySelectorAll<HTMLElement>('.log-row')) {
      const rr = row.getBoundingClientRect();
      if (rr.bottom - cTop > 0) {
        const key = row.getAttribute('data-akey');
        if (key) {
          anchorRef.current = { key, offset: rr.top - cTop };
          onListAnchorKeyChange?.(key);
        }
        return;
      }
    }
  };

  const handleScroll = () => {
    // Ignore the scrolls our own compensation triggers.
    if (programmaticScrollRef.current) return;
    const atEdge = checkAtEdge();
    if (atEdge !== atEdgeRef.current) {
      atEdgeRef.current = atEdge;
      onListFollowChange?.(atEdge);
    }
    if (atEdge) {
      setNewSinceAnchor(0);
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
    applyRowMarkSelection(e, key, index);

    // ── Pause live-following on an edge click (#266), unchanged ──
    if (!isTimeSort || !atEdgeRef.current) return;
    atEdgeRef.current = false;
    onListFollowChange?.(false);
    captureAnchor();
  };

  const scrollToEdge = () => {
    markProgrammatic();
    virtualizer.scrollToOffset(liveEdge === 'top' ? 0 : virtualizer.getTotalSize());
  };

  const jumpToLive = () => {
    atEdgeRef.current = true;
    onListFollowChange?.(true);
    anchorRef.current = null;
    onListAnchorKeyChange?.(null);
    setNewSinceAnchor(0);
    scrollToEdge();
  };

  // Scrolls to a specific row by index and stops live-following, so the
  // viewed rows stay put while new ones accumulate. Used by "quick goto time"
  // and the quick info bar's click-to-jump metrics (#282, #311).
  const gotoIndex = (idx: number) => {
    if (idx < 0 || idx >= telegramRows.length) return;
    atEdgeRef.current = false;
    onListFollowChange?.(false);
    setNewSinceAnchor(0);
    markProgrammatic();
    virtualizer.scrollToIndex(idx, { align: 'center' });
    // Pin the row we land on once the virtualizer has settled the scroll (rows
    // are dynamically measured, so give it two frames before capturing).
    requestAnimationFrame(() => requestAnimationFrame(() => {
      captureAnchor();
      atEdgeRef.current = false;
      onListFollowChange?.(false);
    }));
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
    if (!el || !anchor || atEdgeRef.current) return;
    const now = rowOffset(anchor.key);
    if (now == null) {
      captureAnchor();
      return;
    }
    const delta = now - anchor.offset;
    if (Math.abs(delta) > 0.5) {
      markProgrammatic();
      el.scrollTop += delta;
    }
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
    setNewSinceAnchor(0);
    setStripeOffset(0);
    anchorRef.current = null;
    onListAnchorKeyChange?.(null);
    const atEdge = checkAtEdge();
    if (atEdge !== atEdgeRef.current) {
      atEdgeRef.current = atEdge;
      onListFollowChange?.(atEdge);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveSortConfig]);

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
      anchorRef.current = null;
      onListAnchorKeyChange?.(null);
      setNewSinceAnchor(0);
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

    setNewSinceAnchor(n => n + added);
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
  const visibleCols = useMemo(() => {
    const filtered = COLUMNS.filter(c => {
      const explicitVisible = tableConfig?.columns?.[c.id]?.visible;
      if (explicitVisible !== undefined) return explicitVisible;
      return !c.visibleKey || effectiveVisibleColumns[c.visibleKey];
    });
    const order = tableConfig?.columnOrder;
    const rank = new Map<ColId, number>();
    if (order && order.length > 0) {
      order.forEach((id, idx) => rank.set(id, idx));
    } else {
      for (const c of filtered) {
        const configuredOrder = tableConfig?.columns?.[c.id]?.order;
        if (configuredOrder !== undefined) rank.set(c.id, configuredOrder);
      }
      if (rank.size === 0) return filtered;
    }
    return [...filtered].sort((a, b) => {
      const ar = rank.get(a.id);
      const br = rank.get(b.id);
      if (ar == null && br == null) return 0;
      if (ar == null) return 1;
      if (br == null) return -1;
      return ar - br;
    });
  }, [effectiveVisibleColumns, tableConfig?.columnOrder, tableConfig?.columns]);

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
    const idx = effectiveSortConfig.findIndex(l => l.key === key);
    if (idx === -1) return null;
    const icon = effectiveSortConfig[idx].direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />;
    if (effectiveSortConfig.length <= 1) return icon;
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.15rem' }}>
        {icon}
        <span
          title={`Sort level ${idx + 1} of ${effectiveSortConfig.length}`}
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

  // ── Per-cell body content (keyed switch keeps body aligned with header order) ──
  const renderCell = (id: ColId, t: TelegramRow): React.ReactNode => {
    const customContent = tableConfig?.columns?.[id]?.content;
    if (customContent) {
      return (
        <div style={{ padding: cellPadding, minWidth: 0, overflow: 'hidden' }}>
          <div style={lineStyle(id, 'top')}>
            {customContent.top?.(t)}
          </div>
          {customContent.bottom && (
            <div style={{ ...lineStyle(id, 'bottom'), marginTop: lineStyle(id, 'bottom')?.marginTop ?? '0.2rem' }}>
              {customContent.bottom(t)}
            </div>
          )}
        </div>
      );
    }

    switch (id) {
      case 'time':
        return (
          <div style={{ padding: cellPadding }}>
            <div className="mono-addr" style={lineStyle('time', 'top')}>
              {format(new Date(t.timestamp), 'HH:mm:ss.SS')}
            </div>
            <div className="subtitle-name" style={lineStyle('time', 'bottom')}>
              {format(new Date(t.timestamp), 'yyyy-MM-dd')}
            </div>
          </div>
        );

      case 'delta': {
        return (
          <div style={{ padding: cellPadding, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.16rem' }}>
            <div className="mono-addr" style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums', minHeight: '1em' }}>
              {t.deltaStr ?? ''}
            </div>
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
                title="Toggle source filter"
              >
                <Filter className="filter-icon" size={12} />
                <X className="cancel-icon" size={12} />
              </button>
              {onQuickLastSeen && (
                <button
                  className="quick-last-seen-btn"
                  onClick={(e) => { e.stopPropagation(); onQuickLastSeen(t.source_address, 'pa'); }}
                  title="Show last seen values for this device"
                >
                  <Clock size={12} />
                </button>
              )}
            </div>
            {effectiveVisibleColumns.sourceName && (
              <div className="subtitle-name" title={t.source_name || undefined} style={lineStyle('source', 'bottom')}>
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
                title="Toggle target filter"
              >
                <Filter className="filter-icon" size={12} />
                <X className="cancel-icon" size={12} />
              </button>
              {onQuickLastSeen && (
                <button
                  className="quick-last-seen-btn"
                  onClick={(e) => { e.stopPropagation(); onQuickLastSeen(t.target_address, 'ga'); }}
                  title="Show last seen values for this GA"
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
            {effectiveVisibleColumns.targetName && (
              <div className="subtitle-name" title={t.target_name || undefined} style={lineStyle('target', 'bottom')}>
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
              <button
                className={`quick-filter-btn ${activeFilters.types.includes(t.simplified_type || t.telegram_type) ? 'active' : ''}`}
                onClick={(e) => { e.stopPropagation(); onQuickFilter('types', t.simplified_type || t.telegram_type); }}
                title="Toggle type filter"
              >
                <Filter className="filter-icon" size={12} />
                <X className="cancel-icon" size={12} />
              </button>
            </div>
            <div style={{ fontSize: '0.65rem', color: t.direction === 'Outgoing' ? '#f59e0b' : '#10b981', marginTop: '0.1rem', opacity: 0.8 }}>{t.direction === 'Outgoing' ? 'Outgoing' : 'Incoming'}</div>
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
                    <div title={dptKeyLabel(t.dpt_main, t.dpt_sub) ?? undefined} style={lineStyle('dpt', 'top')}>
                      {dptKeyLabel(t.dpt_main, t.dpt_sub) ?? '-'}
                    </div>
                  </div>
                  <div title={dptDescriptionLabel(t.dpt_name, t.unit) ?? undefined} style={lineStyle('dpt', 'bottom')}>
                    {dptDescriptionLabel(t.dpt_name, t.unit) ?? '-'}
                  </div>
                </div>
                <button
                  className={`quick-filter-btn ${activeFilters.dpts.includes(dptKey(t.dpt_main, t.dpt_sub)) ? 'active' : ''}`}
                  onClick={(e) => { e.stopPropagation(); if (t.dpt_main != null) onQuickFilter('dpts', dptKey(t.dpt_main, t.dpt_sub)); }}
                  title="Toggle DPT filter"
                >
                  <Filter className="filter-icon" size={12} />
                  <X className="cancel-icon" size={12} />
                </button>
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

              <button
                className="quick-visualize-btn"
                onClick={(e) => { e.stopPropagation(); onQuickVisualize(t.target_address); }}
                title="Visualize this target"
              >
                <LineChart size={14} />
              </button>
            </div>
            {effectiveVisibleColumns.data && t.raw_hex && (
              <div style={{ marginTop: '0.18rem', fontSize: '0.65rem', color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                {t.raw_hex}
              </div>
            )}
          </div>
        );
    }
  };

  const infoChipStyle: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: '0.3rem',
    background: 'var(--bg-tag)', border: '1px solid var(--border-subtle)', borderRadius: '4px',
    padding: '0.15rem 0.45rem', fontSize: '0.68rem', color: 'var(--text-dim)',
  };
  const infoChipBtnStyle: React.CSSProperties = {
    ...infoChipStyle, cursor: 'pointer', background: 'transparent',
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Quick info bar (#311): collapsible summary directly above the header. */}
      {quickInfoEnabled && infoOpen && infoMetrics && (
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-subtle)', flexShrink: 0 }}>
          {/* Left icon rail (#341): flush with the outermost edge, two rows
              matching the two chip rows — top row top-aligned, bottom row centered. */}
          <div style={{ width: RAIL_WIDTH, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1, display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
              {quickInfoEnabled && (
                <button
                  className="quick-filter-bar-toggle open"
                  onClick={toggleInfoOpen}
                  title="Hide info bar"
                >
                  <ChevronDown size={13} />
                </button>
              )}
            </div>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }} />
          </div>
          <div style={{
            flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '0.3rem',
            padding: '0.4rem 0.75rem',
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
          </div>
          </div>
        </div>
      )}

      {/* Header */}
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
        {/* Left icon rail (#341): three rows matching the header's three internal
            rows — top row top-aligned, middle row centered, bottom row bottom-aligned. */}
        <div style={{ width: RAIL_WIDTH, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-start', gap: '0.15rem' }}>
            {quickInfoEnabled && !infoOpen && (
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
            {quickFilterFeatureEnabled && (
              quickOpen ? (
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
              )
            )}
          </div>
        </div>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: 'grid',
            gridTemplateColumns: gridTemplate,
            color: 'var(--text-dim)',
            fontSize: '0.65rem',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            fontWeight: 700,
            // Account for scrollbar width to keep columns aligned with body
            paddingRight: '8px'
          }}
        >
        {visibleCols.map((c, i) => (
          // Three stacked rows with no visible divider between them — only the
          // middle row carries the column label.
          <div key={c.id} className="header-col" style={{ position: 'relative', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <div style={{ flex: 1, minHeight: '1.3rem', padding: '0 1rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }} />
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
                  onClick={(e) => handleColumnSort(c.sortKey!, { additive: e.ctrlKey || e.metaKey })}
                  title="Click to sort · ctrl/cmd-click to add as a further sort level (TIME is always the deepest tiebreaker)"
                >
                  {c.label} {renderSortArrow(c.sortKey)}
                </button>
              ) : (
                <span>{c.label}</span>
              )}
            </div>
            <div style={{ flex: 1, minHeight: '1.3rem', padding: '0 1rem', display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: '0.4rem' }}>
              {quickOpen && quickEnabled && (
                <button
                  className={`quick-filter-bar-toggle ${quickEnabled && isQuickColumnEnabled(c.id) ? 'open' : ''}`}
                  onClick={(e) => handleQuickColumnToggleClick(e, c.id)}
                  title={isQuickColumnEnabled(c.id)
                    ? `Disable quick filter for ${c.label} · ctrl/cmd-click clears this column's quick-filter cells`
                    : `Enable quick filter for ${c.label} · ctrl/cmd-click clears this column's quick-filter cells`}
                >
                  <Filter size={12} />
                </button>
              )}
            </div>
            {columnResizeEnabled && i < visibleCols.length - 1 && (
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

      {/* Quick filter bar (#271, #309) — two rows per column: a pattern/from row
          and a text/to row, except TYPE (one row) and DELTA (Time-Delta-Context
          before/after, #371) which don't go through the pattern pipeline. */}
      {quickFilterFeatureEnabled && quickOpen && (
        <>
        <div style={{ display: 'flex', background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border-color)', flexShrink: 0, opacity: quickEnabled ? 1 : 0.5 }}>
          {/* Left icon rail (#341): DELTA window toggle on the first row,
              hide-arrow on the second row. */}
          <div style={{ width: RAIL_WIDTH, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {rowFlagsEnabled && (
                <button
                  className={`quick-filter-bar-toggle ${deltaFlagState !== 'none' ? 'open' : ''}`}
                  onClick={handleDeltaToggleClick}
                  title={[
                    `Time-Delta-Context: ${deltaFlagState} messages flagged.`,
                    deltaFlagState === 'some' ? 'Click to clear all flags.' : deltaFlagState === 'all' ? 'Click to clear all flags.' : 'Click to flag every visible message.',
                    activeFilters.deltaContextEnabled
                      ? 'Ctrl/cmd-click to disable the window (keeps flags and values).'
                      : 'Ctrl/cmd-click to re-enable the window.',
                  ].join(' ')}
                  style={{
                    opacity: activeFilters.deltaContextEnabled ? 1 : 0.5,
                    color: deltaFlagState === 'all' ? 'var(--accent-primary)' : undefined,
                  }}
                >
                  <Power size={12} />
                </button>
              )}
            </div>
            <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
              <button
                className="quick-filter-bar-toggle open"
                onClick={toggleQuickOpen}
                title="Hide quick filter bar"
              >
                <ChevronUp size={12} />
              </button>
            </div>
          </div>
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: 'grid',
              gridTemplateColumns: gridTemplate,
              paddingRight: '8px', // align with the header's scrollbar compensation
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
                      style={{ opacity: isQuickColumnEnabled(c.id) ? (activeFilters.deltaContextEnabled ? 1 : 0.5) : 0.45 }}
                      disabled={!isQuickColumnEnabled(c.id)}
                      onChange={e => onDeltaContextChange?.(Math.max(0, Number(e.target.value) || 0), activeFilters.deltaAfterMs)}
                    />
                    <input
                      className="quick-filter-bar-input"
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
                  <input
                    className="quick-filter-bar-input"
                    type="text"
                    value={currentPatterns.type?.top ?? ''}
                    placeholder="WRITE, RESPONSE, Incoming…"
                    aria-label="Quick filter TYPE"
                    disabled={!isQuickColumnEnabled(c.id)}
                    onChange={e => setQuickCell('type', 'top', e.target.value)}
                  />
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
                      placeholder="from / 0x.. / 0b.. / &quot;regex&quot;"
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
                  // source / target / dpt: top = address/DPT-key pattern, bottom = name/description regex
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
        <div
          data-testid="quick-filter-divider"
          style={{
            height: '2px',
            flexShrink: 0,
            background: quickFilterDividerColor,
          }}
        />
        </>
      )}

      {/* Body area — relative wrapper so the jump-to-live pill (#202) anchors
          below the header, not over it. */}
      <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Jump-to-live pill — shown while anchored away from the edge (#202) */}
      {isTimeSort && newSinceAnchor > 0 && (
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
          {newSinceAnchor.toLocaleString()} new telegram{newSinceAnchor === 1 ? '' : 's'}
        </button>
      )}

      {/* Clear-marks pill — shown only while rows are marked (#310) */}
      {rowMarksEnabled && markedKeysList.length > 0 && (
        <button
          onClick={clearMarks}
          className="clear-marks-pill"
          style={{ position: 'absolute', right: '1rem', top: '0.75rem', zIndex: 20 }}
          title="Clear all marks"
        >
          <X size={13} /> Clear {markedKeysList.length} mark{markedKeysList.length === 1 ? '' : 's'}
        </button>
      )}

      {/* Virtualized Body */}
      <div
        ref={parentRef}
        onScroll={handleScroll}
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
              // match (#343) — a distinct wash, but marks still take priority.
              const hasContext = !!contextKeys?.has(key);
              const isContext = !marked && hasContext;
              const flagged = flaggedSet.has(key);
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
                    // Marked rows get an accent wash that overrides the zebra
                    // stripe; the latest click is washed more strongly and gets
                    // an accent bar. Context-only rows get a distinct (warning-
                    // hued) wash instead, so they read apart from real matches.
                    // color-mix adapts to the theme's accent/warning colors.
                    background: latest
                      ? 'color-mix(in srgb, var(--accent-primary) 34%, transparent)'
                      : marked
                        ? 'color-mix(in srgb, var(--accent-primary) 16%, transparent)'
                        : isContext
                          ? 'color-mix(in srgb, var(--warning, #f59e0b) 12%, transparent)'
                          : (virtualRow.index + stripeOffset) % 2 === 0 ? 'var(--bg-subtle)' : 'transparent',
                    boxShadow: latest ? 'inset 3px 0 0 0 var(--accent-primary)' : undefined,
                    minHeight: '60px' // Ensure a minimum touch/visual target
                  }}
                  title={isContext ? 'Unfiltered Time-Delta-Context — this telegram did not match the active filters' : undefined}
                  className={`log-row${marked ? ' marked' : ''}${latest ? ' latest' : ''}${isContext ? ' context' : ''}`}
                >
                  {/* Left icon rail (#341): single row, vertically centered —
                      the message-context (Time-Delta-Context) flag toggle. */}
                  <div style={{ width: RAIL_WIDTH, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {showRowMessageContextControl && !hasContext && (
                      <button
                        style={{
                          background: 'transparent', border: 'none', cursor: 'pointer', padding: '0.15rem',
                          borderRadius: '4px', display: 'flex', alignItems: 'center', flexShrink: 0,
                          color: flagged ? 'var(--accent-primary)' : 'var(--text-dim)',
                          opacity: activeFilters.deltaContextEnabled ? (flagged ? 1 : 0.35) : 0.25,
                        }}
                        title={flagged
                          ? 'Always show context around this message — click to unflag (ctrl/cmd-click to apply to all marked rows)'
                          : 'Always show context around this message, regardless of the active filters (ctrl/cmd-click to apply to all marked rows)'}
                        onClick={e => handleFlagClick(e, key)}
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
    color: #ef4444; /* red for cancel */
  }

  .log-row::after {
    content: '';
    position: absolute;
    inset: 0;
    border: 1px solid transparent;
    pointer-events: none;
    transition: border-color 0.15s ease;
  }

  .log-row:hover::after {
    border-color: color-mix(in srgb, var(--text-main) 38%, transparent);
  }

  .log-row:hover .quick-filter-btn:not(.active),
  .log-row.marked .quick-filter-btn:not(.active),
  .log-row:hover .quick-visualize-btn,
  .log-row.marked .quick-visualize-btn,
  .log-row:hover .quick-last-seen-btn,
  .log-row.marked .quick-last-seen-btn,
  .log-row:hover .quick-send-btn,
  .log-row.marked .quick-send-btn {
    opacity: 0.6;
  }

  .quick-filter-btn:hover, .quick-visualize-btn:hover, .quick-last-seen-btn:hover, .quick-send-btn:hover {
    opacity: 1 !important;
    background: var(--bg-hover);
    color: var(--accent-primary);
    transform: scale(1.1);
  }

  .quick-visualize-btn:hover {
    color: #10b981;
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

  .clear-marks-pill {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.3rem 0.7rem;
    border: 1px solid var(--border-color);
    border-radius: 999px;
    background: var(--bg-panel);
    color: var(--text-dim);
    font-size: 0.72rem;
    font-weight: 600;
    cursor: pointer;
    box-shadow: var(--shadow-lg);
    transition: color 0.15s, border-color 0.15s;
  }

  .clear-marks-pill:hover {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
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

  /* Show the divider between two header columns when hovering either side,
     not just the narrow drag handle strip itself. */
  .header-col:hover .col-resize-handle::after,
  .header-col:has(+ .header-col:hover) .col-resize-handle::after {
    background: var(--accent-primary);
  }
`;
document.head.appendChild(style);
