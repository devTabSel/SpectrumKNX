import { DEFAULT_QUICK_FILTER_COLUMN_ENABLED, type QuickFilterColumnEnabled, type QuickPatterns } from './quickFilter';

export interface UiSessionState {
  quickFilter: {
    open: boolean;
    enabled: boolean;
    /** Each column's two quick-filter rows (#309) — e.g. an address pattern
     * and a name regex, or a from/to range. */
    patterns: QuickPatterns;
    /** Header-row switch per column. Absent → every column on. */
    columns: QuickFilterColumnEnabled;
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
  /** Filter-panel option search; absent → empty. */
  filterSearch: string;
  /** Filter-panel "Verdichten": hide entries whose telegram count is 0. */
  filterCompact: boolean;
  /** Filter-panel "Compact": show only checked entries. */
  filterCheckedOnly: boolean;
  /** Filter-panel header: the Filter side or the Focus side. Absent → Filter. */
  panelView: 'filter' | 'focus';
  /** Focus list tab. Absent → group addresses. */
  focusTab: 'ga' | 'pa';
  /** Group addresses pinned to the top of Focus. */
  focusGas: string[];
  /** Devices pinned to the top of Focus. */
  focusDevices: string[];
  /** Search field of the Focus group-address list. */
  focusGaSearch: string;
  /** Search field of the Focus device list. */
  focusDeviceSearch: string;
  /** Focus group-address list "Compact": only focused entries. */
  focusGaCompact: boolean;
  /** Focus device list "Compact": only focused entries. */
  focusDeviceCompact: boolean;
  /** Focus group-address list "Verdichten": only entries with telegrams in the buffer. */
  focusGaVerdichten: boolean;
  /** Focus device list "Verdichten": only entries with telegrams in the buffer. */
  focusDeviceVerdichten: boolean;
  /** Group addresses whose Focus "last seen values" toggle is on. */
  lastSeenGas: string[];
  /** Devices whose Focus "last seen values" toggle is on. */
  lastSeenDevices: string[];
  /** Last Seen table grouping. `both` is a device group with a group-address level. Absent → one flat list. */
  lastSeenGroup: 'none' | 'ga' | 'pa' | 'both';
  /** Last Seen groups the user opened. Keys are `ga:address`, `pa:address`, or `pa:device|ga:address`. Absent → all collapsed. */
  lastSeenExpanded: string[];
}

export const DEFAULT_UI_STATE: UiSessionState = {
  quickFilter: {
    open: false,
    enabled: false,
    patterns: {},
    columns: { ...DEFAULT_QUICK_FILTER_COLUMN_ENABLED },
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
  filterSearch: '',
  filterCompact: false,
  filterCheckedOnly: false,
  panelView: 'filter',
  focusTab: 'ga',
  focusGas: [],
  focusDevices: [],
  focusGaSearch: '',
  focusDeviceSearch: '',
  focusGaCompact: false,
  focusDeviceCompact: false,
  focusGaVerdichten: false,
  focusDeviceVerdichten: false,
  lastSeenGas: [],
  lastSeenDevices: [],
  lastSeenGroup: 'none',
  lastSeenExpanded: [],
};

export const UI_STORAGE_KEY = 'spectrum-knx-ui';

interface StoredUiState extends UiSessionState {
  v: number;
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

function columnFlags(value: unknown): QuickFilterColumnEnabled {
  const out: QuickFilterColumnEnabled = { ...DEFAULT_QUICK_FILTER_COLUMN_ENABLED };
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out;
  const record = value as Record<string, unknown>;
  for (const id of Object.keys(out) as (keyof QuickFilterColumnEnabled)[]) {
    if (typeof record[id] === 'boolean') out[id] = record[id];
  }
  return out;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
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
      columns: columnFlags(q.columns),
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
    filterSearch: typeof p.filterSearch === 'string' ? p.filterSearch : '',
    filterCompact: typeof p.filterCompact === 'boolean' ? p.filterCompact : false,
    filterCheckedOnly: typeof p.filterCheckedOnly === 'boolean' ? p.filterCheckedOnly : false,
    panelView: p.panelView === 'focus' ? 'focus' : 'filter',
    focusTab: p.focusTab === 'pa' ? 'pa' : 'ga',
    focusGas: stringList(p.focusGas),
    focusDevices: stringList(p.focusDevices),
    focusGaSearch: typeof p.focusGaSearch === 'string' ? p.focusGaSearch : '',
    focusDeviceSearch: typeof p.focusDeviceSearch === 'string' ? p.focusDeviceSearch : '',
    focusGaCompact: typeof p.focusGaCompact === 'boolean' ? p.focusGaCompact : false,
    focusDeviceCompact: typeof p.focusDeviceCompact === 'boolean' ? p.focusDeviceCompact : false,
    focusGaVerdichten: typeof p.focusGaVerdichten === 'boolean' ? p.focusGaVerdichten : false,
    focusDeviceVerdichten: typeof p.focusDeviceVerdichten === 'boolean' ? p.focusDeviceVerdichten : false,
    lastSeenGas: stringList(p.lastSeenGas),
    lastSeenDevices: stringList(p.lastSeenDevices),
    lastSeenGroup: p.lastSeenGroup === 'ga' || p.lastSeenGroup === 'pa' || p.lastSeenGroup === 'both' ? p.lastSeenGroup : 'none',
    lastSeenExpanded: stringList(p.lastSeenExpanded),
  };
}
