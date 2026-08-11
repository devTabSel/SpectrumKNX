import React, { useMemo, useRef, useEffect, useLayoutEffect, useState, useCallback } from 'react';
import { format } from 'date-fns';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Telegram } from '../hooks/useWebSocket';
import { ChevronUp, ChevronDown, Filter, Search, LineChart, X, Clock, Circle, CircleDot } from 'lucide-react';
import { type ActiveFilters } from '../types/filters';
import { seriesColor } from '../utils/seriesColors';
import { SendToGaPopover } from './SendToGaPopover';
import { GotoTimeControl } from './GotoTimeControl';
import { AutoFollowPill } from './AutoFollowPill';
import { getPref, setPref } from '../utils/prefs';
import type { SortKey, SortLevel, SortConfig } from '../utils/sortConfig';
import { anchorKey } from '../utils/anchorKey';
import type { ContextReason } from '../utils/deltaContextExpansion';
import {
  compileQuickFilters,
  DEFAULT_QUICK_FILTER_COLUMN_ENABLED,
  type ColId,
  type QuickCellValue,
  type QuickFilterColumnEnabled,
} from '../utils/quickFilter';
import {
  DEFAULT_SOURCE_COLUMN_LINE_CONFIG,
  resolveSourceColumnField,
  type SourceColumnLineConfig,
  type SourceDeviceMetadata,
} from '../utils/sourceColumnConfig';

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

export interface TelegramTableColumnConditionalLineStyle {
  /** Regex matcher as /pattern/flags or plain pattern string. */
  regex: string;
  style: React.CSSProperties;
}

export interface TelegramTableColumnLineStyles {
  top?: React.CSSProperties;
  bottom?: React.CSSProperties;
  topConditional?: TelegramTableColumnConditionalLineStyle[];
  bottomConditional?: TelegramTableColumnConditionalLineStyle[];
}

export interface TelegramTableColumnConfig {
  order?: number;
  visible?: boolean;
  width?: number;
  content?: TelegramTableColumnCellContent;
  lineStyles?: TelegramTableColumnLineStyles;
  /** When this column participates in sorting (except TIME/Δt), hide repeated
   * values on its sort level for consecutive rows. The first visible row always
   * keeps its value. Defaults to true; set to false to keep repeats visible. */
  hideRepeatedWhenSorted?: boolean;
}

export interface TelegramTableConfig {
  sortConfig: SortConfig;
  onSort: (key: SortKey, opts?: { additive?: boolean }) => void;
  visibleColumns: { [key: string]: boolean };
  columnOrder?: ColId[];
  onColumnOrderChange?: (order: ColId[]) => void;
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
  /** Count of live telegrams buffered upstream while follow is paused (e.g.
   * from the app's telegram cache), shown in the autofollow pill instead of
   * the table's own edge-diff count so it works under any sort order. */
  pendingLiveCount?: number;
  listAnchorKey?: string | null;
  onListAnchorKeyChange?: (key: string | null) => void;
  centerOnKey?: string | null;
  onCenterOnKeyConsumed?: () => void;

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

  /** Identity keys (via the same anchor identity) of rows present only as
   * context, not because they matched the active filters themselves, mapped
   * to the reason — a Time-Delta-Context window (#343) or being marked in any
   * main panel (#380) — for distinct visual treatment. */
  contextKeys?: ReadonlyMap<string, ContextReason>;
  onVisualizationContextClear?: (key: string) => void;
  /** Number of unique source devices across all telegrams in the current buffer. */
  allBufferSourceCount?: number | null;
  /** Configured message-buffer capacity (max telegram count). */
  bufferCapacity?: number | null;
  /** Current message count in the full buffer (before list filtering/context projection). */
  allBufferMessageCount?: number | null;
  /** Number of unique target devices across all telegrams in the current buffer. */
  allBufferTargetCount?: number | null;
  /** Distinct telegram types across all telegrams in the current buffer. */
  allBufferTypes?: string[] | null;
  /** Distinct directions across all telegrams in the current buffer. */
  allBufferDirections?: string[] | null;
  /** Distinct DPT main values across all telegrams in the current buffer. */
  allBufferDptMains?: string[] | null;
  /** Distinct DPT main.sub values across all telegrams in the current buffer. */
  allBufferDptMainSubs?: string[] | null;
  /** Total source-device count from the loaded xknxproj catalog. */
  projectSourceCount?: number | null;
  /** Total target-device count from the loaded xknxproj catalog. */
  projectTargetCount?: number | null;
  /** Optional device/location metadata keyed by source individual address. */
  sourceDeviceMetadata?: Record<string, SourceDeviceMetadata>;
  /** Configurable top/bottom fields rendered in the SOURCE column. */
  sourceColumnLines?: SourceColumnLineConfig;
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

const TYPE_ABBREVIATIONS: Record<string, string> = {
  write: 'W',
  read: 'R',
  response: 'Rsp',
  groupvaluewrite: 'W',
  groupvalueread: 'R',
  groupvalueresponse: 'Rsp',
};

const DIRECTION_ABBREVIATIONS: Record<string, string> = {
  incoming: 'In',
  outgoing: 'Out',
  unknown: 'Unk',
};

const abbreviateValue = (value: string, mapping: Record<string, string>): string => {
  const trimmed = (value || 'unknown').trim();
  const mapped = mapping[trimmed.toLowerCase()];
  if (mapped) return mapped;

  // Fallback: keep unusual values compact while still readable.
  if (trimmed.length <= 4) return trimmed;
  return trimmed.slice(0, 4);
};

const summarizeAbbreviatedValues = (values: readonly string[] | null | undefined, mapping: Record<string, string>): string => {
  if (!values || values.length === 0) return '-';
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const short = abbreviateValue(raw, mapping);
    if (seen.has(short)) continue;
    seen.add(short);
    out.push(short);
  }
  return out.length > 0 ? out.join(', ') : '-';
};

const countDistinctValues = (values: readonly string[] | null | undefined): number => {
  if (!values || values.length === 0) return 0;
  const seen = new Set<string>();
  for (const raw of values) {
    const val = (raw || '').trim();
    if (val.length === 0) continue;
    seen.add(val);
  }
  return seen.size;
};

type TelegramRow = Telegram & { deltaStr: string | null; deltaNextStr: string | null; deltaMs: number | null };

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
const SOURCE_NAME_TEXT_STYLE: React.CSSProperties = {
  fontSize: '0.7rem',
  color: 'var(--text-main)',
  fontWeight: 500,
};

const DEFAULT_COLUMN_LINE_STYLES: Partial<Record<ColId, TelegramTableColumnLineStyles>> = {
  time: {
    top: { color: 'var(--text-main)', fontVariantNumeric: 'tabular-nums', fontWeight: 500 },
    bottom: { fontSize: '0.65rem', color: 'var(--text-dim)', marginTop: '0.15rem', fontVariantNumeric: 'tabular-nums' },
  },
  delta: {
    top: { fontSize: '0.65rem', color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums', minHeight: '1em' },
    bottom: { fontSize: '0.65rem', color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums', minHeight: '1em', marginTop: '0.02rem' },
    topConditional: [
      { regex: '/^-/', style: SOURCE_NAME_TEXT_STYLE },
    ],
    bottomConditional: [
      { regex: '/^-/', style: SOURCE_NAME_TEXT_STYLE },
    ],
  },
  source: {
    // Device name style aligned to GA name style by default.
    bottom: { ...SOURCE_NAME_TEXT_STYLE, marginTop: '0.15rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  },
  target: {
    bottom: { ...SOURCE_NAME_TEXT_STYLE, marginTop: '0.15rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
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
// (regex/literal, or a to/range bound). TYPE uses two regex/literal rows:
// top against telegram type, bottom against direction. DELTA doesn't
// participate here at all — it edits the Time-Delta-Context window instead
// (#371).


export const TelegramTable: React.FC<TelegramTableProps> = ({
  instanceId = 'default',
  tableConfig,
  telegrams, visibleColumns, sortConfig, onSort, activeFilters, onQuickFilter, onQuickVisualize, onQuickLastSeen, canSend,
  quickFilterOpen, onQuickFilterOpenChange, quickFilterEnabled, onQuickFilterEnabledChange, quickPatterns, onQuickPatternsChange,
  quickFilterColumnEnabled, onQuickFilterColumnEnabledChange,
  quickFilterFiltersOutAny,
  onDeltaContextChange,
  listFollow, onListFollowChange, listAnchorKey, onListAnchorKeyChange,
  pendingLiveCount,
  centerOnKey, onCenterOnKeyConsumed,
  markedKeys, onMarkedKeysChange, lastMarkedKey, onLastMarkedKeyChange,
  infoBarOpen, onInfoBarOpenChange,
  flaggedKeys, onFlaggedKeysChange,
  contextKeys,
  onVisualizationContextClear,
  allBufferSourceCount,
  bufferCapacity,
  allBufferMessageCount,
  allBufferTargetCount,
  allBufferTypes,
  allBufferDirections,
  allBufferDptMains,
  allBufferDptMainSubs,
  projectSourceCount,
  projectTargetCount,
  sourceDeviceMetadata,
  sourceColumnLines = DEFAULT_SOURCE_COLUMN_LINE_CONFIG,
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

  const lineStyle = useCallback((colId: ColId, line: 'top' | 'bottom', lineText?: string): React.CSSProperties | undefined => {
    const defaultLineStyles = DEFAULT_COLUMN_LINE_STYLES[colId];
    const overrideLineStyles = tableConfig?.columns?.[colId]?.lineStyles;
    const base = defaultLineStyles?.[line];
    const override = overrideLineStyles?.[line];
    const conditionalRules = (overrideLineStyles?.[line === 'top' ? 'topConditional' : 'bottomConditional']
      ?? defaultLineStyles?.[line === 'top' ? 'topConditional' : 'bottomConditional']) ?? [];

    const parseRegex = (expr: string): RegExp | null => {
      const match = expr.match(/^\/(.*)\/([a-z]*)$/i);
      try {
        if (match) return new RegExp(match[1], match[2]);
        return new RegExp(expr);
      } catch {
        return null;
      }
    };

    let conditionalStyle: React.CSSProperties | undefined;
    if (lineText && conditionalRules.length > 0) {
      for (const rule of conditionalRules) {
        const re = parseRegex(rule.regex);
        if (!re) continue;
        if (re.test(lineText)) {
          conditionalStyle = rule.style;
          break;
        }
      }
    }

    if (!base && !override && !conditionalStyle) return undefined;
    return { ...(base ?? {}), ...(override ?? {}), ...(conditionalStyle ?? {}) };
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
  const [internalColumnOrder, setInternalColumnOrder] = useState<ColId[]>(() => COLUMNS.map(c => c.id));
  const [hideRepeatedOverrides, setHideRepeatedOverrides] = useState<Partial<Record<ColId, boolean>>>({});

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

  const [draggingColumnId, setDraggingColumnId] = useState<ColId | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<{ id: ColId; side: 'before' | 'after' } | null>(null);

  const applyColumnOrderChange = useCallback((nextOrder: ColId[]) => {
    if (tableConfig?.onColumnOrderChange) {
      tableConfig.onColumnOrderChange(nextOrder);
      return;
    }
    setInternalColumnOrder(nextOrder);
  }, [tableConfig]);

  const isHideRepeatedWhenSortedEnabled = useCallback((id: ColId): boolean => {
    const override = hideRepeatedOverrides[id];
    if (override !== undefined) return override;
    return tableConfig?.columns?.[id]?.hideRepeatedWhenSorted ?? true;
  }, [hideRepeatedOverrides, tableConfig?.columns]);

  const toggleHideRepeatedWhenSortedForColumn = useCallback((id: ColId) => {
    if (id === 'time' || id === 'delta') return;
    setHideRepeatedOverrides(prev => {
      const current = prev[id] ?? (tableConfig?.columns?.[id]?.hideRepeatedWhenSorted ?? true);
      return { ...prev, [id]: !current };
    });
  }, [tableConfig?.columns]);

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

  const showInfoBarToggle = quickInfoEnabled && !infoOpen;

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

  const visualizationContextKeys = useMemo(() => {
    if (!contextKeys) return [] as string[];
    return [...contextKeys.entries()]
      .filter(([, reason]) => reason === 'visualization')
      .map(([key]) => key);
  }, [contextKeys]);

  const clearContextMarks = useCallback(() => {
    if (flaggedKeysList.length > 0) {
      setFlaggedKeysList([]);
    }
    for (const key of visualizationContextKeys) {
      onVisualizationContextClear?.(key);
    }
  }, [flaggedKeysList.length, onVisualizationContextClear, setFlaggedKeysList, visualizationContextKeys]);

  const quickMatches = useMemo(
    () => compileQuickFilters(currentPatterns, currentQuickColumnEnabled),
    [currentPatterns, currentQuickColumnEnabled],
  );
  const forcedAfterQuickFilterKeys = useMemo(() => {
    if (!contextKeys) return new Set<string>();
    return new Set<string>(contextKeys.keys());
  }, [contextKeys]);
  const quickFiltered = useMemo(() => {
    if (!quickFilterFeatureEnabled || !quickOpen || !quickEnabled) return telegrams;
    const hasAnyQuickMatch = telegrams.some(t => quickMatches(t));
    if (!hasAnyQuickMatch && forcedAfterQuickFilterKeys.size === 0) return [];
    return telegrams.filter(t => quickMatches(t) || forcedAfterQuickFilterKeys.has(anchorKey(t)));
  }, [telegrams, quickFilterFeatureEnabled, quickOpen, quickEnabled, quickMatches, forcedAfterQuickFilterKeys]);

  const anyQuickColumnEnabled = useMemo(
    () => Object.values(currentQuickColumnEnabled).some(Boolean),
    [currentQuickColumnEnabled],
  );
  const quickFilterFiltersOutAnyMessage = quickFilterFiltersOutAny ?? (
    quickEnabled &&
    anyQuickColumnEnabled &&
    telegrams.some(t => !quickMatches(t))
  );

  const hasNonInitialDeltaWindow = activeFilters.deltaBeforeMs !== 0 || activeFilters.deltaAfterMs !== 0;
  const showRowMessageContextControl =
    rowFlagsEnabled &&
    quickEnabled &&
    isQuickColumnEnabled('delta') &&
    quickFilterFiltersOutAnyMessage &&
    hasNonInitialDeltaWindow;

  const timeSortDirection: 'asc' | 'desc' | null =
    effectiveSortConfig[0]?.key === 'timestamp' ? effectiveSortConfig[0].direction : null;

  // Time deltas between consecutive rows, by visual (sorted) order — always
  // computed regardless of sort column, respecting whatever hierarchy is
  // active (#311).
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
  const [valueRowFilter, setValueRowFilter] = useState<'none' | 'marked' | 'flagged'>('none');
  const [viewportVersion, setViewportVersion] = useState(0);
  // Bumped to force a re-render so the marks-pill anchor visibility (computed
  // from the live scroll position at render time) recomputes on scroll.
  void viewportVersion;
  const applyFlaggedKeysList = useCallback((nextKeys: string[]) => {
    setFlaggedKeysList(nextKeys);
    if (valueRowFilter === 'flagged' && nextKeys.length === 0) {
      setValueRowFilter('none');
    }
  }, [setFlaggedKeysList, valueRowFilter]);
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

  const applyVisibleDeltas = useCallback((rows: TelegramRow[]): TelegramRow[] => {
    if (rows.length === 0) return [];
    const timestamps = rows.map(t => new Date(t.timestamp).getTime());
    const minTs = Math.min(...timestamps);
    const maxTs = Math.max(...timestamps);

    return rows.map((t, idx) => {
      let deltaStr: string | null = null;
      let deltaNextStr: string | null = null;
      let deltaMs: number | null = null;
      const currTs = timestamps[idx];
      const hasOlderInList = currTs > minTs;
      const hasYoungerInList = currTs < maxTs;

      if (idx > 0) {
        const prevTs = timestamps[idx - 1];
        const rawDiff = currTs - prevTs;
        deltaMs = Math.abs(rawDiff);
        const sign: '+' | '-' = timeSortDirection
          ? (timeSortDirection === 'asc' ? '+' : '-')
          : (rawDiff >= 0 ? '+' : '-');
        const hasRequiredNeighbor = sign === '+' ? hasOlderInList : hasYoungerInList;
        deltaStr = hasRequiredNeighbor ? formatDeltaMs(deltaMs, sign) : null;
      }

      if (idx < rows.length - 1) {
        const nextTs = timestamps[idx + 1];
        const rawDiffToNext = nextTs - currTs;
        const nextSign: '+' | '-' = timeSortDirection
          ? (timeSortDirection === 'asc' ? '-' : '+')
          : (rawDiffToNext >= 0 ? '-' : '+');
        const hasRequiredNeighbor = nextSign === '+' ? hasOlderInList : hasYoungerInList;
        deltaNextStr = hasRequiredNeighbor ? formatDeltaMs(Math.abs(rawDiffToNext), nextSign) : null;
      }

      return { ...t, deltaStr, deltaNextStr, deltaMs };
    });
  }, [timeSortDirection]);

  const preValueFilterRows = deltaSortActive && deltaFrozenRows ? deltaFrozenRows : naturalTelegramRows;
  const telegramRows = useMemo(() => {
    const contextRelatedToSeedKeys = (seedKeys: Set<string>): Set<string> => {
      if (!contextKeys || contextKeys.size === 0 || seedKeys.size === 0) return new Set<string>();
      const beforeMs = Math.max(0, activeFilters.deltaBeforeMs);
      const afterMs = Math.max(0, activeFilters.deltaAfterMs);
      if (beforeMs <= 0 && afterMs <= 0) return new Set<string>();

      const seedTimes = preValueFilterRows
        .filter(t => seedKeys.has(anchorKey(t)))
        .map(t => new Date(t.timestamp).getTime());
      if (seedTimes.length === 0) return new Set<string>();

      const related = new Set<string>();
      for (const t of preValueFilterRows) {
        const key = anchorKey(t);
        if (!contextKeys.has(key)) continue;
        const ts = new Date(t.timestamp).getTime();
        if (seedTimes.some(seedTs => ts >= seedTs - beforeMs && ts <= seedTs + afterMs)) {
          related.add(key);
        }
      }
      return related;
    };

    if (valueRowFilter === 'marked') {
      const markedKeys = new Set(preValueFilterRows.filter(t => markedSet.has(anchorKey(t))).map(t => anchorKey(t)));
      const relatedContext = contextRelatedToSeedKeys(markedKeys);
      const filtered = preValueFilterRows.filter(t => {
        const key = anchorKey(t);
        return markedSet.has(key) || relatedContext.has(key);
      });
      return applyVisibleDeltas(filtered);
    }
    if (valueRowFilter === 'flagged') {
      const flaggedKeys = new Set(preValueFilterRows.filter(t => flaggedSet.has(anchorKey(t))).map(t => anchorKey(t)));
      const relatedContext = contextRelatedToSeedKeys(flaggedKeys);
      const filtered = preValueFilterRows.filter(t => {
        const key = anchorKey(t);
        return flaggedSet.has(key) || relatedContext.has(key);
      });
      return applyVisibleDeltas(filtered);
    }
    return applyVisibleDeltas(preValueFilterRows);
  }, [preValueFilterRows, valueRowFilter, markedSet, flaggedSet, contextKeys, activeFilters.deltaBeforeMs, activeFilters.deltaAfterMs, applyVisibleDeltas]);
  const valueRowFilterFiltersOutAnyMessage = valueRowFilter !== 'none' && telegramRows.length < preValueFilterRows.length;
  const filterIndicatorFiltersOutAnyMessage = quickFilterFiltersOutAnyMessage || valueRowFilterFiltersOutAnyMessage;
  const quickFilterDividerColor = filterIndicatorFiltersOutAnyMessage
    ? '#f59e0b'
    : (!quickEnabled || !anyQuickColumnEnabled ? '#000000' : '#6b7280');

  const markedToggleCount = useMemo(
    () => preValueFilterRows.reduce((n, t) => n + (markedSet.has(anchorKey(t)) ? 1 : 0), 0),
    [preValueFilterRows, markedSet],
  );
  const flaggedToggleCount = useMemo(
    () => preValueFilterRows.reduce((n, t) => n + (flaggedSet.has(anchorKey(t)) ? 1 : 0), 0),
    [preValueFilterRows, flaggedSet],
  );

  const isDeltaContextualKey = useCallback((rowKey: string) => contextKeys?.get(rowKey) === 'delta', [contextKeys]);

  const applyRowMarkSelection = useCallback((e: React.MouseEvent, key: string, index: number) => {
    if (!rowMarksEnabled) return;
    const additive = e.ctrlKey || e.metaKey;
    const range = e.shiftKey;
    const contextReason = contextKeys?.get(key);
    const clickedIsDeltaContext = isDeltaContextualKey(key);
    const clickedIsMarkedContext = contextReason === 'marked';
    const contextualMarkedKeys = markedKeysList.filter(rowKey => contextKeys?.get(rowKey) === 'marked');
    const regularMarkedKeys = markedKeysList.filter(rowKey => contextKeys?.get(rowKey) !== 'marked');
    if (additive || range) {
      e.preventDefault();
      window.getSelection()?.removeAllRanges();
    }

    if (clickedIsDeltaContext && !range) return;
    if (additive && !range && contextReason === 'visualization') {
      onVisualizationContextClear?.(key);
      return;
    }

    let nextKeys: string[];
    if (range) {
      const anchorIdx = lastMarked ? telegramRows.findIndex(r => anchorKey(r) === lastMarked) : -1;
      let rangeKeys: string[];
      if (anchorIdx === -1) {
        rangeKeys = clickedIsDeltaContext ? [] : [key];
      } else {
        const lo = Math.min(anchorIdx, index);
        const hi = Math.max(anchorIdx, index);
        rangeKeys = telegramRows
          .slice(lo, hi + 1)
          .map(r => anchorKey(r))
          .filter(rowKey => {
            if (clickedIsMarkedContext) {
              return contextKeys?.get(rowKey) === 'marked';
            }
            if (isDeltaContextualKey(rowKey)) return false;
            return contextKeys?.get(rowKey) !== 'marked';
          });
      }
      if (rangeKeys.length === 0) return;
      nextKeys = [...new Set([...regularMarkedKeys, ...contextualMarkedKeys, ...rangeKeys])];
    } else if (additive) {
      const currentCategoryKeys = clickedIsMarkedContext ? contextualMarkedKeys : regularMarkedKeys;
      const toggledCategoryKeys = currentCategoryKeys.includes(key)
        ? currentCategoryKeys.filter(markedKey => markedKey !== key)
        : [...currentCategoryKeys, key];
      nextKeys = clickedIsMarkedContext
        ? [...new Set([...regularMarkedKeys, ...toggledCategoryKeys])]
        : [...new Set([...contextualMarkedKeys, ...toggledCategoryKeys])];
    } else {
      if (clickedIsMarkedContext) return;
      nextKeys = markedSet.has(key)
        ? [key]
        : [...contextualMarkedKeys, key];
    }

    setMarkedKeysList(nextKeys);
    if (additive && valueRowFilter === 'marked' && nextKeys.length === 0) {
      setValueRowFilter('none');
    }
    if (!clickedIsDeltaContext) {
      setLastMarked(key);
    }
  }, [contextKeys, isDeltaContextualKey, lastMarked, markedKeysList, markedSet, onVisualizationContextClear, rowMarksEnabled, setLastMarked, setMarkedKeysList, telegramRows, valueRowFilter]);

  // Message-context flags are a standalone toggle control: clicks affect only
  // the flag state for the relevant rows and never trigger row-mark selection.
  const handleFlagClick = useCallback((e: React.MouseEvent, key: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!rowFlagsEnabled) return;
    const additive = e.ctrlKey || e.metaKey;
    const range = e.shiftKey;
    if (additive || range) {
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
      setFollowPaused(true);
      setNewSinceAnchor(0);
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
    } else {
      nextKeys = flaggedSet.has(key)
        ? flaggedKeysList.filter(flaggedKey => flaggedKey !== key)
        : [...flaggedKeysList, key];
    }

    applyFlaggedKeysList(nextKeys);
    lastFlaggedKeyRef.current = key;
  }, [applyFlaggedKeysList, flaggedSet, flaggedKeysList, onListAnchorKeyChange, onListFollowChange, rowFlagsEnabled, telegramRows]);

  // ── Global Time-Delta-Context tristate (#318, #319) ─────────────────────────
  // Reflects the per-message flags among the currently visible rows: none set,
  // all set, or some. Plain click cycles flags using the scoped rule (marked
  // rows when >1 row is marked, otherwise visible non-context rows). Ctrl/cmd
  // click always applies to all currently displayed rows.
  const deltaFlagState: 'none' | 'some' | 'all' = useMemo(() => {
    const markedRows = telegramRows.filter(t => markedSet.has(anchorKey(t)));
    const eligibleRows = markedRows.length > 1
      ? markedRows
      : telegramRows.filter(t => !contextKeys?.has(anchorKey(t)));
    if (eligibleRows.length === 0 || flaggedSet.size === 0) return 'none';
    const flaggedCount = eligibleRows.reduce((n, t) => n + (flaggedSet.has(anchorKey(t)) ? 1 : 0), 0);
    if (flaggedCount === 0) return 'none';
    return flaggedCount === eligibleRows.length ? 'all' : 'some';
  }, [telegramRows, markedSet, flaggedSet, contextKeys]);

  const handleDeltaToggleClick = useCallback((e: React.MouseEvent) => {
    if (e.ctrlKey || e.metaKey) {
      const displayedKeys = telegramRows.map(t => anchorKey(t));
      const displayedKeySet = new Set(displayedKeys);
      const allDisplayedFlagged = displayedKeys.length > 0 && displayedKeys.every(key => flaggedSet.has(key));
      const nextKeys = allDisplayedFlagged
        ? flaggedKeysList.filter(key => !displayedKeySet.has(key))
        : [...new Set([...flaggedKeysList, ...displayedKeys])];
      applyFlaggedKeysList(nextKeys);
      return;
    }
    const markedRows = telegramRows.filter(t => markedSet.has(anchorKey(t)));
    const eligibleRows = markedRows.length > 1
      ? markedRows
      : telegramRows.filter(t => !contextKeys?.has(anchorKey(t)));
    const eligibleKeys = eligibleRows.map(t => anchorKey(t));
    const eligibleKeySet = new Set(eligibleKeys);
    const nextKeys = deltaFlagState === 'none'
      ? [...new Set([...flaggedKeysList, ...eligibleKeys])]
      : flaggedKeysList.filter(key => !eligibleKeySet.has(key));
    applyFlaggedKeysList(nextKeys);
  }, [applyFlaggedKeysList, deltaFlagState, telegramRows, markedSet, contextKeys, flaggedSet, flaggedKeysList]);

  // ── Quick info bar metrics (#311) ───────────────────────────────────────────
  // Summarizes the currently visible (sorted + filtered) rows; oldest/newest
  // and min/max Δt jump to their row via gotoIndex regardless of sort order.
  const infoMetrics = useMemo(() => {
    if (telegramRows.length === 0) {
      return {
        count: 0,
        oldestIdx: -1,
        newestIdx: -1,
        minDeltaIdx: -1,
        maxDeltaIdx: -1,
        displayedSourceCount: 0,
        matchedSourceCount: 0,
        contextualOnlySourceCount: 0,
        displayedTargetCount: 0,
        matchedTargetCount: 0,
        contextualOnlyTargetCount: 0,
        displayedTypeValues: [],
        matchedTypeValues: [],
        displayedDirectionValues: [],
        matchedDirectionValues: [],
        displayedDptMainValues: [],
        matchedDptMainValues: [],
        displayedDptMainSubValues: [],
        matchedDptMainSubValues: [],
        contextCount: 0,
        markedVisibleCount: 0,
        flaggedVisibleCount: 0,
      };
    }
    let oldestIdx = 0, newestIdx = 0;
    let minDeltaIdx = -1, maxDeltaIdx = -1;
    const displayedSources = new Set<string>();
    const matchedSources = new Set<string>();
    const contextualSources = new Set<string>();
    const displayedTargets = new Set<string>();
    const matchedTargets = new Set<string>();
    const contextualTargets = new Set<string>();
    const displayedDptMains = new Set<string>();
    const matchedDptMains = new Set<string>();
    const displayedDptMainSubs = new Set<string>();
    const matchedDptMainSubs = new Set<string>();
    const displayedTypes = new Set<string>();
    const matchedTypes = new Set<string>();
    const displayedDirections = new Set<string>();
    const matchedDirections = new Set<string>();
    let contextCount = 0;
    telegramRows.forEach((t, i) => {
      const isContextOnly = !!contextKeys?.has(anchorKey(t));
      if (new Date(t.timestamp) < new Date(telegramRows[oldestIdx].timestamp)) oldestIdx = i;
      if (new Date(t.timestamp) > new Date(telegramRows[newestIdx].timestamp)) newestIdx = i;
      if (t.deltaMs != null) {
        if (minDeltaIdx === -1 || t.deltaMs < telegramRows[minDeltaIdx].deltaMs!) minDeltaIdx = i;
        if (maxDeltaIdx === -1 || t.deltaMs > telegramRows[maxDeltaIdx].deltaMs!) maxDeltaIdx = i;
      }
      displayedSources.add(t.source_address);
      if (isContextOnly) {
        contextualSources.add(t.source_address);
        contextualTargets.add(t.target_address);
      } else {
        matchedSources.add(t.source_address);
        matchedTargets.add(t.target_address);
      }
      displayedTargets.add(t.target_address);
      if (t.dpt_main != null) {
        const main = String(t.dpt_main);
        displayedDptMains.add(main);
        if (!isContextOnly) matchedDptMains.add(main);
        if (t.dpt_sub != null) {
          const full = `${t.dpt_main}.${String(t.dpt_sub).padStart(3, '0')}`;
          displayedDptMainSubs.add(full);
          if (!isContextOnly) matchedDptMainSubs.add(full);
        }
      }
      const type = t.simplified_type || t.telegram_type;
      const direction = t.direction ?? 'unknown';
      displayedTypes.add(type);
      displayedDirections.add(direction);
      if (!isContextOnly) {
        matchedTypes.add(type);
        matchedDirections.add(direction);
      }
      if (isContextOnly) contextCount++;
    });
    const contextualOnlySourceCount = [...contextualSources].filter(src => !matchedSources.has(src)).length;
    const contextualOnlyTargetCount = [...contextualTargets].filter(tgt => !matchedTargets.has(tgt)).length;
    const markedVisibleCount = telegramRows.reduce((n, t) => n + (markedSet.has(anchorKey(t)) ? 1 : 0), 0);
    const flaggedVisibleCount = telegramRows.reduce((n, t) => n + (flaggedSet.has(anchorKey(t)) ? 1 : 0), 0);
    return {
      count: telegramRows.length,
      oldestIdx, newestIdx,
      minDeltaIdx, maxDeltaIdx,
      displayedSourceCount: displayedSources.size,
      matchedSourceCount: matchedSources.size,
      contextualOnlySourceCount,
      displayedTargetCount: displayedTargets.size,
      matchedTargetCount: matchedTargets.size,
      contextualOnlyTargetCount,
      displayedTypeValues: [...displayedTypes],
      matchedTypeValues: [...matchedTypes],
      displayedDirectionValues: [...displayedDirections],
      matchedDirectionValues: [...matchedDirections],
      displayedDptMainValues: [...displayedDptMains],
      matchedDptMainValues: [...matchedDptMains],
      displayedDptMainSubValues: [...displayedDptMainSubs],
      matchedDptMainSubValues: [...matchedDptMainSubs],
      contextCount,
      markedVisibleCount,
      flaggedVisibleCount,
    };
  }, [telegramRows, contextKeys, markedSet, flaggedSet]);

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

  useLayoutEffect(() => {
    if (parentRef.current) {
      setViewportVersion(v => v + 1);
    }
  }, [telegramRows.length, virtualizer.getTotalSize()]);

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
  // Reactive mirror of atEdgeRef so the autofollow pill can re-render on
  // pause/resume regardless of sort (edge-diffing alone only works for the
  // timestamp sort).
  const [followPaused, setFollowPaused] = useState(() => !(listFollow ?? true));
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

  const pauseFollow = useCallback(() => {
    atEdgeRef.current = false;
    onListFollowChange?.(false);
    setFollowPaused(true);
  }, [onListFollowChange]);

  const resumeFollow = useCallback(() => {
    atEdgeRef.current = true;
    onListFollowChange?.(true);
    setNewSinceAnchor(0);
    setFollowPaused(false);
  }, [onListFollowChange]);

  // Sync props to refs. A parent prop of false pauses follow; a prop of true
  // does not override a user-triggered pause until the user explicitly resumes.
  useEffect(() => {
    if (listFollow === false) {
      pauseFollow();
    }
  }, [listFollow, pauseFollow]);

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
    if (isTimeSort) {
      // A live edge exists: reaching it resumes follow automatically, moving
      // away pauses it, mirroring the pre-unification behavior.
      const atEdge = checkAtEdge();
      if (atEdge !== atEdgeRef.current) {
        if (atEdge) {
          resumeFollow();
        } else {
          pauseFollow();
        }
      }
      if (atEdge) {
        anchorRef.current = null;
        onListAnchorKeyChange?.(null);
      } else {
        captureAnchor();
      }
    } else {
      // No live edge outside the timestamp sort — any scroll is navigation;
      // only an explicit pill click resumes (#391).
      if (atEdgeRef.current) pauseFollow();
      captureAnchor();
    }
    setViewportVersion(v => v + 1);
  };

  // Clicking a row (a) marks it (#310) and (b) pauses live-following just like
  // scrolling away (#266) — the row being read must not move. The jump-to-live
  // pill is the way back. Rows present only as delta-time context stay
  // protected from plain/ctrl clicks, while other context reasons can still be
  // marked/unmarked.
  const handleRowClick = (e: React.MouseEvent, key: string, index: number, isDeltaContextOnly: boolean) => {
    if (isDeltaContextOnly && !e.shiftKey) return;
    const contextReason = contextKeys?.get(key);
    const isPlainRowClick = !e.ctrlKey && !e.metaKey && !e.shiftKey;
    const shouldSetLastMarked = isPlainRowClick && !isDeltaContextOnly && contextReason !== 'marked' && contextReason !== 'visualization';
    applyRowMarkSelection(e, key, index);
    if (shouldSetLastMarked) {
      setLastMarked(key);
    }

    // ── Pause live-following on a row click, any sort (#391) ──
    if (!atEdgeRef.current) return;
    pauseFollow();
    captureAnchor();
  };

  const scrollToEdge = () => {
    markProgrammatic();
    virtualizer.scrollToOffset(liveEdge === 'top' ? 0 : virtualizer.getTotalSize());
  };

  const jumpToLive = () => {
    resumeFollow();
    anchorRef.current = null;
    onListAnchorKeyChange?.(null);
    scrollToEdge();
  };

  // Scrolls to a specific row by index and stops live-following, so the
  // viewed rows stay put while new ones accumulate. Used by "quick goto time"
  // and the quick info bar's click-to-jump metrics (#282, #311).
  const gotoIndex = (idx: number) => {
    if (idx < 0 || idx >= telegramRows.length) return;
    pauseFollow();
    markProgrammatic();
    virtualizer.scrollToIndex(idx, { align: 'center' });
    // Pin the row we land on once the virtualizer has settled the scroll (rows
    // are dynamically measured, so give it two frames before capturing).
    requestAnimationFrame(() => requestAnimationFrame(() => {
      captureAnchor();
      pauseFollow();
    }));
  };

  const markSingleRowByIndex = useCallback((idx: number) => {
    if (!rowMarksEnabled || idx < 0 || idx >= telegramRows.length) return;
    const key = anchorKey(telegramRows[idx]);
    const nextKeys = markedSet.has(key)
      ? markedKeysList
      : [...markedKeysList, key];
    setMarkedKeysList(nextKeys);
    setLastMarked(key);
  }, [rowMarksEnabled, telegramRows, markedSet, markedKeysList, setMarkedKeysList, setLastMarked]);

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
    setStripeOffset(0);
    anchorRef.current = null;
    onListAnchorKeyChange?.(null);
    const atEdge = checkAtEdge();
    if (atEdge === false && atEdgeRef.current) {
      pauseFollow();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveSortConfig]);

  // Restore scroll position/anchor on mount (#203, #341)
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || telegramRows.length === 0) return;
    restoredRef.current = true;

    if (!atEdgeRef.current) return;
    if (listAnchorKey) {
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

  useEffect(() => {
    if (!centerOnKey || telegramRows.length === 0) return;
    const idx = telegramRows.findIndex(t => anchorKey(t) === centerOnKey);
    if (idx === -1) return;

    atEdgeRef.current = false;
    onListFollowChange?.(false);
    setFollowPaused(true);
    setNewSinceAnchor(0);
    markProgrammatic();
    virtualizer.scrollToIndex(idx, { align: 'center' });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      captureAnchor();
      atEdgeRef.current = false;
      onListFollowChange?.(false);
      onCenterOnKeyConsumed?.();
    }));
  }, [centerOnKey, telegramRows, virtualizer, onListFollowChange, onCenterOnKeyConsumed]);

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
    const order = tableConfig?.columnOrder ?? internalColumnOrder;
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
  }, [effectiveVisibleColumns, tableConfig?.columnOrder, tableConfig?.columns, internalColumnOrder]);

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

  const handleColumnDrop = useCallback((fromId: ColId, overId: ColId, side: 'before' | 'after') => {
    if (fromId === overId) return;
    const visibleIds = visibleCols.map(c => c.id);
    if (!visibleIds.includes(fromId) || !visibleIds.includes(overId)) return;

    const fromIdx = visibleIds.indexOf(fromId);
    const overIdx = visibleIds.indexOf(overId);
    if (fromIdx === -1 || overIdx === -1) return;

    const nextVisibleIds = [...visibleIds];
    nextVisibleIds.splice(fromIdx, 1);
    const overIdxAfterRemoval = nextVisibleIds.indexOf(overId);
    const insertionIdx = side === 'after' ? overIdxAfterRemoval + 1 : overIdxAfterRemoval;
    nextVisibleIds.splice(insertionIdx, 0, fromId);

    if (nextVisibleIds.every((id, idx) => id === visibleIds[idx])) return;

    const configuredOrder = (tableConfig?.columnOrder && tableConfig.columnOrder.length > 0)
      ? tableConfig.columnOrder
      : internalColumnOrder;
    const visibleSet = new Set(visibleIds);
    const hiddenIds = configuredOrder.filter(id => !visibleSet.has(id));
    const nextOrder = [...nextVisibleIds, ...hiddenIds];
    applyColumnOrderChange(nextOrder);
  }, [visibleCols, tableConfig?.columnOrder, internalColumnOrder, applyColumnOrderChange]);

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
    const hideRepeatedEnabled = isHideRepeatedWhenSortedEnabled(id);
    if (!hideRepeatedEnabled) return false;

    const sortKey = COLUMNS.find(c => c.id === id)?.sortKey;
    if (!sortKey || sortKey === 'timestamp') return false;

    const levelIdx = effectiveSortConfig.findIndex(level => level.key === sortKey);
    if (levelIdx === -1) return false;

    const prev = telegramRows[rowIndex - 1];
    const curr = telegramRows[rowIndex];
    if (!prev || !curr) return false;

    for (let i = 0; i <= levelIdx; i++) {
      if (!isSameSortKeyValue(prev, curr, effectiveSortConfig[i].key)) return false;
    }
    return true;
  }, [isHideRepeatedWhenSortedEnabled, effectiveSortConfig, telegramRows, isSameSortKeyValue]);

  // ── Per-cell body content (keyed switch keeps body aligned with header order) ──
  const renderCell = (id: ColId, t: TelegramRow, rowIndex: number, forceShow = false): React.ReactNode => {
    const hideRepeated = shouldHideRepeatedOnSortLevel(id, rowIndex, forceShow);
    const customContent = tableConfig?.columns?.[id]?.content;
    if (customContent) {
      if (hideRepeated) {
        return <div style={{ padding: cellPadding, minWidth: 0, overflow: 'hidden' }} />;
      }
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

    if (hideRepeated) {
      return <div style={{ padding: cellPadding, minWidth: 0, overflow: 'hidden' }} className="filterable-cell" />;
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
        const topText = t.deltaStr ?? '';
        const bottomText = t.deltaNextStr ?? '';
        return (
          <div style={{ padding: cellPadding, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.16rem' }}>
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
        {
          const topField = sourceColumnLines.top;
          const bottomField = sourceColumnLines.bottom;
          const topText = resolveSourceColumnField(t, sourceDeviceMetadata, topField) || '-';
          const bottomText = resolveSourceColumnField(t, sourceDeviceMetadata, bottomField) || '-';
          const topIsAddress = topField === 'address';
          const bottomIsAddress = bottomField === 'address';
        return (
          <div style={{ padding: cellPadding, minWidth: 0, overflow: 'hidden' }} className="filterable-cell">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', minWidth: 0 }}>
              <div
                className={topIsAddress ? 'mono-addr highlight' : undefined}
                title={topText}
                style={topIsAddress
                  ? { color: 'var(--text-dim)', fontWeight: 400 }
                  : {
                    color: 'var(--text-main)',
                    fontSize: '0.75rem',
                    fontWeight: 500,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    minWidth: 0,
                    ...lineStyle('source', 'top', topText),
                  }}
              >
                {topText}
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
            {effectiveVisibleColumns.sourceName && (
              <div
                className={bottomIsAddress ? 'mono-addr' : 'subtitle-name'}
                title={bottomText}
                style={bottomIsAddress
                  ? {
                    fontSize: '0.7rem',
                    color: 'var(--text-dim)',
                    marginTop: '0.15rem',
                    fontWeight: 400,
                    ...lineStyle('source', 'bottom', bottomText),
                  }
                  : lineStyle('source', 'bottom', bottomText)}
              >
                {bottomText}
              </div>
            )}
          </div>
        );
      }

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
    display: 'flex', alignItems: 'center', gap: '0.3rem',
    width: '100%',
    minHeight: '1.65rem',
    background: 'var(--bg-tag)',
    border: '1px solid var(--border-color)',
    borderRadius: '5px',
    padding: '0.25rem 0.45rem',
    fontSize: '0.68rem',
    color: 'var(--text-dim)',
    fontFamily: 'var(--font-mono, monospace)',
  };
  const infoChipBtnStyle: React.CSSProperties = {
    ...infoChipStyle, cursor: 'pointer',
  };
  const infoChipBottomStyle: React.CSSProperties = {
    ...infoChipStyle,
    color: '#f59e0b',
  };
  const infoCountBtnStyle: React.CSSProperties = {
    border: '1px solid var(--border-color)',
    borderRadius: '4px',
    background: 'transparent',
    color: 'var(--text-main)',
    fontFamily: 'var(--font-mono, monospace)',
    fontSize: '0.68rem',
    lineHeight: 1,
    minWidth: '1.6rem',
    height: '1.25rem',
    padding: '0 0.35rem',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  };
  const infoCountBtnBottomStyle: React.CSSProperties = {
    ...infoCountBtnStyle,
    color: '#f59e0b',
    borderColor: 'color-mix(in srgb, #f59e0b 45%, var(--border-color))',
  };
  const infoCountBtnDisabledStyle: React.CSSProperties = {
    ...infoCountBtnStyle,
    opacity: 0.45,
    cursor: 'default',
  };
  const infoCountBtnActiveStyle: React.CSSProperties = {
    ...infoCountBtnStyle,
    borderColor: 'var(--accent-primary)',
    background: 'color-mix(in srgb, var(--accent-primary) 22%, transparent)',
    color: 'var(--text-main)',
    boxShadow: '0 0 0 1px color-mix(in srgb, var(--accent-primary) 35%, transparent) inset',
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Quick info bar (#311): collapsible summary directly above the header. */}
      {quickInfoEnabled && infoOpen && (
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-subtle)', flexShrink: 0 }}>
          {/* Left icon rail (#341): two rows matching the quick-info grid rows. */}
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
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: 'grid',
              gridTemplateColumns: gridTemplate,
              paddingRight: '8px', // align with header/QF scrollbar compensation
            }}
          >
            {visibleCols.map((c) => {
              let topNode: React.ReactNode = <span style={infoChipStyle} />;
              let bottomNode: React.ReactNode = <span style={infoChipBottomStyle} />;

              if (infoMetrics) {
                if (c.id === 'time' && infoMetrics.count > 0) {
                  topNode = (
                    <button
                      style={{ ...infoChipBtnStyle, width: '100%', justifyContent: 'flex-start' }}
                      title="Jump to the oldest telegram in the current view"
                      onClick={() => {
                        markSingleRowByIndex(infoMetrics.oldestIdx);
                        gotoIndex(infoMetrics.oldestIdx);
                      }}
                    >
                      Oldest: {format(new Date(telegramRows[infoMetrics.oldestIdx].timestamp), 'yyyy-MM-dd HH:mm:ss.SS')}
                    </button>
                  );
                  bottomNode = (
                    <button
                      style={{ ...infoChipBtnStyle, width: '100%', justifyContent: 'flex-start' }}
                      title="Jump to the newest telegram in the current view"
                      onClick={() => {
                        markSingleRowByIndex(infoMetrics.newestIdx);
                        gotoIndex(infoMetrics.newestIdx);
                      }}
                    >
                      Newest: {format(new Date(telegramRows[infoMetrics.newestIdx].timestamp), 'yyyy-MM-dd HH:mm:ss.SS')}
                    </button>
                  );
                } else if (c.id === 'delta' && infoMetrics.count > 0) {
                  topNode = infoMetrics.minDeltaIdx !== -1 ? (
                    <button
                      style={{ ...infoChipBtnStyle, width: '100%', justifyContent: 'flex-start' }}
                      title="Jump to the smallest time gap in the current view"
                      onClick={() => {
                        markSingleRowByIndex(infoMetrics.minDeltaIdx);
                        gotoIndex(infoMetrics.minDeltaIdx);
                      }}
                    >
                      Min Δt: {telegramRows[infoMetrics.minDeltaIdx].deltaStr}
                    </button>
                  ) : <span style={infoChipStyle}>Min Δt: -</span>;
                  bottomNode = infoMetrics.maxDeltaIdx !== -1 ? (
                    <button
                      style={{ ...infoChipBtnStyle, width: '100%', justifyContent: 'flex-start' }}
                      title="Jump to the largest time gap in the current view"
                      onClick={() => {
                        markSingleRowByIndex(infoMetrics.maxDeltaIdx);
                        gotoIndex(infoMetrics.maxDeltaIdx);
                      }}
                    >
                      Max Δt: {telegramRows[infoMetrics.maxDeltaIdx].deltaStr}
                    </button>
                  ) : <span style={infoChipStyle}>Max Δt: -</span>;
                } else if (c.id === 'source') {
                  const allSourcesInBuffer = allBufferSourceCount ?? infoMetrics.displayedSourceCount;
                  const showFilteredSourceContent = infoMetrics.matchedSourceCount !== allSourcesInBuffer;
                  topNode = <span style={infoChipStyle}>buffer: {allSourcesInBuffer} / {projectSourceCount ?? '-'}</span>;
                  bottomNode = infoMetrics.count === 0 || !showFilteredSourceContent
                    ? <span style={infoChipBottomStyle} />
                    : (
                      <span style={infoChipBottomStyle}>
                        <button
                          style={infoCountBtnBottomStyle}
                          title="Filtered source-device count"
                          onClick={() => {}}
                        >
                          {infoMetrics.matchedSourceCount}
                        </button>
                        <span>filtered</span>
                        {infoMetrics.contextualOnlySourceCount > 0 && (
                          <>
                            <span>(</span>
                            <button
                              style={infoCountBtnBottomStyle}
                              title="Contextual source-device count"
                              onClick={() => {}}
                            >
                              {infoMetrics.contextualOnlySourceCount}
                            </button>
                            <span>)</span>
                          </>
                        )}
                      </span>
                    );
                } else if (c.id === 'target') {
                  const allTargetsInBuffer = allBufferTargetCount ?? infoMetrics.displayedTargetCount;
                  const showFilteredTargetContent = infoMetrics.matchedTargetCount !== allTargetsInBuffer;
                  topNode = <span style={infoChipStyle}>buffer: {allTargetsInBuffer} / {projectTargetCount ?? '-'}</span>;
                  bottomNode = infoMetrics.count === 0 || !showFilteredTargetContent
                    ? <span style={infoChipBottomStyle} />
                    : (
                      <span style={infoChipBottomStyle}>
                        <button
                          style={infoCountBtnBottomStyle}
                          title="Filtered target-device count"
                          onClick={() => {}}
                        >
                          {infoMetrics.matchedTargetCount}
                        </button>
                        <span>filtered</span>
                        {infoMetrics.contextualOnlyTargetCount > 0 && (
                          <>
                            <span>(</span>
                            <button
                              style={infoCountBtnBottomStyle}
                              title="Contextual target-device count"
                              onClick={() => {}}
                            >
                              {infoMetrics.contextualOnlyTargetCount}
                            </button>
                            <span>)</span>
                          </>
                        )}
                      </span>
                    );
                } else if (c.id === 'type') {
                  const totalTypeSummary = summarizeAbbreviatedValues(allBufferTypes ?? infoMetrics.displayedTypeValues, TYPE_ABBREVIATIONS);
                  const totalDirectionSummary = summarizeAbbreviatedValues(allBufferDirections ?? infoMetrics.displayedDirectionValues, DIRECTION_ABBREVIATIONS);
                  const filteredTypeSummary = summarizeAbbreviatedValues(infoMetrics.matchedTypeValues, TYPE_ABBREVIATIONS);
                  const filteredDirectionSummary = summarizeAbbreviatedValues(infoMetrics.matchedDirectionValues, DIRECTION_ABBREVIATIONS);
                  const bottomParts: string[] = [];
                  if (filteredTypeSummary !== totalTypeSummary || quickFilterFiltersOutAnyMessage) bottomParts.push(`types: ${filteredTypeSummary}`);
                  if (filteredDirectionSummary !== totalDirectionSummary || quickFilterFiltersOutAnyMessage) bottomParts.push(`dirs: ${filteredDirectionSummary}`);
                  topNode = <span style={infoChipStyle}>types: {totalTypeSummary} / dirs: {totalDirectionSummary}</span>;
                  bottomNode = infoMetrics.count === 0
                    ? <span style={infoChipBottomStyle} />
                    : <span style={infoChipBottomStyle}>{bottomParts.join(' / ')}</span>;
                } else if (c.id === 'dpt') {
                  const totalMainCount = countDistinctValues(allBufferDptMains ?? infoMetrics.displayedDptMainValues);
                  const totalMainSubCount = countDistinctValues(allBufferDptMainSubs ?? infoMetrics.displayedDptMainSubValues);
                  const filteredMainCount = countDistinctValues(infoMetrics.matchedDptMainValues);
                  const filteredMainSubCount = countDistinctValues(infoMetrics.matchedDptMainSubValues);
                  const bottomParts: string[] = [];
                  if (filteredMainCount !== totalMainCount || quickFilterFiltersOutAnyMessage) bottomParts.push(`main: ${filteredMainCount}`);
                  if (filteredMainSubCount !== totalMainSubCount || quickFilterFiltersOutAnyMessage) bottomParts.push(`DPT: ${filteredMainSubCount}`);
                  topNode = <span style={infoChipStyle}>main: {totalMainCount} / DPT: {totalMainSubCount}</span>;
                  bottomNode = infoMetrics.count === 0
                    ? <span style={infoChipBottomStyle} />
                    : <span style={infoChipBottomStyle}>{bottomParts.join(' / ')}</span>;
                } else if (c.id === 'value') {
                  const totalInBuffer = allBufferMessageCount ?? infoMetrics.count;
                  const filteredMessageCount = Math.max(0, infoMetrics.count - infoMetrics.contextCount);
                  const showFilteredMessageCount = filteredMessageCount !== totalInBuffer;
                  topNode = (
                    <span style={infoChipStyle}>
                      <span>msg: {totalInBuffer} / buf: {bufferCapacity ?? '-'}, marks:</span>
                      <button
                        style={markedToggleCount > 0
                          ? (valueRowFilter === 'marked' ? infoCountBtnActiveStyle : infoCountBtnStyle)
                          : infoCountBtnDisabledStyle}
                        title="Marked message count"
                        disabled={markedToggleCount === 0}
                        aria-pressed={valueRowFilter === 'marked'}
                        onClick={() => {
                          if (markedToggleCount === 0) return;
                          setValueRowFilter(prev => (prev === 'marked' ? 'none' : 'marked'));
                        }}
                      >
                        {markedToggleCount}
                      </button>
                      <span>context marks:</span>
                      <button
                        style={flaggedToggleCount > 0
                          ? (valueRowFilter === 'flagged' ? infoCountBtnActiveStyle : infoCountBtnStyle)
                          : infoCountBtnDisabledStyle}
                        title="Context-marked message count"
                        disabled={flaggedToggleCount === 0}
                        aria-pressed={valueRowFilter === 'flagged'}
                        onClick={() => {
                          if (flaggedToggleCount === 0) return;
                          setValueRowFilter(prev => (prev === 'flagged' ? 'none' : 'flagged'));
                        }}
                      >
                        {flaggedToggleCount}
                      </button>
                    </span>
                  );
                  bottomNode = infoMetrics.count === 0
                    ? <span style={infoChipBottomStyle} />
                    : (
                      <span style={infoChipBottomStyle}>
                        {showFilteredMessageCount
                          ? `${filteredMessageCount} filtered${infoMetrics.contextCount > 0 ? ` (${infoMetrics.contextCount})` : ''}`
                          : ''}
                      </span>
                    );
                }
              }

              return (
                <div
                  key={c.id}
                  style={{
                    padding: '0.35rem 0.5rem',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '0.35rem',
                    minWidth: 0,
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', minWidth: 0, flex: 1 }}>
                    {topNode}
                    {bottomNode}
                  </div>
                </div>
              );
            })}
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
            color: '#fff',
            fontSize: '0.8rem',
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
          <div
            key={c.id}
            className={`header-col${draggingColumnId === c.id ? ' drag-source' : ''}${dragOverColumn?.id === c.id ? ` drop-${dragOverColumn.side}` : ''}`}
            draggable
            onDragStart={(e) => {
              setDraggingColumnId(c.id);
              e.dataTransfer?.setData('text/plain', c.id);
              if (e.dataTransfer) {
                e.dataTransfer.effectAllowed = 'move';
              }
            }}
            onDragOver={(e) => {
              if (!draggingColumnId || draggingColumnId === c.id) return;
              e.preventDefault();
              if (e.dataTransfer) {
                e.dataTransfer.dropEffect = 'move';
              }
              const rect = e.currentTarget.getBoundingClientRect();
              const side: 'before' | 'after' = (e.clientX - rect.left) < (rect.width / 2) ? 'before' : 'after';
              if (!dragOverColumn || dragOverColumn.id !== c.id || dragOverColumn.side !== side) {
                setDragOverColumn({ id: c.id, side });
              }
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (draggingColumnId && draggingColumnId !== c.id) {
                const side = dragOverColumn?.id === c.id ? dragOverColumn.side : 'before';
                handleColumnDrop(draggingColumnId, c.id, side);
              }
              setDragOverColumn(null);
              setDraggingColumnId(null);
            }}
            onDragEnd={() => {
              setDragOverColumn(null);
              setDraggingColumnId(null);
            }}
            style={{ position: 'relative', display: 'flex', flexDirection: 'column', minWidth: 0 }}
          >
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
          and a text/to row. TYPE uses type/direction regex rows; DELTA
          (Time-Delta-Context before/after, #371) doesn't go through the
          pattern pipeline. */}
      {quickFilterFeatureEnabled && quickOpen && (
        <>
        <div style={{ display: 'flex', background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border-color)', flexShrink: 0, opacity: quickEnabled ? 1 : 0.5 }}>
          {/* Left icon rail (#341): DELTA window toggle on the first row,
              hide-arrow on the second row. */}
          <div style={{ width: RAIL_WIDTH, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {showRowMessageContextControl && (
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
                  {deltaFlagState === 'all' ? <CircleDot size={12} /> : <Circle size={12} />}
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
                  // source / target / dpt: top = address/DPT-key pattern, bottom = name/description regex
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
            background: quickFilterDividerColor,
          }}
        />
        </>
      )}

      {/* Body area — relative wrapper so the jump-to-live pill (#202) anchors
          below the header, not over it. */}
      <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Jump-to-live / autofollow pill — shown while paused, in any sort order (#391) */}
      {(pendingLiveCount !== undefined ? (followPaused && !deltaSortActive) : isTimeSort) && (
        <AutoFollowPill
          count={pendingLiveCount ?? newSinceAnchor}
          onClick={jumpToLive}
          style={{
            position: 'absolute', left: '50%', transform: 'translateX(-50%)',
            [liveEdge]: '1rem', zIndex: 20,
          }}
        />
      )}

      {/* Clear marks/context-marks pills — shown while entries exist (#310, #319) */}
      {((rowMarksEnabled && markedKeysList.length > 0) || (rowFlagsEnabled && (flaggedKeysList.length > 0 || visualizationContextKeys.length > 0))) && (
        <div style={{ position: 'absolute', right: '1rem', top: '0.75rem', zIndex: 20, display: 'flex', flexDirection: 'column', gap: '0.35rem', alignItems: 'flex-end' }}>
          {rowMarksEnabled && markedKeysList.length > 0 && (() => {
            const virtualItems = virtualizer.getVirtualItems();
            const scrollTop = parentRef.current?.scrollTop ?? 0;
            const viewportHeight = parentRef.current?.clientHeight ?? 0;
            const scrollBottom = scrollTop + viewportHeight;
            const firstVisibleVirtual =
              virtualItems.find(v => v.start >= scrollTop && (v.start + v.size) <= scrollBottom)
              ?? virtualItems.find(v => (v.start + v.size) > scrollTop)
              ?? virtualItems[0];
            const firstVisibleRowIndex = firstVisibleVirtual?.index ?? -1;
            const lastVisibleRowIndex = virtualItems.at(-1)?.index ?? firstVisibleRowIndex;
            const markedRowIndices = telegramRows.reduce<number[]>((acc, row, index) => {
              if (markedSet.has(anchorKey(row))) acc.push(index);
              return acc;
            }, []);
            const aboveVisible = markedRowIndices.filter(index => index < firstVisibleRowIndex).at(-1);
            const belowVisible = markedRowIndices.find(index => index > lastVisibleRowIndex);
            return (
              <div className="clear-marks-pill" title="Marked rows">
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    clearMarks();
                  }}
                  className="clear-marks-pill-clear"
                  title="Clear all marks"
                  aria-label="Clear all marks"
                >
                  <X size={13} />
                </button>
                <span>{markedKeysList.length} mark{markedKeysList.length === 1 ? '' : 's'}</span>
                {aboveVisible !== undefined && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      gotoIndex(aboveVisible);
                    }}
                    className="clear-marks-pill-anchor"
                    title="Jump to the nearest marked row above the visible area"
                    aria-label="Jump to marked row above"
                  >
                    <ChevronUp size={12} />
                  </button>
                )}
                {belowVisible !== undefined && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      gotoIndex(belowVisible);
                    }}
                    className="clear-marks-pill-anchor"
                    title="Jump to the nearest marked row below the visible area"
                    aria-label="Jump to marked row below"
                  >
                    <ChevronDown size={12} />
                  </button>
                )}
              </div>
            );
          })()}
          {rowFlagsEnabled && (flaggedKeysList.length > 0 || visualizationContextKeys.length > 0) && (() => {
            const virtualItems = virtualizer.getVirtualItems();
            const scrollTop = parentRef.current?.scrollTop ?? 0;
            const viewportHeight = parentRef.current?.clientHeight ?? 0;
            const scrollBottom = scrollTop + viewportHeight;
            const firstVisibleVirtual =
              virtualItems.find(v => v.start >= scrollTop && (v.start + v.size) <= scrollBottom)
              ?? virtualItems.find(v => (v.start + v.size) > scrollTop)
              ?? virtualItems[0];
            const firstVisibleRowIndex = firstVisibleVirtual?.index ?? -1;
            const lastVisibleRowIndex = virtualItems.at(-1)?.index ?? firstVisibleRowIndex;
            const contextAnchorRowIndices = telegramRows.reduce<number[]>((acc, row, index) => {
              const key = anchorKey(row);
              if (flaggedSet.has(key) || contextKeys?.get(key) === 'visualization') acc.push(index);
              return acc;
            }, []);
            const aboveVisible = contextAnchorRowIndices.filter(index => index < firstVisibleRowIndex).at(-1);
            const belowVisible = contextAnchorRowIndices.find(index => index > lastVisibleRowIndex);
            return (
              <div className="clear-context-marks-pill" title="Context marks">
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    clearContextMarks();
                  }}
                  className="clear-marks-pill-clear"
                  title="Clear all context marks"
                  aria-label="Clear all context marks"
                >
                  <X size={13} />
                </button>
                <span>{flaggedKeysList.length + visualizationContextKeys.length} context mark{flaggedKeysList.length + visualizationContextKeys.length === 1 ? '' : 's'}</span>
                {aboveVisible !== undefined && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      gotoIndex(aboveVisible);
                    }}
                    className="clear-marks-pill-anchor"
                    title="Jump to the nearest context-marked row above the visible area"
                    aria-label="Jump to context-marked row above"
                  >
                    <ChevronUp size={12} />
                  </button>
                )}
                {belowVisible !== undefined && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      gotoIndex(belowVisible);
                    }}
                    className="clear-marks-pill-anchor"
                    title="Jump to the nearest context-marked row below the visible area"
                    aria-label="Jump to context-marked row below"
                  >
                    <ChevronDown size={12} />
                  </button>
                )}
              </div>
            );
          })()}
        </div>
      )}

      {/* Virtualized Body */}
      <div
        ref={parentRef}
        onScroll={handleScroll}
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            if (atEdgeRef.current) {
              pauseFollow();
              captureAnchor();
            }
          }
        }}
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
            {(() => {
              const virtualItems = virtualizer.getVirtualItems();
              const scrollTop = parentRef.current?.scrollTop ?? 0;
              const viewportHeight = parentRef.current?.clientHeight ?? 0;
              const scrollBottom = scrollTop + viewportHeight;
              const firstVisibleVirtual =
                virtualItems.find(v => v.start >= scrollTop && (v.start + v.size) <= scrollBottom)
                ?? virtualItems.find(v => (v.start + v.size) > scrollTop)
                ?? virtualItems[0];
              const firstVisibleRowIndex = firstVisibleVirtual?.index ?? -1;
              return virtualItems.map((virtualRow) => {
              const t = telegramRows[virtualRow.index];
              const key = anchorKey(t);
              const marked = markedSet.has(key);
              // The most-recently-clicked row is the most prominent (#310).
              const latest = marked && key === lastMarked;
              // Present only as context, not a real filter match — either a
              // Time-Delta-Context window (#343) or marked in any main panel
              // (#380). A stale 'delta' tag is superseded once the row is
              // independently marked, but a 'marked' reason IS the mark, so
              // its indicator is never suppressed by the mark itself.
              const contextReason = contextKeys?.get(key);
              const hasContext = !!contextReason;
              const isContext = hasContext && (contextReason === 'marked' || contextReason === 'visualization' || !marked);
              const isDeltaContextOnly = contextReason === 'delta' && !marked;
              const contextBarColor = hasContext
                ? (contextReason === 'delta'
                    ? 'color-mix(in srgb, var(--warning, #f59e0b) 30%, transparent)'
                    : contextReason === 'marked'
                      ? (latest
                        ? 'color-mix(in srgb, var(--accent-primary) 60%, transparent)'
                        : 'color-mix(in srgb, var(--accent-primary) 40%, transparent)')
                      : contextReason === 'visualization'
                        ? seriesColor(t.target_address)
                        : undefined)
                : undefined;
              const contextualBackgroundColor = isContext
                ? 'color-mix(in srgb, var(--warning, #f59e0b) 12%, transparent)'
                : undefined;
              const flagged = flaggedSet.has(key);
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  data-akey={key}
                  onMouseDown={(e) => {
                    if (e.button !== 0) return;
                    const target = e.target as HTMLElement;
                    const isInsideControl = target.closest('button, input, select, textarea, [role="button"], [data-row-control]');
                    if (isInsideControl) return;
                    if (!atEdgeRef.current) return;
                    pauseFollow();
                    captureAnchor();
                  }}
                  onClick={(e) => handleRowClick(e, key, virtualRow.index, isDeltaContextOnly)}
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
                    // stripe; the latest click is washed more strongly.
                    // Context-only rows always use the warning-hued wash so they
                    // read as contextual additions instead of ordinary matches.
                    // color-mix adapts to the theme's accent/warning colors.
                    background: isContext
                      ? contextualBackgroundColor
                      : latest
                        ? 'color-mix(in srgb, var(--accent-primary) 34%, transparent)'
                        : marked
                          ? 'color-mix(in srgb, var(--accent-primary) 16%, transparent)'
                          : (virtualRow.index + stripeOffset) % 2 === 0 ? 'var(--bg-subtle)' : 'transparent',
                    // A thin vertical bar tags context rows forced by marks.
                    boxShadow: contextBarColor ? `inset 3px 0 0 0 ${contextBarColor}` : undefined,
                    minHeight: '60px' // Ensure a minimum touch/visual target
                  }}
                  title={isContext
                    ? (contextReason === 'marked'
                        ? 'Marked message — shown despite not matching the active filters'
                        : contextReason === 'visualization'
                          ? 'Navigation target from the visualization'
                          : 'Unfiltered Time-Delta-Context — this telegram did not match the active filters')
                    : undefined}
                  className={`log-row${marked ? ' marked' : ''}${latest ? ' latest' : ''}${isContext ? ` context context-${contextReason}` : ''}`}
                >
                  {/* Left icon rail (#341): single row, vertically centered —
                      the message-context (Time-Delta-Context) flag toggle. */}
                  <div style={{ width: RAIL_WIDTH, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {showRowMessageContextControl && contextReason !== 'delta' && (
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
                        onClick={e => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleFlagClick(e, key);
                        }}
                      >
                        {flagged ? <CircleDot size={12} /> : <Circle size={12} />}
                      </button>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0, display: 'grid', gridTemplateColumns: gridTemplate, alignItems: 'start' }}>
                  {visibleCols.map(c => (
                    <React.Fragment key={c.id}>{renderCell(c.id, t, virtualRow.index, virtualRow.index === firstVisibleRowIndex)}</React.Fragment>
                  ))}
                  </div>
                </div>
              );
            });
            })()}
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

  .quick-last-seen-btn:hover {
    color: var(--accent-primary);
  }

  .clear-marks-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.3rem 0.7rem;
    border: 1px solid var(--border-color);
    border-radius: 999px;
    background: var(--bg-panel);
    color: var(--text-dim);
    font-size: 0.72rem;
    font-weight: 600;
    box-shadow: var(--shadow-lg);
    transition: color 0.15s, border-color 0.15s;
  }

  .clear-marks-pill:hover {
    color: var(--accent-primary);
    border-color: var(--accent-primary);
  }

  .clear-marks-pill-clear,
  .clear-marks-pill-anchor {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    color: inherit;
    cursor: pointer;
    padding: 0;
    margin: 0;
  }

  .clear-marks-pill-clear:hover,
  .clear-marks-pill-anchor:hover {
    color: var(--accent-primary);
  }

  .clear-context-marks-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.3rem 0.7rem;
    border: 1px solid var(--border-color);
    border-radius: 999px;
    background: var(--bg-panel);
    color: var(--text-dim);
    font-size: 0.72rem;
    font-weight: 600;
    box-shadow: var(--shadow-lg);
    transition: color 0.15s, border-color 0.15s;
  }

  .clear-context-marks-pill:hover {
    color: var(--warning, #f59e0b);
    border-color: var(--warning, #f59e0b);
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

  .header-col {
    cursor: grab;
  }

  .header-col.drag-source {
    opacity: 0.7;
    cursor: grabbing;
  }

  .header-col.drop-before::before,
  .header-col.drop-after::after {
    content: '';
    position: absolute;
    top: 8%;
    bottom: 8%;
    width: 2px;
    background: var(--accent-primary);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent-primary) 35%, transparent);
    pointer-events: none;
    z-index: 4;
  }

  .header-col.drop-before::before {
    left: 0;
  }

  .header-col.drop-after::after {
    right: 0;
  }
`;
document.head.appendChild(style);
