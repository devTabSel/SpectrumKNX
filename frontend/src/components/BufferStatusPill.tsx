import {
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { format } from 'date-fns';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  FastForward,
  Rewind,
  Trash2,
  Play,
  Pause,
} from 'lucide-react';
import { DateTimeField } from './DateTimeField';
import { DurationField, parseTypedDurationUnit } from './DurationField';
import { GotoIcon } from './GotoIcon';
import { READING_END_LABEL, type ReadingEndCause } from '../utils/telegramDisplay';
import { classifyGotoTarget } from '../utils/gotoTarget';
import { OUTSIDE_GOTO_TITLE } from '../utils/gotoBuffer';
import {
  parseRangePreset,
  RANGE_PRESETS,
  RANGE_UNITS,
  type RangeUnit,
} from '../utils/rangeWindow';

/** Match telegram timestamp column: date + space + time with centiseconds. */
const INPUT_FMT = 'yyyy-MM-dd HH:mm:ss.SS';
/** Local datetime display width while editing (YYYY-MM-DD HH:mm:ss.SS). */
const DT_WIDTH_CH = INPUT_FMT.length;

export type ReadDirection = 'forward' | 'backward';
export type { RangeUnit };

/** Format canonical minutes into the active unit for the range field. `d` is days. */
export function formatRangeMinutes(minutes: number, unit: RangeUnit): string {
  if (unit === 's') return String(Math.round(minutes * 60));
  if (unit === 'h') {
    const h = minutes / 60;
    return Number.isInteger(h) ? String(h) : (Math.round(h * 100) / 100).toString();
  }
  if (unit === 'd') {
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
  else if (unit === 'd') minutes = n * 60 * 24;
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
   * Reading-end marker. `range` / `loadlimit` turn Clear orange and name the
   * reason. `data` names the reason and leaves Clear dim. `loading` does
   * neither — the spinner owns that state.
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

/** Frameless editor while a buffer-edge time is focused. */
const dtEditStyle: CSSProperties = {
  width: `${DT_WIDTH_CH}ch`,
  border: 'none',
  outline: 'none',
  background: 'transparent',
  padding: 0,
  margin: 0,
  color: 'var(--text-main)',
  fontSize: '0.7rem',
  fontFamily: "'JetBrains Mono', monospace",
  fontVariantNumeric: 'tabular-nums',
  fontWeight: 500,
  minHeight: 0,
  height: '1.55rem',
};

function msToInput(ms: number | null): string {
  return ms != null ? format(new Date(ms), INPUT_FMT) : '';
}

function parseCommitMs(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const m = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/,
  );
  if (!m) {
    const ms = new Date(trimmed.replace(' ', 'T')).getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  const csRaw = m[7] ?? '0';
  const cs = Number(csRaw.padEnd(2, '0').slice(0, 2));
  const ms = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6] ?? 0),
    cs * 10,
  ).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Jump targets the edge telegram's real timestamp, never the second-truncated
 * display string. A focused draft that still matches the edge display keeps
 * that TG time; only a truly edited value becomes a typed goto.
 */
function resolveEdgeTarget(
  focused: boolean,
  draft: string,
  edgeMs: number | null,
): number | null {
  if (!focused) return edgeMs;
  if (draft.trim() === msToInput(edgeMs)) return edgeMs;
  return parseCommitMs(draft);
}

function edgeGotoTone(
  targetMs: number | null,
  oldestMs: number | null,
  newestMs: number | null,
): 'ready' | 'outside' {
  if (targetMs == null) return 'ready';
  const place = classifyGotoTarget(targetMs, oldestMs, newestMs);
  return place === 'inside' || place === 'unknown' ? 'ready' : 'outside';
}

/**
 * Monitor-table buffer status pill.
 * Backward: rewind → oldest → limit → clear → range → chevron → play/pause
 * → newest → fast-forward → WS LED → rate → count → export.
 * Forward: rewind → oldest → chevron → range → clear → limit → play
 * → newest → fast-forward → WS LED → rate → count → export.
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
  const oldestDraftRef = useRef(oldestDraft);
  const newestDraftRef = useRef(newestDraft);
  oldestDraftRef.current = oldestDraft;
  newestDraftRef.current = newestDraft;

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
  const endNamed = readingEnd === 'range' || readingEnd === 'loadlimit' || readingEnd === 'data';
  const clearOrange = readingEnd === 'range' || readingEnd === 'loadlimit';
  const rangeTitle = `${heldCount}/${loadLimit}`;
  const clearLabel = 'Clear (also wipes the local telegram cache).';
  const clearTitle = bufferEmpty
    ? 'Buffer is empty'
    : endNamed && readingEnd
      ? `${READING_END_LABEL[readingEnd]}. ${clearLabel}`
      : clearLabel;

  const applyTime = (ms: number | null, via: 'enter' | 'blur' | 'icon', ctrl: boolean, reset: () => void) => {
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
    // Enter/blur always treat the field value as a draft (even after focus clears).
    const ms = resolveEdgeTarget(via !== 'icon' || oldestFocused, raw, oldestMs);
    applyTime(ms, via, ctrl, () => setOldestDraft(msToInput(oldestMs)));
  };

  const commitNewest = (raw: string, via: 'enter' | 'blur' | 'icon', ctrl = false) => {
    const ms = resolveEdgeTarget(via !== 'icon' || newestFocused, raw, newestMs);
    applyTime(ms, via, ctrl, () => setNewestDraft(msToInput(newestMs)));
  };

  const jumpOldest = (ctrl: boolean) => {
    const el = oldestRef.current;
    // Prefer React focus state: jsdom often leaves activeElement unset after
    // fireEvent.focus, but the draft still owns the typed target.
    // Draft is always full date+time (input may show time-only via if-differs).
    const raw = oldestFocused ? oldestDraftRef.current : msToInput(oldestMs);
    const ms = resolveEdgeTarget(oldestFocused, raw, oldestMs);
    const place = ms == null ? 'unknown' : classifyGotoTarget(ms, oldestMs, newestMs);
    const willCommit = place === 'inside' || place === 'unknown' || ctrl;
    // Keep an outside draft after a plain click so Ctrl can still load it.
    if (oldestFocused && willCommit) {
      oldestCancel.current = true;
      commitOldest(raw, 'icon', ctrl);
      if (el != null && document.activeElement === el) el.blur();
      return;
    }
    commitOldest(raw, 'icon', ctrl);
  };

  const jumpNewest = (ctrl: boolean) => {
    const el = newestRef.current;
    const raw = newestFocused ? newestDraftRef.current : msToInput(newestMs);
    const ms = resolveEdgeTarget(newestFocused, raw, newestMs);
    const place = ms == null ? 'unknown' : classifyGotoTarget(ms, oldestMs, newestMs);
    const willCommit = place === 'inside' || place === 'unknown' || ctrl;
    if (newestFocused && willCommit) {
      newestCancel.current = true;
      commitNewest(raw, 'icon', ctrl);
      if (el != null && document.activeElement === el) el.blur();
      return;
    }
    commitNewest(raw, 'icon', ctrl);
  };

  const oldestTarget = resolveEdgeTarget(oldestFocused, oldestDraft, oldestMs);
  const newestTarget = resolveEdgeTarget(newestFocused, newestDraft, newestMs);
  const oldestTone = edgeGotoTone(oldestTarget, oldestMs, newestMs);
  const newestTone = edgeGotoTone(newestTarget, oldestMs, newestMs);
  const oldestOutside = oldestTone === 'outside';
  const newestOutside = newestTone === 'outside';

  const gotoStyle: CSSProperties = {
    color: 'var(--text-dim)',
    padding: '0.15rem',
    flexShrink: 0,
    opacity: isHistoryLoading ? 0.45 : 1,
    cursor: isHistoryLoading ? 'not-allowed' : 'pointer',
  };

  const commitRange = (raw: string = rangeDraft, activeUnit: RangeUnit = rangeUnit) => {
    const sanitized = sanitizeRangeInput(raw);
    const next = rangeValueToMinutes(sanitized, activeUnit);
    if (next == null) {
      setRangeDraft(formatRangeMinutes(rangeMinutes, rangeUnit));
      return;
    }
    if (activeUnit !== rangeUnit) setRangeUnit(activeUnit);
    setRangeDraft(formatRangeMinutes(next, activeUnit));
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

  const applyRangeUnit = (nextUnit: RangeUnit) => {
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
    const raw = (e.target as HTMLInputElement).value;
    const typed = parseTypedDurationUnit(raw, RANGE_UNITS);
    commitRange(typed?.value ?? raw, (typed?.unit as RangeUnit | undefined) ?? rangeUnit);
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
        color: clearOrange ? 'var(--warning-text)' : 'var(--text-dim)',
        padding: 0,
        flexShrink: 0,
        opacity: bufferEmpty ? 0.45 : 1,
        cursor: bufferEmpty ? 'not-allowed' : 'pointer',
      }}
    >
      <Trash2 size={14} />
    </button>
  );

  // Forward shows a blue Play. A click writes now into the edge opposite
  // the anchor and the parent starts the fill. A fixed anchor in the past uses the
  // auto-pause icon even while the mode is still playing. Manual pause keeps
  // its own icon. Offline only turns the LED red; it does not replace this control.
  const forwardPlay = readDirection === 'forward';
  const showAuto = !forwardPlay && pauseMode !== 'manual' && (pauseMode === 'auto' || fixedAnchor);
  const controlLabel = forwardPlay
    ? 'Play'
    : showAuto
      ? 'Paused automatically'
      : pauseTitle;
  const controlTitle = forwardPlay ? 'Jetzt auf die Gegenseite' : controlLabel;
  const controlColor = forwardPlay
    ? 'var(--accent-primary)'
    : showAuto
      ? 'var(--text-dim)'
      : pauseColor;
  const controlDisabled = forwardPlay ? false : pauseDisabled;

  // Range stays next to the visible direction chevron; limit sits on the far side.
  // Forward:  chevron → range → clear → limit
  // Backward: limit → clear → range → chevron
  const rangeField = (
    <DurationField
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
      unitSwitchable
      units={RANGE_UNITS}
      sanitize={sanitizeRangeInput}
      onUnitChange={u => applyRangeUnit(u as RangeUnit)}
      suggestions={RANGE_PRESETS.map(preset => preset.label)}
      unitTitle="Cycle range unit (s / m / h / d)"
      color={readingEnd === 'range' ? 'var(--warning-text)' : undefined}
      onBlur={(sanitized, activeUnit) => {
        setRangeFocused(false);
        commitRange(sanitized, activeUnit as RangeUnit);
      }}
      onKeyDown={onRangeKeyDown}
    />
  );
  const limitText = limitFocused ? limitDraft : String(loadLimit);
  const limitField = (
    <input
      className="glass-input"
      aria-label="Load limit"
      value={limitText}
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
      size={Math.max(4, limitText.length)}
      style={{
        // content-box: size/ch cover the digits; glass padding/border add outside.
        width: `${Math.max(4, limitText.length)}ch`,
        boxSizing: 'content-box',
        padding: '0.2rem 0.35rem',
        font: 'inherit',
        fontSize: '0.72rem',
        flexShrink: 0,
        ...(readingEnd === 'loadlimit' ? { color: 'var(--warning-text)' } : {}),
      }}
    />
  );
  const rangeLimitCluster = readDirection === 'forward'
    ? <>{rangeField}{rangeAction}{limitField}</>
    : <>{limitField}{rangeAction}{rangeField}</>;
  // Directly before the right-hand time field in both directions.
  const transportControl = (
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
        {forwardPlay
          ? <Play size={15} fill="currentColor" />
          : showAuto || pauseMode !== 'playing'
            ? <Pause size={15} fill="currentColor" />
            : <Play size={15} fill="currentColor" />}
      </button>
    </span>
  );

  return (
    <div data-buffer-status-pill="" style={pillStyle}>
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

      <DateTimeField
        valueMs={oldestMs}
        referenceMs={newestMs}
        dateDisplay="if-differs"
        editable
        withCentiseconds
        editValue={oldestDraft}
        focused={oldestFocused}
        aria-label="Oldest telegram in buffer"
        placeholder="Oldest"
        inputRef={oldestRef}
        editStyle={dtEditStyle}
        onBeginEdit={() => {
          setOldestDraft(msToInput(oldestMs));
          setOldestFocused(true);
        }}
        onChange={v => {
          setOldestFocused(true);
          oldestDraftRef.current = v;
          setOldestDraft(v);
        }}
        onBlur={() => {
          setOldestFocused(false);
          if (oldestCancel.current) {
            oldestCancel.current = false;
            setOldestDraft(msToInput(oldestMs));
            return;
          }
          // Draft is always full date+time; the input may show time-only (if-differs).
          commitOldest(oldestDraftRef.current, 'blur');
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
          commitOldest(oldestDraftRef.current, 'enter');
          if (document.activeElement === el) el.blur();
        }}
        endSlot={(
          <button
            type="button"
            className="icon-button"
            aria-label="Go to oldest time"
            title={oldestOutside ? OUTSIDE_GOTO_TITLE : 'Go to oldest time'}
            disabled={isHistoryLoading}
            onMouseDown={e => e.preventDefault()}
            onClick={e => jumpOldest(e.ctrlKey || e.metaKey)}
            style={{ ...gotoStyle, color: oldestOutside ? 'var(--warning-text)' : gotoStyle.color }}
          >
            <GotoIcon tone={oldestTone} readDirection={readDirection} size={13} />
          </button>
        )}
      />

      {readDirection === 'forward' ? (
        <button
          type="button"
          className="icon-button"
          title="Reading forward — click for backward"
          aria-label="Reading forward"
          onClick={() => onReadDirectionChange('backward')}
          style={{
            color: 'var(--accent-primary)',
            padding: '0.2rem 0.3rem',
            flexShrink: 0,
            border: '1px solid var(--border-color)',
            borderRadius: 6,
            background: 'var(--bg-inset)',
            display: 'inline-flex',
            alignItems: 'center',
          }}
        >
          <ChevronRight size={14} />
        </button>
      ) : null}

      {rangeLimitCluster}

      {readDirection === 'backward' ? (
        <button
          type="button"
          className="icon-button"
          title="Reading backward — click for forward"
          aria-label="Reading backward"
          onClick={() => onReadDirectionChange('forward')}
          style={{
            color: 'var(--accent-primary)',
            padding: '0.2rem 0.3rem',
            flexShrink: 0,
            border: '1px solid var(--border-color)',
            borderRadius: 6,
            background: 'var(--bg-inset)',
            display: 'inline-flex',
            alignItems: 'center',
          }}
        >
          <ChevronLeft size={14} />
        </button>
      ) : null}

      {transportControl}

      <DateTimeField
        valueMs={newestMs}
        referenceMs={oldestMs}
        dateDisplay="if-differs"
        editable
        withCentiseconds
        editValue={newestDraft}
        focused={newestFocused}
        aria-label="Newest telegram in buffer"
        placeholder="Newest"
        inputRef={newestRef}
        editStyle={dtEditStyle}
        onBeginEdit={() => {
          setNewestDraft(msToInput(newestMs));
          setNewestFocused(true);
        }}
        onChange={v => {
          setNewestFocused(true);
          newestDraftRef.current = v;
          setNewestDraft(v);
        }}
        onBlur={() => {
          setNewestFocused(false);
          if (newestCancel.current) {
            newestCancel.current = false;
            setNewestDraft(msToInput(newestMs));
            return;
          }
          // Draft is always full date+time; the input may show time-only (if-differs).
          commitNewest(newestDraftRef.current, 'blur');
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
          commitNewest(newestDraftRef.current, 'enter');
          if (document.activeElement === el) el.blur();
        }}
        endSlot={(
          <button
            type="button"
            className="icon-button"
            aria-label="Go to newest time"
            title={newestOutside ? OUTSIDE_GOTO_TITLE : 'Go to newest time'}
            disabled={isHistoryLoading}
            onMouseDown={e => e.preventDefault()}
            onClick={e => jumpNewest(e.ctrlKey || e.metaKey)}
            style={{ ...gotoStyle, color: newestOutside ? 'var(--warning-text)' : gotoStyle.color }}
          >
            <GotoIcon tone={newestTone} readDirection={readDirection} size={13} />
          </button>
        )}
      />

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
