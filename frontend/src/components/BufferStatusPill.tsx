import { useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { format } from 'date-fns';
import {
  ChevronLeft,
  ChevronRight,
  CornerDownLeft,
  Download,
  FastForward,
  Rewind,
  Trash2,
  Play,
  Pause,
  Square,
} from 'lucide-react';
import { ThemedDatetimePicker } from './ThemedDatetimePicker';
import { SecondsField } from './SecondsField';
import { READING_END_LABEL, type ReadingEndCause } from '../utils/telegramDisplay';
import { classifyGotoTarget } from '../utils/gotoTarget';
import { parseRangePreset, RANGE_PRESETS } from '../utils/rangeWindow';

const INPUT_FMT = "yyyy-MM-dd'T'HH:mm:ss";
/** Local datetime-with-seconds display width (YYYY-MM-DDTHH:mm:ss). */
const DT_WIDTH_CH = INPUT_FMT.length;

export type ReadDirection = 'forward' | 'backward';
export type RangeUnit = 's' | 'm' | 'h' | 't';

const RANGE_UNITS: RangeUnit[] = ['s', 'm', 'h', 't'];
const RANGE_LIST_ID = 'monitor-range-presets';

/** Format canonical minutes into the active unit for the range field. `t` is days. */
export function formatRangeMinutes(minutes: number, unit: RangeUnit): string {
  if (unit === 's') return String(Math.round(minutes * 60));
  if (unit === 'h') {
    const h = minutes / 60;
    return Number.isInteger(h) ? String(h) : (Math.round(h * 100) / 100).toString();
  }
  if (unit === 't') {
    const d = minutes / (60 * 24);
    return Number.isInteger(d) ? String(d) : (Math.round(d * 100) / 100).toString();
  }
  return String(Math.round(minutes));
}

/** Convert a typed range value in `unit` back to whole minutes (≥ 1). */
export function rangeValueToMinutes(raw: string, unit: RangeUnit): number | null {
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  let minutes = n;
  if (unit === 's') minutes = n / 60;
  else if (unit === 'h') minutes = n * 60;
  else if (unit === 't') minutes = n * 60 * 24;
  const next = Math.max(1, Math.round(minutes));
  return next;
}

/** Positive number (optional one decimal) for the range draft. Preset labels pass through. */
export function sanitizeRangeInput(raw: string): string {
  if (parseRangePreset(raw)) return raw.trim();
  const t = raw.trim().replace(',', '.');
  if (t === '') return '';
  if (!/^(?:[1-9]\d*(?:\.\d*)?|0?\.\d+)$/.test(t)) return '';
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return '';
  // Keep trailing dot while typing ("1.") — blur will normalize.
  if (t.endsWith('.')) return t;
  return String(n);
}

export interface BufferStatusPillProps {
  /** Oldest telegram in the raw buffer (epoch ms), or null when empty. */
  oldestMs: number | null;
  /** Newest telegram in the raw buffer (epoch ms), or null when empty. */
  newestMs: number | null;
  /** Fill/eviction axis: forward = keep oldest, backward = keep newest. */
  readDirection: ReadDirection;
  /** Click the direction chevron to switch (clears + reloads via parent). */
  onReadDirectionChange: (dir: ReadDirection) => void;
  /** Max telegram count (settings); used for tooltip and full-color. */
  loadLimit: number;
  /** Editable time window in minutes. */
  rangeMinutes: number;
  onRangeMinutesChange: (n: number) => void;
  /** Editable cap shown after the range as `/ loadLimit`. */
  onLoadLimitChange?: (n: number) => void;
  /** x: rows after the side panel and the quick filter, without context rows. */
  filteredCount: number;
  /** y: rows the side panel would show with the quick filter off, or the raw total when it is off. */
  totalCount: number;
  /**
   * Raw buffer plus backlog. The range tooltip and the empty-buffer clear
   * stay on this figure. Defaults to `totalCount`.
   */
  unfilteredCount?: number;
  /** Quick filter is effective: show `x / y`. Otherwise show y. */
  filterActive: boolean;
  onClear: () => void;
  /**
   * Reading-end marker. `range` / `loadlimit` / `data` turn Clear orange and
   * name the reason. `loading` does not — the spinner owns that state.
   */
  readingEnd?: ReadingEndCause | null;
  /** Abort in-flight history load. */
  onCancelLoad: () => void;
  pauseTitle: string;
  pauseColor: string;
  pauseMode: 'playing' | 'auto' | 'manual';
  pauseDisabled: boolean;
  onTogglePause: () => void;
  busRate: number;
  rateMode: 's' | 'm' | 'h';
  onCycleRateMode: () => void;
  wsConnected: boolean;
  isHistoryLoading: boolean;
  /**
   * Backward read parked on a fixed anchor (not the live edge). The control
   * shows the auto-pause icon; a click still goes through `onTogglePause`.
   */
  fixedAnchor?: boolean;
  historyLoadError: string | null;
  /** Target is inside the buffer: scroll only. Direction and pause stay. */
  onScrollToTime: (ms: number) => void;
  /**
   * Typed Enter/Blur, or a Ctrl-click on the goto icon, when the time is
   * outside the buffer. The parent loads forward from an older target and
   * backward from a newer one.
   */
  onCommitOutside: (ms: number) => void;
  /** Load the buffer forward starting at the oldest telegram in the DB. */
  onLoadFromDbOldest: () => void;
  /** Load the buffer covering up to the newest telegram in the DB. */
  onLoadFromDbNewest: () => void;
}

const pillStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexWrap: 'wrap',
  gap: '0.45rem',
  maxWidth: '100%',
  minWidth: 0,
  boxSizing: 'border-box',
  background: 'var(--bg-subtle)',
  padding: '0.35rem 0.65rem',
  borderRadius: '8px',
  border: '1px solid var(--border-color)',
  fontSize: '0.75rem',
  color: 'var(--text-dim)',
};

const dtStyle: CSSProperties = {
  width: `${DT_WIDTH_CH}ch`,
  fontSize: '0.7rem',
  padding: '0.15rem 0.35rem',
  minHeight: 0,
  height: '1.55rem',
};

function msToInput(ms: number | null): string {
  return ms != null ? format(new Date(ms), INPUT_FMT) : '';
}

function parseCommitMs(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const ms = new Date(trimmed).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Monitor-table buffer status pill: rewind → oldest → goto → direction →
 * range → clear/spinner → direction → newest → goto → fast-forward →
 * play/pause → WS LED → rate → count → export.
 */
export function BufferStatusPill({
  oldestMs,
  newestMs,
  readDirection,
  onReadDirectionChange,
  loadLimit,
  rangeMinutes,
  onRangeMinutesChange,
  onLoadLimitChange,
  filteredCount,
  totalCount,
  unfilteredCount,
  filterActive,
  onClear,
  readingEnd = null,
  onCancelLoad,
  pauseTitle,
  pauseColor,
  pauseMode,
  pauseDisabled,
  onTogglePause,
  busRate,
  rateMode,
  onCycleRateMode,
  wsConnected,
  isHistoryLoading,
  fixedAnchor = false,
  historyLoadError,
  onScrollToTime,
  onCommitOutside,
  onLoadFromDbOldest,
  onLoadFromDbNewest,
}: BufferStatusPillProps) {
  const [oldestDraft, setOldestDraft] = useState(() => msToInput(oldestMs));
  const [newestDraft, setNewestDraft] = useState(() => msToInput(newestMs));
  const [rangeUnit, setRangeUnit] = useState<RangeUnit>('m');
  const [rangeDraft, setRangeDraft] = useState(() => formatRangeMinutes(rangeMinutes, 'm'));
  const [limitDraft, setLimitDraft] = useState(() => String(loadLimit));
  const [oldestFocused, setOldestFocused] = useState(false);
  const [newestFocused, setNewestFocused] = useState(false);
  const [rangeFocused, setRangeFocused] = useState(false);
  const [limitFocused, setLimitFocused] = useState(false);
  const oldestRef = useRef<HTMLInputElement>(null);
  const newestRef = useRef<HTMLInputElement>(null);
  const oldestCancel = useRef(false);
  const newestCancel = useRef(false);

  // Outside focus, always mirror buffer bounds.
  const [oldestBaseline, setOldestBaseline] = useState(oldestMs);
  if (oldestMs !== oldestBaseline) {
    setOldestBaseline(oldestMs);
    if (!oldestFocused) setOldestDraft(msToInput(oldestMs));
  }
  const [newestBaseline, setNewestBaseline] = useState(newestMs);
  if (newestMs !== newestBaseline) {
    setNewestBaseline(newestMs);
    if (!newestFocused) setNewestDraft(msToInput(newestMs));
  }
  const [rangeBaseline, setRangeBaseline] = useState(rangeMinutes);
  if (rangeMinutes !== rangeBaseline) {
    setRangeBaseline(rangeMinutes);
    if (!rangeFocused) setRangeDraft(formatRangeMinutes(rangeMinutes, rangeUnit));
  }
  const [limitBaseline, setLimitBaseline] = useState(loadLimit);
  if (loadLimit !== limitBaseline) {
    setLimitBaseline(loadLimit);
    if (!limitFocused) setLimitDraft(String(loadLimit));
  }

  const countText = filterActive
    ? `${filteredCount} / ${totalCount}`
    : String(totalCount);
  const countLabel = filterActive
    ? `${filteredCount} quick-filtered of ${totalCount}`
    : `${totalCount} in buffer and backlog`;

  const countWidthCh = useMemo(() => Math.max(1, countText.length), [countText]);

  const heldCount = unfilteredCount ?? totalCount;
  const bufferEmpty = heldCount <= 0;
  const endMarked = readingEnd === 'range' || readingEnd === 'loadlimit' || readingEnd === 'data';
  const rangeTitle = `${heldCount}/${loadLimit}`;
  const clearLabel = 'Clear (also wipes the local telegram cache).';
  const clearTitle = bufferEmpty
    ? 'Buffer is empty'
    : endMarked && readingEnd
      ? `${READING_END_LABEL[readingEnd]}. ${clearLabel}`
      : clearLabel;

  const OUTSIDE_GOTO_TITLE = 'Ctrl-Klick lädt nach';

  const applyTime = (raw: string, via: 'enter' | 'blur' | 'icon', ctrl: boolean, reset: () => void) => {
    const ms = parseCommitMs(raw);
    if (ms == null) {
      reset();
      return;
    }
    const place = classifyGotoTarget(ms, oldestMs, newestMs);
    if (place === 'inside') {
      onScrollToTime(ms);
      return;
    }
    // The icon only loads on Ctrl. Enter and blur still commit a typed time.
    if (via === 'icon' && !ctrl) return;
    onCommitOutside(ms);
  };

  const commitOldest = (raw: string, via: 'enter' | 'blur' | 'icon', ctrl = false) => {
    applyTime(raw, via, ctrl, () => setOldestDraft(msToInput(oldestMs)));
  };

  const commitNewest = (raw: string, via: 'enter' | 'blur' | 'icon', ctrl = false) => {
    applyTime(raw, via, ctrl, () => setNewestDraft(msToInput(newestMs)));
  };

  const jumpOldest = (raw: string, ctrl: boolean) => {
    const el = oldestRef.current;
    const focused = el != null && document.activeElement === el;
    if (focused) oldestCancel.current = true;
    commitOldest(raw, 'icon', ctrl);
    if (focused) el.blur();
  };

  const jumpNewest = (raw: string, ctrl: boolean) => {
    const el = newestRef.current;
    const focused = el != null && document.activeElement === el;
    if (focused) newestCancel.current = true;
    commitNewest(raw, 'icon', ctrl);
    if (focused) el.blur();
  };

  const oldestShown = parseCommitMs(oldestFocused ? oldestDraft : msToInput(oldestMs));
  const newestShown = parseCommitMs(newestFocused ? newestDraft : msToInput(newestMs));
  const oldestOutside = oldestShown != null && classifyGotoTarget(oldestShown, oldestMs, newestMs) !== 'inside';
  const newestOutside = newestShown != null && classifyGotoTarget(newestShown, oldestMs, newestMs) !== 'inside';

  const gotoStyle: CSSProperties = {
    color: 'var(--text-dim)',
    padding: '0.15rem',
    flexShrink: 0,
    opacity: isHistoryLoading ? 0.45 : 1,
    cursor: isHistoryLoading ? 'not-allowed' : 'pointer',
  };

  const commitRange = (raw: string = rangeDraft) => {
    const preset = parseRangePreset(raw);
    const unit = preset?.unit ?? rangeUnit;
    const sanitized = preset ? String(preset.value) : sanitizeRangeInput(raw);
    const next = rangeValueToMinutes(sanitized, unit);
    if (next == null) {
      setRangeDraft(formatRangeMinutes(rangeMinutes, rangeUnit));
      return;
    }
    if (preset) setRangeUnit(preset.unit);
    setRangeDraft(formatRangeMinutes(next, unit));
    if (next !== rangeMinutes) onRangeMinutesChange(next);
  };

  const commitLimit = (raw: string) => {
    const n = Number(raw.trim());
    if (!Number.isFinite(n) || n < 1) {
      setLimitDraft(String(loadLimit));
      return;
    }
    const next = Math.floor(n);
    setLimitDraft(String(next));
    if (next !== loadLimit) onLoadLimitChange?.(next);
  };

  const cycleRangeUnit = () => {
    const idx = RANGE_UNITS.indexOf(rangeUnit);
    const nextUnit = RANGE_UNITS[(idx + 1) % RANGE_UNITS.length];
    // A formatted echo of the committed window cycles without rounding drift
    // (days of a 1 h window are 0.04). A typed draft converts from that text.
    const fromDraft = rangeValueToMinutes(sanitizeRangeInput(rangeDraft), rangeUnit);
    const echoing = formatRangeMinutes(rangeMinutes, rangeUnit) === rangeDraft;
    const minutes = !echoing && fromDraft != null ? fromDraft : rangeMinutes;
    setRangeUnit(nextUnit);
    setRangeDraft(formatRangeMinutes(minutes, nextUnit));
  };

  const onRangeKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    // Apply immediately in the selected unit, then leave the field.
    commitRange((e.target as HTMLInputElement).value);
    (e.target as HTMLInputElement).blur();
  };

  const rangeAction = isHistoryLoading ? (
    <button
      type="button"
      className="icon-button"
      onClick={onCancelLoad}
      title={historyLoadError ? `Cancel loading (${historyLoadError})` : 'Cancel loading'}
      aria-label="Cancel loading"
      style={{ color: 'var(--accent-primary)', padding: 0, flexShrink: 0 }}
    >
      <span className="chip-spinner" style={{ width: 14, height: 14, display: 'inline-block' }} />
    </button>
  ) : (
    <button
      type="button"
      className="icon-button"
      onClick={() => onClear()}
      disabled={bufferEmpty}
      title={clearTitle}
      aria-label={clearLabel}
      style={{
        color: endMarked ? 'var(--warning-text)' : 'var(--text-dim)',
        padding: 0,
        flexShrink: 0,
        opacity: bufferEmpty ? 0.45 : 1,
        cursor: bufferEmpty ? 'not-allowed' : 'pointer',
      }}
    >
      <Trash2 size={14} />
    </button>
  );

  // Backward: icon left, value+unit right. Forward: value+unit left, icon right.
  const rangeIconLeft = readDirection === 'backward';
  // Forward has no live control — a visible, non-clickable Stop. A wrapper
  // carries the tooltip, because a disabled button does not show its own.
  // A fixed anchor in the past uses the auto-pause icon even while the mode
  // is still playing. Manual pause keeps its own icon. Offline only turns
  // the LED red; it does not replace this control.
  const forwardStop = readDirection === 'forward';
  const showAuto = !forwardStop && pauseMode !== 'manual' && (pauseMode === 'auto' || fixedAnchor);
  const controlLabel = forwardStop
    ? 'Stop'
    : showAuto
      ? 'Paused automatically'
      : pauseTitle;
  const controlTitle = forwardStop ? 'Kein Live in Leserichtung vorwärts' : controlLabel;
  const controlColor = forwardStop || showAuto ? 'var(--text-dim)' : pauseColor;
  const controlDisabled = forwardStop || pauseDisabled;

  return (
    <div data-buffer-status-pill="" style={pillStyle}>
      <datalist id={RANGE_LIST_ID}>
        {RANGE_PRESETS.map(preset => <option key={preset.label} value={preset.label}>{preset.label}</option>)}
      </datalist>
      <button
        type="button"
        className="icon-button"
        onClick={onLoadFromDbOldest}
        disabled={isHistoryLoading}
        title="Load from oldest telegram in database"
        aria-label="Load from oldest telegram in database"
        style={{
          color: 'var(--text-dim)',
          padding: '0.15rem',
          opacity: isHistoryLoading ? 0.45 : 1,
          cursor: isHistoryLoading ? 'not-allowed' : 'pointer',
        }}
      >
        <Rewind size={15} />
      </button>

      <ThemedDatetimePicker
        inputRef={oldestRef}
        value={oldestFocused ? oldestDraft : msToInput(oldestMs)}
        onChange={v => {
          setOldestFocused(true);
          setOldestDraft(v);
        }}
        withSeconds
        variant="field"
        aria-label="Oldest telegram in buffer"
        placeholder="Oldest"
        style={dtStyle}
        onBlur={() => {
          setOldestFocused(false);
          if (oldestCancel.current) {
            oldestCancel.current = false;
            setOldestDraft(msToInput(oldestMs));
            return;
          }
          commitOldest(oldestRef.current?.value ?? oldestDraft, 'blur');
        }}
        onKeyDown={e => {
          if (e.key === 'Escape') {
            oldestCancel.current = true;
            setOldestDraft(msToInput(oldestMs));
            return;
          }
          if (e.key !== 'Enter') return;
          e.preventDefault();
          const el = e.currentTarget as HTMLInputElement;
          if (document.activeElement === el) oldestCancel.current = true;
          commitOldest(el.value, 'enter');
          if (document.activeElement === el) el.blur();
        }}
      />
      <button
        type="button"
        className="icon-button"
        aria-label="Go to oldest time"
        title={oldestOutside ? OUTSIDE_GOTO_TITLE : 'Go to oldest time'}
        disabled={isHistoryLoading}
        onMouseDown={e => e.preventDefault()}
        onClick={e => jumpOldest(
          oldestRef.current?.value ?? (oldestFocused ? oldestDraft : msToInput(oldestMs)),
          e.ctrlKey || e.metaKey,
        )}
        style={{ ...gotoStyle, color: oldestOutside ? 'var(--warning-text)' : gotoStyle.color }}
      >
        <CornerDownLeft size={13} />
      </button>

      {readDirection === 'forward' ? (
        <button
          type="button"
          className="icon-button"
          title="Reading forward — click for backward"
          aria-label="Reading forward"
          onClick={() => onReadDirectionChange('backward')}
          style={{ color: 'var(--accent-primary)', padding: '0.15rem', flexShrink: 0 }}
        >
          <ChevronRight size={14} />
        </button>
      ) : null}

      <SecondsField
        value={rangeDraft}
        onChange={v => {
          setRangeFocused(true);
          setRangeDraft(v);
        }}
        placeholder="range"
        title={rangeTitle}
        ariaLabel="Buffer range"
        unit={rangeUnit}
        alwaysShowUnit
        sanitize={sanitizeRangeInput}
        onUnitClick={cycleRangeUnit}
        list={RANGE_LIST_ID}
        unitTitle="Cycle range unit (s / m / h / t)"
        textAlign={rangeIconLeft ? 'right' : 'left'}
        startSlot={rangeIconLeft ? rangeAction : undefined}
        endSlot={rangeIconLeft ? undefined : rangeAction}
        onBlur={sanitized => {
          setRangeFocused(false);
          commitRange(sanitized);
        }}
        onKeyDown={onRangeKeyDown}
      />

      <span aria-hidden style={{ color: 'var(--text-dim)', flexShrink: 0 }}>/</span>
      <input
        aria-label="Load limit"
        value={limitFocused ? limitDraft : String(loadLimit)}
        onChange={e => {
          setLimitFocused(true);
          setLimitDraft(e.target.value);
        }}
        onFocus={() => setLimitFocused(true)}
        onBlur={e => {
          setLimitFocused(false);
          commitLimit(e.currentTarget.value);
        }}
        onKeyDown={e => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          const raw = (e.target as HTMLInputElement).value;
          commitLimit(raw);
          (e.target as HTMLInputElement).blur();
        }}
        inputMode="numeric"
        title="Load limit"
        style={{
          width: `${Math.max(4, String(loadLimit).length)}ch`,
          border: 'none',
          outline: 'none',
          background: 'transparent',
          color: 'var(--text-main)',
          font: 'inherit',
          fontSize: '0.72rem',
          padding: 0,
          flexShrink: 0,
        }}
      />

      {readDirection === 'backward' ? (
        <button
          type="button"
          className="icon-button"
          title="Reading backward — click for forward"
          aria-label="Reading backward"
          onClick={() => onReadDirectionChange('forward')}
          style={{ color: 'var(--accent-primary)', padding: '0.15rem', flexShrink: 0 }}
        >
          <ChevronLeft size={14} />
        </button>
      ) : null}

      <ThemedDatetimePicker
        inputRef={newestRef}
        value={newestFocused ? newestDraft : msToInput(newestMs)}
        onChange={v => {
          setNewestFocused(true);
          setNewestDraft(v);
        }}
        withSeconds
        variant="field"
        aria-label="Newest telegram in buffer"
        placeholder="Newest"
        style={dtStyle}
        onBlur={() => {
          setNewestFocused(false);
          if (newestCancel.current) {
            newestCancel.current = false;
            setNewestDraft(msToInput(newestMs));
            return;
          }
          commitNewest(newestRef.current?.value ?? newestDraft, 'blur');
        }}
        onKeyDown={e => {
          if (e.key === 'Escape') {
            newestCancel.current = true;
            setNewestDraft(msToInput(newestMs));
            return;
          }
          if (e.key !== 'Enter') return;
          e.preventDefault();
          const el = e.currentTarget as HTMLInputElement;
          if (document.activeElement === el) newestCancel.current = true;
          commitNewest(el.value, 'enter');
          if (document.activeElement === el) el.blur();
        }}
      />
      <button
        type="button"
        className="icon-button"
        aria-label="Go to newest time"
        title={newestOutside ? OUTSIDE_GOTO_TITLE : 'Go to newest time'}
        disabled={isHistoryLoading}
        onMouseDown={e => e.preventDefault()}
        onClick={e => jumpNewest(
          newestRef.current?.value ?? (newestFocused ? newestDraft : msToInput(newestMs)),
          e.ctrlKey || e.metaKey,
        )}
        style={{ ...gotoStyle, color: newestOutside ? 'var(--warning-text)' : gotoStyle.color }}
      >
        <CornerDownLeft size={13} />
      </button>

      <button
        type="button"
        className="icon-button"
        onClick={onLoadFromDbNewest}
        disabled={isHistoryLoading}
        title="Load up to newest telegram in database"
        aria-label="Load up to newest telegram in database"
        style={{
          color: 'var(--text-dim)',
          padding: '0.15rem',
          opacity: isHistoryLoading ? 0.45 : 1,
          cursor: isHistoryLoading ? 'not-allowed' : 'pointer',
        }}
      >
        <FastForward size={15} />
      </button>

      <span title={controlTitle} style={{ display: 'inline-flex' }}>
        <button
          type="button"
          className="icon-button"
          onClick={onTogglePause}
          title={controlTitle}
          aria-label={controlLabel}
          disabled={controlDisabled}
          style={{
            color: controlColor,
            padding: '0.15rem',
            opacity: controlDisabled ? 0.45 : 1,
            cursor: controlDisabled ? 'not-allowed' : 'pointer',
          }}
        >
          {forwardStop
            ? <Square size={15} fill="currentColor" />
            : showAuto || pauseMode !== 'playing'
              ? <Pause size={15} fill="currentColor" />
              : <Play size={15} fill="currentColor" />}
        </button>
      </span>

      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.4rem',
          flexShrink: 0,
        }}
        title={wsConnected ? 'WebSocket active' : 'WebSocket offline'}
      >
        <span
          aria-label={wsConnected ? 'WebSocket active' : 'WebSocket offline'}
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: wsConnected ? 'var(--success)' : 'var(--error)',
            boxShadow: wsConnected
              ? '0 0 0 2px color-mix(in srgb, var(--success) 35%, transparent)'
              : '0 0 0 2px color-mix(in srgb, var(--error) 35%, transparent)',
            flexShrink: 0,
          }}
        />
        <span
          onClick={onCycleRateMode}
          style={{ color: 'var(--accent-primary)', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
          title="Cycle rate window (s / m / h)"
        >
          {busRate.toFixed(1)}/{rateMode}
        </span>
      </span>

      <span
        style={{
          color: 'var(--text-main)',
          fontWeight: 500,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'flex-start',
          fontFamily: 'var(--font-mono, ui-monospace, monospace)',
          width: `${countWidthCh}ch`,
          minWidth: `${countWidthCh}ch`,
          fontVariantNumeric: 'tabular-nums',
          textAlign: 'left',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
        title={countLabel}
        aria-label={countLabel}
      >
        {countText}
      </span>

      <button
        type="button"
        className="icon-button"
        disabled
        title="Export (coming soon)"
        aria-label="Export (coming soon)"
        style={{ color: 'var(--text-dim)', padding: '0.15rem', opacity: 0.45, cursor: 'not-allowed' }}
      >
        <Download size={15} />
      </button>
    </div>
  );
}
