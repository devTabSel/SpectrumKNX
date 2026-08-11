import React, { useEffect, useRef, useLayoutEffect, useState, useMemo } from 'react';
import UplotReact from 'uplot-react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { LockOpen } from 'lucide-react';
import type { ChartBucket } from '../hooks/useChartData';
import { useThemeTick } from '../hooks/useTheme';
import { seriesColor } from '../utils/seriesColors';
import { computeSharedLeftGutter } from '../utils/chartGutter';
import { spansMultipleDays, formatAxisTime, formatFullTime } from '../utils/timeFormat';
import { isRightSideHoverActive, setRightSideHoverSource, subscribeRightSideHover } from '../utils/rightSideHoverSync';

interface EventDotsChartProps {
  bucket: ChartBucket;
  minTime: number | null;
  maxTime: number | null;
  rightLabelTime?: number | null;
  autoFollow?: boolean;
  onZoomRangeChange?: (value: [number, number] | null) => void;
  /** Click (not drag-select) on the chart: navigate to the telegram list around
   * this timestamp (#308). */
  onTimeClick?: (ms: number, chartTargets?: string[]) => void;
  /** Shared left-axis gutter (#... ) so every chart's X-axis starts at the same
   * pixel column; falls back to this chart's own bucket when not provided. */
  leftGutter?: number;
  /** Hide the right-side current-value band when no live NOW context is available. */
  showCurrentValueBand?: boolean;
}

const syncCursor = uPlot.sync('knx-time-axis');

/**
 * Discrete event dots for GAs that never resolve to a number or boolean —
 * text (DPT16) and other unchartable/complex payloads — grouped in one lane
 * group like the binary timeline (#341). Each dot is a standalone occurrence
 * (no forward-fill/held state); its tooltip/legend shows the telegram's
 * formatted value.
 */
export const EventDotsChart: React.FC<EventDotsChartProps> = ({ bucket, minTime, maxTime, autoFollow = false, onZoomRangeChange, onTimeClick, leftGutter: sharedLeftGutter, rightLabelTime, showCurrentValueBand = false }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const [width, setWidth] = useState(800);
  const themeTick = useThemeTick();
  const valueRefs = useRef<(HTMLDivElement | null)[]>([]);
  const hoverSourceIdRef = useRef(`events-${Math.random().toString(36).slice(2)}`);
  const rightBandLocalRef = useRef(false);
  const rightSideHoverRef = useRef(isRightSideHoverActive());
  const cursorActiveRef = useRef(false);
  const showCurrentValuesRef = useRef<() => void>(() => {});
  const clearValuesRef = useRef<() => void>(() => {});

  // Ref-read inside the stable draw/cursor plugins (same pattern as the other
  // charts) so live data/callback updates don't force a chart rebuild.
  const realRef = useRef<boolean[][]>([]);
  // eslint-disable-next-line react-hooks/refs
  realRef.current = bucket.series.map(s => s.real);
  const labelsRef = useRef<(string | null)[][]>([]);
  // eslint-disable-next-line react-hooks/refs
  labelsRef.current = bucket.series.map(s => s.labels ?? []);
  const onTimeClickRef = useRef(onTimeClick);
  // eslint-disable-next-line react-hooks/refs
  onTimeClickRef.current = onTimeClick;

  useEffect(() => {
    const unsub = subscribeRightSideHover((active) => {
      rightSideHoverRef.current = active;
      if (active) {
        showCurrentValuesRef.current();
      } else if (!cursorActiveRef.current) {
        clearValuesRef.current();
      }
    });
    return () => {
      setRightSideHoverSource(hoverSourceIdRef.current, false);
      unsub();
    };
  }, []);

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver(entries => {
      setWidth(entries[0].contentRect.width);
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const { series, timestamps } = bucket;
  const oldestBufferMs = timestamps.length > 0 ? timestamps[0] : null;
  const newestBufferMs = timestamps.length > 0 ? timestamps[timestamps.length - 1] : null;
  const visibleLeftMs = minTime ?? oldestBufferMs;
  const visibleRightMs = maxTime ?? newestBufferMs;
  const data: uPlot.AlignedData = [
    timestamps.map(t => t / 1000),
    ...series.map(s => s.data)
  ];

  const multiDay = minTime != null && maxTime != null && spansMultipleDays(minTime, maxTime);
  const LEFT_GUTTER = useMemo(
    () => sharedLeftGutter ?? computeSharedLeftGutter([bucket]),
    [sharedLeftGutter, bucket],
  );
  const rightRulerPad = multiDay ? 240 : 160;

  const rowHeight = 32;
  const rowGap = 4;
  // The bottom time axis + chart padding reserve a fixed amount of vertical
  // space regardless of content, so a generous floor is needed here or the
  // actual plot area (uPlot's bbox) can shrink to a sliver — the draw plugin
  // below still positions rows from the *real* bbox height, not this value,
  // but the row/legend heights on our own side need enough room to show in.
  const chartHeight = Math.max(160, series.length * (rowHeight + rowGap) + 60);

  // minTime/maxTime are deliberately excluded here — applied via setScale in
  // the effect below instead of forcing a full chart rebuild, so a live-
  // following right edge doesn't destroy/recreate the whole chart and
  // visibly blink (#358).
  const structureKey = [
    width, themeTick, LEFT_GUTTER, series.map(s => `${s.address}~${s.name}`).join('|'),
  ].join('§');

  const options: uPlot.Options = useMemo(() => {
    const style = getComputedStyle(document.documentElement);
    const gridStroke = style.getPropertyValue('--border-subtle').trim();
    const axisStroke = style.getPropertyValue('--text-dim').trim();
    const dotOutline = style.getPropertyValue('--bg-inset').trim();

    const eventsPlugin = () => ({
      hooks: {
        draw: [(u: uPlot) => {
          const { ctx } = u;
          const { left, top, width, height } = u.bbox;

          ctx.save();
          ctx.beginPath();
          ctx.rect(left, top, width, height);
          ctx.clip();

          const xs = u.data[0];
          const seriesCount = u.data.length - 1;
          const nameCenterOffset = Math.max(8, Math.round(rowHeight * 0.28));

          for (let sIdx = 0; sIdx < seriesCount; sIdx++) {
            // Keep dot rows aligned with the fixed GA/value rows rendered in
            // the left gutter overlay.
            const yTop = top + sIdx * (rowHeight + rowGap) + rowGap;
            const yMid = yTop + nameCenterOffset;
            const color = seriesColor(series[sIdx]?.address ?? String(sIdx));

            // Baseline for the row, so an empty stretch still reads as "this GA's lane".
            ctx.strokeStyle = gridStroke;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(left, yMid);
            ctx.lineTo(left + width, yMid);
            ctx.stroke();

            const real = realRef.current[sIdx];
            for (let i = 0; i < xs.length; i++) {
              if (!real?.[i]) continue;
              const x = u.valToPos(xs[i], 'x', true);
              ctx.beginPath();
              ctx.arc(x, yMid, 4.5, 0, Math.PI * 2);
              ctx.fillStyle = color;
              ctx.fill();
              ctx.lineWidth = 1.5;
              ctx.strokeStyle = dotOutline;
              ctx.stroke();
            }
          }

          ctx.restore();
        }]
      }
    });

    return {
      width,
      height: chartHeight,
      padding: [10, rightRulerPad, 0, 0],
      legend: { show: false },
      cursor: {
        sync: { key: syncCursor.key },
        drag: { x: true, y: false, setScale: false }
      },
      hooks: {
        setCursor: [
          (u) => {
            const idx = u.cursor.idx;
            const cursorActive = u.cursor.left != null && u.cursor.left >= 0 && idx != null;
            cursorActiveRef.current = cursorActive;
            const showCurrent = rightSideHoverRef.current;
            series.forEach((_s, sIdx) => {
              const el = valueRefs.current[sIdx];
              if (!el) return;
              const labels = labelsRef.current[sIdx] ?? [];
              let hoverLabel: string | null = null;
              if (cursorActive) {
                for (let i = idx; i >= 0; i--) {
                  if (labels[i] != null) {
                    hoverLabel = labels[i] as string;
                    break;
                  }
                }
              }
              const currentLabel = [...labels].reverse().find(l => l != null) ?? null;
              el.textContent = hoverLabel ?? (showCurrent ? (currentLabel ?? '') : '');
            });
          }
        ],
        setSelect: [
          (u) => {
            if (Math.abs(u.select.width) < 0.5) return;
            const plotLeft = u.bbox.left;
            const plotWidth = u.bbox.width;
            if (plotWidth <= 0) return;
            const plotRight = plotLeft + plotWidth;
            const rawA = u.select.left;
            const rawB = u.select.left + u.select.width;
            const unclampedLeft = Math.min(rawA, rawB);
            const unclampedRight = Math.max(rawA, rawB);
            const leftPx = Math.max(plotLeft, Math.min(plotRight, unclampedLeft));
            const rightPx = Math.max(leftPx, Math.min(plotRight, unclampedRight));
            const selectWidth = rightPx - leftPx;
            if (Math.abs(u.select.left - leftPx) > 0.5 || Math.abs(u.select.width - selectWidth) > 0.5) {
              u.setSelect({ left: leftPx, width: selectWidth, top: u.select.top, height: u.select.height }, false);
            }
            const min = u.posToVal(leftPx - plotLeft, 'x');
            const max = u.posToVal(rightPx - plotLeft, 'x');
            onZoomRangeChange?.([min * 1000, max * 1000]);
          }
        ],
        ready: [
          (u) => {
            plotRef.current = u;
            const showCurrentValues = () => {
              series.forEach((s, sIdx) => {
                const el = valueRefs.current[sIdx];
                if (!el) return;
                const labels = s.labels ?? [];
                const currentLabel = [...labels].reverse().find(l => l != null) ?? null;
                el.textContent = currentLabel ?? '';
              });
            };

            const clearValues = () => {
              series.forEach((_s, sIdx) => {
                const el = valueRefs.current[sIdx];
                if (el) el.textContent = '';
              });
            };
            showCurrentValuesRef.current = showCurrentValues;
            clearValuesRef.current = clearValues;

            // Navigate only when clicking the chart's time ruler (x-axis band)
            // below the plot area, not when clicking the plot or dots.
            // Keep the delayed single-click so double-click zoom reset wins.
            let clickTimer: ReturnType<typeof setTimeout> | null = null;
            let down: { x: number; y: number } | null = null;
            const clearSelection = () => {
              if (Math.abs(u.select.width) < 0.5 && Math.abs(u.select.height) < 0.5) return;
              window.requestAnimationFrame(() => {
                u.setSelect({ left: 0, width: 0, top: 0, height: 0 }, false);
              });
            };
            u.root.addEventListener('mousedown', (e) => { down = { x: e.clientX, y: e.clientY }; });
            window.addEventListener('mouseup', clearSelection);
            u.root.addEventListener('mouseup', (e) => {
              clearSelection();
              const start = down;
              down = null;
              if (!start) return;
              const movedPx = Math.hypot(e.clientX - start.x, e.clientY - start.y);
              if (movedPx >= 5) return;

              const pickDot = () => {
                const overRect = u.over.getBoundingClientRect();
                const withinOver =
                  e.clientX >= overRect.left &&
                  e.clientX <= overRect.right &&
                  e.clientY >= overRect.top &&
                  e.clientY <= overRect.bottom;
                if (!withinOver) return null;

                const xs = u.data[0] as number[];
                if (!xs || xs.length === 0) return null;

                const xVal = u.posToVal(e.clientX - overRect.left, 'x');
                let lo = 0;
                let hi = xs.length - 1;
                while (lo < hi) {
                  const mid = (lo + hi) >> 1;
                  if (xs[mid] < xVal) lo = mid + 1;
                  else hi = mid;
                }
                let idx = lo;
                if (idx > 0 && Math.abs(xs[idx - 1] - xVal) <= Math.abs(xs[idx] - xVal)) idx -= 1;

                const clickX = e.clientX - overRect.left;
                const clickY = e.clientY - overRect.top;
                const nameCenterOffset = Math.max(8, Math.round(rowHeight * 0.28));
                let best: { target: string; ms: number; dist: number } | null = null;

                for (let sIdx = 0; sIdx < series.length; sIdx++) {
                  if (!realRef.current[sIdx]?.[idx]) continue;
                  if ((u.data[sIdx + 1] as Array<number | null> | undefined)?.[idx] == null) continue;

                  const x = u.valToPos(xs[idx], 'x');
                  const y = sIdx * (rowHeight + rowGap) + rowGap + nameCenterOffset;
                  const dist = Math.hypot(clickX - x, clickY - y);
                  if (!best || dist < best.dist) {
                    best = { target: series[sIdx].address, ms: Math.round(xs[idx] * 1000), dist };
                  }
                }

                return best && best.dist <= 9 ? best : null;
              };

              const picked = pickDot();
              if (picked) {
                onTimeClickRef.current?.(picked.ms, [picked.target]);
                return;
              }

              const rootRect = u.root.getBoundingClientRect();
              const overRect = u.over.getBoundingClientRect();
              const inXAxisBand =
                e.clientX >= overRect.left &&
                e.clientX <= overRect.right &&
                e.clientY >= overRect.bottom &&
                e.clientY <= rootRect.bottom;
              if (!inXAxisBand) return;

              const ms = u.posToVal(e.clientX - overRect.left, 'x') * 1000;
              clickTimer = setTimeout(() => onTimeClickRef.current?.(ms), 250);
            });
            u.over.addEventListener('dblclick', () => {
              if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
              onZoomRangeChange?.(null);
            });

            // Hovering the ruler shows the same synced dashed cursor line as
            // hovering the plot itself (#308), pinned to the plot's bottom
            // edge since there's no data row to align a horizontal line to.
            u.root.addEventListener('mousemove', (e) => {
              const rootRect = u.root.getBoundingClientRect();
              const overRect = u.over.getBoundingClientRect();
              const withinOver =
                e.clientX >= overRect.left && e.clientX <= overRect.right &&
                e.clientY >= overRect.top && e.clientY <= overRect.bottom;
              const inRightValueBand =
                e.clientX > overRect.right && e.clientX <= rootRect.right &&
                e.clientY >= overRect.top && e.clientY <= overRect.bottom;

              if (inRightValueBand) {
                if (!rightBandLocalRef.current) {
                  rightBandLocalRef.current = true;
                  setRightSideHoverSource(hoverSourceIdRef.current, true);
                }
                u.setCursor({ left: -10, top: -10 });
                return;
              }

              if (rightBandLocalRef.current) {
                rightBandLocalRef.current = false;
                setRightSideHoverSource(hoverSourceIdRef.current, false);
              }

              if (withinOver) return; // native cursor handling already applies

              const inXAxisBand =
                e.clientX >= overRect.left && e.clientX <= overRect.right &&
                e.clientY > overRect.bottom && e.clientY <= rootRect.bottom;
              u.setCursor(inXAxisBand
                ? { left: e.clientX - overRect.left, top: overRect.height }
                : { left: -10, top: -10 });
            });
            u.root.addEventListener('mouseleave', () => {
              rightBandLocalRef.current = false;
              setRightSideHoverSource(hoverSourceIdRef.current, false);
              u.setCursor({ left: -10, top: -10 });
            });
          }
        ]
      },
      plugins: [eventsPlugin()],
      scales: {
        x: {
          time: true,
          min: minTime ? minTime / 1000 : undefined,
          max: maxTime ? maxTime / 1000 : undefined,
        },
        y: { auto: false, range: [0, 1] }
      },
      axes: [
        {
          space: multiDay ? 92 : 52,
          stroke: axisStroke,
          grid: { stroke: gridStroke },
          values: (_u, splits) => splits.map(v => formatAxisTime(v * 1000, multiDay))
        },
        {
          show: true,
          stroke: axisStroke,
          grid: { show: false },
          size: LEFT_GUTTER,
          values: () => []
        }
      ],
      series: [
        {
          value: (_u, v) => v == null ? '-' : formatFullTime(v * 1000, multiDay)
        },
        ...series.map((s) => ({
          label: s.name,
          show: false,
        }))
      ]
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureKey, rightRulerPad]);

  // Apply x-range changes to the live chart instance instead of rebuilding
  // `options` (which would destroy/recreate the whole uPlot and blink) —
  // covers both normal zoom/pan and the live-now ticking right edge (#358).
  useLayoutEffect(() => {
    const u = plotRef.current;
    if (!u || minTime == null || maxTime == null) return;
    u.setScale('x', { min: minTime / 1000, max: maxTime / 1000 });
  }, [minTime, maxTime, options]);

  const plotTop = 10;
  const edgeLineStyle: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '1px',
    background: 'var(--border-subtle)',
    pointerEvents: 'none',
    zIndex: 5,
  };

  return (
    <div style={{ marginBottom: '2rem', background: 'var(--bg-inset)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)', overflow: 'visible' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h4 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-main)' }}>
          Events (unchartable values)
        </h4>
        <button
          type="button"
          title="Lock"
          onClick={(e) => { e.stopPropagation(); }}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent',
            border: '1px solid var(--border-color)', borderRadius: '6px', width: 28, height: 28, padding: 0,
            cursor: 'pointer', color: 'var(--text-dim)',
          }}
        >
          <LockOpen size={12} />
        </button>
      </div>
      <div style={{ position: 'relative', width: '100%' }}>
        {/* HTML Legend Overlay on the left */}
        <div style={{
          position: 'absolute',
          left: '8px',
          top: `${plotTop + rowGap}px`,
          width: `${LEFT_GUTTER - 16}px`,
          height: `${chartHeight - plotTop - 30}px`,
          display: 'flex',
          flexDirection: 'column',
          pointerEvents: 'none',
          zIndex: 10,
        }}>
          {series.map((s, sIdx) => {
            const labels = s.labels ?? [];
            const lastLabel = [...labels].reverse().find(l => l != null) ?? null;
            return (
              <div
                key={s.address}
                style={{
                  height: `${rowHeight}px`,
                  marginBottom: `${rowGap}px`,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'flex-start',
                  fontSize: '0.75rem',
                  lineHeight: '1.2',
                }}
              >
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  minWidth: 0,
                }}>
                  <div
                    data-testid={`event-series-dot-${sIdx}`}
                    style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: seriesColor(s.address),
                      flexShrink: 0,
                      marginTop: '2px',
                    }}
                  />
                  <div style={{
                    fontWeight: 400,
                    color: 'var(--text-main)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    minWidth: 0,
                  }} title={s.name}>
                    {s.name}
                  </div>
                </div>
                <div
                  ref={el => { valueRefs.current[sIdx] = el; }}
                  style={{
                    fontSize: '0.7rem',
                    fontWeight: 400,
                    color: 'var(--text-dim)',
                    marginTop: '2px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={lastLabel ?? undefined}
                >
                  {''}
                </div>
              </div>
            );
          })}
        </div>
        {showCurrentValueBand && (
          <div style={{
            position: 'absolute',
            left: `calc(100% - ${rightRulerPad}px + 14px)`,
            top: `${plotTop + rowGap}px`,
            width: `${Math.max(0, rightRulerPad - 18)}px`,
            display: 'flex',
            flexDirection: 'column',
            pointerEvents: 'none',
            zIndex: 10,
          }}>
            {series.map((s) => {
              const labels = s.labels ?? [];
              const lastLabel = [...labels].reverse().find(l => l != null) ?? null;
              return (
                <div
                  key={`right-${s.address}`}
                  style={{
                    height: `${rowHeight}px`,
                    marginBottom: `${rowGap}px`,
                    display: 'flex',
                    alignItems: 'flex-start',
                    fontSize: '0.7rem',
                    fontWeight: 400,
                    color: 'var(--text-dim)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={lastLabel ?? undefined}
                >
                  {lastLabel ?? '–'}
                </div>
              );
            })}
          </div>
        )}
        <div ref={containerRef} data-chart-root style={{ width: '100%', overflow: 'visible' }}>
           <UplotReact options={options} data={data} resetScales={autoFollow} />
        </div>
        {/* Plot bounds markers for the chart area. */}
        <div style={{ ...edgeLineStyle, left: `${LEFT_GUTTER}px` }} />
        <div style={{ ...edgeLineStyle, right: `${rightRulerPad}px` }} />
        {visibleLeftMs != null && (
          <div
            style={{
              position: 'absolute',
              left: 0,
              bottom: '6px',
              width: `${Math.max(0, LEFT_GUTTER - 4)}px`,
              paddingRight: '4px',
              textAlign: 'right',
              fontSize: '0.68rem',
              lineHeight: 1,
              color: 'var(--text-dim)',
              fontVariantNumeric: 'tabular-nums',
              pointerEvents: 'none',
              zIndex: 6,
            }}
            title="Oldest telegram in visible range"
          >
            {formatFullTime(visibleLeftMs, multiDay)}
          </div>
        )}
        {visibleRightMs != null && (
          <div
            style={{
              position: 'absolute',
              left: `calc(100% - ${rightRulerPad}px)`,
              bottom: '6px',
              paddingLeft: '4px',
              textAlign: 'left',
              fontSize: '0.68rem',
              lineHeight: 1,
              color: 'var(--text-dim)',
              fontVariantNumeric: 'tabular-nums',
              pointerEvents: 'none',
              zIndex: 6,
              whiteSpace: 'nowrap',
            }}
            title="Newest telegram in visible range"
          >
            {formatFullTime(visibleRightMs, multiDay)}
          </div>
        )}
      </div>
    </div>
  );
};
