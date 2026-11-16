import type { QuickFilterColumnEnabled, QuickPatterns } from './quickFilter';
import { DEFAULT_QUICK_FILTER_COLUMN_ENABLED } from './quickFilter';
import { splitLegacyMarkReasons } from './markReasons';
import {
  isValidMarkColorIndex,
  type MarkColorIndexMap,
} from './markColors';

export interface UiSessionState {
  quickFilter: {
    open: boolean;
    enabled: boolean;
    /** Each column's two quick-filter rows (#309) — e.g. an address pattern
     * and a name regex, or a from/to range. */
    patterns: QuickPatterns;
    /** Per-column filter on/off. Absent keys default to on. */
    columnEnabled: QuickFilterColumnEnabled;
  };
  /** Display pin for the telegram list. Follow lives on the monitor view. */
  listAnchorKey: string | null;
  /** Quick info bar open/closed state above the telegram list header (#311). */
  infoBarOpen: boolean;
  zoomRange: [number, number] | null;
  statsSearch: string;
  buildingSearch: string;
  lastSeenLimit: number;
  lastSeenLive: boolean;
  lastSeenSearch: string;
  /** Master enable/disable of the filter set (#370); absent → enabled. */
  filtersEnabled: boolean;
  /** Rows with the marked flag. Mouse selection is a separate flag. */
  markedKeys: string[];
  /** Rows in the mouse selection. */
  mouseSelectedKeys: string[];
  /** Rows omitted from the telegram list until shown again. */
  hiddenKeys: string[];
  /** Live telegram list mark colours (palette indices). */
  markColorIndices: MarkColorIndexMap;
  /** Rows with the − (before) Time-Delta-Context flag on. */
  flaggedBeforeKeys: string[];
  /** Rows with the + (after) Time-Delta-Context flag on. */
  flaggedAfterKeys: string[];
}

export const DEFAULT_UI_STATE: UiSessionState = {
  quickFilter: {
    open: false,
    enabled: false,
    patterns: {},
    columnEnabled: { ...DEFAULT_QUICK_FILTER_COLUMN_ENABLED },
  },
  listAnchorKey: null,
  infoBarOpen: false,
  zoomRange: null,
  statsSearch: '',
  buildingSearch: '',
  lastSeenLimit: 20,
  lastSeenLive: true,
  lastSeenSearch: '',
  filtersEnabled: true,
  markedKeys: [],
  mouseSelectedKeys: [],
  hiddenKeys: [],
  markColorIndices: {},
  flaggedBeforeKeys: [],
  flaggedAfterKeys: [],
};

export const UI_STORAGE_KEY = 'spectrum-knx-ui';

interface StoredUiState extends UiSessionState {
  v: number;
  /** Sessions from before row flags stored a reason map. */
  markReasons?: unknown;
  /**
   * Pre-step-0b single anchor list. Copied onto both sides when the
   * per-side lists are absent. Individual windows and all-mode are dropped.
   */
  flaggedKeys?: unknown;
}

function sanitizeMarkColorIndices(raw: unknown): MarkColorIndexMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: MarkColorIndexMap = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof key !== 'string' || key.length === 0) continue;
    if (isValidMarkColorIndex(val)) out[key] = val;
  }
  return out;
}

function sanitizeFlaggedKeys(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const k of raw) {
    if (typeof k !== 'string' || k.length === 0 || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

export function saveUiState(state: UiSessionState): void {
  try {
    const stored: StoredUiState = { v: 1, ...state };
    localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Storage unavailable - fallback to in-memory state in App.tsx
  }
}

export function loadUiState(): UiSessionState | null {
  try {
    const raw = localStorage.getItem(UI_STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<StoredUiState>;
    if (p.v !== 1) return null;
    return sanitize(p);
  } catch {
    return null;
  }
}

function sanitize(p: Partial<StoredUiState>): UiSessionState {
  const q = (p.quickFilter ?? {}) as Partial<UiSessionState['quickFilter']>;
  const isCell = (v: unknown): v is { top: string; bottom: string } =>
    !!v && typeof v === 'object' && typeof (v as { top?: unknown }).top === 'string' && typeof (v as { bottom?: unknown }).bottom === 'string';
  const patterns: Record<string, { top: string; bottom: string }> = {};
  if (q.patterns && typeof q.patterns === 'object' && !Array.isArray(q.patterns)) {
    // Cells from the pre-#309 single-string shape are dropped (low-stakes UI
    // preference) rather than guessed into top/bottom.
    for (const [key, val] of Object.entries(q.patterns)) {
      if (isCell(val)) patterns[key] = val;
    }
  }

  const columnEnabled: QuickFilterColumnEnabled = { ...DEFAULT_QUICK_FILTER_COLUMN_ENABLED };
  if (q.columnEnabled && typeof q.columnEnabled === 'object' && !Array.isArray(q.columnEnabled)) {
    for (const [key, val] of Object.entries(q.columnEnabled as Record<string, unknown>)) {
      if (typeof key !== 'string' || key.length === 0) continue;
      if (typeof val === 'boolean') columnEnabled[key] = val;
    }
  }

  const zoom = Array.isArray(p.zoomRange) && p.zoomRange.length === 2 && typeof p.zoomRange[0] === 'number' && typeof p.zoomRange[1] === 'number'
    ? (p.zoomRange as [number, number])
    : null;
  const legacy = splitLegacyMarkReasons(p.markReasons);

  return {
    quickFilter: {
      open: typeof q.open === 'boolean' ? q.open : false,
      enabled: typeof q.enabled === 'boolean' ? q.enabled : false,
      patterns,
      columnEnabled,
    },
    listAnchorKey: typeof p.listAnchorKey === 'string' ? p.listAnchorKey : null,
    infoBarOpen: typeof p.infoBarOpen === 'boolean' ? p.infoBarOpen : false,
    zoomRange: zoom,
    statsSearch: typeof p.statsSearch === 'string' ? p.statsSearch : '',
    buildingSearch: typeof p.buildingSearch === 'string' ? p.buildingSearch : '',
    lastSeenLimit: typeof p.lastSeenLimit === 'number' ? p.lastSeenLimit : 20,
    lastSeenLive: typeof p.lastSeenLive === 'boolean' ? p.lastSeenLive : true,
    lastSeenSearch: typeof p.lastSeenSearch === 'string' ? p.lastSeenSearch : '',
    filtersEnabled: typeof p.filtersEnabled === 'boolean' ? p.filtersEnabled : true,
    markedKeys: sanitizeFlaggedKeys([...legacy.markedKeys, ...sanitizeFlaggedKeys(p.markedKeys)]),
    mouseSelectedKeys: sanitizeFlaggedKeys([...legacy.mouseSelectedKeys, ...sanitizeFlaggedKeys(p.mouseSelectedKeys)]),
    hiddenKeys: sanitizeFlaggedKeys([...legacy.hiddenKeys, ...sanitizeFlaggedKeys(p.hiddenKeys)]),
    markColorIndices: sanitizeMarkColorIndices(p.markColorIndices),
    ...readContextSideKeys(p),
  };
}

/** New per-side lists win. An older single flag list applies to both sides. */
function readContextSideKeys(p: Partial<StoredUiState>): Pick<UiSessionState, 'flaggedBeforeKeys' | 'flaggedAfterKeys'> {
  const hasNew = Array.isArray(p.flaggedBeforeKeys) || Array.isArray(p.flaggedAfterKeys);
  if (hasNew) {
    return {
      flaggedBeforeKeys: sanitizeFlaggedKeys(p.flaggedBeforeKeys),
      flaggedAfterKeys: sanitizeFlaggedKeys(p.flaggedAfterKeys),
    };
  }
  const legacy = sanitizeFlaggedKeys(p.flaggedKeys);
  return { flaggedBeforeKeys: legacy, flaggedAfterKeys: legacy };
}
