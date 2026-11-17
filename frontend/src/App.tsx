import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from 'react';
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
import { BufferStatusPill } from './components/BufferStatusPill';
import { TelegramTable, type SortConfig, type SortKey, type ListGotoRequest } from './components/TelegramTable';
import { anchorKey } from './utils/anchorKey';
import type { MarkColorIndexMap } from './utils/markColors';
import { readSortConfigPref, writeSortConfigPref, toggleSortLevel } from './utils/sortConfig';
import {
  deriveMonitorView,
  normalizeMonitorView,
  resolveMonitorStartup,
  writeMonitorViewPref,
  type MonitorPauseMode,
  type MonitorView,
} from './utils/monitorView';
import { deriveLiveTelegramView, type LiveTelegramView } from './utils/liveTelegramView';
import { pinnedVisibleKeys } from './utils/selectVisibleTelegrams';
import { activeQuickFilter } from './utils/quickFilter';
import { backlogStatusCount, bufferBacklogCounts, statusViewRowCount } from './utils/telegramDisplay';
import { classifyGotoTarget, enterForward, gotoWindow, nextJumpTargets, parkOnFixedY } from './utils/gotoTarget';
import { GotoBufferProvider } from './components/GotoBufferContext';
import { LayoutDashboard, History, Settings, SlidersHorizontal, LineChart, BarChart2, Building2, Database, ChevronDown, Sun, Moon, Monitor, FolderInput, Send, Sparkles, Clock, List } from 'lucide-react';
import { getPref, setPref } from './utils/prefs';
import { HISTORY_LOAD_LIMIT_PREF, MONITOR_LOAD_LIMIT_PREF, readLoadLimit } from './utils/loadLimitPref';
import { getLabel, getFileName } from './utils/labels';
import { useTheme } from './hooks/useTheme';
import { apiUrl, wsUrl } from './utils/basePath';
import { HistoryLoader } from './components/HistoryLoader';
import {
  useTelegramCache,
  clampMonitorPageSize,
  MONITOR_PAGE_SIZE_DEFAULT,
  MONITOR_PAGE_SIZE_MIN,
  MONITOR_PAGE_SIZE_MAX,
} from './hooks/useTelegramCache';
import {
  pauseModeForListFollow,
  pauseModeForToggle,
  cachePausedForMode,
} from './utils/bufferPauseMode';
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
import {
  WriteToBusPanel,
  type CtrlSendRequest,
  type SendPanelCommand,
  type LinkedRowStatus,
} from './components/WriteToBusPanel';
import {
  correspondenceKeyFromDraft,
  type SendCorrespondenceKey,
} from './utils/sendCorrespondence';
import type { BusPayload } from './utils/dptValues';
import { DptCatalogProvider } from './components/DptCatalogContext';
import { GaReadPhaseProvider } from './components/GaReadPhase';
import { UpdateNotification } from './components/UpdateNotification';
import { LegacyTimestampBanner } from './components/LegacyTimestampBanner';
import { LoginScreen } from './components/LoginScreen';
import { AuthSettings } from './components/AuthSettings';
import { useAuthStatus, loginRequired } from './hooks/useAuthStatus';
import { useUpdateCheck } from './hooks/useUpdateCheck';
import {
  DEFAULT_FILTERS,
  hasActiveFilters,
  enabledFilters,
  matchesTelegram,
  pruneDisabled,
  countSelections,
  type ActiveFilters,
  type FilterOptions,
} from './types/filters';

declare const __APP_VERSION__: string;

// Remembers the latest version the user already dismissed, so the popup shows
// once per new release rather than on every load.
const DISMISSED_UPDATE_PREF = 'dismissed_update_version';

const EMPTY_FILTER_OPTIONS: FilterOptions = { sources: [], targets: [], types: [], dpts: [], ga_group_names: {}, pa_line_names: {} };

const NavDropdown = ({ activeTab, isSettingsOpen, isDatabaseOpen, onChange }: { activeTab: string; isSettingsOpen: boolean; isDatabaseOpen: boolean; onChange: (id: string) => void }) => {
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
  { id: 'statistics', label: 'Statistics', icon: BarChart2 },
  { id: 'building', label: 'Building Structure', icon: Building2 },
  { id: 'lastseen', label: 'Last Seen Values', icon: Clock },
];

// Segmented switch across the five main panels, marking the active one (#374).
const PanelSwitch = ({ active, onChange }: { active: MainPanel; onChange: (p: MainPanel) => void }) => (
  <div
    role="tablist"
    aria-label="Main panel"
    style={{
      display: 'flex', alignItems: 'center', gap: '0.15rem',
      padding: '0.2rem', borderRadius: '8px',
      background: 'var(--bg-subtle)', border: '1px solid var(--border-color)',
    }}
  >
    {MAIN_PANELS.map(({ id, label, icon: Icon }) => {
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
            padding: '0.4rem', borderRadius: '6px',
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
  // URL wins over the preference for direction, anchor and range. Follow and
  // pause mode always come from the preference. Embedded mode ignores the URL.
  const [initialMonitor] = useState(() => {
    const embedded = isEmbedded();
    const url = initialView || embedded || !initialWorkspace
      ? null
      : {
          direction: initialWorkspace.readDirection,
          anchorTs: initialWorkspace.anchorTs,
          rangeMinutes: initialWorkspace.rangeMinutes,
        };
    return resolveMonitorStartup({ embedded, url });
  });
  const [monitorView, setMonitorView] = useState<MonitorView>(initialMonitor.view);
  const readDirection = monitorView.direction;
  // Chevron keeps the current rows and only swaps the spacers. Every other
  // direction change rebuilds the list onto the anchor.
  const [directionGesture, setDirectionGesture] = useState<'chevron' | 'rebuild'>('rebuild');
  const listFollow = monitorView.follow;
  const pauseMode = monitorView.pauseMode;
  const [quickFilterOpen, setQuickFilterOpen] = useState(initialUiState.quickFilter.open);
  const [quickFilterEnabled, setQuickFilterEnabled] = useState(initialUiState.quickFilter.enabled);
  const [quickPatterns, setQuickPatterns] = useState(initialUiState.quickFilter.patterns);
  const [quickColumnEnabled, setQuickColumnEnabled] = useState(initialUiState.quickFilter.columnEnabled);
  const [listAnchorKey, setListAnchorKey] = useState<string | null>(initialUiState.listAnchorKey);
  const [infoBarOpen, setInfoBarOpen] = useState(initialUiState.infoBarOpen);
  const [zoomRange, setZoomRange] = useState<[number, number] | null>(initialUiState.zoomRange);
  const [statsSearch, setStatsSearch] = useState(initialUiState.statsSearch);
  const [buildingSearch, setBuildingSearch] = useState(initialUiState.buildingSearch);
  const [lastSeenLimit, setLastSeenLimit] = useState(initialUiState.lastSeenLimit);
  const [lastSeenLive, setLastSeenLive] = useState(initialUiState.lastSeenLive);
  const [lastSeenSearch, setLastSeenSearch] = useState(initialUiState.lastSeenSearch);
  // Master enable/disable of the filter set (#370): when off the list shows all
  // telegrams while activeFilters is preserved.
  const [filtersEnabled, setFiltersEnabled] = useState(initialUiState.filtersEnabled);
  // Bumped when the main filter set changes the telegram list — TT pins + flashes.
  const [ttViewChangeToken, setTtViewChangeToken] = useState(0);
  const noteTtViewChange = useCallback(() => setTtViewChangeToken(n => n + 1), []);
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
  const [isSendOpen, setIsSendOpen] = useState(false);
  /** GAs currently present in the send panel (TT send-icon opaque/blue; panel visibility irrelevant). */
  const [sendPanelAddresses, setSendPanelAddresses] = useState<ReadonlySet<string>>(() => new Set());
  /** Ctrl-click send-icon request consumed by WriteToBusPanel (clear or insert top row). */
  const [ctrlSendRequest, setCtrlSendRequest] = useState<CtrlSendRequest | null>(null);
  const ctrlSendNonceRef = useRef(0);
  /** Popover ↔ panel schedule correspondence. */
  const [sendPanelCommand, setSendPanelCommand] = useState<SendPanelCommand | null>(null);
  const sendPanelCmdNonceRef = useRef(0);
  const [popoverLinkedRowId, setPopoverLinkedRowId] = useState<string | null>(null);
  const [linkedRowStatuses, setLinkedRowStatuses] = useState<Record<string, LinkedRowStatus>>({});
  const [gaJobStatuses, setGaJobStatuses] = useState<Record<string, LinkedRowStatus>>({});
  const activeSendJobAddresses = useMemo(
    () => new Set(Object.keys(gaJobStatuses)),
    [gaJobStatuses],
  );
  const pendingEnsureRef = useRef<{
    nonce: number;
    kind: 'write' | 'read';
    payload?: BusPayload;
    response?: boolean;
  } | null>(null);
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
  const [monitorLoadLimit, setMonitorLoadLimit] = useState(() => readLoadLimit(MONITOR_LOAD_LIMIT_PREF));
  const [historyLoadLimit, setHistoryLoadLimit] = useState(() => readLoadLimit(HISTORY_LOAD_LIMIT_PREF));
  const [monitorPageSize, setMonitorPageSize] = useState(() => {
    const raw = getPref('monitorPageSize');
    if (raw == null || raw.trim() === '') return MONITOR_PAGE_SIZE_DEFAULT;
    const n = Number(raw);
    return Number.isFinite(n) ? clampMonitorPageSize(n) : MONITOR_PAGE_SIZE_DEFAULT;
  });
  const [bufferRangeMinutes, setBufferRangeMinutes] = useState(initialMonitor.rangeMinutes);
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

  // ── Live State ──────────────────────────────────────────────────────────────
  // Buffer + IndexedDB cache + coverage bookkeeping (#246): cached telegrams
  // reappear instantly after a reload and only the gaps are fetched (#211).
  const {
    telegrams: liveTelegrams,
    ingested: ingestedTelegrams,
    addLive,
    setConnected: setCacheConnected,
    setPaused: setCachePaused,
    pausedCount,
    pausedTelegrams,
    revealPaused,
    loadRange,
    fillForwardFrom,
    oldestTs: bufferOldestTs,
    newestTs: bufferNewestTs,
    isLoading: isHistoryLoading,
    loadError: historyLoadError,
    clear: clearTelegrams,
    cancelLoad,
    setEvictionMode,
    bufferAnchor,
    setBufferAnchor,
    adoptAnchorDirection,
    setBufferRangeMinutes: setCacheRangeMinutes,
    enforceTimeWindow,
    retainPausedInWindow,
    publishBuffer,
    covered: coveredIntervals,
    readingEnd,
  } = useTelegramCache(
    monitorLoadLimit,
    // An explicit anchor loads through fillAnchorWindow instead of the
    // newest-first startup restore. The hook reads this flag once.
    restoreOnStartup && initialMonitor.view.anchorTs == null,
    monitorPageSize,
  );
  // Live-trim policy for handleTelegram (declared before filters; synced below).
  const liveTrimRef = useRef({
    pauseMode: 'playing' as MonitorPauseMode,
    readDirection: 'backward' as 'forward' | 'backward',
    rangeMinutes: 60,
    filters: DEFAULT_FILTERS as ActiveFilters,
    filtersEnabled: true,
  });
  liveTrimRef.current.pauseMode = pauseMode;
  liveTrimRef.current.readDirection = readDirection;
  liveTrimRef.current.rangeMinutes = bufferRangeMinutes;
  // Popstate reads the latest window and loaders. Filled in an effect below,
  // after those callbacks exist, so render does not touch the refs.
  const monitorWindowRef = useRef<{
    direction: 'forward' | 'backward';
    anchorTs: number | null;
    rangeMinutes: number;
  } | null>(null);
  const monitorActionsRef = useRef<{
    fillAnchor: (dir: 'forward' | 'backward', ts: number, rangeMinutes?: number) => Promise<void>;
    adoptAnchorDirection: typeof adoptAnchorDirection;
    setBufferAnchor: typeof setBufferAnchor;
    setEvictionMode: typeof setEvictionMode;
  } | null>(null);
  // Snapshot frozen in auto/manual while reading backward. Forward never
  // freezes: new rows appear when the buffer's own window admits them.
  // Flush moves mode to playing without necessarily enabling live-follow
  // (edge flush keeps the viewport + pill).
  const isPaused = readDirection === 'backward'
    && pauseMode !== 'off'
    && cachePausedForMode(pauseMode);
  const applyCachePause = useCallback((paused: boolean) => {
    setCachePaused(readDirection === 'backward' && paused);
  }, [readDirection, setCachePaused]);
  // Popover, send panel, and list READ color follow the full buffer, including
  // telegrams still sitting in the pause backlog.

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
  const handleFiltersEnabledChange = useCallback((enabled: boolean) => {
    setFiltersEnabled(enabled);
    noteTtViewChange();
  }, [noteTtViewChange]);

  const handleFiltersChange = useCallback((newFilters: ActiveFilters | ((prev: ActiveFilters) => ActiveFilters)) => {
    // Every change passes through here, so a removed entry also loses its
    // switched-off marker (#437) and cannot come back switched off later.
    setActiveFilters(prev => pruneDisabled(typeof newFilters === 'function' ? newFilters(prev) : newFilters));
    noteTtViewChange();
  }, [noteTtViewChange]);
  // The filters in effect: selections minus the ones switched off (#437).
  const appliedFilters = useMemo(() => enabledFilters(activeFilters), [activeFilters]);
  liveTrimRef.current.filters = activeFilters;
  liveTrimRef.current.filtersEnabled = filtersEnabled;

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

    // While playing backward, enforce the minute window when a filter-matching
    // telegram arrives. Forward has no live trim; admission stays in the cache.
    const pol = liveTrimRef.current;
    if (pol.readDirection === 'forward' || pol.pauseMode !== 'playing') return;
    const filters = enabledFilters(pol.filters);
    const filterOn = pol.filtersEnabled && hasActiveFilters(filters);
    if (filterOn && !matchesTelegram(t, filters)) return;
    enforceTimeWindow(pol.readDirection, pol.rangeMinutes);
  }, [addLive, enforceTimeWindow]);

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
    setPref(MONITOR_LOAD_LIMIT_PREF, monitorLoadLimit.toString());
    setPref(HISTORY_LOAD_LIMIT_PREF, historyLoadLimit.toString());
    setPref('monitorPageSize', String(monitorPageSize));
    setPref('bufferRangeMinutes', String(bufferRangeMinutes));
    setPref('visibleColumns', JSON.stringify(visibleColumns));
    setPref('rateMode', rateMode);
    setPref('restoreOnStartup', String(restoreOnStartup));
  }, [monitorLoadLimit, historyLoadLimit, monitorPageSize, bufferRangeMinutes, visibleColumns, rateMode, restoreOnStartup]);

  useEffect(() => {
    // Disk matches the forward form even when a timestamped switch left a
    // backward pause mode in memory for a later return to backward.
    writeMonitorViewPref(
      monitorView.direction === 'forward' ? normalizeMonitorView(monitorView) : monitorView,
    );
  }, [monitorView]);

  // Eviction and the live admission window follow the view. An explicit anchor
  // is pushed into the cache by the action that set it (and once at startup);
  // adopting the direction here would clear that timestamp. A null anchor
  // keeps the buffer edge, and adopt leaves an unchanged direction's cursor.
  useEffect(() => {
    setEvictionMode(readDirection === 'forward' ? 'keepOldest' : 'keepNewest');
    setCacheRangeMinutes(bufferRangeMinutes);
    if (monitorView.anchorTs == null) adoptAnchorDirection(readDirection);
  }, [readDirection, bufferRangeMinutes, monitorView.anchorTs, setEvictionMode, adoptAnchorDirection, setCacheRangeMinutes]);

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
      lastSeenAddresses,
      lastSeenMode,
      readDirection,
      anchorTs: monitorView.anchorTs,
      rangeMinutes: bufferRangeMinutes,
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
  }, [initialView, activeTab, workspaceView, isFilterOpen, activeFilters, selectedVisualizationTargets, lastSeenAddresses, lastSeenMode, readDirection, monitorView.anchorTs, bufferRangeMinutes]);

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
      // An overlay left open would hide the workspace just navigated to.
      setIsSettingsOpen(false);
      const cur = monitorWindowRef.current;
      const sameWindow = cur != null
        && cur.direction === ws.readDirection
        && cur.anchorTs === ws.anchorTs
        && cur.rangeMinutes === ws.rangeMinutes;
      setMonitorView(prev => normalizeMonitorView(
        prev.direction === ws.readDirection && prev.anchorTs === ws.anchorTs
          ? prev
          : { ...prev, direction: ws.readDirection, anchorTs: ws.anchorTs },
      ));
      if (cur != null && cur.direction !== ws.readDirection) setDirectionGesture('rebuild');
      setBufferRangeMinutes(ws.rangeMinutes);
      if (sameWindow) return;
      // Back/Forward restores the window the URL names. Follow and pause stay.
      const act = monitorActionsRef.current;
      if (act == null) return;
      act.setEvictionMode(ws.readDirection === 'forward' ? 'keepOldest' : 'keepNewest');
      if (ws.anchorTs == null) {
        act.adoptAnchorDirection(ws.readDirection);
        return;
      }
      act.setBufferAnchor({ direction: ws.readDirection, ts: ws.anchorTs });
      void act.fillAnchor(ws.readDirection, ws.anchorTs, ws.rangeMinutes);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [initialView]);

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
  // Playing → Pause latches as manual. While paused, the Pause icon toggles
  // auto ↔ manual (stays frozen). Manual→Auto keeps the backlog in the pause
  // buffer; the table fills the fill-spacer with its oldest row and feeds the
  // rest in as the user scrolls toward the live edge. An empty buffer disables
  // the pause toggle. A clear leaves play/pause as it was. Resume via the newer pill while
  // auto-paused, Ctrl-click on that pill while manually paused, or an auto
  // edge-flush / follow-while-auto. A plain pill click keeps manual pause and
  // publishes the backlog so the view can land on the newest telegram.
  const bufferEmpty = liveTelegrams.length === 0;
  const togglePause = () => {
    if (readDirection !== 'backward' || bufferEmpty || pauseMode === 'off') return;
    const next = pauseModeForToggle(pauseMode);
    if (pauseMode === 'manual' && next === 'auto') {
      setMonitorView(v => ({ ...v, follow: false, pauseMode: 'auto' }));
      return;
    }
    setMonitorView(v => ({ ...v, pauseMode: next, follow: next === 'auto' ? false : v.follow }));
    // Sync cache in the same turn so the pill does not see isPaused flip
    // before publish/pausedCount update.
    applyCachePause(cachePausedForMode(next));
  };

  // Status icon: Play=running, Pause=frozen; color separates auto vs manual.
  const pauseTitle =
    pauseMode === 'playing' ? 'Playing'
    : pauseMode === 'auto' ? 'Paused automatically'
    : 'Paused manually';
  const pauseColor =
    pauseMode === 'playing' ? 'var(--success)'
    : pauseMode === 'auto' ? 'var(--text-dim)'
    : 'var(--accent-primary)';

  const flushPauseBuffer = useCallback(() => {
    if (readDirection !== 'backward' || pauseMode !== 'auto') return;
    setMonitorView(v => ({ ...v, pauseMode: 'playing' }));
    applyCachePause(false);
  }, [readDirection, pauseMode, applyCachePause]);

  // Metered flush: reveal the oldest `n` backlog rows while staying auto-paused,
  // so the table can scroll them in line by line. Once that backlog is gone the
  // mode returns to playing (same as a full flush). A plain newer-pill click
  // while manually paused reveals the whole backlog and stays paused.
  const revealPauseBuffer = useCallback((n: number) => {
    if (readDirection !== 'backward' || pauseMode === 'playing' || pauseMode === 'off') return;
    const remaining = revealPaused(n);
    if (pauseMode === 'auto' && remaining <= 0) {
      setMonitorView(v => ({ ...v, pauseMode: 'playing' }));
      applyCachePause(false);
    }
  }, [readDirection, pauseMode, revealPaused, applyCachePause]);

  // Newer-pill resume. The table only calls this for auto-pause and for a
  // Ctrl-click during manual pause; a plain click stays latched.
  const jumpToLiveResume = useCallback(() => {
    if (readDirection !== 'backward') return;
    setMonitorView(v => ({ ...v, pauseMode: 'playing', follow: true }));
    applyCachePause(false);
  }, [readDirection, applyCachePause]);

  // Couple list live-follow to pause mode in the same turn as follow changes
  // (table scroll unfollow, chart jump, etc.) — avoid syncing via an effect.
  const handleListFollowChange = useCallback((follow: boolean) => {
    if (readDirection !== 'backward') return;
    setMonitorView(prev => ({
      ...prev,
      follow,
      pauseMode: pauseModeForListFollow(prev.pauseMode === 'off' ? 'auto' : prev.pauseMode, follow),
    }));
  }, [readDirection]);

  useLayoutEffect(() => {
    applyCachePause(isPaused);
  }, [isPaused, applyCachePause]);

  const toggleColumn = (col: string) =>
    setVisibleColumns(prev => ({ ...prev, [col]: !prev[col] }));

  // ── Telegram list flags (#310) ─────────────────────────────────────────────
  // Lifted above the conditionally-rendered panels so they survive main-panel
  // navigation. Marked and mouse selection restore from the ui session. Goto
  // and last-selected are live only.
  const [telegramMarkedKeys, setTelegramMarkedKeys] = useState<string[]>(
    () => initialUiState.markedKeys,
  );
  const [telegramMouseSelectedKeys, setTelegramMouseSelectedKeys] = useState<string[]>(
    () => initialUiState.mouseSelectedKeys,
  );
  const [telegramHiddenKeys, setTelegramHiddenKeys] = useState<string[]>(
    () => initialUiState.hiddenKeys,
  );
  const [telegramMarkColorIndices, setTelegramMarkColorIndices] = useState<MarkColorIndexMap>(
    () => initialUiState.markColorIndices,
  );
  const [lastSelectedTelegramKey, setLastSelectedTelegramKey] = useState<string | null>(null);
  // Write-to-bus "go to": center this telegram in the list. The table selects
  // it when that exact telegram is in the buffer.
  const listGotoSeq = useRef(0);
  const [listGoto, setListGoto] = useState<ListGotoRequest | null>(null);
  /** Rows a goto landed on. Force-visible, not marks and not context flags. */
  const [jumpTargetKeys, setJumpTargetKeys] = useState<string[]>([]);
  const loadOutsideGotoRef = useRef<(ms: number) => Promise<void>>(async () => {});

  // ── Per-message Time-Delta-Context flags ────────────────────────────────────
  // Same lifting rationale as marks. A side flag anchors that side's
  // quick-filter window. The row stays visible only when it matches, is
  // pinned, or is context of a visible flagged row.
  const [flaggedBeforeKeys, setFlaggedBeforeKeys] = useState<string[]>(
    () => initialUiState.flaggedBeforeKeys,
  );
  const [flaggedAfterKeys, setFlaggedAfterKeys] = useState<string[]>(
    () => initialUiState.flaggedAfterKeys,
  );

  // ── Persist UI Session State (#341) ──────────────────────────────────────────
  useEffect(() => {
    const handle = setTimeout(() => {
      saveUiState({
        quickFilter: {
          open: quickFilterOpen,
          enabled: quickFilterEnabled,
          patterns: quickPatterns,
          columnEnabled: quickColumnEnabled,
        },
        listAnchorKey,
        infoBarOpen,
        zoomRange,
        statsSearch,
        buildingSearch,
        lastSeenLimit,
        lastSeenLive,
        lastSeenSearch,
        filtersEnabled,
        markedKeys: telegramMarkedKeys,
        mouseSelectedKeys: telegramMouseSelectedKeys,
        hiddenKeys: telegramHiddenKeys,
        markColorIndices: telegramMarkColorIndices,
        flaggedBeforeKeys,
        flaggedAfterKeys,
      });
    }, 500);
    return () => clearTimeout(handle);
  }, [
    quickFilterOpen,
    quickFilterEnabled,
    quickPatterns,
    quickColumnEnabled,
    listAnchorKey,
    infoBarOpen,
    zoomRange,
    statsSearch,
    buildingSearch,
    lastSeenLimit,
    lastSeenLive,
    lastSeenSearch,
    filtersEnabled,
    telegramMarkedKeys,
    telegramMouseSelectedKeys,
    telegramHiddenKeys,
    telegramMarkColorIndices,
    flaggedBeforeKeys,
    flaggedAfterKeys,
  ]);

  // ── Sorting (#311: multi-level, ctrl/cmd-click adds a level) ─────────────────
  const [sortConfig, setSortConfig] = useState<SortConfig>(readSortConfigPref);
  const handleSort = (key: SortKey, opts?: { additive?: boolean }) => {
    setSortConfig(prev => {
      const next = toggleSortLevel(prev, key, !!opts?.additive);
      writeSortConfigPref(next);
      return next;
    });
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

  const handleQuickVisualize = (targetAddress: string) => {
    setSelectedVisualizationTargets(prev =>
      prev.includes(targetAddress) ? prev : [...prev, targetAddress]
    );
    setActivePanel('visualizer');
    setIsDatabaseOpen(false);
  };

  // Add a function's/device's/comm-object's group addresses to the visualization
  // selection (union, like handleFilterGAs) and open the visualizer (#307).
  const handleVisualizeGAs = useCallback((addresses: string[]) => {
    setSelectedVisualizationTargets(prev => [...new Set([...prev, ...addresses])]);
    setActivePanel('visualizer');
    setIsDatabaseOpen(false);
  }, []);

  // Click a time/dot on a visualization chart: close the panel, land on the
  // telegram nearest that timestamp with live-follow paused, and turn on both
  // context sides so the quick-filter window opens around it (#308).
  const handleChartTimeClick = useCallback((ms: number) => {
    if (liveTelegrams.length === 0) return;
    let nearest = liveTelegrams[0];
    let bestDiff = Infinity;
    for (const t of liveTelegrams) {
      const diff = Math.abs(new Date(t.timestamp).getTime() - ms);
      if (diff < bestDiff) { bestDiff = diff; nearest = t; }
    }
    const key = anchorKey(nearest);
    const add = (prev: string[]) => prev.includes(key) ? prev : [...prev, key];
    setFlaggedBeforeKeys(add);
    setFlaggedAfterKeys(add);
    handleListFollowChange(false);
    setListAnchorKey(key);
    setActivePanel('list');
  }, [liveTelegrams, handleListFollowChange]);

  // Last value in a write row: open the telegram list on that telegram.
  // Ctrl/Cmd and Shift are the same selection modifiers as a row click.
  // The table selects it once the row is visible, and only if it is in the buffer.
  const handleGotoTelegram = useCallback((telegram: Telegram, mods?: { additive?: boolean; range?: boolean; load?: boolean }) => {
    // Drop a restored anchor so mounting the list does not pin a different row
    // after this jump. The table captures a new anchor once it has centered.
    setListAnchorKey(null);
    setIsDatabaseOpen(false);
    setActivePanel('list');
    const ms = new Date(telegram.timestamp).getTime();
    if (mods?.load && Number.isFinite(ms)) {
      void (async () => {
        await loadOutsideGotoRef.current(ms);
        listGotoSeq.current += 1;
        setListGoto({
          id: listGotoSeq.current,
          telegram,
          allowFill: false,
        });
      })();
      return;
    }
    // In the buffer: scroll only. Direction, anchor and pause stay.
    listGotoSeq.current += 1;
    setListGoto({
      id: listGotoSeq.current,
      telegram,
      additive: mods?.additive,
      range: mods?.range,
      preserveFollow: true,
      allowFill: false,
    });
  }, []);

  const handleAltSend = useCallback(() => {
    setIsSendOpen(o => {
      if (o) setCtrlSendRequest(null);
      return !o;
    });
  }, []);

  const handleCtrlSend = useCallback((info: {
    address: string;
    name?: string | null;
    dptMain?: number | null;
    dptSub?: number | null;
  }) => {
    setIsSendOpen(true);
    ctrlSendNonceRef.current += 1;
    setCtrlSendRequest({ ...info, nonce: ctrlSendNonceRef.current });
  }, []);

  const handleCtrlSendHandled = useCallback(() => {
    setCtrlSendRequest(null);
  }, []);

  const handlePanelAddressesChange = useCallback((addresses: string[]) => {
    setSendPanelAddresses(prev => {
      if (prev.size === addresses.length && addresses.every(a => prev.has(a))) return prev;
      return new Set(addresses);
    });
  }, []);

  const handleLinkedRowStatusesChange = useCallback((statuses: Record<string, LinkedRowStatus>) => {
    setLinkedRowStatuses(statuses);
  }, []);

  const handleGaJobStatusesChange = useCallback((byAddress: Record<string, LinkedRowStatus>) => {
    setGaJobStatuses(byAddress);
  }, []);

  // Delay/every commit only drops the link. The panel row is created when Write/Read starts the job.
  const handleScheduleCommit = useCallback((draft: SendCorrespondenceKey & { name?: string | null }) => {
    const key = correspondenceKeyFromDraft(draft);
    if (!key.delay && !key.every) setPopoverLinkedRowId(null);
  }, []);

  const handleWriteWithSchedule = useCallback((
    draft: SendCorrespondenceKey & { name?: string | null },
    payload: BusPayload,
    opts?: { response?: boolean },
  ) => {
    const key = correspondenceKeyFromDraft(draft);
    sendPanelCmdNonceRef.current += 1;
    const nonce = sendPanelCmdNonceRef.current;
    pendingEnsureRef.current = { nonce, kind: 'write', payload, response: opts?.response };
    setSendPanelCommand({ type: 'ensureRow', nonce, key, name: draft.name });
  }, []);

  const handleReadWithSchedule = useCallback((
    draft: SendCorrespondenceKey & { name?: string | null },
  ) => {
    const key = correspondenceKeyFromDraft(draft);
    sendPanelCmdNonceRef.current += 1;
    const nonce = sendPanelCmdNonceRef.current;
    pendingEnsureRef.current = { nonce, kind: 'read' };
    setSendPanelCommand({ type: 'ensureRow', nonce, key, name: draft.name });
  }, []);

  const handleCancelLinked = useCallback((rowId?: string) => {
    const id = rowId ?? popoverLinkedRowId;
    if (!id) return;
    sendPanelCmdNonceRef.current += 1;
    setSendPanelCommand({
      type: 'cancelRow',
      nonce: sendPanelCmdNonceRef.current,
      rowId: id,
    });
  }, [popoverLinkedRowId]);

  const handleClearLinked = useCallback((rowId?: string) => {
    const id = rowId ?? popoverLinkedRowId;
    if (!id) return;
    sendPanelCmdNonceRef.current += 1;
    setSendPanelCommand({
      type: 'clearRow',
      nonce: sendPanelCmdNonceRef.current,
      rowId: id,
    });
  }, [popoverLinkedRowId]);

  const handleSendPanelCommandHandled = useCallback((result: {
    nonce: number;
    rowId: string | null;
    created: boolean;
    matched: boolean;
  }) => {
    const pending = pendingEnsureRef.current;
    if (pending && pending.nonce === result.nonce) {
      pendingEnsureRef.current = null;
      if (result.rowId) setPopoverLinkedRowId(result.rowId);
      if (pending.kind === 'write' && result.rowId && pending.payload) {
        sendPanelCmdNonceRef.current += 1;
        setSendPanelCommand({
          type: 'writeViaRow',
          nonce: sendPanelCmdNonceRef.current,
          rowId: result.rowId,
          payload: pending.payload,
          response: pending.response,
        });
        return;
      }
      if (pending.kind === 'read' && result.rowId) {
        sendPanelCmdNonceRef.current += 1;
        setSendPanelCommand({
          type: 'readViaRow',
          nonce: sendPanelCmdNonceRef.current,
          rowId: result.rowId,
        });
        return;
      }
    }
    setSendPanelCommand(null);
  }, []);

  const handleQuickLastSeen = useCallback((address: string | string[], mode: 'ga' | 'pa') => {
    setLastSeenAddresses(Array.isArray(address) ? address : [address]);
    setLastSeenMode(mode);
    setActivePanel('lastseen');
    setIsDatabaseOpen(false);
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
  const handleShowGaTelegrams = useCallback((address: string) => {
    handleFilterGAs([address]);
    setFiltersEnabled(true);
    handleListFollowChange(true);
    setActivePanel('list');
  }, [handleFilterGAs, handleListFollowChange]);

  // Time-Delta-Context window, now edited from the telegram list's DELTA TIME
  // quick-filter cell rather than the filter pane (#309, #371).
  const handleDeltaContextChange = useCallback((deltaBeforeMs: number, deltaAfterMs: number) => {
    handleFiltersChange(prev => ({ ...prev, deltaBeforeMs, deltaAfterMs }));
  }, [handleFiltersChange]);

  // Toggles the window on/off without losing the entered values (#318).
  const handleDeltaContextEnabledChange = useCallback((deltaContextEnabled: boolean) => {
    handleFiltersChange(prev => ({ ...prev, deltaContextEnabled }));
  }, [handleFiltersChange]);

  // ── In-memory filtering (live view) ────────────────────────────────────────
  const visibleOpts = useMemo(() => ({
    filters: appliedFilters,
    filtersEnabled,
    quickFilterOpen,
    quickFilterEnabled,
    quickPatterns,
    quickColumnEnabled,
    flaggedBeforeKeys,
    flaggedAfterKeys,
    markedKeys: telegramMarkedKeys,
    mouseSelectedKeys: telegramMouseSelectedKeys,
    lastSelectedKey: lastSelectedTelegramKey,
    jumpTargetKeys,
  }), [
    appliedFilters, filtersEnabled, quickFilterOpen, quickFilterEnabled, quickPatterns, quickColumnEnabled,
    flaggedBeforeKeys, flaggedAfterKeys, telegramMarkedKeys, telegramMouseSelectedKeys,
    lastSelectedTelegramKey, jumpTargetKeys,
  ]);

  // Side-panel view of the same rows. Quick-filter fields stay off so a
  // pattern edit does not rebuild this list; the published view still uses
  // visibleOpts.
  const sidePanelOpts = useMemo(() => ({
    filters: appliedFilters,
    filtersEnabled,
    quickFilterOpen: false,
    quickFilterEnabled: false,
    quickPatterns: {},
    flaggedBeforeKeys,
    flaggedAfterKeys,
    markedKeys: telegramMarkedKeys,
    mouseSelectedKeys: telegramMouseSelectedKeys,
    lastSelectedKey: lastSelectedTelegramKey,
    jumpTargetKeys,
  }), [
    appliedFilters, filtersEnabled,
    flaggedBeforeKeys, flaggedAfterKeys, telegramMarkedKeys,
    telegramMouseSelectedKeys, lastSelectedTelegramKey, jumpTargetKeys,
  ]);

  // Orange quick-filter bar: the bar is open, the filter is enabled, and at
  // least one enabled non-delta cell has a pattern. Closed, disabled, or
  // empty does not filter the list.
  const quickFilterActive = activeQuickFilter(
    quickFilterOpen, quickFilterEnabled, quickPatterns, quickColumnEnabled,
  ) != null;
  const sidePanelActive = filtersEnabled && hasActiveFilters(appliedFilters);
  const forceVisibleKeys = useMemo(() => pinnedVisibleKeys(visibleOpts), [visibleOpts]);

  const liveViewRef = useRef<LiveTelegramView | null>(null);
  const sidePanelViewRef = useRef<LiveTelegramView | null>(null);
  // The previous view has to be read while rendering: an effect would apply the
  // prepend a frame late. deriveLiveTelegramView is idempotent for the same
  // source, so StrictMode's second render does not edit the list twice.
  // eslint-disable-next-line react-hooks/refs
  const liveView = deriveLiveTelegramView(liveViewRef.current, liveTelegrams, sortConfig, visibleOpts);
  // eslint-disable-next-line react-hooks/refs
  liveViewRef.current = liveView;
  const sortedLiveTelegrams = liveView.sorted;
  const filteredLiveTelegrams = liveView.items;
  // Keys of rows shown only as unfiltered context around a match/flag (#343).
  const contextTelegramKeys = liveView.contextKeys;
  const contextTelegramParents = liveView.contextParents;
  // y while the quick filter is also on: today's list with the quick filter
  // forced off (side panel, context rows, force-visible marks). A second view
  // so a live prepend does not rescan the buffer. It is not published.
  const countSidePanel = sidePanelActive && quickFilterActive;
  // eslint-disable-next-line react-hooks/refs
  const sidePanelPrev = sidePanelViewRef.current;
  const sidePanelView = countSidePanel
    ? deriveLiveTelegramView(sidePanelPrev, liveTelegrams, sortConfig, sidePanelOpts)
    : null;
  // eslint-disable-next-line react-hooks/refs
  sidePanelViewRef.current = sidePanelView;
  // Backlog rows are mutated in place; pausedCount is the render signal.
  // x: side panel + quick filter, no context rows, force-visible rows stay.
  // y: the side-panel selection with the quick filter off, context included.
  const quickBacklogCount = useMemo(() => {
    if (!quickFilterActive || pausedCount <= 0 || pausedTelegrams.length === 0) return 0;
    // x ignores context, so the buffer is not an input. Match and force-visible
    // are decided on the backlog row alone.
    return backlogStatusCount([], pausedTelegrams, visibleOpts, true);
  }, [quickFilterActive, pausedCount, pausedTelegrams, visibleOpts]);
  const sidePanelBacklogCount = useMemo(() => {
    if (pausedCount <= 0 || pausedTelegrams.length === 0) return 0;
    if (!sidePanelActive) return pausedTelegrams.length;
    return backlogStatusCount(liveTelegrams, pausedTelegrams, sidePanelOpts, false);
  }, [pausedCount, pausedTelegrams, sidePanelActive, liveTelegrams, sidePanelOpts]);
  const backlogCount = pausedCount > 0 ? pausedTelegrams.length : 0;
  const pillCounts = bufferBacklogCounts({
    bufferCount: liveTelegrams.length,
    backlogCount,
    sidePanelBufferCount: sidePanelView ? sidePanelView.items.length : filteredLiveTelegrams.length,
    sidePanelBacklogCount,
    quickBufferCount: statusViewRowCount(
      filteredLiveTelegrams,
      contextTelegramKeys,
      forceVisibleKeys,
      true,
    ),
    quickBacklogCount,
    sidePanelActive,
    quickFilterActive,
  });
  const filterCounts = liveView.counts;

  const activeFilterCount = countSelections(appliedFilters);

  // The filter pane and its toggle are tied to the Telegram List (#374): only
  // that panel consumes the main filter, so the pane shows only when it is active.
  const showFilterPane = activePanel === 'list' && isFilterOpen;

  /**
   * Trim to the anchor window, then fill its gaps from the anchor outward.
   * Matching rows stay. IndexedDB is read before the database, and only new
   * rows spend the shared load budget. `rangeMinutes` overrides the state
   * value when Back/Forward restores a window before React has committed it.
   */
  const fillAnchorWindow = useCallback(async (
    dir: 'forward' | 'backward',
    anchorTs: number,
    rangeMinutes: number = bufferRangeMinutes,
  ) => {
    enforceTimeWindow(dir, rangeMinutes);
    if (dir === 'forward') {
      await fillForwardFrom(anchorTs);
      return;
    }
    await loadRange(anchorTs - rangeMinutes * 60_000, anchorTs);
  }, [bufferRangeMinutes, enforceTimeWindow, fillForwardFrom, loadRange]);

  /**
   * Switch the fill/eviction axis without wiping the buffer. `after` runs once
   * the anchor direction has been adopted (timestamp cleared when it changed).
   * The timestamp sort is independent and stays as the user left it.
   */
  const changeReadDirection = useCallback(async (
    dir: 'forward' | 'backward',
    after?: () => Promise<void>,
    /** Chevron: no timestamp. Forward→backward lands on the edge, auto, not live. */
    edge = false,
  ) => {
    setDirectionGesture(edge ? 'chevron' : 'rebuild');
    const switched = readDirection !== dir;
    // Forward has nothing to restore. Latch auto only after `after` publishes
    // the window — pausing first would hide that fill.
    const parkAuto = switched && dir === 'backward' && (edge || pauseMode === 'off');
    setMonitorView(v => {
      const dirChanged = v.direction !== dir;
      let next: MonitorView = dirChanged ? { ...v, direction: dir, anchorTs: null } : v;
      if (dir === 'forward') next = enterForward({ ...next, direction: 'forward' });
      else if (parkAuto && dirChanged) next = { ...next, pauseMode: 'off', follow: false };
      return next;
    });
    if (switched) {
      setEvictionMode(dir === 'forward' ? 'keepOldest' : 'keepNewest');
      adoptAnchorDirection(dir);
    }
    await after?.();
    if (parkAuto) {
      setMonitorView(v => (
        v.direction === 'backward'
          ? { ...v, pauseMode: 'auto', follow: false }
          : v
      ));
    }
  }, [readDirection, pauseMode, setEvictionMode, adoptAnchorDirection]);

  /** User-chosen anchor. The view is the source; the cache trims from it. */
  const placeAnchor = useCallback((dir: 'forward' | 'backward', ts: number) => {
    setMonitorView(v => ({ ...v, direction: dir, anchorTs: ts }));
    setBufferAnchor({ direction: dir, ts });
  }, [setBufferAnchor]);

  /**
   * Target outside the buffer. Older → forward, x = target. Newer → backward,
   * y = target (fixed; it does not slide). A direction change rebuilds;
   * staying on the same axis only moves the anchor and fills gaps. Going
   * forward clears live in memory. A fixed y turns live off. The pause
   * backlog keeps only rows that fit the new window.
   */
  const loadOutsideGoto = useCallback(async (targetMs: number) => {
    const place = classifyGotoTarget(targetMs, bufferOldestTs, bufferNewestTs);
    const dir: 'forward' | 'backward' = place === 'newer' ? 'backward' : 'forward';
    const windowPlace = dir === 'forward' ? 'older' as const : 'newer' as const;
    const win = gotoWindow(windowPlace, targetMs, bufferRangeMinutes);
    retainPausedInWindow(win.min, win.max);
    if (readDirection !== dir) {
      await changeReadDirection(dir, async () => {
        placeAnchor(dir, targetMs);
        await fillAnchorWindow(dir, targetMs);
      });
    } else {
      if (dir === 'forward') {
        setMonitorView(v => enterForward({ ...v, direction: 'forward' }));
      }
      placeAnchor(dir, targetMs);
      await fillAnchorWindow(dir, targetMs);
    }
    if (dir === 'forward') {
      setMonitorView(v => enterForward({ ...v, direction: 'forward', anchorTs: targetMs }));
    } else {
      setMonitorView(v => parkOnFixedY(v, targetMs));
      setBufferAnchor({ direction: 'backward', ts: targetMs });
    }
    publishBuffer();
  }, [
    bufferOldestTs, bufferNewestTs, bufferRangeMinutes, readDirection,
    retainPausedInWindow, changeReadDirection, placeAnchor, fillAnchorWindow,
    setBufferAnchor, publishBuffer,
  ]);

  useEffect(() => {
    loadOutsideGotoRef.current = loadOutsideGoto;
  }, [loadOutsideGoto]);

  useEffect(() => {
    monitorWindowRef.current = {
      direction: readDirection,
      anchorTs: monitorView.anchorTs,
      rangeMinutes: bufferRangeMinutes,
    };
    monitorActionsRef.current = {
      fillAnchor: fillAnchorWindow,
      adoptAnchorDirection,
      setBufferAnchor,
      setEvictionMode,
    };
  }, [
    readDirection,
    monitorView.anchorTs,
    bufferRangeMinutes,
    fillAnchorWindow,
    adoptAnchorDirection,
    setBufferAnchor,
    setEvictionMode,
  ]);

  // Sort stays in its own preference. Direction, anchor and pause come from
  // the monitor view. An explicit anchor loads through the same window fill
  // as a rewind; no anchor keeps today's startup. A restored forward view is
  // already normalized (no live, no pause).
  const startupAnchorOnce = useRef(false);
  useEffect(() => {
    if (startupAnchorOnce.current) return;
    startupAnchorOnce.current = true;
    const derived = deriveMonitorView(initialMonitor.view);
    if (derived.bufferAnchor.ts == null) return;
    setBufferAnchor(derived.bufferAnchor);
    void fillAnchorWindow(derived.readDirection, derived.bufferAnchor.ts, initialMonitor.rangeMinutes);
  }, [initialMonitor, setBufferAnchor, fillAnchorWindow]);

  /** Apply a new minute window: trim when shrinking, fill gaps when expanding. */
  const applyBufferRange = useCallback(async (nextMinutes: number) => {
    const prev = bufferRangeMinutes;
    setBufferRangeMinutes(nextMinutes);
    setCacheRangeMinutes(nextMinutes);
    const oldest = bufferOldestTs;
    const newest = bufferNewestTs;
    const anchored = bufferAnchor.direction === readDirection ? bufferAnchor.ts : null;
    if (oldest == null || newest == null) {
      enforceTimeWindow(readDirection, nextMinutes);
      return;
    }
    const rangeMs = nextMinutes * 60_000;
    if (nextMinutes < prev) {
      enforceTimeWindow(readDirection, nextMinutes);
      return;
    }
    // Expanding: fetch the missing side of the anchor window, then trim.
    // No explicit anchor uses the same buffer edge as before.
    if (readDirection === 'forward') {
      const end = (anchored ?? oldest) + rangeMs;
      if (newest < end) await loadRange(newest, end);
    } else {
      const start = (anchored ?? newest) - rangeMs;
      if (oldest > start) await loadRange(start, oldest);
    }
    enforceTimeWindow(readDirection, nextMinutes);
  }, [
    bufferRangeMinutes, bufferOldestTs, bufferNewestTs, readDirection, bufferAnchor,
    enforceTimeWindow, loadRange, setCacheRangeMinutes,
  ]);

  // Replace the app with a login screen when authentication is required. Early
  // so an unauthenticated visitor triggers no data fetching or WebSocket work
  // (those requests would 401 and the socket would be refused anyway).
  if (loginRequired(authStatus)) {
    return <LoginScreen status={authStatus!} onAuthenticated={reloadAuth} />;
  }

  return (
    <GotoBufferProvider scope="live" oldestMs={bufferOldestTs} newestMs={bufferNewestTs}>
    <DptCatalogProvider value={filterOptions.dpts}>
    <GaReadPhaseProvider rows={ingestedTelegrams}>
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
                <BufferStatusPill
                  oldestMs={bufferOldestTs}
                  newestMs={bufferNewestTs}
                  readDirection={readDirection}
                  onReadDirectionChange={dir => {
                    void changeReadDirection(dir, async () => {
                      // No timestamp: the anchor is the buffer edge (oldest
                      // forward, newest backward), then trim and fill.
                      // Forward → backward does not go live (auto, follow off).
                      const edgeTs = dir === 'forward' ? bufferOldestTs : bufferNewestTs;
                      if (edgeTs == null) return;
                      await fillAnchorWindow(dir, edgeTs);
                    }, true);
                  }}
                  loadLimit={monitorLoadLimit}
                  onLoadLimitChange={setMonitorLoadLimit}
                  rangeMinutes={bufferRangeMinutes}
                  onRangeMinutesChange={n => { void applyBufferRange(n); }}
                  filteredCount={pillCounts.filtered}
                  totalCount={pillCounts.total}
                  unfilteredCount={pillCounts.unfiltered}
                  filterActive={quickFilterActive}
                  readingEnd={readingEnd}
                  onClear={() => {
                    setMonitorView(v => ({
                      ...v,
                      follow: false,
                      anchorTs: null,
                    }));
                    // Real wipe. clear() also drops the anchor timestamp.
                    void clearTelegrams();
                  }}
                  onCancelLoad={cancelLoad}
                  pauseTitle={pauseTitle}
                  pauseColor={pauseColor}
                  pauseMode={pauseMode === 'off' ? 'auto' : pauseMode}
                  pauseDisabled={bufferEmpty}
                  onTogglePause={togglePause}
                  busRate={busRate}
                  rateMode={rateMode}
                  onCycleRateMode={() => setRateMode(m => (m === 's' ? 'm' : m === 'm' ? 'h' : 's'))}
                  wsConnected={isConnected}
                  isHistoryLoading={isHistoryLoading}
                  fixedAnchor={readDirection === 'backward' && monitorView.anchorTs != null}
                  historyLoadError={historyLoadError}
                  onScrollToTime={ms => {
                    listGotoSeq.current += 1;
                    setListGoto({
                      id: listGotoSeq.current,
                      targetMs: ms,
                      preserveFollow: true,
                      allowFill: false,
                    });
                    setActivePanel('list');
                  }}
                  onCommitOutside={ms => {
                    void (async () => {
                      await loadOutsideGoto(ms);
                      listGotoSeq.current += 1;
                      setListGoto({
                        id: listGotoSeq.current,
                        targetMs: ms,
                        allowFill: false,
                      });
                      setActivePanel('list');
                    })();
                  }}
                  onLoadFromDbOldest={() => {
                    void (async () => {
                      try {
                        const res = await fetch(apiUrl('/api/database/info'));
                        if (!res.ok) return;
                        const info = await res.json() as { oldest_timestamp?: string | null };
                        const raw = info.oldest_timestamp;
                        if (!raw) return;
                        const ms = new Date(raw).getTime();
                        if (Number.isNaN(ms)) return;
                        await changeReadDirection('forward', async () => {
                          placeAnchor('forward', ms);
                          await fillAnchorWindow('forward', ms);
                        });
                        setMonitorView(v => enterForward({ ...v, direction: 'forward', anchorTs: ms }));
                        setActivePanel('list');
                        listGotoSeq.current += 1;
                        setListGoto({ id: listGotoSeq.current, targetMs: ms });
                      } catch {
                        // spinner / loadError cover failures
                      }
                    })();
                  }}
                  onLoadFromDbNewest={() => {
                    // Capture before the awaits: changeReadDirection may park a
                    // forward view on auto, and that must not hide what FF was
                    // asked to do. Only FF turns live on from a non-live state.
                    const priorPause = pauseMode;
                    void (async () => {
                      try {
                        const res = await fetch(apiUrl('/api/database/info'));
                        if (!res.ok) return;
                        const info = await res.json() as { newest_timestamp?: string | null };
                        const raw = info.newest_timestamp;
                        if (!raw) return;
                        const ms = new Date(raw).getTime();
                        if (Number.isNaN(ms)) return;
                        await changeReadDirection('backward', async () => {
                          placeAnchor('backward', ms);
                          await fillAnchorWindow('backward', ms);
                        });
                        setActivePanel('list');
                        if (priorPause === 'manual') {
                          // Stay paused on the newest telegram. No follow.
                          setMonitorView(v => ({
                            ...v,
                            direction: 'backward',
                            anchorTs: ms,
                            follow: false,
                            pauseMode: 'manual',
                          }));
                          setBufferAnchor({ direction: 'backward', ts: ms });
                          applyCachePause(true);
                          listGotoSeq.current += 1;
                          setListGoto({ id: listGotoSeq.current, targetMs: ms });
                        } else {
                          // Auto, off, or already playing: live edge, follow on.
                          // Playing simply continues; auto and off enter live here.
                          // No list-goto: that jump unfollows and pins the anchor
                          // again, which would leave live. Follow sits on the edge.
                          setMonitorView(v => ({
                            ...v,
                            direction: 'backward',
                            anchorTs: null,
                            follow: true,
                            pauseMode: 'playing',
                          }));
                          setBufferAnchor({ direction: 'backward', ts: null });
                          applyCachePause(false);
                        }
                      } catch {
                        // spinner / loadError cover failures
                      }
                    })();
                  }}
                />

                {/* Main-panel switch (#374): the five panels close back to the
                    list; the Building opener also clears any drilled-in device. */}
                <PanelSwitch
                  active={activePanel}
                  onChange={(p) => { if (p !== 'building') setStatusDevice(null); setActivePanel(p); setIsDatabaseOpen(false); }}
                />

                {serverConfig?.status?.write_enabled && (
                  <div style={{
                    display: 'flex', alignItems: 'center',
                    padding: '0.2rem', borderRadius: '8px',
                    background: 'var(--bg-subtle)', border: '1px solid var(--border-color)',
                  }}>
                    <button
                      className="icon-button"
                      onClick={() => {
                        setIsSendOpen(o => {
                          if (o) setCtrlSendRequest(null);
                          return !o;
                        });
                      }}
                      title="Send / read telegrams"
                      aria-pressed={isSendOpen}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        padding: '0.4rem', borderRadius: '6px',
                        background: isSendOpen ? 'rgba(99,102,241,0.15)' : 'transparent',
                        color: isSendOpen ? 'var(--accent-primary)' : 'var(--text-dim)',
                      }}
                    >
                      <Send size={18} />
                    </button>
                  </div>
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

              <h3 style={{ fontSize: '0.75rem', color: 'var(--text-dim)', textTransform: 'uppercase', marginBottom: '0.75rem', letterSpacing: '0.05em', marginTop: '1.5rem' }}>
                Seitengröße Monitor-Laden
              </h3>
              <div className="input-group">
                <input
                  type="number"
                  min={MONITOR_PAGE_SIZE_MIN}
                  max={MONITOR_PAGE_SIZE_MAX}
                  step={100}
                  className="glass-input"
                  style={{ width: '100%', padding: '0.75rem', fontSize: '0.85rem' }}
                  value={monitorPageSize}
                  title="Page size for Monitor database loads (200–10000). History search stays a single request."
                  aria-label="Seitengröße Monitor-Laden"
                  onChange={e => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n)) setMonitorPageSize(clampMonitorPageSize(n));
                  }}
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
            {/* Full width of main, above the filter column so the bar is not
                inset beside the filter pane. */}
            {serverConfig?.status?.write_enabled && (
              <div
                style={{ display: isSendOpen ? undefined : 'none' }}
                aria-hidden={!isSendOpen}
              >
                <WriteToBusPanel
                  targets={filterOptions.targets}
                  dptCatalog={filterOptions.dpts}
                  latestTelegram={latestTelegram}
                  onGotoTelegram={handleGotoTelegram}
                  onPanelAddressesChange={handlePanelAddressesChange}
                  ctrlSendRequest={ctrlSendRequest}
                  onCtrlSendHandled={handleCtrlSendHandled}
                  sendPanelCommand={sendPanelCommand}
                  onSendPanelCommandHandled={handleSendPanelCommandHandled}
                  onLinkedRowStatusesChange={handleLinkedRowStatusesChange}
                  onGaJobStatusesChange={handleGaJobStatusesChange}
                />
              </div>
            )}
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
                    onQuickLastSeen={handleQuickLastSeen}
                    projectLoaded={projectStatus?.project_loaded}
                    onUploadProject={() => setIsSettingsOpen(true)}
                    writeEnabled={serverConfig?.status?.write_enabled}
                    onGotoTelegram={handleGotoTelegram}
                    filtersEnabled={filtersEnabled}
                    onFiltersEnabledChange={handleFiltersEnabledChange}
                  />
              </ResizablePane>

              {/* Content body */}
              <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
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
                    onFilterGAs={handleFilterGAs}
                    onShowGaTelegrams={handleShowGaTelegrams}
                    onLastSeen={handleQuickLastSeen}
                    onGotoTelegram={handleGotoTelegram}
                  />
                ) : isLastSeenOpen ? (
                  <LastSeenOverlay
                    filterOptions={filterOptions}
                    initialAddresses={lastSeenAddresses}
                    initialMode={lastSeenMode}
                    writeEnabled={serverConfig?.status?.write_enabled}
                    latestTelegram={latestTelegram}
                    onClose={() => setActivePanel('list')}
                    limit={lastSeenLimit}
                    onLimitChange={setLastSeenLimit}
                    autoRefresh={lastSeenLive}
                    onAutoRefreshChange={setLastSeenLive}
                    search={lastSeenSearch}
                    onSearchChange={setLastSeenSearch}
                    onSelectionChange={(mode, addresses) => {
                      setLastSeenMode(mode);
                      setLastSeenAddresses(addresses);
                    }}
                    onFilterDevice={(pa) => handleQuickFilter('sources', pa)}
                    onFilterGAs={handleFilterGAs}
                    onVisualizeGAs={handleVisualizeGAs}
                    onGotoTelegram={handleGotoTelegram}
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
                  />
                ) : isBuildingOpen ? (
                  <BuildingOverlay
                    onClose={() => setActivePanel('list')}
                    onFilterDevice={(pa) => handleQuickFilter('sources', pa)}
                    onFilterGAs={handleFilterGAs}
                    onLastSeen={handleQuickLastSeen}
                    onVisualizeGAs={handleVisualizeGAs}
                    onDeviceStatus={setStatusDevice}
                    onGotoTelegram={handleGotoTelegram}
                    writeEnabled={serverConfig?.status?.write_enabled}
                    latestTelegram={latestTelegram}
                    searchQuery={buildingSearch}
                    onSearchQueryChange={setBuildingSearch}
                  />
                ) : isDatabaseOpen ? (
                  <DatabaseOverlay onClose={() => setIsDatabaseOpen(false)} />
                ) : (
                  <>
                    {/* Telegram List panel header (#374): its own filter toggle
                        (top-left) and the live play/pause it governs. */}
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: '0.5rem',
                      padding: '0.4rem 0.75rem', flexShrink: 0,
                      borderBottom: '1px solid var(--border-color)',
                    }}>
                      <button
                        className="icon-button"
                        onClick={() => setIsFilterOpen(o => !o)}
                        title="Toggle filter panel"
                        style={{
                          position: 'relative',
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
                    <TelegramTable
                    telegrams={filteredLiveTelegrams}
                    forceIncludeFrom={sortedLiveTelegrams}
                    readPhaseTelegrams={ingestedTelegrams}
                    pausedTelegrams={pausedTelegrams}
                    filtersEnabled={filtersEnabled}
                    visibleColumns={visibleColumns}
                    sortConfig={sortConfig}
                    onSort={handleSort}
                    activeFilters={activeFilters}
                    onQuickFilter={handleQuickFilter}
                    onQuickVisualize={handleQuickVisualize}
                    onQuickLastSeen={handleQuickLastSeen}
                    canSend={serverConfig?.status?.write_enabled}
                    onGotoTelegram={handleGotoTelegram}
                    onAltSend={handleAltSend}
                    onCtrlSend={handleCtrlSend}
                    sendPanelAddresses={sendPanelAddresses}
                    activeSendJobAddresses={activeSendJobAddresses}
                    gaJobStatuses={gaJobStatuses}
                    linkedStatus={popoverLinkedRowId ? linkedRowStatuses[popoverLinkedRowId] ?? null : null}
                    onScheduleCommit={handleScheduleCommit}
                    onWriteWithSchedule={handleWriteWithSchedule}
                    onReadWithSchedule={handleReadWithSchedule}
                    onCancelLinked={handleCancelLinked}
                    onClearLinked={handleClearLinked}
                    latestTelegram={latestTelegram}
                    quickFilterOpen={quickFilterOpen}
                    onQuickFilterOpenChange={setQuickFilterOpen}
                    quickFilterEnabled={quickFilterEnabled}
                    onQuickFilterEnabledChange={setQuickFilterEnabled}
                    quickPatterns={quickPatterns}
                    onQuickPatternsChange={setQuickPatterns}
                    quickColumnEnabled={quickColumnEnabled}
                    onQuickColumnEnabledChange={setQuickColumnEnabled}
                    onDeltaContextChange={handleDeltaContextChange}
                    onDeltaContextEnabledChange={handleDeltaContextEnabledChange}
                    listFollow={readDirection === 'backward' && listFollow}
                    liveFollow={readDirection === 'backward'}
                    readDirection={readDirection}
                    directionGesture={directionGesture}
                    covered={coveredIntervals}
                    bufferAnchorTs={bufferAnchor.ts}
                    readingEnd={readingEnd}
                    onListFollowChange={handleListFollowChange}
                    isPaused={isPaused}
                    isManualPause={readDirection === 'backward' && pauseMode === 'manual'}
                    pausedCount={pausedCount}
                    onPauseFlush={flushPauseBuffer}
                    onPauseReveal={revealPauseBuffer}
                    onJumpToLive={jumpToLiveResume}
                    bufferOldestMs={bufferOldestTs}
                    bufferNewestMs={bufferNewestTs}
                    onGotoFillOlder={async ms => {
                      await loadOutsideGoto(ms);
                    }}
                    onGotoFillNewer={async ms => {
                      await loadOutsideGoto(ms);
                    }}
                    listAnchorKey={listAnchorKey}
                    onListAnchorKeyChange={setListAnchorKey}
                    viewChangeToken={ttViewChangeToken}
                    markedKeys={telegramMarkedKeys}
                    onMarkedKeysChange={setTelegramMarkedKeys}
                    mouseSelectedKeys={telegramMouseSelectedKeys}
                    onMouseSelectedKeysChange={setTelegramMouseSelectedKeys}
                    hiddenKeys={telegramHiddenKeys}
                    onHiddenKeysChange={setTelegramHiddenKeys}
                    markColorIndices={telegramMarkColorIndices}
                    onMarkColorIndicesChange={setTelegramMarkColorIndices}
                    lastSelectedKey={lastSelectedTelegramKey}
                    onLastSelectedKeyChange={setLastSelectedTelegramKey}
                    flaggedBeforeKeys={flaggedBeforeKeys}
                    onFlaggedBeforeKeysChange={setFlaggedBeforeKeys}
                    flaggedAfterKeys={flaggedAfterKeys}
                    onFlaggedAfterKeysChange={setFlaggedAfterKeys}
                    jumpTargetKeys={jumpTargetKeys}
                    onJumpTarget={(key, mode) => {
                      setJumpTargetKeys(prev => nextJumpTargets(prev, key, mode === 'add'));
                    }}
                    contextKeys={contextTelegramKeys}
                    contextParents={contextTelegramParents}
                    infoBarOpen={infoBarOpen}
                    onInfoBarOpenChange={setInfoBarOpen}
                    gotoRequest={listGoto}
                  />
                  </>
                )}
              </div>
            </div>
          </div>
        ) : activeTab === 'import' ? (
          <ImportExportView />
        ) : (
          <HistorySearch
            visibleColumns={visibleColumns}
            loadLimit={historyLoadLimit}
            onLoadLimitChange={setHistoryLoadLimit}
            filterOptions={filterOptions}
            activeFilters={activeFilters}
            onFiltersChange={handleFiltersChange}
            onOpenSettings={() => setIsSettingsOpen(true)}
            projectLoaded={projectStatus?.project_loaded}
            selectedVisualizationTargets={selectedVisualizationTargets}
            onVisualizationTargetsChange={setSelectedVisualizationTargets}
            initialView={initialView}
            filtersEnabled={filtersEnabled}
            onFiltersEnabledChange={handleFiltersEnabledChange}
            viewChangeToken={ttViewChangeToken}
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
          limit={monitorLoadLimit}
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
      `}</style>
    </div>
    </GaReadPhaseProvider>
    </DptCatalogProvider>
    </GotoBufferProvider>
  );
}

export default App;
