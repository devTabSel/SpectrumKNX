import type { QuickPatterns } from './quickFilter';
import {
  MARK_REASONS,
  type MarkReason,
  type MarkReasonsMap,
} from './markReasons';
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
  };
  listFollow: boolean;
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
  /** Live telegram list mark reasons (manual / hidden / mouse / …). */
  markReasons: MarkReasonsMap;
  /** Live telegram list mark colours (palette indices). */
  markColorIndices: MarkColorIndexMap;
  /** Per-message Time-Delta-Context flag buttons (#319). */
  flaggedKeys: string[];
  /** Every filter match anchors a context window when true. */
  contextForAllMatches: boolean;
}

export const DEFAULT_UI_STATE: UiSessionState = {
  quickFilter: {
    open: false,
    enabled: false,
    patterns: {},
  },
  listFollow: true,
  listAnchorKey: null,
  infoBarOpen: false,
  zoomRange: null,
  statsSearch: '',
  buildingSearch: '',
  lastSeenLimit: 20,
  lastSeenLive: true,
  lastSeenSearch: '',
  filtersEnabled: true,
  markReasons: {},
  markColorIndices: {},
  flaggedKeys: [],
  contextForAllMatches: true,
};

export const UI_STORAGE_KEY = 'spectrum-knx-ui';

interface StoredUiState extends UiSessionState {
  v: number;
}

const MARK_REASON_SET = new Set<string>(MARK_REASONS);

function sanitizeMarkReasons(raw: unknown): MarkReasonsMap {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: MarkReasonsMap = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof key !== 'string' || key.length === 0) continue;
    if (!Array.isArray(val)) continue;
    const reasons = val.filter((r): r is MarkReason => typeof r === 'string' && MARK_REASON_SET.has(r));
    // Drop ephemeral goto/auto; context is re-synced from the soft window on load.
    const durable = reasons.filter(r => r !== 'goto' && r !== 'context' && r !== 'auto');
    if (durable.length > 0) out[key] = durable;
  }
  return out;
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

  const zoom = Array.isArray(p.zoomRange) && p.zoomRange.length === 2 && typeof p.zoomRange[0] === 'number' && typeof p.zoomRange[1] === 'number'
    ? (p.zoomRange as [number, number])
    : null;

  return {
    quickFilter: {
      open: typeof q.open === 'boolean' ? q.open : false,
      enabled: typeof q.enabled === 'boolean' ? q.enabled : false,
      patterns,
    },
    listFollow: typeof p.listFollow === 'boolean' ? p.listFollow : true,
    listAnchorKey: typeof p.listAnchorKey === 'string' ? p.listAnchorKey : null,
    infoBarOpen: typeof p.infoBarOpen === 'boolean' ? p.infoBarOpen : false,
    zoomRange: zoom,
    statsSearch: typeof p.statsSearch === 'string' ? p.statsSearch : '',
    buildingSearch: typeof p.buildingSearch === 'string' ? p.buildingSearch : '',
    lastSeenLimit: typeof p.lastSeenLimit === 'number' ? p.lastSeenLimit : 20,
    lastSeenLive: typeof p.lastSeenLive === 'boolean' ? p.lastSeenLive : true,
    lastSeenSearch: typeof p.lastSeenSearch === 'string' ? p.lastSeenSearch : '',
    filtersEnabled: typeof p.filtersEnabled === 'boolean' ? p.filtersEnabled : true,
    markReasons: sanitizeMarkReasons(p.markReasons),
    markColorIndices: sanitizeMarkColorIndices(p.markColorIndices),
    flaggedKeys: sanitizeFlaggedKeys(p.flaggedKeys),
    contextForAllMatches: typeof p.contextForAllMatches === 'boolean' ? p.contextForAllMatches : true,
  };
}
