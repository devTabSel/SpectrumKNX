import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useWebSocket, type Telegram, type ConnectionStateEvent } from './hooks/useWebSocket';
import { parseViewUrl } from './utils/viewUrl';
import {
  isEmbedded,
  loadWorkspace,
  saveWorkspace,
  parseMonitorSearch,
  applyWorkspaceUrl,
  buildMonitorSearch,
  sameWorkspaceApartFromLayout,
  workspaceFromSearch,
  DEFAULT_WORKSPACE,
  type WorkspaceState,
  type WorkspaceView,
} from './utils/workspaceState';
import {
  loadUiState,
  saveUiState,
  DEFAULT_UI_STATE,
} from './utils/uiState';
import { DeviceStatusOverlay } from './components/DeviceStatusOverlay';
import { TelegramTable, type SortConfig, type SortKey } from './components/TelegramTable';
import { AddressActionProvider } from './components/telegramCell';
import { expandWithDeltaContext, retainKeptRows } from './utils/deltaContextExpansion';
import { activeQuickFilter } from './utils/quickFilter';
import { anchorKey } from './utils/anchorKey';
import { applyToggle, PLAIN_TOGGLE, toggleGesture, toggleTurnOn, type ToggleGesture } from './utils/toggleClick';
import { setSendPanelOpen, toggleSendPanel, useSendPanelOpen } from './utils/sendPanel';
import { readSortConfigPref, writeSortConfigPref, toggleSortLevel, sortTelegrams } from './utils/sortConfig';
import { LayoutDashboard, History, Settings, Play, Pause, Download, Trash2, SlidersHorizontal, LineChart, BarChart2, Building2, Database, ChevronDown, AlertTriangle, Sun, Moon, Monitor, FolderInput, Send, Sparkles, Clock, List } from 'lucide-react';
import { getPref, setPref } from './utils/prefs';
import { getLabel, getFileName } from './utils/labels';
import { useTheme } from './hooks/useTheme';
import { apiUrl, wsUrl } from './utils/basePath';
import { HistoryLoader } from './components/HistoryLoader';
import { useTelegramCache } from './hooks/useTelegramCache';
import { useDbTelegramCounts } from './hooks/useDbTelegramCounts';
import { rangeToMs } from './utils/historyLoad';
import { HistorySearch } from './components/HistorySearch';
import { ImportExportView } from './components/ImportExportView';
import { Visualizer } from './components/Visualizer';
import { FilterPanel } from './components/FilterPanel';
import { ResizablePane } from './components/ResizablePane';
import { ProjectUploadWizard } from './components/ProjectUploadWizard';
import { KeysUploadWizard } from './components/KeysUploadWizard';
import { LastSeenOverlay } from './components/LastSeenOverlay';
import { StatisticsOverlay } from './components/StatisticsOverlay';
import { BuildingOverlay, type DeviceNode } from './components/BuildingOverlay';
import { DatabaseOverlay } from './components/DatabaseOverlay';
import { WriteToBusPanel } from './components/WriteToBusPanel';
import { UpdateNotification } from './components/UpdateNotification';
import { LegacyTimestampBanner } from './components/LegacyTimestampBanner';
import { LoginScreen } from './components/LoginScreen';
import { AuthSettings } from './components/AuthSettings';
import { useAuthStatus, loginRequired } from './hooks/useAuthStatus';
import { useUpdateCheck } from './hooks/useUpdateCheck';
import {
  DEFAULT_FILTERS,
  countAppliedFilterOptions,
  countFilterOptions,
  effectiveDeltaContext,
  hasActiveFilters,
  enabledFilters,
  pruneDisabled,
  countSelections,
  matchesTelegram,
  focusAddressesForList,
  passesFocusAddressFilter,
  type ActiveFilters,
  type FilterOptions,
} from './types/filters';

declare const __APP_VERSION__: string;

// Remembers the latest version the user already dismissed, so the popup shows
// once per new release rather than on every load.
const DISMISSED_UPDATE_PREF = 'dismissed_update_version';

const EMPTY_FILTER_OPTIONS: FilterOptions = { sources: [], targets: [], types: [], dpts: [], ga_group_names: {}, pa_line_names: {} };

const NavDropdown = ({ activeTab, isSettingsOpen, isDatabaseOpen, onChange }: { activeTab: string, isSettingsOpen: boolean, isDatabaseOpen: boolean, onChange: (id: string) => void }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const items = [
    { id: 'live', label: 'Group Monitor', icon: LayoutDashboard },
    { id: 'history', label: 'History Search', icon: History },
    { id: 'import', label: 'Import / Export', icon: FolderInput },
    { id: 'database', label: 'Database Maintenance', icon: Database },
    { id: 'settings', label: 'Settings', icon: Settings }
  ];

  const currentSelection = isDatabaseOpen ? 'database' : isSettingsOpen ? 'settings' : activeTab;
  const activeItem = items.find(i => i.id === currentSelection) || items[0];
  const ActiveIcon = activeItem.icon;

  return (
    <div ref={dropdownRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="glass-input"
        style={{
          display: 'flex', alignItems: 'center', gap: '0.75rem',
          fontSize: '0.95rem', fontWeight: 600, padding: '0.5rem 1rem',
          borderRadius: '8px', border: '1px solid var(--border-color)',
          background: isOpen ? 'var(--bg-hover)' : 'var(--bg-tag)',
          color: 'var(--text-main)', cursor: 'pointer', outline: 'none',
          minWidth: '220px', justifyContent: 'space-between',
          transition: 'all 0.2s ease'
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <ActiveIcon size={18} className="accent-primary" />
          {activeItem.label}
        </span>
        <ChevronDown size={18} style={{ color: 'var(--text-dim)', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
      </button>

      {isOpen && (
        <div
          className="glass"
          style={{
            position: 'absolute', top: '100%', left: 0, marginTop: '0.5rem',
            width: '100%', borderRadius: '8px',
            border: '1px solid var(--border-color)',
            padding: '0.5rem', zIndex: 100,
            display: 'flex', flexDirection: 'column', gap: '0.25rem',
            boxShadow: 'var(--shadow-lg)'
          }}
        >
          {items.map(item => {
            const Icon = item.icon;
            const isActive = item.id === currentSelection;
            return (
              <button
                key={item.id}
                onClick={() => {
                  onChange(item.id);
                  setIsOpen(false);
                }}
                className={`nav-item ${isActive ? 'active' : ''}`}
                style={{
                   display: 'flex', alignItems: 'center', gap: '0.75rem',
                   padding: '0.75rem 1rem', borderRadius: '6px', border: 'none',
                   background: isActive ? 'rgba(99,102,241,0.1)' : 'transparent',
                   color: isActive ? 'var(--accent-primary)' : 'var(--text-main)',
                   cursor: 'pointer', fontWeight: 500, width: '100%', textAlign: 'left',
                   transition: 'all 0.2s ease', fontSize: '0.9rem'
                }}
              >
                <Icon size={18} />
                {item.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  );
};

// The five main panels inside Group Monitor (#374). One switch selects exactly
// one; 'list' is the default every panel's close (X) returns to.
type MainPanel = 'list' | 'visualizer' | 'statistics' | 'building' | 'lastseen';

const MAIN_PANELS: { id: MainPanel; label: string; icon: typeof List }[] = [
  { id: 'list', label: 'Telegram List', icon: List },
  { id: 'visualizer', label: 'Visualization', icon: LineChart },
  { id: 'lastseen', label: 'Last Seen Values', icon: Clock },
  { id: 'statistics', label: 'Statistics', icon: BarChart2 },
  { id: 'building', label: 'Building Structure', icon: Building2 },
];

/** Views that share the telegram-list header. */
const VIEW_PANELS: readonly MainPanel[] = ['list', 'visualizer', 'lastseen'];
/** The panels that stay in the global header. */
const OTHER_PANELS: readonly MainPanel[] = ['statistics', 'building'];

// Segmented switch across a subset of the main panels, marking the active one (#374).
const PanelSwitch = ({ active, onChange, panels, compact = false }: {
  active: MainPanel;
  onChange: (p: MainPanel) => void;
  panels: readonly MainPanel[];
  /** Fits the 40px list header. */
  compact?: boolean;
}) => (
  <div
    role="tablist"
    aria-label={compact ? 'List views' : 'Main panel'}
    style={{
      display: 'flex', alignItems: 'center', gap: '0.15rem',
      padding: compact ? '0.1rem' : '0.2rem', borderRadius: '8px',
      background: 'var(--bg-subtle)', border: '1px solid var(--border-color)',
    }}
  >
    {MAIN_PANELS.filter(panel => panels.includes(panel.id)).map(({ id, label, icon: Icon }) => {
      const isActive = id === active;
      return (
        <button
          key={id}
          role="tab"
          aria-selected={isActive}
          onClick={() => onChange(id)}
          title={label}
          className="icon-button"
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: compact ? '0.28rem' : '0.4rem', borderRadius: '6px',
            background: isActive ? 'rgba(99,102,241,0.15)' : 'transparent',
            color: isActive ? 'var(--accent-primary)' : 'var(--text-dim)',
          }}
        >
          <Icon size={18} />
        </button>
      );
    })}
  </div>
);

// Stable identity so passing "no flags" doesn't churn memo deps (#319).
const EMPTY_KEY_SET: ReadonlySet<string> = new Set();

/**
 * Settings-screen timestamp: locale date + time. ETS records its own
 * last-modified string, which is not always parseable — show it verbatim
 * rather than "Invalid Date" (#425).
 */
const formatSettingsDate = (value?: string | null): string | null => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
};

function App() {
  const [theme, setTheme] = useTheme();
  // A view shared via URL (#150) starts on the History tab with its filters applied.
  const [initialView] = useState(() => parseViewUrl(window.location.search));
  // Workspace restore (#211): a shared viz link wins; otherwise the HA
  // dashboard iframe restores from localStorage and a regular tab from the
  // view=monitor URL it maintains below.
  const [initialWorkspace] = useState(() =>
    initialView ? null : isEmbedded() ? loadWorkspace() : parseMonitorSearch(window.location.search),
  );
  const [initialUiState] = useState(() => loadUiState() ?? DEFAULT_UI_STATE);
  const [quickFilterOpen, setQuickFilterOpen] = useState(initialUiState.quickFilter.open);
  const [quickFilterEnabled, setQuickFilterEnabled] = useState(initialUiState.quickFilter.enabled);
  const [quickPatterns, setQuickPatterns] = useState(initialUiState.quickFilter.patterns);
  const [quickFilterColumns, setQuickFilterColumns] = useState(initialUiState.quickFilter.columns);
  const [listFollow, setListFollow] = useState(initialUiState.listFollow);
  const [listAnchorKey, setListAnchorKey] = useState<string | null>(initialUiState.listAnchorKey);
  // One-shot placement for a jump from Last Seen. A later scroll goes back to pinning the top.
  const [listAnchorAlign, setListAnchorAlign] = useState<'start' | 'center'>('start');
  const listAnchorKeyRef = useRef(listAnchorKey);
  listAnchorKeyRef.current = listAnchorKey;
  const [infoBarOpen, setInfoBarOpen] = useState(initialUiState.infoBarOpen);
  const [zoomRange, setZoomRange] = useState<[number, number] | null>(initialUiState.zoomRange);
  const [statsSearch, setStatsSearch] = useState(initialUiState.statsSearch);
  const [buildingSearch, setBuildingSearch] = useState(initialUiState.buildingSearch);
  const [lastSeenLimit, setLastSeenLimit] = useState(initialUiState.lastSeenLimit);
  const [lastSeenLive, setLastSeenLive] = useState(initialUiState.lastSeenLive);
  const [lastSeenSearch] = useState(initialUiState.lastSeenSearch);
  const [lastSeenGas, setLastSeenGas] = useState(initialUiState.lastSeenGas);
  const [lastSeenDevices, setLastSeenDevices] = useState(initialUiState.lastSeenDevices);
  const [focusFilterGas, setFocusFilterGas] = useState<string[]>([]);
  const [focusFilterDevices, setFocusFilterDevices] = useState<string[]>([]);
  const [filterFocusedSources, setFilterFocusedSources] = useState(false);
  const [filterFocusedTargets, setFilterFocusedTargets] = useState(false);
  const [lastSeenGroup, setLastSeenGroup] = useState(initialUiState.lastSeenGroup);
  const [lastSeenExpanded, setLastSeenExpanded] = useState(initialUiState.lastSeenExpanded);
  // Last Seen renders its title and settings into the shared view header.
  // A callback ref, so the portal follows this node when the header is recreated.
  const [viewHeaderSlot, setViewHeaderSlot] = useState<HTMLDivElement | null>(null);
  const assignViewHeaderSlot = useCallback((node: HTMLDivElement | null) => {
    setViewHeaderSlot(prev => (prev === node ? prev : node));
  }, []);
  // Master enable/disable of the filter set (#370): when off the list shows all
  // telegrams while activeFilters is preserved.
  const [filtersEnabled, setFiltersEnabled] = useState(initialUiState.filtersEnabled);
  const [filterSearch, setFilterSearch] = useState(initialUiState.filterSearch);
  const [filterCompact, setFilterCompact] = useState(initialUiState.filterCompact);
  const [filterCheckedOnly, setFilterCheckedOnly] = useState(initialUiState.filterCheckedOnly);
  const [panelView, setPanelView] = useState(initialUiState.panelView);
  const [focusTab, setFocusTab] = useState(initialUiState.focusTab);
  const [focusGas, setFocusGas] = useState(() => {
    const seen = (initialWorkspace?.lastSeenMode ?? 'ga') !== 'pa' ? (initialWorkspace?.lastSeenAddresses ?? []) : [];
    return [...new Set([...initialUiState.focusGas, ...seen])];
  });
  const [focusDevices, setFocusDevices] = useState(() => {
    const seen = initialWorkspace?.lastSeenMode === 'pa' ? initialWorkspace.lastSeenAddresses : [];
    return [...new Set([...initialUiState.focusDevices, ...seen])];
  });
  const [focusGaSearch, setFocusGaSearch] = useState(initialUiState.focusGaSearch);
  const [focusDeviceSearch, setFocusDeviceSearch] = useState(initialUiState.focusDeviceSearch);
  const [focusGaCompact, setFocusGaCompact] = useState(initialUiState.focusGaCompact);
  const [focusDeviceCompact, setFocusDeviceCompact] = useState(initialUiState.focusDeviceCompact);
  const [focusGaVerdichten, setFocusGaVerdichten] = useState(initialUiState.focusGaVerdichten);
  const [focusDeviceVerdichten, setFocusDeviceVerdichten] = useState(initialUiState.focusDeviceVerdichten);
  const [activeTab, setActiveTab] = useState<'live' | 'history' | 'import'>(
    initialView ? 'history' : initialWorkspace?.tab ?? 'live',
  );
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isFilterOpen, setIsFilterOpen] = useState(initialWorkspace?.filterOpen ?? true);
  // The active main panel within Group Monitor (#374). Replaces the former
  // isVisualizerOpen/isLastSeenOpen/isStatisticsOpen/isBuildingOpen booleans with
  // one selector so exactly one panel is active and every close returns to 'list'.
  const [activePanel, setActivePanel] = useState<MainPanel>(
    initialWorkspace?.view && initialWorkspace.view !== 'none' && initialWorkspace.view !== 'database'
      ? (initialWorkspace.view as MainPanel)
      : 'list',
  );
  const isVisualizerOpen = activePanel === 'visualizer';
  const isLastSeenOpen = activePanel === 'lastseen';
  const isStatisticsOpen = activePanel === 'statistics';
  const isBuildingOpen = activePanel === 'building';
  const [lastSeenAddresses, setLastSeenAddresses] = useState<string[]>(initialWorkspace?.lastSeenAddresses ?? []);
  const [lastSeenMode, setLastSeenMode] = useState<'ga' | 'pa'>(initialWorkspace?.lastSeenMode ?? 'ga');
  const [statusDevice, setStatusDevice] = useState<DeviceNode | null>(null);
  const [latestTelegram, setLatestTelegram] = useState<Telegram | null>(null);
  const [isDatabaseOpen, setIsDatabaseOpen] = useState(initialWorkspace?.view === 'database');
  const isSendOpen = useSendPanelOpen();
  const [backendVersion, setBackendVersion] = useState<string>('loading...');
  const [projectStatus, setProjectStatus] = useState<{
    upload_feature_active: boolean;
    upload_writable: boolean;
    project_loaded: boolean;
    upload_required: boolean;
  } | null>(null);
  const [isUploadWizardOpen, setIsUploadWizardOpen] = useState(false);
  const [isKeysWizardOpen, setIsKeysWizardOpen] = useState(false);
  const [knxkeysStatus, setKnxkeysStatus] = useState<{ upload_feature_active: boolean; knxkeys_found: boolean } | null>(null);
  const { status: authStatus, reload: reloadAuth } = useAuthStatus();
  const updateInfo = useUpdateCheck();
  const [isUpdateOpen, setIsUpdateOpen] = useState(false);
  const [updateClosed, setUpdateClosed] = useState(false);
  // Version the user has already been shown, read once at mount. Kept in state
  // (not re-read) so persisting "seen" below doesn't retract the popup mid-view.
  const [seenUpdateVersion] = useState(() => getPref(DISMISSED_UPDATE_PREF));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [serverConfig, setServerConfig] = useState<any>(null);

  // ── Settings & Persistence ──────────────────────────────────────────────────
  const [loadLimit, setLoadLimit] = useState(Number(getPref('loadLimit') || 100000));
  const [visibleColumns, setVisibleColumns] = useState<{ [key: string]: boolean }>(() => {
    try {
      const cookie = getPref('visibleColumns');
      if (cookie) return JSON.parse(cookie);
    } catch {
      // Ignore cookie parsing errors
    }
    return {
      time: true, delta: true, source: true, sourceName: true,
      target: true, targetName: true, type: true, dpt: true, data: true, value: true,
    };
  });
  const [rateMode, setRateMode] = useState<'s' | 'm' | 'h'>((getPref('rateMode') as 's' | 'm' | 'h') || 's');
  // Restore the browser telegram cache (and fill the gap from the backend) on
  // startup. On by default; when off the view starts empty and shows only live
  // telegrams and manual history loads (#246).
  const [restoreOnStartup, setRestoreOnStartup] = useState(() => getPref('restoreOnStartup') !== 'false');

  const [isHistoryLoaderOpen, setIsHistoryLoaderOpen] = useState(false);
  const [selectedVisualizationTargets, setSelectedVisualizationTargets] = useState<string[]>(
    initialView?.plot ?? initialWorkspace?.plot ?? [],
  );
  const [visualizedDevices, setVisualizedDevices] = useState<string[]>([]);

  const [isPaused, setIsPaused] = useState(false);

  // ── Rate Estimation ─────────────────────────────────────────────────────────
  const [busRate, setBusRate] = useState(0);
  const arrivalTimesRef = useRef<number[]>([]);

  // ── Filter State ────────────────────────────────────────────────────────────
  const [filterOptions, setFilterOptions] = useState<FilterOptions>(EMPTY_FILTER_OPTIONS);
  const [activeFilters, setActiveFilters] = useState<ActiveFilters>(
    initialView?.filters ?? initialWorkspace?.filters ?? DEFAULT_FILTERS,
  );

  // The Visualization is independent of the main filter (#361): editing the
  // filter changes only the telegram list, never the plotted target selection.
  const handleFiltersChange = useCallback((newFilters: ActiveFilters | ((prev: ActiveFilters) => ActiveFilters)) => {
    // Every change passes through here, so a removed entry also loses its
    // switched-off marker (#437) and cannot come back switched off later.
    setActiveFilters(prev => pruneDisabled(typeof newFilters === 'function' ? newFilters(prev) : newFilters));
  }, []);
  // The filters in effect: selections minus the ones switched off (#437).
  const appliedFilters = useMemo(() => enabledFilters(activeFilters), [activeFilters]);
  // Null while the master switch is off or nothing is selected: the buffer stays unfiltered.
  const cacheFilter = filtersEnabled && hasActiveFilters(appliedFilters) ? appliedFilters : null;
  const [visibleSpan, setVisibleSpan] = useState<{ startMs: number; endMs: number } | null>(null);
  const onVisibleSpanChange = useCallback((span: { startMs: number; endMs: number } | null) => {
    setVisibleSpan(prev => {
      if (prev === span) return prev;
      if (prev && span && prev.startMs === span.startMs && prev.endMs === span.endMs) return prev;
      return span;
    });
  }, []);

  // ── Live State ──────────────────────────────────────────────────────────────
  // Buffer + IndexedDB cache + coverage bookkeeping (#246): cached telegrams
  // reappear instantly after a reload and only the gaps are fetched (#211).
  // The buffer holds only telegrams that pass the filter panel.
  const {
    telegrams: liveTelegrams,
    addLive,
    setConnected: setCacheConnected,
    setPaused: setCachePaused,
    pausedCount,
    loadRange,
    isLoading: isHistoryLoading,
    loadError: historyLoadError,
    clear: clearTelegrams,
  } = useTelegramCache(loadLimit, restoreOnStartup, cacheFilter, visibleSpan);

  const refreshServerConfig = useCallback(() => {
    fetch(apiUrl('/api/server/config'))
      .then(r => r.json())
      .then(data => setServerConfig(data))
      .catch(err => console.error("Failed to load server config", err));
  }, []);

  // Load filter options from backend on mount
  useEffect(() => {
    fetch(apiUrl('/api/filter-options'))
      .then(r => r.json())
      .then(data => setFilterOptions({
        sources: data.sources || [],
        targets: data.targets || [],
        types: data.types || ['Write', 'Read', 'Response'],
        dpts: data.dpts || [],
        ga_group_names: data.ga_group_names || {},
        pa_line_names: data.pa_line_names || {},
      }))
      .catch(() => {
        // Fallback: populate only the static types
        setFilterOptions(prev => ({ ...prev, types: ['Write', 'Read', 'Response'] }));
      });

    // Load backend version
    fetch(apiUrl('/api/version'))
      .then(r => r.json())
      .then(data => setBackendVersion(data.version || 'unknown'))
      .catch(() => setBackendVersion('error'));

    // Load project status
    fetch(apiUrl('/api/project/status'))
      .then(r => r.json())
      .then(data => {
        setProjectStatus(data);
        if (data.upload_required) {
          setIsUploadWizardOpen(true);
        }
      })
      .catch(err => console.error("Failed to check project status", err));

    // Load knxkeys status
    fetch(apiUrl('/api/knxkeys/status'))
      .then(r => r.json())
      .then(data => setKnxkeysStatus(data))
      .catch(err => console.error("Failed to check knxkeys status", err));

    // Load server config
    refreshServerConfig();
  }, [refreshServerConfig]);

  // A new release the user hasn't been shown yet (seenUpdateVersion is frozen
  // at mount, so it stays true for the session once detected). Auto-shows once;
  // updateClosed hides it after the user dismisses it, the chip can reopen it.
  const hasNewUpdate =
    !!updateInfo?.update_available && !!updateInfo.latest && updateInfo.latest !== seenUpdateVersion;
  const showUpdate = isUpdateOpen || (hasNewUpdate && !updateClosed);

  // Persist "seen" as soon as a new release is detected, so the popup appears
  // only once across reloads even if the user navigates away without closing it.
  useEffect(() => {
    if (hasNewUpdate && updateInfo?.latest) {
      setPref(DISMISSED_UPDATE_PREF, updateInfo.latest);
    }
  }, [hasNewUpdate, updateInfo?.latest]);

  // ── WebSocket ───────────────────────────────────────────────────────────────
  const handleTelegram = useCallback((t: Telegram) => {
    // Track the newest telegram even while paused — the device status view (#153)
    // stays live independently of the table.
    setLatestTelegram(t);
    const now = Date.now();
    arrivalTimesRef.current.push(now);
    const oneHourAgo = now - 3_600_000;
    while (arrivalTimesRef.current.length > 0 && arrivalTimesRef.current[0] < oneHourAgo) {
      arrivalTimesRef.current.shift();
    }

    // The cache keeps ingesting while paused; only the snapshot is frozen, so
    // nothing is lost and resume simply reveals what arrived in between.
    addLive(t);
  }, [addLive]);

  const handleConnectionState = useCallback((e: ConnectionStateEvent) => {
    // Flip the badge immediately, then refetch for authoritative state
    // (write_enabled depends on the connection and is recomputed server-side).
    setServerConfig((prev: { status?: { connected?: boolean; write_enabled?: boolean } } | null) => prev
      ? {
          ...prev,
          status: {
            ...prev.status,
            connected: e.connected,
            write_enabled: prev.status?.write_enabled && e.connected,
          },
        }
      : prev);
    refreshServerConfig();
  }, [refreshServerConfig]);

  // Companion mode: Home Assistant's store still holds pre-UTC timestamps
  // (#462). Only Home Assistant can convert it, so keep asking until it has.
  const legacyTimestamps = serverConfig?.status?.legacy_timestamps === true;
  useEffect(() => {
    if (!legacyTimestamps) return;
    const id = window.setInterval(refreshServerConfig, 60_000);
    return () => window.clearInterval(id);
  }, [legacyTimestamps, refreshServerConfig]);

  const wsEndpoint = wsUrl('/ws/telegrams');
  const { isConnected } = useWebSocket(wsEndpoint, handleTelegram, handleConnectionState);

  // Mirror the WS state into the cache so offline windows become coverage
  // gaps that are automatically re-fetched on reconnect.
  useEffect(() => {
    setCacheConnected(isConnected);
  }, [isConnected, setCacheConnected]);

  // ── Persist settings ────────────────────────────────────────────────────────
  useEffect(() => {
    setPref('loadLimit', loadLimit.toString());
    setPref('visibleColumns', JSON.stringify(visibleColumns));
    setPref('rateMode', rateMode);
    setPref('restoreOnStartup', String(restoreOnStartup));
  }, [loadLimit, visibleColumns, rateMode, restoreOnStartup]);

  // ── Persist workspace (#211) ────────────────────────────────────────────────
  // What the address bar currently says, in normalised form, and how the next
  // write goes: the first one after load only tidies the URL the app was
  // opened with, so it must not add a history entry.
  const syncedSearchRef = useRef(buildMonitorSearch(initialWorkspace ?? DEFAULT_WORKSPACE));
  const urlWriteModeRef = useRef<'push' | 'replace'>('replace');
  const workspaceView: WorkspaceView = isDatabaseOpen
    ? 'database'
    : activePanel === 'list'
      ? 'none'
      : activePanel;
  useEffect(() => {
    // A shared viz link owns the URL for this session; don't overwrite it or
    // persist its transient state as the workspace.
    if (initialView) return;
    const workspace: WorkspaceState = {
      tab: activeTab,
      view: workspaceView,
      filterOpen: isFilterOpen,
      filters: activeFilters,
      plot: selectedVisualizationTargets,
      lastSeenAddresses: focusTab === 'pa' ? focusDevices : focusGas,
      lastSeenMode: focusTab === 'pa' ? 'pa' : 'ga',
    };
    const handle = setTimeout(() => {
      if (isEmbedded()) {
        saveWorkspace(workspace);
        return;
      }
      // Each settled change becomes one browser-history entry, so Back and
      // Forward step through filters, panels and tabs. The debounce
      // folds a multi-part change (e.g. "visualize this GA": targets + panel)
      // into a single step.
      const search = buildMonitorSearch(workspace);
      const first = urlWriteModeRef.current === 'replace';
      urlWriteModeRef.current = 'push';
      if (search === syncedSearchRef.current) return;
      // Showing or hiding the filter pane is layout, not a place to go back to.
      const layoutOnly = sameWorkspaceApartFromLayout(search, syncedSearchRef.current);
      syncedSearchRef.current = search;
      applyWorkspaceUrl(workspace, first || layoutOnly ? 'replace' : 'push');
    }, 500);
    return () => clearTimeout(handle);
  }, [initialView, activeTab, workspaceView, isFilterOpen, activeFilters, selectedVisualizationTargets, focusGas, focusDevices, focusTab]);

  // ── Browser Back / Forward ───────────────────────────────────────────
  // The address bar is the source of truth for the entry navigated to: parse
  // it and put the app into that workspace. Recording it as already synced
  // keeps the effect above from pushing it again, which would cut off the
  // forward history.
  useEffect(() => {
    if (initialView || isEmbedded()) return;
    const onPopState = () => {
      const ws = workspaceFromSearch(window.location.search);
      syncedSearchRef.current = buildMonitorSearch(ws);
      setActiveTab(ws.tab);
      setIsDatabaseOpen(ws.view === 'database');
      setActivePanel(ws.view === 'none' || ws.view === 'database' ? 'list' : ws.view);
      if (ws.view !== 'building') setStatusDevice(null);
      setIsFilterOpen(ws.filterOpen);
      setActiveFilters(ws.filters);
      setSelectedVisualizationTargets(ws.plot);
      setLastSeenAddresses(ws.lastSeenAddresses);
      setLastSeenMode(ws.lastSeenMode);
      if (ws.lastSeenMode === 'ga') setFocusGas([...ws.lastSeenAddresses]);
      else setFocusDevices(ws.lastSeenAddresses);
      setFocusTab(ws.lastSeenMode === 'pa' ? 'pa' : 'ga');
      // An overlay left open would hide the workspace just navigated to.
      setIsSettingsOpen(false);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [initialView]);

  // ── Persist UI Session State (#341) ──────────────────────────────────────────
  useEffect(() => {
    const handle = setTimeout(() => {
      saveUiState({
        quickFilter: {
          open: quickFilterOpen,
          enabled: quickFilterEnabled,
          patterns: quickPatterns,
          columns: quickFilterColumns,
        },
        listFollow,
        listAnchorKey,
        infoBarOpen,
        zoomRange,
        statsSearch,
        buildingSearch,
        lastSeenLimit,
        lastSeenLive,
        lastSeenSearch,
        lastSeenGas,
        lastSeenDevices,
        lastSeenGroup,
        lastSeenExpanded,
        filtersEnabled,
        filterSearch,
        filterCompact,
        filterCheckedOnly,
        panelView,
        focusTab,
        focusGas,
        focusDevices,
        focusGaSearch,
        focusDeviceSearch,
        focusGaCompact,
        focusDeviceCompact,
        focusGaVerdichten,
        focusDeviceVerdichten,
      });
    }, 500);
    return () => clearTimeout(handle);
  }, [
    quickFilterOpen,
    quickFilterEnabled,
    quickPatterns,
    quickFilterColumns,
    listFollow,
    listAnchorKey,
    infoBarOpen,
    zoomRange,
    statsSearch,
    buildingSearch,
    lastSeenLimit,
    lastSeenLive,
    lastSeenSearch,
    lastSeenGas,
    lastSeenDevices,
    lastSeenGroup,
    lastSeenExpanded,
    filtersEnabled,
    filterSearch,
    filterCompact,
    filterCheckedOnly,
    panelView,
    focusTab,
    focusGas,
    focusDevices,
    focusGaSearch,
    focusDeviceSearch,
    focusGaCompact,
    focusDeviceCompact,
    focusGaVerdichten,
    focusDeviceVerdichten,
  ]);

  // ── Rate Calculation Loop ───────────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      let windowMs = 5000;
      if (rateMode === 'm') windowMs = 60_000;
      if (rateMode === 'h') windowMs = 3_600_000;
      const cutoff = now - windowMs;
      const count = arrivalTimesRef.current.filter(t => t > cutoff).length;
      if (rateMode === 's') setBusRate(count / (windowMs / 1000));
      else setBusRate(count);
    }, 1000);
    return () => clearInterval(interval);
  }, [rateMode]);

  // ── Pause / Resume ──────────────────────────────────────────────────────────
  const togglePause = () => {
    const next = !isPaused;
    setCachePaused(next);
    setIsPaused(next);
  };

  const toggleColumn = (col: string) =>
    setVisibleColumns(prev => ({ ...prev, [col]: !prev[col] }));

  // ── Telegram list marks (#310) ──────────────────────────────────────────────
  // Lifted above the conditionally-rendered panels so marked rows survive
  // main-panel navigation. Keyed by the table's anchorKey identity.
  const [markedTelegramKeys, setMarkedTelegramKeys] = useState<string[]>([]);
  const [lastMarkedTelegramKey, setLastMarkedTelegramKey] = useState<string | null>(null);
  // Stripe highlights, separate from the mouse selection. Shared with Last Seen.
  const [highlightedTelegramKeys, setHighlightedTelegramKeys] = useState<string[]>([]);

  // ── Per-message Time-Delta-Context flags (#319) ─────────────────────────────
  // Same lifting rationale as marks; each flagged telegram always anchors a
  // context window around itself regardless of the active filters.
  const [flaggedTelegramKeys, setFlaggedTelegramKeys] = useState<string[]>([]);
  // Global "all" state: every filter match anchors a window. Off, only the
  // flagged telegrams do.
  const [contextForAllMatches, setContextForAllMatches] = useState(true);

  // ── Sorting (#311: multi-level, ctrl/cmd-click adds a level) ─────────────────
  const [sortConfig, setSortConfig] = useState<SortConfig>(readSortConfigPref);
  const handleSort = (key: SortKey, opts?: { additive?: boolean }) => {
    setSortConfig(prev => {
      const next = toggleSortLevel(prev, key, !!opts?.additive);
      writeSortConfigPref(next);
      return next;
    });
  };

  const revealFocusList = (mode: 'ga' | 'pa') => {
    setFocusTab(mode);
    setPanelView('focus');
    setIsFilterOpen(true);
  };

  const openPanel = (panel: 'list' | 'visualizer' | 'lastseen') => {
    setActivePanel(panel);
    setIsDatabaseOpen(false);
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
      const update = (prev: string[]) => applyToggle(
        prev,
        addresses,
        toggleTurnOn(prev, addresses, clicked ?? (addresses.length === 1 ? addresses[0] : undefined)),
        gesture.exclusive,
      );
      if (mode === 'ga') setFocusGas(update);
      else setFocusDevices(update);
      if (!gesture.navigate) return;
    }
    revealFocusList(mode);
  };

  const toggleFocusGroup = (addresses: string[], gesture: ToggleGesture = PLAIN_TOGGLE) => {
    toggleFocusMembership(addresses, 'ga', gesture);
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
      const update = (prev: string[]) => applyToggle(
        prev,
        addresses,
        toggleTurnOn(prev, addresses, clicked ?? (addresses.length === 1 ? addresses[0] : undefined)),
        gesture.exclusive,
      );
      if (mode === 'ga') setFocusFilterGas(update);
      else setFocusFilterDevices(update);
      if (!gesture.navigate) return;
    }
    setFocusTab(mode);
    setPanelView('focus');
    setIsFilterOpen(true);
    openPanel('list');
  };

  const runVisualize = (
    address: string | string[],
    mode: 'ga' | 'pa',
    gesture: ToggleGesture = PLAIN_TOGGLE,
    clicked?: string,
  ) => {
    if (gesture.kind === 'none') return;
    const addresses = typeof address === 'string' ? [address] : address;
    if (gesture.kind === 'toggle') {
      const update = (prev: string[]) => applyToggle(
        prev,
        addresses,
        toggleTurnOn(prev, addresses, clicked ?? (addresses.length === 1 ? addresses[0] : undefined)),
        gesture.exclusive,
      );
      if (mode === 'ga') setSelectedVisualizationTargets(update);
      else setVisualizedDevices(update);
      if (!gesture.navigate) return;
    }
    setFocusTab(mode);
    openPanel('visualizer');
  };

  const handleQuickFilter = (key: 'sources' | 'targets' | 'types' | 'dpts', value: string | number) => {
    handleFiltersChange(prev => {
      const current = prev[key] as (string | number)[];
      const isPresent = current.includes(value as never);
      return {
        ...prev,
        [key]: isPresent ? current.filter(v => v !== value) : [...current, value]
      };
    });
    setIsFilterOpen(true);
  };

  const handleQuickVisualize = (targetAddress: string | string[], _mode: 'ga' | 'pa' = 'ga', gesture: ToggleGesture = PLAIN_TOGGLE, clicked?: string) => {
    runVisualize(targetAddress, 'ga', gesture, clicked);
  };

  const handleVisualizeDevice = (sourceAddress: string | string[], _mode: 'ga' | 'pa' = 'pa', gesture: ToggleGesture = PLAIN_TOGGLE, clicked?: string) => {
    runVisualize(sourceAddress, 'pa', gesture, clicked);
  };

  // A function's, device's or comm-object's group addresses share one visualize toggle (#307).
  const handleVisualizeGAs = useCallback((addresses: string[], gesture: ToggleGesture = PLAIN_TOGGLE) => {
    runVisualize(addresses, 'ga', gesture);
  }, []);

  // Jump from outside the list (Last Seen, a chart): center that telegram and
  // frame it. A focus or quick filter that would hide it also selects it, so
  // the filter keep-rule leaves the row on screen.
  const openListAtTelegram = useCallback((telegram: Telegram) => {
    const key = anchorKey(telegram);
    const quick = activeQuickFilter(quickFilterOpen, quickFilterEnabled, quickPatterns, quickFilterColumns);
    const applied = focusAddressesForList(focusFilterGas, focusFilterDevices, filterFocusedSources, filterFocusedTargets);
    const hiddenByFocus = !passesFocusAddressFilter(telegram, applied.gas, applied.devices);
    const hiddenByQuick = quick != null && !quick(telegram);
    if (hiddenByFocus || hiddenByQuick) {
      setMarkedTelegramKeys(prev => (prev.includes(key) ? prev : [...prev, key]));
      setLastMarkedTelegramKey(key);
    }
    setListFollow(false);
    setListAnchorKey(key);
    setListAnchorAlign('center');
    setActivePanel('list');
    setIsDatabaseOpen(false);
  }, [quickFilterOpen, quickFilterEnabled, quickPatterns, quickFilterColumns, focusFilterGas, focusFilterDevices, filterFocusedSources, filterFocusedTargets]);

  const handleGotoTelegram = openListAtTelegram;

  // Click a time/dot on a visualization chart: close the panel, land on the
  // telegram nearest that timestamp with live-follow paused, and auto-flag it
  // as a Time-Delta-Context anchor so its context window opens around it (#308).
  const handleChartTimeClick = useCallback((ms: number) => {
    if (liveTelegrams.length === 0) return;
    let nearest = liveTelegrams[0];
    let bestDiff = Infinity;
    for (const t of liveTelegrams) {
      const diff = Math.abs(new Date(t.timestamp).getTime() - ms);
      if (diff < bestDiff) { bestDiff = diff; nearest = t; }
    }
    setFlaggedTelegramKeys(prev => prev.includes(anchorKey(nearest)) ? prev : [...prev, anchorKey(nearest)]);
    openListAtTelegram(nearest);
  }, [liveTelegrams, openListAtTelegram]);

  const handleListAnchorKeyChange = useCallback((key: string | null) => {
    if (key !== listAnchorKeyRef.current) setListAnchorAlign('start');
    setListAnchorKey(key);
  }, []);

  const handleQuickLastSeen = useCallback((
    address: string | string[],
    mode: 'ga' | 'pa',
    gesture: ToggleGesture = PLAIN_TOGGLE,
    clicked?: string,
  ) => {
    if (gesture.kind === 'none') return;
    const addresses = Array.isArray(address) ? address : [address];
    if (gesture.kind === 'toggle') {
      const update = (prev: string[]) => applyToggle(
        prev,
        addresses,
        toggleTurnOn(prev, addresses, clicked ?? (addresses.length === 1 ? addresses[0] : undefined)),
        gesture.exclusive,
      );
      if (mode === 'pa') setLastSeenDevices(update);
      else setLastSeenGas(update);
      if (!gesture.navigate) return;
    }
    setLastSeenMode(mode);
    openPanel('lastseen');
  }, []);

  // Add all of a KO's connected group addresses to the target filter (union).
  const handleFilterGAs = useCallback((addresses: string[]) => {
    handleFiltersChange(prev => ({
      ...prev,
      targets: [...new Set([...prev.targets, ...addresses])],
    }));
    setIsFilterOpen(true);
  }, [handleFiltersChange]);

  // Click a GA name in a chart legend: add it to the target filter, make sure
  // filtering is on and show the newest telegrams in the list (#521).
  const handleShowGaTelegrams = useCallback((address: string, event?: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
    const gesture = event ? toggleGesture(event) : PLAIN_TOGGLE;
    if (gesture.kind === 'none') return;
    if (gesture.kind === 'toggle') {
      handleFiltersChange(prev => ({
        ...prev,
        targets: applyToggle(prev.targets, [address], toggleTurnOn(prev.targets, [address], address), gesture.exclusive),
      }));
      if (!gesture.navigate) return;
    }
    setFiltersEnabled(true);
    setListFollow(true);
    openPanel('list');
  }, [handleFiltersChange]);

  // Time-Delta-Context window, now edited from the telegram list's DELTA TIME
  // quick-filter cell rather than the filter pane (#309, #371).
  const handleDeltaContextChange = useCallback((deltaBeforeMs: number, deltaAfterMs: number) => {
    handleFiltersChange(prev => ({ ...prev, deltaBeforeMs, deltaAfterMs }));
  }, [handleFiltersChange]);

  // Toggles the window on/off without losing the entered values (#318).
  const handleDeltaContextEnabledChange = useCallback((deltaContextEnabled: boolean) => {
    handleFiltersChange(prev => ({ ...prev, deltaContextEnabled }));
  }, [handleFiltersChange]);

  const sortedLiveTelegrams = useMemo(
    () => sortTelegrams(liveTelegrams, sortConfig),
    [liveTelegrams, sortConfig]
  );

  // ── In-memory filtering (live view) ────────────────────────────────────────
  const deltaExpandedLive = useMemo(() => {
    const f = appliedFilters;
    // Master toggle off (#370): show everything, keep the filter set intact.
    const noFilter =
      !filtersEnabled ||
      (f.sources.length === 0 &&
      f.targets.length === 0 &&
      f.types.length === 0 &&
      f.directions.length === 0 &&
      f.dpts.length === 0);

    // Quick-filter matches anchor the context like main-filter matches (#520).
    const quick = activeQuickFilter(quickFilterOpen, quickFilterEnabled, quickPatterns, quickFilterColumns);
    const appliedFocus = focusAddressesForList(focusFilterGas, focusFilterDevices, filterFocusedSources, filterFocusedTargets);
    // Stripe marks stay visible, but they are not filter matches: a context row
    // that is highlighted keeps its context identity. A mouse selection never does.
    const kept = new Set(highlightedTelegramKeys);
    const matches = sortedLiveTelegrams.map(t => {
      const panelPass = noFilter || matchesTelegram(t, f);
      const focusPass = passesFocusAddressFilter(t, appliedFocus.gas, appliedFocus.devices);
      const quickPass = !quick || quick(t);
      return panelPass && focusPass && quickPass;
    });

    // The Δt column filter closes the window the same way the master toggle does.
    const { before: deltaBeforeMs, after: deltaAfterMs } = effectiveDeltaContext(f, quickFilterColumns.delta !== false);
    // A per-message flag keeps a non-match and anchors a window only when that
    // window exists and a focus or quick filter is narrowing the list. Otherwise
    // the flag is stored but does not hold the row the way a mark does. The
    // global "all" state still anchors filter matches. The master toggle off
    // (#318) leaves the flags stored and inert.
    const focusOrQuick = appliedFocus.gas.length > 0 || appliedFocus.devices.length > 0 || quick != null;
    const flags = f.deltaContextEnabled && (deltaBeforeMs > 0 || deltaAfterMs > 0) && focusOrQuick
      ? new Set(flaggedTelegramKeys)
      : EMPTY_KEY_SET;

    const expanded = expandWithDeltaContext(sortedLiveTelegrams, matches, anchorKey, flags, deltaBeforeMs, deltaAfterMs, contextForAllMatches);
    return retainKeptRows(
      sortedLiveTelegrams,
      expanded,
      anchorKey,
      kept,
      t => noFilter || matchesTelegram(t, f),
    );
  }, [sortedLiveTelegrams, appliedFilters, filtersEnabled, flaggedTelegramKeys, contextForAllMatches, quickFilterOpen, quickFilterEnabled, quickPatterns, quickFilterColumns, focusFilterGas, focusFilterDevices, filterFocusedSources, filterFocusedTargets, highlightedTelegramKeys]);
  const filteredLiveTelegrams = deltaExpandedLive.items;

  // A mouse selection is never held. A row that leaves the list leaves the
  // selection. A stripe mark stays visible, so a selection on it stays.
  useEffect(() => {
    const visible = new Set(filteredLiveTelegrams.map(anchorKey));
    const next = markedTelegramKeys.filter(key => visible.has(key));
    if (next.length === markedTelegramKeys.length && next.every((key, i) => key === markedTelegramKeys[i])) return;
    setMarkedTelegramKeys(next);
  }, [filteredLiveTelegrams, markedTelegramKeys]);
  // Keys of rows shown only as unfiltered context around a match/flag (#343).
  const contextTelegramKeys = deltaExpandedLive.contextKeys;

  // ── Count bubbles ───────────────────────────────────────────────
  // The master switch changes which telegrams the list shows. The pane keeps
  // counting as if the filter were on, so its badges do not follow that switch.
  const filterCounts = useMemo(
    () => countAppliedFilterOptions(sortedLiveTelegrams, activeFilters),
    [sortedLiveTelegrams, activeFilters],
  );
  // Entry labels are highlighted from the unfiltered buffer. A gray badge counts
  // the entry in the database only when the live filter leaves it out of the buffer.
  const bufferCounts = useMemo(
    () => countFilterOptions(sortedLiveTelegrams),
    [sortedLiveTelegrams],
  );
  const dbCounts = useDbTelegramCounts();

  const activeFilterCount = countSelections(appliedFilters);

  // One header for the telegram list, the visualization and last seen (#374).
  const showViewHeader = !isDatabaseOpen && VIEW_PANELS.includes(activePanel);
  // The filter/focus pane is the address picker for the list, the chart and last seen.
  const showFilterPane = showViewHeader && isFilterOpen;

  // The buffer holds at most `loadLimit` (newest) telegrams; once it is at
  // capacity there is no room to load older history (#313).
  const bufferFull = liveTelegrams.length >= loadLimit;

  // Inline "buffer full" marker shown next to the count in the stats pill (#284).
  const bufferLimitWarning = filteredLiveTelegrams.length >= loadLimit ? (
    <span
      onClick={() => setIsSettingsOpen(true)}
      title={`Buffer full (${loadLimit.toLocaleString()}). Click to adjust in settings.`}
      style={{ display: 'inline-flex', alignItems: 'center', color: 'var(--warning-text)', cursor: 'pointer' }}
    >
      <AlertTriangle size={13} />
    </span>
  ) : null;

  // Replace the app with a login screen when authentication is required. Early
  // so an unauthenticated visitor triggers no data fetching or WebSocket work
  // (those requests would 401 and the socket would be refused anyway).
  if (loginRequired(authStatus)) {
    return <LoginScreen status={authStatus!} onAuthenticated={reloadAuth} />;
  }

  return (
    <AddressActionProvider value={{
      focusGas, focusDevices, focusFilterGas, focusFilterDevices,
      lastSeenGas, lastSeenDevices,
      visualizedGas: selectedVisualizationTargets, visualizedDevices,
      onFocus: toggleFocusMembership,
      onFilter: toggleFocusFilter,
      onVisualize: runVisualize,
      onLastSeen: handleQuickLastSeen,
      canSend: !!serverConfig?.status?.write_enabled,
    }}>
    <div className="container dashboard-grid" style={{ padding: '1.5rem', gap: '1.5rem' }}>

      {/* ── Main area (Full Width) ─── */}
      <main style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1, borderRadius: '12px' }} className="glass">

        {legacyTimestamps && <LegacyTimestampBanner />}

        {/* === GLOBAL HEADER === */}
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', flexShrink: 0, background: 'var(--bg-inset)' }}>
          {/* Left: App Section Dropdown */}
          <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0, zIndex: 50 }}>
            <NavDropdown
              activeTab={activeTab}
              isSettingsOpen={isSettingsOpen}
              isDatabaseOpen={isDatabaseOpen}
              onChange={(id) => {
                if (id === 'settings') {
                  setIsSettingsOpen(true);
                  setIsDatabaseOpen(false);
                  if (activeTab !== 'live') setActiveTab('live');
                } else if (id === 'database') {
                  setIsDatabaseOpen(true);
                  setIsSettingsOpen(false);
                  setActivePanel('list');
                } else {
                  setIsSettingsOpen(false);
                  setIsDatabaseOpen(false);
                  setActiveTab(id as 'live' | 'history' | 'import');
                }
              }}
            />
          </div>

          {/* Center: Brand — flexible middle column, clips gracefully instead of overlapping the actions */}
          <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', overflow: 'hidden', padding: '0 0.75rem', pointerEvents: 'none' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexShrink: 0 }}>
              <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="Spectrum KNX" style={{ width: 22, height: 22 }} />
              <h1 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0, letterSpacing: '-0.02em', whiteSpace: 'nowrap' }}>Spectrum KNX</h1>
            </div>
          </div>

          {/* Right: Actions */}
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexShrink: 0 }}>
            {activeTab === 'live' && !isSettingsOpen && (
              <>
                {/* Embedded Stats */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginRight: '1rem', background: 'var(--bg-subtle)', padding: '0.4rem 0.85rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                  <span style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-dim)' }}>
                    Rate: <span onClick={() => setRateMode(m => m === 's' ? 'm' : m === 'm' ? 'h' : 's')} style={{ color: 'var(--accent-primary)', fontWeight: 600, cursor: 'pointer' }}>{busRate.toFixed(1)}/{rateMode}</span>
                  </span>
                  <span style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem', color: 'var(--text-dim)' }}>
                    Buffer:
                    {/* Buffer-related actions live with the count (#284): clear + load history */}
                    <button
                      className="icon-button"
                      onClick={() => { void clearTelegrams(); }}
                      title="Clear (also wipes the local telegram cache)"
                      style={{ color: 'var(--text-dim)', padding: '0.15rem' }}
                    >
                      <Trash2 size={15} />
                    </button>
                    <button
                      className="icon-button"
                      onClick={() => setIsHistoryLoaderOpen(true)}
                      disabled={bufferFull}
                      title={
                        bufferFull
                          ? `Buffer full (${loadLimit.toLocaleString()}); clear it or raise the limit to load more history`
                          : isHistoryLoading
                            ? 'History read in progress…'
                            : 'Load history'
                      }
                      style={{
                        color: isHistoryLoading ? 'var(--accent-primary)' : 'var(--text-dim)',
                        padding: '0.15rem',
                        opacity: bufferFull ? 0.4 : 1,
                        cursor: bufferFull ? 'not-allowed' : 'pointer',
                      }}
                    >
                      <Download size={15} />
                    </button>
                    {/* Pausing holds back the buffer for every panel, not just
                        the list, so it sits with the other buffer actions (#374). */}
                    <button
                      className="icon-button"
                      onClick={togglePause}
                      title={isPaused ? 'Resume' : 'Pause'}
                      style={{ color: isPaused ? 'var(--accent-primary)' : 'var(--text-dim)', padding: '0.15rem' }}
                    >
                      {isPaused ? <Play size={15} fill="currentColor" /> : <Pause size={15} fill="currentColor" />}
                    </button>
                    <span style={{ color: 'var(--text-main)', fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
                      {activeFilterCount
                        ? <>{filteredLiveTelegrams.length}{bufferLimitWarning}<span style={{ color: 'var(--text-dim)', fontWeight: 400 }}> / {liveTelegrams.length}</span></>
                        : <>{liveTelegrams.length}{bufferLimitWarning}</>}
                    </span>
                  </span>
                  {isPaused && (
                    <span style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--warning-text)' }}>
                      Paused: <span style={{ fontWeight: 600 }}>{pausedCount}</span>
                    </span>
                  )}
                  <span style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-dim)' }}>
                    WS: <span style={{ color: isConnected ? 'var(--success)' : 'var(--error)', fontWeight: 500 }}>{isConnected ? 'Active' : 'Offline'}</span>
                  </span>
                  {/* Background history reads run without blocking the UI (#222) */}
                  {isHistoryLoading && (
                    <span style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--accent-primary)' }}>
                      <span className="chip-spinner" /> History: loading…
                    </span>
                  )}
                  {!isHistoryLoading && historyLoadError && (
                    <span
                      title={historyLoadError}
                      style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.35rem', color: 'var(--error)' }}
                    >
                      <AlertTriangle size={13} /> History: failed
                    </span>
                  )}
                </div>

                {/* Main-panel switch (#374): the five panels close back to the
                    list; the Building opener also clears any drilled-in device. */}
                <PanelSwitch
                  panels={OTHER_PANELS}
                  active={activePanel}
                  onChange={(p) => { if (p !== 'building') setStatusDevice(null); setActivePanel(p); setIsDatabaseOpen(false); }}
                />

                {serverConfig?.status?.write_enabled && (
                  <button
                    className="icon-button"
                    onClick={() => toggleSendPanel()}
                    title="Send / read telegrams"
                    style={{ color: isSendOpen ? 'var(--accent-primary)' : 'var(--text-dim)' }}
                  >
                    <Send size={18} />
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* === MAIN CONTENT BODY === */}
        {isSettingsOpen ? (
          <div style={{ flex: 1, overflowY: 'auto', padding: '2rem' }}>
            <div className="glass-card" style={{ padding: '1.5rem', maxWidth: 600, margin: '0 auto' }}>
               <h2 style={{ marginBottom: '1.5rem', fontSize: '1.1rem' }}>Application Settings</h2>

              <h3 style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: '0.75rem', letterSpacing: '0.05em' }}>
                Appearance
              </h3>
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '2rem' }}>
                {([
                  { id: 'system', label: 'System', Icon: Monitor },
                  { id: 'light',  label: 'Light',  Icon: Sun },
                  { id: 'dark',   label: 'Dark',   Icon: Moon },
                ] as const).map(({ id, label, Icon }) => (
                  <button
                    key={id}
                    onClick={() => setTheme(id)}
                    style={{
                      flex: 1,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem',
                      padding: '0.5rem',
                      borderRadius: 6,
                      border: `1px solid ${theme === id ? 'var(--accent-primary)' : 'var(--border-color)'}`,
                      background: theme === id ? 'rgba(99,102,241,0.15)' : 'var(--bg-subtle)',
                      color: theme === id ? 'var(--accent-primary)' : 'var(--text-dim)',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      fontWeight: theme === id ? 600 : 400,
                      transition: 'all 0.15s',
                    }}
                  >
                    <Icon size={14} />
                    {label}
                  </button>
                ))}
              </div>

               <h3 style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: '0.75rem', letterSpacing: '0.05em' }}>
                Table Columns
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '2rem' }}>
                {Object.keys(visibleColumns).map(col => (
                  <button key={col} className="setting-item" onClick={() => toggleColumn(col)} style={{ padding: '0.5rem', background: 'var(--bg-subtle)', borderRadius: 6 }}>
                    <div className={`checkbox ${visibleColumns[col] ? 'checked' : ''}`} style={{ width: 14, height: 14, border: '1px solid var(--border-color)', borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {visibleColumns[col] && <div style={{ width: 8, height: 8, background: 'white', borderRadius: 2 }} />}
                    </div>
                    <span style={{ fontSize: '0.85rem' }}>{col === 'dpt' ? 'DPT' : col.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}</span>
                  </button>
                ))}
              </div>

              <h3 style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: '0.75rem', letterSpacing: '0.05em' }}>
                Loading Limit
              </h3>
              <div className="input-group">
                <input
                  type="number"
                  step="1000"
                  className="glass-input"
                  style={{ width: '100%', padding: '0.75rem', fontSize: '0.85rem' }}
                  value={loadLimit}
                  onChange={e => setLoadLimit(Number(e.target.value))}
                />
              </div>

              <h3 style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: '0.75rem', letterSpacing: '0.05em', marginTop: '1.5rem' }}>
                Startup
              </h3>
              <button
                className="setting-item"
                onClick={() => setRestoreOnStartup(v => !v)}
                title="Restore recent telegrams from the browser cache and fill the gap from the server on load. When off, the view starts empty and shows only live telegrams and manual history loads."
                style={{ padding: '0.5rem', background: 'var(--bg-subtle)', borderRadius: 6, marginBottom: '2rem' }}
              >
                <div className={`checkbox ${restoreOnStartup ? 'checked' : ''}`} style={{ width: 14, height: 14, border: '1px solid var(--border-color)', borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {restoreOnStartup && <div style={{ width: 8, height: 8, background: 'white', borderRadius: 2 }} />}
                </div>
                <span style={{ fontSize: '0.85rem' }}>Load cached telegrams on startup</span>
              </button>

              <>
                <h3 style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: '0.75rem', letterSpacing: '0.05em', marginTop: '1.5rem' }}>
                  Project File
                </h3>
                {projectStatus?.upload_writable === false ? (
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', padding: '0.75rem', border: '1px solid var(--border-color)', borderRadius: '6px' }}>
                    Project file is not writable. Mount the project directory as a writable volume to enable browser upload.
                  </div>
                ) : (
                  <button
                    className="glass-input"
                    onClick={() => setIsUploadWizardOpen(true)}
                    style={{ width: '100%', padding: '0.75rem', textAlign: 'left', cursor: 'pointer', fontSize: '0.85rem' }}
                  >
                    Upload / Replace ETS Project File
                  </button>
                )}
              </>

              {knxkeysStatus?.upload_feature_active && (
                <>
                  <h3 style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: '0.75rem', letterSpacing: '0.05em', marginTop: '1.5rem' }}>
                    KNX Security Keys
                  </h3>
                  <button
                    className="glass-input"
                    onClick={() => setIsKeysWizardOpen(true)}
                    style={{ width: '100%', padding: '0.75rem', textAlign: 'left', cursor: 'pointer', fontSize: '0.85rem' }}
                  >
                    Upload / Replace KNX Keys File (.knxkeys)
                  </button>
                </>
              )}

              {/* Server Configuration — always visible */}
              <div style={{ marginTop: '2rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <h3 style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Server Configuration
                </h3>
                {serverConfig ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.8rem' }}>
                    {/* Connection Status — in companion mode Home Assistant owns the
                        bus; what matters is whether our live feed from HA works (#184) */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: 'var(--text-dim)' }}>
                        {serverConfig.mode === 'companion' ? 'Home Assistant Feed:' : 'KNX Connection:'}
                      </span>
                      <span style={{
                        color: serverConfig.status?.connected ? 'var(--success)' : 'var(--error)',
                        fontWeight: 600
                      }}>
                        {serverConfig.status?.connected ? '● Connected' : '● Disconnected'}
                      </span>
                    </div>

                    {/* Connection Settings */}
                    {Object.entries(serverConfig.connection || {}).map(([key, value]) => (
                      value != null && (
                        <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ color: 'var(--text-dim)' }}>{getLabel('connection', key)}:</span>
                          <span style={{ fontFamily: '"JetBrains Mono", monospace', color: 'var(--text-main)', background: 'var(--bg-tag)', padding: '0.15rem 0.4rem', borderRadius: 4, fontSize: '0.75rem' }}>
                            {String(value)}
                          </span>
                        </div>
                      )
                    ))}

                    {/* Files */}
                    <div style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border-subtle)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ color: 'var(--text-dim)' }}>Project file:</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          {serverConfig.files?.project_file && (
                            <span style={{ fontFamily: '"JetBrains Mono", monospace', color: 'var(--text-main)', background: 'var(--bg-tag)', padding: '0.15rem 0.4rem', borderRadius: 4, fontSize: '0.75rem' }}>
                              {/* The name the user uploaded, not the fixed path we store it under (#425). */}
                              {serverConfig.files.project_display_name || getFileName(serverConfig.files.project_file)}
                            </span>
                          )}
                          <span style={{ color: serverConfig.files?.project_loaded ? 'var(--success)' : 'var(--text-dim)', fontSize: '0.75rem' }}>
                            {serverConfig.files?.project_loaded ? '● Loaded' : '○ Not loaded'}
                          </span>
                        </div>
                      </div>
                      {/* Import time and what ETS recorded inside the project (#425). */}
                      {[
                        ['Imported:', formatSettingsDate(serverConfig.files?.project_imported_at)],
                        ['ETS project:', serverConfig.files?.project_ets_name],
                        ['ETS modified:', formatSettingsDate(serverConfig.files?.project_ets_last_modified)],
                        ['Created by:', serverConfig.files?.project_created_by],
                      ].map(([label, value]) => value ? (
                        <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.25rem' }}>
                          <span style={{ color: 'var(--text-dim)' }}>{label}</span>
                          <span style={{ fontFamily: '"JetBrains Mono", monospace', color: 'var(--text-main)', background: 'var(--bg-tag)', padding: '0.15rem 0.4rem', borderRadius: 4, fontSize: '0.75rem' }}>
                            {value}
                          </span>
                        </div>
                      ) : null)}
                      {serverConfig.files?.knxkeys_found !== undefined && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.25rem' }}>
                          <span style={{ color: 'var(--text-dim)' }}>KNX keys file:</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            {serverConfig.files?.knxkeys_file && (
                              <span style={{ fontFamily: '"JetBrains Mono", monospace', color: 'var(--text-main)', background: 'var(--bg-tag)', padding: '0.15rem 0.4rem', borderRadius: 4, fontSize: '0.75rem' }}>
                                {getFileName(serverConfig.files.knxkeys_file)}
                              </span>
                            )}
                            <span style={{ color: serverConfig.files?.knxkeys_found ? 'var(--success)' : 'var(--text-dim)', fontSize: '0.75rem' }}>
                              {serverConfig.files?.knxkeys_found ? '● Found' : '○ Not found'}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Authentication (#451) */}
                    {authStatus && <AuthSettings status={authStatus} onChanged={reloadAuth} />}

                    {/* Security */}
                    {Object.entries(serverConfig.security || {}).some(([, v]) => v != null) && (
                      <div style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border-subtle)' }}>
                        {Object.entries(serverConfig.security || {}).map(([key, value]) => (
                          value != null && (
                            <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.25rem' }}>
                              <span style={{ color: 'var(--text-dim)' }}>{getLabel('security', key)}:</span>
                              <span style={{ fontFamily: '"JetBrains Mono", monospace', color: 'var(--text-main)', background: 'var(--bg-tag)', padding: '0.15rem 0.4rem', borderRadius: 4, fontSize: '0.75rem' }}>
                                {String(value)}
                              </span>
                            </div>
                          )
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>Loading...</span>
                )}
              </div>

              <div style={{ marginTop: '1.5rem', paddingTop: '1.5rem', borderTop: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <h3 style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  System Information
                </h3>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem' }}>
                  <span style={{ color: 'var(--text-dim)' }}>Frontend Version:</span>
                  <span style={{ fontFamily: '"JetBrains Mono", monospace', color: 'var(--text-main)', background: 'var(--bg-tag)', padding: '0.2rem 0.4rem', borderRadius: 4 }}>
                    {typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'unknown'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem' }}>
                  <span style={{ color: 'var(--text-dim)' }}>Backend Version:</span>
                  <span style={{ fontFamily: '"JetBrains Mono", monospace', color: 'var(--text-main)', background: 'var(--bg-tag)', padding: '0.2rem 0.4rem', borderRadius: 4 }}>
                    {backendVersion}
                  </span>
                </div>
                {updateInfo?.enabled && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.85rem' }}>
                    <span style={{ color: 'var(--text-dim)' }}>Updates:</span>
                    {updateInfo.update_available ? (
                      <button
                        onClick={() => setIsUpdateOpen(true)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer',
                          fontFamily: '"JetBrains Mono", monospace', fontSize: '0.8rem', fontWeight: 600,
                          padding: '0.2rem 0.5rem', borderRadius: 4,
                          border: '1px solid var(--accent-primary)', background: 'rgba(99,102,241,0.12)',
                          color: 'var(--accent-primary)',
                        }}
                      >
                        <Sparkles size={13} /> {updateInfo.latest} available
                      </button>
                    ) : (
                      <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>
                        {updateInfo.error ? 'Check failed' : 'Up to date'}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : activeTab === 'live' ? (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Content row: filter panel + table */}
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>

              {/* Filter panel (slide-in). Filters apply to the Telegram List only,
                  so the pane is list-only now (#374; contents redesign is #370). */}
              <ResizablePane open={showFilterPane} prefKey="filter-pane-width">
                  <FilterPanel
                    options={filterOptions}
                    activeFilters={activeFilters}
                    onFiltersChange={handleFiltersChange}
                    counts={filterCounts}
                    bufferCounts={bufferCounts}
                    dbCounts={dbCounts}
                    onQuickLastSeen={handleQuickLastSeen}
                    onOpenPanel={openPanel}
                    projectLoaded={projectStatus?.project_loaded}
                    onUploadProject={() => setIsSettingsOpen(true)}
                    writeEnabled={serverConfig?.status?.write_enabled}
                    filtersEnabled={filtersEnabled}
                    onFiltersEnabledChange={setFiltersEnabled}
                    search={filterSearch}
                    onSearchChange={setFilterSearch}
                    compact={filterCompact}
                    onCompactChange={setFilterCompact}
                    checkedOnly={filterCheckedOnly}
                    onCheckedOnlyChange={setFilterCheckedOnly}
                    panelView={panelView}
                    onPanelViewChange={setPanelView}
                    focusTab={focusTab}
                    onFocusTabChange={setFocusTab}
                    focusGas={focusGas}
                    onFocusGasChange={setFocusGas}
                    focusDevices={focusDevices}
                    onFocusDevicesChange={setFocusDevices}
                    focusGaSearch={focusGaSearch}
                    onFocusGaSearchChange={setFocusGaSearch}
                    focusDeviceSearch={focusDeviceSearch}
                    onFocusDeviceSearchChange={setFocusDeviceSearch}
                    focusGaCompact={focusGaCompact}
                    onFocusGaCompactChange={setFocusGaCompact}
                    focusDeviceCompact={focusDeviceCompact}
                    onFocusDeviceCompactChange={setFocusDeviceCompact}
                    focusGaVerdichten={focusGaVerdichten}
                    onFocusGaVerdichtenChange={setFocusGaVerdichten}
                    focusDeviceVerdichten={focusDeviceVerdichten}
                    onFocusDeviceVerdichtenChange={setFocusDeviceVerdichten}
                    lastSeenGas={lastSeenGas}
                    onLastSeenGasChange={setLastSeenGas}
                    visualizedGas={selectedVisualizationTargets}
                    onVisualizedGasChange={setSelectedVisualizationTargets}
                    visualizedDevices={visualizedDevices}
                    onVisualizedDevicesChange={setVisualizedDevices}
                    lastSeenDevices={lastSeenDevices}
                    onLastSeenDevicesChange={setLastSeenDevices}
                    focusFilterGas={focusFilterGas}
                    onFocusFilterGasChange={setFocusFilterGas}
                    focusFilterDevices={focusFilterDevices}
                    onFocusFilterDevicesChange={setFocusFilterDevices}
                  />
              </ResizablePane>

              {/* Content body */}
              <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                {isSendOpen && serverConfig?.status?.write_enabled && (
                  <WriteToBusPanel
                    targets={filterOptions.targets}
                    onClose={() => setSendPanelOpen(false)}
                    latestTelegram={latestTelegram}
                  />
                )}
                {showViewHeader && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                    height: 40, boxSizing: 'border-box', padding: '0 0.75rem 0 0', flexShrink: 0,
                    borderBottom: '1px solid var(--border-color)',
                  }}>
                    <div style={{
                      display: 'flex', alignItems: 'center',
                      padding: '0.1rem', borderRadius: '0 8px 8px 0',
                      background: 'var(--bg-subtle)',
                      border: '1px solid var(--border-color)', borderLeft: 'none',
                    }}>
                      <button
                        className="icon-button"
                        onClick={() => setIsFilterOpen(o => !o)}
                        title="Toggle filter panel"
                        style={{
                          position: 'relative',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          padding: '0.28rem', borderRadius: '6px',
                          color: isFilterOpen || (hasActiveFilters(appliedFilters) && filtersEnabled) ? 'var(--accent-primary)' : 'var(--text-dim)',
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
                    </div>
                    <span
                      aria-hidden
                      style={{ width: '1px', height: '1.1rem', flexShrink: 0, background: 'var(--border-color)' }}
                    />
                    <PanelSwitch
                        panels={VIEW_PANELS}
                        compact
                        active={activePanel}
                        onChange={(p) => {
                          setStatusDevice(null);
                          setActivePanel(p);
                          setIsDatabaseOpen(false);
                          if (p === 'visualizer' || p === 'lastseen') {
                            setPanelView('focus');
                            setIsFilterOpen(true);
                            if (p === 'visualizer') setFocusTab('ga');
                          }
                        }}
                      />
                    <span
                      aria-hidden
                      style={{ width: '1px', height: '1.1rem', flexShrink: 0, background: 'var(--border-color)' }}
                    />
                    {activePanel === 'list' && (
                      <div style={{ fontWeight: 600, fontSize: '0.875rem', flexShrink: 0 }}>Telegram List</div>
                    )}
                    <div
                      ref={assignViewHeaderSlot}
                      style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '0.65rem', minWidth: 0, overflow: 'hidden' }}
                    />
                  </div>
                )}
                {isVisualizerOpen ? (
                  <Visualizer
                    // The main filter applies to the telegram list only; the
                    // Visualization Targets list every GA in the buffer (#361).
                    telegrams={liveTelegrams}
                    selectedTargets={selectedVisualizationTargets}
                    onTargetsChange={setSelectedVisualizationTargets}
                    onClose={() => setActivePanel('list')}
                    zoomRange={zoomRange}
                    onZoomRangeChange={setZoomRange}
                    onTimeClick={handleChartTimeClick}
                    writeEnabled={serverConfig?.status?.write_enabled}
                    onShowGaTelegrams={handleShowGaTelegrams}
                    onLastSeen={handleQuickLastSeen}
                    headerSlot={viewHeaderSlot}
                  />
                ) : isLastSeenOpen ? (
                  <LastSeenOverlay
                    filterOptions={filterOptions}
                    visibleColumns={visibleColumns}
                    gaAddresses={lastSeenGas}
                    deviceAddresses={lastSeenDevices}
                    group={lastSeenGroup}
                    onGroupChange={setLastSeenGroup}
                    expanded={lastSeenExpanded}
                    onExpandedChange={setLastSeenExpanded}
                    onFocusFilter={toggleFocusMembership}
                    focusGas={focusGas}
                    focusDevices={focusDevices}
                    onQuickVisualize={handleQuickVisualize}
                    onQuickVisualizeSource={handleVisualizeDevice}
                    onQuickLastSeen={handleQuickLastSeen}
                    canSend={serverConfig?.status?.write_enabled}
                    telegrams={liveTelegrams}
                    highlightedKeys={highlightedTelegramKeys}
                    onHighlightedKeysChange={setHighlightedTelegramKeys}
                    onGotoTelegram={handleGotoTelegram}
                    onClose={() => setActivePanel('list')}
                    headerSlot={viewHeaderSlot}
                    limit={lastSeenLimit}
                    onLimitChange={setLastSeenLimit}
                    autoRefresh={lastSeenLive}
                    onAutoRefreshChange={setLastSeenLive}
                  />
                ) : isStatisticsOpen ? (
                  <StatisticsOverlay
                    filterOptions={filterOptions}
                    onClose={() => setActivePanel('list')}
                    searchQuery={statsSearch}
                    onSearchQueryChange={setStatsSearch}
                  />
                ) : isBuildingOpen && statusDevice ? (
                  <DeviceStatusOverlay
                    device={statusDevice}
                    latestTelegram={latestTelegram}
                    onClose={() => setStatusDevice(null)}
                    onLastSeen={handleQuickLastSeen}
                    onFocusFilter={toggleFocusMembership}
                    focusGas={focusGas}
                    focusDevices={focusDevices}
                  />
                ) : isBuildingOpen ? (
                  <BuildingOverlay
                    onClose={() => setActivePanel('list')}
                    onFilterDevice={(pa, gesture = PLAIN_TOGGLE) => toggleFocusMembership(pa, 'pa', gesture)}
                    onFilterGAs={toggleFocusGroup}
                    onLastSeen={handleQuickLastSeen}
                    onVisualizeGAs={handleVisualizeGAs}
                    onFocusFilter={toggleFocusMembership}
                    focusFilterGas={focusGas}
                    focusDevices={focusDevices}
                    onDeviceStatus={setStatusDevice}
                    writeEnabled={serverConfig?.status?.write_enabled}
                    latestTelegram={latestTelegram}
                    searchQuery={buildingSearch}
                    onSearchQueryChange={setBuildingSearch}
                  />
                ) : isDatabaseOpen ? (
                  <DatabaseOverlay onClose={() => setIsDatabaseOpen(false)} />
                ) : (
                    <TelegramTable
                    telegrams={filteredLiveTelegrams}
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
                    onFilterFocusedSourcesChange={setFilterFocusedSources}
                    filterFocusedTargets={filterFocusedTargets}
                    onFilterFocusedTargetsChange={setFilterFocusedTargets}
                    onQuickVisualize={handleQuickVisualize}
                    onQuickVisualizeSource={handleVisualizeDevice}
                    onQuickLastSeen={handleQuickLastSeen}
                    onFocusAddressFilter={toggleFocusFilter}
                    lastSeenGas={lastSeenGas}
                    lastSeenDevices={lastSeenDevices}
                    visualizedGas={selectedVisualizationTargets}
                    visualizedDevices={visualizedDevices}
                    canSend={serverConfig?.status?.write_enabled}
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
                    listFollow={listFollow}
                    onListFollowChange={setListFollow}
                    onVisibleSpanChange={onVisibleSpanChange}
                    listAnchorKey={listAnchorKey}
                    onListAnchorKeyChange={handleListAnchorKeyChange}
                    listAnchorAlign={listAnchorAlign}
                    markedKeys={markedTelegramKeys}
                    onMarkedKeysChange={setMarkedTelegramKeys}
                    lastMarkedKey={lastMarkedTelegramKey}
                    onLastMarkedKeyChange={setLastMarkedTelegramKey}
                    highlightedKeys={highlightedTelegramKeys}
                    onHighlightedKeysChange={setHighlightedTelegramKeys}
                    flaggedKeys={flaggedTelegramKeys}
                    onFlaggedKeysChange={setFlaggedTelegramKeys}
                    contextForAllMatches={contextForAllMatches}
                    onContextForAllMatchesChange={setContextForAllMatches}
                    contextKeys={contextTelegramKeys}
                    infoBarOpen={infoBarOpen}
                    onInfoBarOpenChange={setInfoBarOpen}
                  />
                )}
              </div>
            </div>
          </div>
        ) : activeTab === 'import' ? (
          <ImportExportView />
        ) : (
          <HistorySearch
            visibleColumns={visibleColumns}
            loadLimit={loadLimit}
            filterOptions={filterOptions}
            activeFilters={activeFilters}
            onFiltersChange={handleFiltersChange}
            onOpenSettings={() => setIsSettingsOpen(true)}
            projectLoaded={projectStatus?.project_loaded}
            selectedVisualizationTargets={selectedVisualizationTargets}
            onVisualizationTargetsChange={setSelectedVisualizationTargets}
            initialView={initialView}
            filtersEnabled={filtersEnabled}
            onFiltersEnabledChange={setFiltersEnabled}
            filterSearch={filterSearch}
            onFilterSearchChange={setFilterSearch}
            filterCompact={filterCompact}
            onFilterCompactChange={setFilterCompact}
            filterCheckedOnly={filterCheckedOnly}
            onFilterCheckedOnlyChange={setFilterCheckedOnly}
            panelView={panelView}
            onPanelViewChange={setPanelView}
            focusTab={focusTab}
            onFocusTabChange={setFocusTab}
            focusGas={focusGas}
            onFocusGasChange={setFocusGas}
            focusDevices={focusDevices}
            onFocusDevicesChange={setFocusDevices}
            focusGaSearch={focusGaSearch}
            onFocusGaSearchChange={setFocusGaSearch}
            focusDeviceSearch={focusDeviceSearch}
            onFocusDeviceSearchChange={setFocusDeviceSearch}
            focusGaCompact={focusGaCompact}
            onFocusGaCompactChange={setFocusGaCompact}
            focusDeviceCompact={focusDeviceCompact}
            onFocusDeviceCompactChange={setFocusDeviceCompact}
            focusGaVerdichten={focusGaVerdichten}
            onFocusGaVerdichtenChange={setFocusGaVerdichten}
            focusDeviceVerdichten={focusDeviceVerdichten}
            onFocusDeviceVerdichtenChange={setFocusDeviceVerdichten}
            lastSeenGas={lastSeenGas}
            onLastSeenGasChange={setLastSeenGas}
            lastSeenDevices={lastSeenDevices}
            onLastSeenDevicesChange={setLastSeenDevices}
            visualizedGas={selectedVisualizationTargets}
            onVisualizedGasChange={setSelectedVisualizationTargets}
            visualizedDevices={visualizedDevices}
            onVisualizedDevicesChange={setVisualizedDevices}
            focusFilterGas={focusFilterGas}
            onFocusFilterGasChange={setFocusFilterGas}
            focusFilterDevices={focusFilterDevices}
            onFocusFilterDevicesChange={setFocusFilterDevices}
            filterFocusedSources={filterFocusedSources}
            onFilterFocusedSourcesChange={setFilterFocusedSources}
            filterFocusedTargets={filterFocusedTargets}
            onFilterFocusedTargetsChange={setFilterFocusedTargets}
            dbCounts={dbCounts}
            onOpenLastSeen={() => openPanel('lastseen')}
            writeEnabled={serverConfig?.status?.write_enabled}
          />
        )}
      </main>

      {isHistoryLoaderOpen && (
        <HistoryLoader
          onClose={() => setIsHistoryLoaderOpen(false)}
          onAsyncLoad={(range) => {
            // Fire-and-forget: the modal closes and the header chip shows
            // progress; cached sub-ranges appear instantly (#222).
            const { startMs, endMs } = rangeToMs(range);
            void loadRange(startMs, endMs);
          }}
          limit={loadLimit}
          mode="monitor"
        />
      )}

      {isUploadWizardOpen && (
        <ProjectUploadWizard
          isClosable={!projectStatus?.upload_required}
          onClose={() => setIsUploadWizardOpen(false)}
          onSuccess={() => {
            setIsUploadWizardOpen(false);
            window.location.reload();
          }}
        />
      )}

      {isKeysWizardOpen && (
        <KeysUploadWizard
          onClose={() => setIsKeysWizardOpen(false)}
          onSuccess={() => {
            setIsKeysWizardOpen(false);
            // Refresh server config to show updated status
            fetch(apiUrl('/api/server/config'))
              .then(r => r.json())
              .then(data => setServerConfig(data))
              .catch(() => {});
            fetch(apiUrl('/api/knxkeys/status'))
              .then(r => r.json())
              .then(data => setKnxkeysStatus(data))
              .catch(() => {});
          }}
        />
      )}

      {showUpdate && updateInfo && (
        <UpdateNotification
          info={updateInfo}
          onClose={() => {
            if (updateInfo.latest) setPref(DISMISSED_UPDATE_PREF, updateInfo.latest);
            setUpdateClosed(true);
            setIsUpdateOpen(false);
          }}
        />
      )}

      <style>{`
        .nav-item { display: flex; align-items: center; gap: 0.75rem; padding: 0.75rem 1rem; border-radius: 8px; border: none; background: transparent; color: var(--text-dim); cursor: pointer; font-weight: 500; transition: all 0.2s ease; width: 100%; text-align: left; }
        .nav-item:hover { background: var(--bg-hover); color: var(--text-main); }
        .nav-item.active { background: rgba(99,102,241,0.1); color: var(--accent-primary); }
        .icon-button { background: transparent; border: none; cursor: pointer; color: var(--text-dim); transition: all 0.2s; }
        .chip-spinner { width: 12px; height: 12px; border: 2px solid rgba(99,102,241,0.2); border-top-color: var(--accent-primary); border-radius: 50%; animation: chip-spin 0.8s linear infinite; display: inline-block; }
        @keyframes chip-spin { to { transform: rotate(360deg); } }
        .icon-button:hover { color: var(--text-main); transform: scale(1.1); }
        .setting-item { display: flex; align-items: center; gap: 0.6rem; background: transparent; border: none; color: var(--text-main); cursor: pointer; width: 100%; padding: 0.35rem 0; text-align: left; }
        .checkbox.checked { background: var(--accent-primary); border-color: var(--accent-primary); }
        .sort-header { background: transparent; border: none; color: inherit; text-transform: inherit; letter-spacing: inherit; font-size: inherit; font-weight: inherit; cursor: pointer; display: flex; align-items: center; gap: 0.25rem; padding: 0; }
        .mono-addr { font-family: 'JetBrains Mono', monospace; font-size: 0.8125rem; }
        .highlight { color: var(--text-dim); }
        .highlight-target { color: var(--accent-primary); font-weight: 500; }
        .subtitle-name { font-size: 0.7rem; color: var(--text-dim); margin-top: 0.15rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .raw-badge { background: var(--bg-tag); padding: 0.15rem 0.4rem; border-radius: 3px; font-family: 'JetBrains Mono', monospace; font-size: 0.65rem; color: var(--text-dim); display: inline-block; border: 1px solid var(--border-subtle); }
      `}</style>
    </div>
    </AddressActionProvider>
  );
}

export default App;
