import React, { useEffect, useRef, useState, useMemo } from 'react';
import type { Telegram } from '../hooks/useWebSocket';
import { useChartData } from '../hooks/useChartData';
import { MixedChart } from './MixedChart';
import { TimelineChart } from './TimelineChart';
import { EventDotsChart } from './EventDotsChart';
import { TimeBrush } from './TimeBrush';
import { AutoFollowPill } from './AutoFollowPill';
import { Download, Link2, Check, X, LineChart, CircleDot } from 'lucide-react';
import { getPref, setPref } from '../utils/prefs';
import { clearSeriesHidden } from '../utils/legendVisibility';
import { expandDegenerateRange } from '../utils/timeRange';
import { splitLockedBuckets } from '../utils/chartLock';
import { computeSharedLeftGutter } from '../utils/chartGutter';
import { formatFullTime, spansMultipleDays } from '../utils/timeFormat';

interface VisualizerProps {
  telegrams: Telegram[];
  selectedTargets: string[];
  onTargetsChange: (targets: string[]) => void;
  onClose: () => void;
  /** Returns a shareable URL for the current view (#150); shows a Copy-link button when set. */
  getShareLink?: () => string;
  /** Chart-area-only rendering for iframe/dashboard embedding (#150). */
  embed?: boolean;
  zoomRange?: [number, number] | null;
  onZoomRangeChange?: (range: [number, number] | null) => void;
  /** Click on a chart's time ruler: navigate to the telegram list around that
   * timestamp (#308). */
  onTimeClick?: (ms: number, chartTargets?: string[]) => void;
  /** Per-target row actions in the sidebar (#341): write/filter/last-seen. */
  writeEnabled?: boolean;
  onFilterGAs?: (addresses: string[]) => void;
  onLastSeen?: (address: string | string[], mode: 'ga' | 'pa') => void;

  // Shared buffer-pause state (#391): the same autofollow pause driving the
  // telegram list's live buffer, so pausing on either main panel is reflected
  // on both — one buffer, one pause state, one pill.
  listFollow?: boolean;
  onListFollowChange?: (follow: boolean) => void;
  /** Telegrams buffered upstream while paused, shown in the autofollow pill. */
  pendingLiveCount?: number;
}

export const Visualizer: React.FC<VisualizerProps> = ({
  telegrams, selectedTargets, onTargetsChange, onClose, getShareLink, embed = false,
  zoomRange, onZoomRangeChange, onTimeClick, writeEnabled, onFilterGAs, onLastSeen,
  listFollow, onListFollowChange, pendingLiveCount,
}) => {

  const chartWrapperRef = useRef<HTMLDivElement>(null);
  const pendingSingleClickRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);

  // Datatype chosen per group address for GAs with no DPT in the project, so
  // their raw payloads can be decoded and plotted (#315). Persisted so the
  // choice survives reloads.
  const [dptOverrides, setDptOverrides] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(getPref('vizDptOverrides') || '{}') as Record<string, string>;
    } catch {
      return {};
    }
  });

  const setDptOverride = (address: string, key: string) => {
    setDptOverrides(prev => {
      const next = { ...prev };
      if (key) next[address] = key;
      else delete next[address];
      setPref('vizDptOverrides', JSON.stringify(next));
      return next;
    });
  };

  // GAs whose telegrams never carry a decoded DPT but do carry raw byte
  // payloads — the ones that need a manual datatype to be plottable (#315).
  const untypedTargets = useMemo(() => {
    const decoded = new Set<string>();
    const rawArray = new Set<string>();
    for (const t of telegrams) {
      if (!t.target_address) continue;
      if (t.dpt_main != null) decoded.add(t.target_address);
      else if (Array.isArray(t.value_json)) rawArray.add(t.target_address);
    }
    return new Set([...rawArray].filter(a => !decoded.has(a)));
  }, [telegrams]);

  const { buckets, minTime, maxTime, addressToUnit } = useChartData(telegrams, selectedTargets, dptOverrides);
  const [stepped, setStepped] = useState(() => getPref('chartStepped') !== 'false');
  const [showDots, setShowDots] = useState(() => getPref('chartDots') !== 'false');
  const [linkCopied, setLinkCopied] = useState(false);

  // Per-metric chart "lock" (#349): a locked chart stops taking further GAs of
  // its unit — the next one selected spawns a new chart instead of crowding
  // the existing one. Thresholds are "GAs assigned so far" counts (by
  // selection order) at each lock action; see utils/chartLock.ts.
  const [lockThresholds, setLockThresholds] = useState<Record<string, number[]>>({});
  const displayBuckets = useMemo(
    () => splitLockedBuckets(buckets, selectedTargets, addressToUnit, lockThresholds),
    [buckets, selectedTargets, addressToUnit, lockThresholds]
  );
  // One gutter width shared by every displayed chart (#... ), wide enough for
  // all their y-axis tick labels and titles, so every X-axis starts at the
  // same vertical pixel column regardless of chart type.
  const sharedLeftGutter = useMemo(
    () => computeSharedLeftGutter(displayBuckets.map(g => g.bucket)),
    [displayBuckets],
  );
  // `openGroupSize` is the currently-open chart's own GA count (for that
  // unit), read fresh from `displayBuckets` at the call site. If the most
  // recent threshold exactly equals it, nothing has been added since that
  // lock — toggling again undoes it; otherwise a new lock closes it off.
  const toggleLock = (unit: string, openGroupSize: number) => {
    setLockThresholds(prev => {
      const existing = prev[unit] ?? [];
      const alreadyLocked = existing.length > 0 && existing[existing.length - 1] === openGroupSize;
      const next = alreadyLocked ? existing.slice(0, -1) : [...existing, openGroupSize];
      return { ...prev, [unit]: next };
    });
  };

  const defaultRange = useMemo<[number, number]>(() => {
    // Pad a zero-width extent (a single telegram, or several at the same instant)
    // so the time axis renders real times instead of collapsing to 00:00 (#239).
    return expandDegenerateRange(minTime ?? 0, maxTime ?? 0);
  }, [minTime, maxTime]);

  const [internalZoomRange, setInternalZoomRange] = useState<[number, number] | null>(null);
  const currentZoomRange = zoomRange !== undefined ? zoomRange : internalZoomRange;

  // Edge pin (#341, #340 follow-up): a handle left at (or dragged/double-clicked
  // to) the domain edge keeps tracking that edge as minTime/maxTime move — the
  // timeline analogue of the telegram list's live-edge follow (#203). Ephemeral,
  // like the list's follow state: not part of the shareable-link zoomRange
  // contract, so it resets on reload rather than being encoded in a URL.
  const [edgePinned, setEdgePinned] = useState<{ left: boolean; right: boolean }>({ left: false, right: false });
  const [liveNowMs, setLiveNowMs] = useState(() => Date.now());

  // Whether this view is currently following live data: the shared buffer's
  // pause state when provided (#391, one buffer/pause/pill for every main
  // panel), otherwise this instance's own edge-pin for standalone use (e.g.
  // the embed view, which has no shared buffer to bind to).
  const isFollowing = listFollow !== undefined ? listFollow : edgePinned.right;

  useEffect(() => {
    if (!isFollowing) return;
    const id = window.setInterval(() => setLiveNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [isFollowing]);

  const applyZoomRange = (next: [number, number] | null, pinOverride?: { left: boolean; right: boolean }) => {
    setInternalZoomRange(next);
    onZoomRangeChange?.(next);
    if (next && minTime !== null && maxTime !== null) {
      if (pinOverride) {
        setEdgePinned(pinOverride);
        return;
      }
      const eps = Math.max(1000, (maxTime - minTime) * 0.005);
      setEdgePinned({ left: next[0] <= minTime + eps, right: next[1] >= maxTime - eps });
    } else {
      setEdgePinned({ left: false, right: false });
    }
  };

  const setZoomRange = (val: [number, number] | null | ((prev: [number, number] | null) => [number, number] | null)) => {
    const next = typeof val === 'function' ? val(currentZoomRange) : val;
    applyZoomRange(next);
  };

  const activeRange = useMemo<[number, number]>(() => {
    if (!currentZoomRange || minTime === null || maxTime === null) return defaultRange;
    const left = edgePinned.left ? minTime : Math.max(minTime, Math.min(maxTime, currentZoomRange[0]));
    const right = edgePinned.right ? maxTime : Math.max(left, Math.min(maxTime, currentZoomRange[1]));
    return [left, right];
  }, [currentZoomRange, minTime, maxTime, defaultRange, edgePinned]);

  const chartMaxTime = useMemo(() => {
    if (edgePinned.right) return Math.max(activeRange[1], liveNowMs);
    return activeRange[1];
  }, [activeRange, edgePinned.right, liveNowMs]);

  const pauseAutoFollow = () => {
    if (minTime === null || maxTime === null) return;
    const frozenRange: [number, number] = [activeRange[0], activeRange[1]];
    applyZoomRange(frozenRange, { left: edgePinned.left, right: false });
    onListFollowChange?.(false);
  };

  const resumeAutoFollow = () => {
    if (minTime === null || maxTime === null) return;
    const nextRange: [number, number] = [activeRange[0], maxTime];
    const eps = Math.max(1000, (maxTime - minTime) * 0.005);
    applyZoomRange(nextRange, { left: nextRange[0] <= minTime + eps, right: true });
    onListFollowChange?.(true);
  };

  const toggleRightAutoFollow = () => {
    if (isFollowing) pauseAutoFollow(); else resumeAutoFollow();
  };

  // An external pause (e.g. triggered from the telegram list) freezes this
  // view too — the buffer's pause state is a single source of truth shared by
  // every main panel. Resuming is always user-triggered, never implied by the
  // prop flipping back to true (mirrors the telegram list's sticky pause).
  useEffect(() => {
    if (listFollow === false && edgePinned.right) {
      const frozenRange: [number, number] = [activeRange[0], activeRange[1]];
      applyZoomRange(frozenRange, { left: edgePinned.left, right: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listFollow]);

  // A single click anywhere in a chart pauses autofollow, mirroring the
  // telegram list's row-area pause behavior, while a double-click is left
  // alone so it can keep the zoom reset path intact.
  const clearPendingSingleClick = () => {
    if (pendingSingleClickRef.current != null) {
      window.clearTimeout(pendingSingleClickRef.current);
      pendingSingleClickRef.current = null;
    }
  };

  const handleChartAreaClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isFollowing) return;
    const target = e.target as HTMLElement | null;
    const clickedOnChart = !!target?.closest('[data-chart-root]');
    if (!clickedOnChart) return;

    if (e.detail === 2) {
      clearPendingSingleClick();
      return;
    }
    if (e.detail !== 1) return;

    clearPendingSingleClick();
    pendingSingleClickRef.current = window.setTimeout(() => {
      pendingSingleClickRef.current = null;
      pauseAutoFollow();
    }, 220);
  };

  // Telegrams that arrived after the right edge was frozen, used only when no
  // shared buffer count is provided (standalone use).
  const pendingSinceFreeze = useMemo(() => {
    if (edgePinned.right) return 0;
    const frozenEdge = activeRange[1];
    let count = 0;
    for (const t of telegrams) {
      if (new Date(t.timestamp).getTime() > frozenEdge) count++;
    }
    return count;
  }, [telegrams, edgePinned.right, activeRange]);

  // Align the TimeBrush ruler's ends with each chart's left gutter / right
  // ruler-pad vertical marker lines (#358): both sit CHART_OUTER_INSET (the
  // chart card's 1rem padding + 1px border) plus the charts wrapper's own
  // padding away from the shared column edge, then the gutter/pad itself.
  const CHART_OUTER_INSET = 17;
  const chartsWrapperPad = embed ? 12 : 24;
  const rulerMultiDay = spansMultipleDays(activeRange[0], chartMaxTime);
  const chartRightRulerPad = rulerMultiDay ? 240 : 160;
  const rulerLeftInset = chartsWrapperPad + CHART_OUTER_INSET + sharedLeftGutter;
  const rulerRightInset = chartsWrapperPad + CHART_OUTER_INSET + chartRightRulerPad;

  // Deselecting a target clears any legend-hide on it, so reselecting the same
  // target shows its series again instead of staying invisible (#205).
  const handleTargetsChange = (next: string[]) => {
    const removed = selectedTargets.filter(a => !next.includes(a));
    if (removed.length > 0) clearSeriesHidden(removed);
    onTargetsChange(next);
  };

  useEffect(() => {
    if (selectedTargets.length === 0) return;
    const removed = selectedTargets.filter(address => !telegrams.some(telegram => telegram.target_address === address));
    if (removed.length > 0) {
      clearSeriesHidden(removed);
    }
  }, [selectedTargets, telegrams]);

  const toggleStepped = () => {
    setStepped(s => {
      const next = !s;
      setPref('chartStepped', String(next));
      return next;
    });
  };

  const toggleDots = () => {
    setShowDots(d => {
      const next = !d;
      setPref('chartDots', String(next));
      return next;
    });
  };

  const exportPng = () => {
    window.print();
  };

  const copyShareLink = async () => {
    if (!getShareLink) return;
    const absolute = new URL(getShareLink(), window.location.href).toString();
    try {
      await navigator.clipboard.writeText(absolute);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      window.prompt('Copy this link:', absolute);
    }
  };

  // With no active zoom the charts should track the data as the buffer grows, so
  // a new (or history-loaded) telegram that extends the range stays on screen
  // instead of dropping off a frozen scale (#340). A user zoom freezes it (#281).
  const autoFollow = currentZoomRange === null;

  const rightLabelTime = isFollowing ? liveNowMs : null;
  const showCurrentValueBand = isFollowing;

  const hasTimeDomain = minTime !== null && maxTime !== null && minTime < maxTime;
  const showAutoFollowPill = hasTimeDomain && !isFollowing;
  const showNowLabel = hasTimeDomain && isFollowing && rightLabelTime != null;
  const nowLabel = showNowLabel && (
    <div
      title="Current NOW time"
      style={{
        padding: '0.35rem 0.7rem',
        border: '1px solid var(--border-color)',
        borderRadius: '999px',
        background: 'var(--bg-inset)',
        color: 'var(--accent-primary)',
        fontSize: '0.75rem',
        fontWeight: 600,
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
      }}
    >
      {formatFullTime(rightLabelTime, spansMultipleDays(activeRange[0], chartMaxTime))}
    </div>
  );
  const autoFollowPill = showAutoFollowPill && (
    <AutoFollowPill count={pendingLiveCount ?? pendingSinceFreeze} onClick={toggleRightAutoFollow} />
  );

  const charts = (
    <div ref={chartWrapperRef} data-testid="visualization-chart-area" onClick={handleChartAreaClick} style={{ flex: 1, overflowY: 'auto', padding: embed ? '0.75rem' : '1.5rem' }}>
      {displayBuckets.map(g => (
        g.bucket.isBinary ? (
          <TimelineChart key={g.key} bucket={g.bucket} minTime={activeRange[0]} maxTime={chartMaxTime} showDots={showDots} autoFollow={autoFollow} onZoomRangeChange={setZoomRange} onTimeClick={(ms) => onTimeClick?.(ms, g.bucket.series.map(s => s.address))} leftGutter={sharedLeftGutter} rightLabelTime={rightLabelTime} showCurrentValueBand={showCurrentValueBand} />
        ) : g.bucket.isEvents ? (
          <EventDotsChart key={g.key} bucket={g.bucket} minTime={activeRange[0]} maxTime={chartMaxTime} autoFollow={autoFollow} onZoomRangeChange={setZoomRange} onTimeClick={(ms) => onTimeClick?.(ms, g.bucket.series.map(s => s.address))} leftGutter={sharedLeftGutter} rightLabelTime={rightLabelTime} showCurrentValueBand={showCurrentValueBand} />
        ) : (
          <MixedChart
            key={g.key} bucket={g.bucket} minTime={activeRange[0]} maxTime={chartMaxTime}
            stepped={stepped} showDots={showDots} autoFollow={autoFollow} onZoomRangeChange={setZoomRange}
            groupLabel={g.groupCount > 1 ? `${g.groupIndex}/${g.groupCount}` : undefined}
            // Only the unit's currently-open chart is lockable; earlier ones are permanently closed (#349).
            locked={g.isLatest ? (lockThresholds[g.bucket.unit]?.at(-1) === g.bucket.series.length) : undefined}
            onToggleLock={g.isLatest ? () => toggleLock(g.bucket.unit, g.bucket.series.length) : undefined}
            onTimeClick={(ms) => onTimeClick?.(ms, g.bucket.series.map(s => s.address))}
            leftGutter={sharedLeftGutter}
            rightLabelTime={rightLabelTime}
            showCurrentValueBand={showCurrentValueBand}
          />
        )
      ))}

      {buckets.length === 0 && selectedTargets.length > 0 && (
        <div style={{ color: 'var(--text-dim)', textAlign: 'center', marginTop: '3rem' }}>
          No plottable values (numeric or continuous) found for the selected targets.
        </div>
      )}
    </div>
  );

  if (embed) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-subtle)' }}>
        {/* Pan & zoom timeline sits above the charts it controls (#308). */}
        {minTime !== null && maxTime !== null && minTime < maxTime && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem' }}>
            <div style={{ flex: 1 }}>
              <TimeBrush
                minTime={minTime}
                maxTime={maxTime}
                value={activeRange}
                onChange={setZoomRange}
                telegrams={telegrams}
                leftPinned={edgePinned.left}
                rightPinned={edgePinned.right}
              />
            </div>
            {autoFollowPill}
          </div>
        )}
        {charts}
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Chart Area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg-subtle)' }}>
          <div style={{ padding: '1rem 1.5rem', position: 'relative', borderBottom: '1px solid var(--border-color)' }}>
            {minTime !== null && maxTime !== null && minTime < maxTime && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  pointerEvents: 'none',
                }}
              >
                <div style={{ width: '100%', pointerEvents: 'auto' }}>
                  <TimeBrush
                    minTime={minTime}
                    maxTime={maxTime}
                    value={activeRange}
                    onChange={setZoomRange}
                    telegrams={telegrams}
                    leftPinned={edgePinned.left}
                    rightPinned={edgePinned.right}
                    leftInset={rulerLeftInset}
                    rightInset={rulerRightInset}
                    compact
                  />
                </div>
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', position: 'relative', zIndex: 2, pointerEvents: 'none' }}>
              {/* Left zone spans the row's start up to the ruler's left edge, so
                  the buttons can center in the gap after the title (#391). */}
              <div style={{ width: Math.max(0, rulerLeftInset - chartsWrapperPad), flexShrink: 0, display: 'flex', alignItems: 'center', pointerEvents: 'auto' }}>
                <h3 style={{ fontSize: '1rem', margin: 0, flexShrink: 0 }}>Visualization</h3>
                {buckets.length > 0 && (
                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem' }}>
                  <button
                    onClick={toggleStepped}
                    title={stepped ? 'Switch to linear interpolation' : 'Switch to stepped (hold-last-value)'}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      width: 24, height: 24, border: '1px solid var(--border-color)',
                      borderRadius: '6px', cursor: 'pointer',
                      background: stepped ? 'rgba(99,102,241,0.15)' : 'transparent',
                      color: stepped ? 'var(--accent-primary)' : 'var(--text-dim)',
                    }}
                  >
                    <LineChart size={12} />
                  </button>
                  <button
                    onClick={toggleDots}
                    title={showDots ? 'Hide telegram dots' : 'Show a dot at each telegram (makes cyclic repeats visible)'}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      width: 24, height: 24, border: '1px solid var(--border-color)',
                      borderRadius: '6px', cursor: 'pointer',
                      background: showDots ? 'rgba(99,102,241,0.15)' : 'transparent',
                      color: showDots ? 'var(--accent-primary)' : 'var(--text-dim)',
                    }}
                  >
                    <CircleDot size={12} />
                  </button>
                  <button
                    className="icon-button"
                    onClick={exportPng}
                    title="Print / PDF Export"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, border: '1px solid var(--border-color)', borderRadius: '6px' }}
                  >
                    <Download size={12} />
                  </button>
                  </div>
                )}
              </div>

              {/* Middle spacer over the ruler track itself, non-interactive. */}
              <div style={{ flex: 1 }} />

              {/* Right zone spans the ruler's right edge up to the row's end, so
                  the pill can center in the gap before copy-link/close (#391).
                  justifyContent keeps close pinned top-right even without a
                  pill/copy-link filler to push it there. */}
              <div
                style={{
                  width: Math.max(0, rulerRightInset - chartsWrapperPad),
                  minWidth: '12rem',
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  gap: '0.5rem',
                  pointerEvents: 'auto',
                }}
              >
                {showAutoFollowPill && (
                  <div style={{ display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
                    {autoFollowPill}
                  </div>
                )}
                {nowLabel && (
                  <div style={{ display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
                    {nowLabel}
                  </div>
                )}
                {getShareLink && buckets.length > 0 && (
                    <button
                      className="icon-button"
                      onClick={() => void copyShareLink()}
                      title="Copy a shareable link to this visualization (filters, targets and time range)"
                      style={{
                        display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.85rem',
                        border: '1px solid var(--border-color)', borderRadius: '7px', fontSize: '0.8125rem',
                        color: linkCopied ? 'var(--success)' : undefined,
                      }}
                    >
                      {linkCopied ? <><Check size={16} /> Copied</> : <><Link2 size={16} /> Copy link</>}
                    </button>
                )}
                {/* Close X in the panel header, like every other main panel (#347). */}
                <button
                  className="icon-button"
                  onClick={onClose}
                  title="Close Visualization"
                  style={{ padding: '0.4rem', display: 'flex', color: 'var(--text-dim)', flexShrink: 0 }}
                >
                  <X size={18} />
                </button>
              </div>
            </div>
          </div>
          {charts}
        </div>
      </div>
    </div>
  );
};
