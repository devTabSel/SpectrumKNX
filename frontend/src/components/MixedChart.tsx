import React, { useEffect, useRef, useLayoutEffect, useState, useMemo } from 'react';
import UplotReact from 'uplot-react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import { Lock, LockOpen } from 'lucide-react';
import type { ChartBucket } from '../hooks/useChartData';
import { useThemeTick } from '../hooks/useTheme';
import { seriesColor } from '../utils/seriesColors';
import { isSeriesHidden, setSeriesHidden } from '../utils/legendVisibility';
import { computeSharedLeftGutter } from '../utils/chartGutter';
import { spansMultipleDays, formatAxisTime, formatFullTime } from '../utils/timeFormat';
import { isRightSideHoverActive, setRightSideHoverSource, subscribeRightSideHover } from '../utils/rightSideHoverSync';

interface MixedChartProps {
  bucket: ChartBucket;
  minTime: number | null;
  maxTime: number | null;
  stepped: boolean;
  rightLabelTime?: number | null;
  /** Draw a dot at each telegram timestamp so cyclic repeats are visible (#195). */
  showDots: boolean;
  /** When true (no active zoom), let the chart re-fit to new data so a telegram
   * that extends the range stays visible instead of falling off a frozen scale
   * (#340). When zoomed, stays false to preserve the app-controlled range (#281). */
  autoFollow?: boolean;
  onZoomRangeChange?: (value: [number, number] | null) => void;
  /** "2/3" when this is one of several charts split off this metric by locking (#349). */
  groupLabel?: string;
  /** Whether this (the unit's currently-open) chart is locked against further GAs (#349). */
  locked?: boolean;
  onToggleLock?: () => void;
  /** Click (not drag-select) on the chart: navigate to the telegram list around
   * this timestamp (#308). */
  onTimeClick?: (ms: number, chartTargets?: string[]) => void;
  /** Shared left-axis gutter (#... ) so every chart's X-axis starts at the same
   * pixel column; falls back to this chart's own bucket when not provided. */
  leftGutter?: number;
}

// Ensure we have a shared sync cursor across all charts
const syncCursor = uPlot.sync('knx-time-axis');

export const MixedChart: React.FC<MixedChartProps> = ({
  bucket, minTime, maxTime, stepped, showDots, autoFollow = false, onZoomRangeChange,
  groupLabel, locked, onToggleLock, onTimeClick, leftGutter: sharedLeftGutter, rightLabelTime,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const [width, setWidth] = useState(800);
  const [, setLegendVersion] = useState(0);
  const themeTick = useThemeTick();
  // Ref-read inside the stable `ready` hook (same pattern as realIndicesRef
  // below) so a new onTimeClick identity each render doesn't rebuild the chart.
  const onTimeClickRef = useRef(onTimeClick);
  const hoverSourceIdRef = useRef(`mixed-${Math.random().toString(36).slice(2)}`);
  const rightBandLocalRef = useRef(false);
  const rightSideHoverRef = useRef(isRightSideHoverActive());
  const cursorActiveRef = useRef(false);
  const showCurrentValuesRef = useRef<() => void>(() => {});
  const clearValuesRef = useRef<() => void>(() => {});
  // eslint-disable-next-line react-hooks/refs
  onTimeClickRef.current = onTimeClick;

  // Resize observer to keep chart fluid
  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver(entries => {
      setWidth(entries[0].contentRect.width);
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const { unit, isBinary, timestamps, series } = bucket;
  const oldestBufferMs = timestamps.length > 0 ? timestamps[0] : null;
  const newestBufferMs = timestamps.length > 0 ? timestamps[timestamps.length - 1] : null;
  const chartHeight = isBinary ? Math.max(150, series.length * 50) : 300;
  const leftGutter = useMemo(
    () => sharedLeftGutter ?? computeSharedLeftGutter([bucket]),
    [sharedLeftGutter, bucket],
  );

  // Show a date alongside times once the visible range crosses midnight (#281).
  const multiDay = minTime != null && maxTime != null && spansMultipleDays(minTime, maxTime);
  const rightRulerPad = multiDay ? 240 : 160;

  // Prepare data array: [ [x], [y1], [y2] ]
  // We divide timestamps by 1000 since uPlot expects unix seconds by default
  const data: uPlot.AlignedData = useMemo(() => {
    const xs = [...timestamps];
    const ys = series.map(s => [...s.data]);

    // Metrics: visually carry the latest value almost to the right boundary so
    // the line does not stop abruptly before the chart edge.
    if (!isBinary && xs.length > 0 && maxTime != null) {
      const lastTs = xs[xs.length - 1];
      if (lastTs < maxTime) {
        const firstTs = minTime ?? xs[0];
        const spanMs = Math.max(1, maxTime - firstTs);
        const gapMs = Math.max(1, Math.round(spanMs * 0.005));
        const extendTs = Math.max(lastTs, maxTime - gapMs);
        if (extendTs > lastTs) {
          xs.push(extendTs);
          ys.forEach((arr) => {
            arr.push(arr[arr.length - 1] ?? null);
          });
        }
      }
    }

    return [xs.map(t => t / 1000), ...ys];
  }, [timestamps, series, isBinary, minTime, maxTime]);

  // Only the chart's *structure* (size, theme, series identity, unit) should
  // rebuild `options`; a new telegram changes `data`, not `options`, so
  // uplot-react updates via setData instead of destroying and recreating the
  // chart — which would drop the cursor/hover on every telegram (#207).
  // minTime/maxTime are deliberately excluded here — they're applied via
  // setScale in the effect below instead of forcing a full chart rebuild,
  // so a live-following right edge (#... ticking every second) doesn't
  // destroy/recreate the whole chart and visibly blink (#358).
  const structureKey = [
    width, isBinary, unit, stepped, showDots, themeTick, leftGutter,
    series.map(s => `${s.address}~${s.name}`).join('|'),
  ].join('§');

  // Indices (per series) where an actual telegram was received, so dots mark
  // real receipts rather than every forward-filled column (#195). Held in a ref
  // that is refreshed every render, so the points.filter (kept in the stable
  // memoized options for #207) reads live data instead of a stale snapshot.
  const realIndicesRef = useRef<number[][]>([]);
  // Written in render (not an effect) so it is fresh before uPlot's child draw
  // effect runs on this commit; only ever read inside the imperative points
  // filter, never during React render.
  // eslint-disable-next-line react-hooks/refs
  realIndicesRef.current = series.map(s => s.real.flatMap((r, i) => (r ? [i] : [])));
  const realRef = useRef<boolean[][]>([]);
  // eslint-disable-next-line react-hooks/refs
  realRef.current = series.map(s => s.real);

  // Fixed legend (#349): unlike uPlot's native legend, this doesn't move
  // around under the cursor. Each row's value tracks the hovered x-position
  // (or the series' last value while not hovering).
  const legendValueRefs = useRef<(HTMLSpanElement | null)[]>([]);

  const toggleSeriesVisibility = (seriesIdx: number) => {
    const u = plotRef.current;
    if (!u) return;
    const uSeriesIdx = seriesIdx + 1;
    const current = !!u.series[uSeriesIdx]?.show;
    u.setSeries(uSeriesIdx, { show: !current });
  };

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

  const options: uPlot.Options = useMemo(() => {
    const style = getComputedStyle(document.documentElement);
    const gridStroke = style.getPropertyValue('--border-subtle').trim();
    const axisStroke = style.getPropertyValue('--text-dim').trim();

    // Configure Y-Axis scale limits based on smart defaults
    let scaleConfig: uPlot.Scale = {};
    if (!isBinary && (unit === '%' || unit === 'Hz' || unit === 'W')) {
      scaleConfig = {
        auto: true,
        range: (_u, _min, max) => {
          const hardMin = 0;
          return [hardMin, max > hardMin ? max * 1.1 : 100];
        }
      };
    } else if (isBinary) {
      scaleConfig = { auto: false, range: [-0.1, 1.1] };
    }

    const currentValueMarkersPlugin = () => ({
      hooks: {
        draw: [(u: uPlot) => {
          if (isBinary) return;
          const { ctx } = u;
          const { left, top, width, height } = u.bbox;
          const xSep = left + width;
          const x2 = Math.max(left + width + 20, u.width - 8);
          const x1 = Math.min(xSep + 14, x2 - 24);

          ctx.save();

          series.forEach((s, sIdx) => {
            if (isSeriesHidden(s.address)) return;
            const yData = u.data[sIdx + 1] as Array<number | null> | undefined;
            if (!yData || yData.length === 0) return;
            let val: number | null = null;
            for (let i = yData.length - 1; i >= 0; i--) {
              const v = yData[i];
              if (v != null) {
                val = v;
                break;
              }
            }
            if (val == null) return;
            // Draw plugin runs in canvas coordinates, so use canvas-space pos
            // to keep marker perfectly aligned with plotted lines/scale.
            const yRaw = u.valToPos(val, 'y', true);
            if (!Number.isFinite(yRaw)) return;
            const y = Math.max(top + 1, Math.min(top + height - 1, yRaw));

            // Continue the horizontal grid feel into the right-side value area.
            ctx.beginPath();
            ctx.moveTo(x1, y);
            ctx.lineTo(x2, y);
            ctx.lineWidth = 1;
            ctx.strokeStyle = gridStroke;
            ctx.stroke();

            // Colored marker on top for the series' current value.
            ctx.beginPath();
            ctx.moveTo(x1, y);
            ctx.lineTo(x2, y);
            ctx.lineWidth = 2;
            ctx.strokeStyle = seriesColor(s.address);
            ctx.stroke();
          });

          ctx.restore();
        }]
      }
    });

    return {
      width,
      height: chartHeight,
      padding: [8, rightRulerPad, 0, 0],
      legend: { show: false }, // replaced by the fixed overlay legend below (#349)
      cursor: {
        sync: { key: syncCursor.key },
        drag: { x: true, y: false, setScale: false }
      },
      hooks: {
        // Record legend show/hide toggles so they survive chart recreation (#192).
        // Use the requested value from `opts.show` rather than reading it back
        // off `u.series[idx].show`, which uPlot only commits after this hook —
        // reading the stale value lagged the store by one click and made the
        // legend appear to need a second click to stick (#205).
        setSeries: [(_u, idx, opts) => {
          if (idx == null || idx === 0 || !('show' in opts)) return;
          const addr = series[idx - 1]?.address;
          if (addr) setSeriesHidden(addr, !opts.show);
          setLegendVersion(v => v + 1);
        }],
        setCursor: [
          (u) => {
            const idx = u.cursor.idx;
            const cursorActive = u.cursor.left != null && u.cursor.left >= 0 && idx != null;
            cursorActiveRef.current = cursorActive;
            const showCurrent = rightSideHoverRef.current;
            series.forEach((s, sIdx) => {
              const val = showCurrent ? s.data[s.data.length - 1] : cursorActive ? s.data[idx] : null;
              const el = legendValueRefs.current[sIdx];
              if (el) {
                el.textContent = val == null ? '' : isBinary ? (val === 1 ? 'On' : 'Off') : `${val} ${unit}`;
              }
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
                const el = legendValueRefs.current[sIdx];
                if (!el) return;
                const val = s.data[s.data.length - 1];
                el.textContent = val == null ? '' : isBinary ? (val === 1 ? 'On' : 'Off') : `${val} ${unit}`;
              });
            };

            const clearValues = () => {
              series.forEach((_s, sIdx) => {
                const el = legendValueRefs.current[sIdx];
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
                let best: { target: string; ms: number; dist: number } | null = null;

                for (let sIdx = 0; sIdx < series.length; sIdx++) {
                  const target = series[sIdx]?.address;
                  if (!target || isSeriesHidden(target)) continue;
                  if (!realRef.current[sIdx]?.[idx]) continue;
                  const yData = u.data[sIdx + 1] as Array<number | null> | undefined;
                  const yVal = yData?.[idx];
                  if (yVal == null) continue;
                  const x = u.valToPos(xs[idx], 'x');
                  const y = u.valToPos(yVal, 'y');
                  const dist = Math.hypot(clickX - x, clickY - y);
                  if (!best || dist < best.dist) {
                    best = { target, ms: Math.round(xs[idx] * 1000), dist };
                  }
                }

                return best && best.dist <= 8 ? best : null;
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
      scales: {
        x: {
          time: true,
          min: minTime ? minTime / 1000 : undefined,
          max: maxTime ? maxTime / 1000 : undefined,
        },
        y: scaleConfig
      },
      plugins: [currentValueMarkersPlugin()],
      axes: [
        {
          // Wider minimum tick spacing when labels carry a date, so the
          // "MM-DD HH:mm" ticks don't overlap into an unreadable ruler (#314).
          space: multiDay ? 92 : 52,
          grid: { stroke: gridStroke, width: 1 },
          stroke: axisStroke,
          values: (_u, splits) => splits.map(v => formatAxisTime(v * 1000, multiDay))
        },
        {
          space: 30,
          gap: 0,
          grid: { stroke: gridStroke, width: 1 },
          stroke: axisStroke,
          size: leftGutter,
          values: isBinary
            ? (_u, splits) => splits.map(v => v === 1 ? 'ON' : v === 0 ? 'OFF' : '')
            : undefined
        }
      ],
      series: [
        {
          value: (_u, v) => v == null ? '-' : formatFullTime(v * 1000, multiDay)
        },
        ...series.map((s, sIdx) => ({
          label: s.name,
          show: !isSeriesHidden(s.address),
          stroke: seriesColor(s.address),
          width: 2,
          spanGaps: true,
          paths: (isBinary || stepped) ? uPlot.paths.stepped?.({ align: 1 }) : undefined,
          fill: isBinary ? seriesColor(s.address) + '33' : undefined,
          points: showDots
            ? { show: true, size: 5, space: 0, filter: () => realIndicesRef.current[sIdx] ?? null }
            : { show: false },
          value: (_u: uPlot, v: number | null) => {
            if (v === null) return '-';
            if (isBinary) return v === 1 ? 'On' : 'Off';
            return v + ' ' + unit;
          }
        }))
      ]
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureKey, rightRulerPad, chartHeight]);

  // Apply x-range changes to the live chart instance instead of rebuilding
  // `options` (which would destroy/recreate the whole uPlot and blink) —
  // covers both normal zoom/pan and the live-now ticking right edge (#358).
  useLayoutEffect(() => {
    const u = plotRef.current;
    if (!u || minTime == null || maxTime == null) return;
    u.setScale('x', { min: minTime / 1000, max: maxTime / 1000 });
  }, [minTime, maxTime, options]);

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
    <div style={{ marginBottom: '2rem', background: 'var(--bg-inset)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h4 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          {isBinary ? 'Binary States (Ein/Aus)' : `Metrics (${unit})`}
          {groupLabel && (
            <span style={{ fontSize: '0.7rem', fontWeight: 400, color: 'var(--text-dim)' }}>{groupLabel}</span>
          )}
        </h4>
        {onToggleLock && (
          <button
            onClick={onToggleLock}
            title={locked
              ? 'Unlock: further selected GAs of this metric will join this chart again'
              : 'Lock: prevent further selected GAs of this metric from crowding this chart — they start a new one instead'}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent',
              border: '1px solid var(--border-color)', borderRadius: '6px', width: 28, height: 28, padding: 0,
              cursor: 'pointer',
              color: locked ? 'var(--accent-primary)' : 'var(--text-dim)',
            }}
          >
            {locked ? <Lock size={12} /> : <LockOpen size={12} />}
          </button>
        )}
      </div>
      <div style={{ position: 'relative' }}>
        <div style={{
          position: 'absolute',
          left: '8px',
          top: '8px',
          width: `${Math.max(0, leftGutter - 16)}px`,
          display: 'flex',
          flexDirection: 'column',
          gap: '0.25rem',
          zIndex: 10,
        }}>
          {series.map((s, sIdx) => {
            const isShown = !isSeriesHidden(s.address);
            return (
              <div
                key={s.address}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '12px minmax(0, 1fr)',
                  columnGap: '0.4rem',
                  alignItems: 'start',
                  opacity: isShown ? 1 : 0.5,
                }}
              >
                <button
                  type="button"
                  onClick={() => toggleSeriesVisibility(sIdx)}
                  title={isShown ? 'Disable series' : 'Enable series'}
                  style={{
                    width: '10px',
                    height: '10px',
                    borderRadius: '50%',
                    border: `1px solid ${seriesColor(s.address)}`,
                    background: isShown ? seriesColor(s.address) : 'transparent',
                    marginTop: '2px',
                    padding: 0,
                    cursor: 'pointer',
                  }}
                />
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: '0.75rem',
                      fontWeight: 400,
                      color: 'var(--text-main)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={s.name}
                  >
                    {s.name}
                  </div>
                  <div
                    ref={el => { legendValueRefs.current[sIdx] = el; }}
                    style={{
                      display: 'block',
                      height: '14px',
                      minHeight: '14px',
                      maxHeight: '14px',
                      lineHeight: '14px',
                      fontSize: '0.7rem',
                      fontWeight: 400,
                      color: 'var(--text-dim)',
                      fontVariantNumeric: 'tabular-nums',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {''}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div ref={containerRef} style={{ width: '100%', overflow: 'hidden', position: 'relative' }}>
           {/* Re-fit to new data only while not zoomed (#340): keeps a new telegram
               visible instead of dropping off a frozen scale. When the user has
               zoomed, autoFollow is false so the range is preserved (#281). */}
           <UplotReact options={options} data={data} resetScales={autoFollow} />
        </div>
        {/* Plot bounds markers for the chart area. */}
        <div style={{ ...edgeLineStyle, left: `${leftGutter}px` }} />
        <div style={{ ...edgeLineStyle, right: `${rightRulerPad}px` }} />
        {oldestBufferMs != null && (
          <div
            style={{
              position: 'absolute',
              left: 0,
              bottom: '6px',
              width: `${Math.max(0, leftGutter - 4)}px`,
              paddingRight: '4px',
              textAlign: 'right',
              fontSize: '0.68rem',
              lineHeight: 1,
              color: 'var(--text-dim)',
              fontVariantNumeric: 'tabular-nums',
              pointerEvents: 'none',
              zIndex: 6,
            }}
            title="Oldest telegram in buffer"
          >
            {formatFullTime(oldestBufferMs, multiDay)}
          </div>
        )}
        {newestBufferMs != null && (
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
            title="Newest telegram in buffer"
          >
            {formatFullTime(newestBufferMs, multiDay)}
          </div>
        )}
        {rightLabelTime != null && (
          <div
            style={{
              position: 'absolute',
              right: '8px',
              bottom: '24px',
              fontSize: '0.68rem',
              lineHeight: 1,
              color: 'var(--accent-primary)',
              fontVariantNumeric: 'tabular-nums',
              pointerEvents: 'none',
              zIndex: 6,
              whiteSpace: 'nowrap',
            }}
            title="Current NOW time"
          >
            {formatFullTime(rightLabelTime, multiDay)}
          </div>
        )}
      </div>
    </div>
  );
};
