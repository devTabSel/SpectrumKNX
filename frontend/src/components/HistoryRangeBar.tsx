import { useState, type CSSProperties, type KeyboardEvent } from 'react';
import { format } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ThemedDatetimePicker } from './ThemedDatetimePicker';
import { DurationField, parseTypedDurationUnit } from './DurationField';
import {
  formatRangeMs,
  parseRangePreset,
  RANGE_PRESETS,
  RANGE_UNITS,
  rangeValueToMs,
  type RangeUnit,
} from '../utils/rangeWindow';

const INPUT_FMT = "yyyy-MM-dd'T'HH:mm:ss";
const DT_WIDTH_CH = INPUT_FMT.length;

const dtStyle: CSSProperties = {
  width: `${DT_WIDTH_CH}ch`,
  fontSize: '0.7rem',
  padding: '0.15rem 0.35rem',
  minHeight: 0,
  height: '1.55rem',
};

function msToInput(ms: number | null): string {
  return ms != null && Number.isFinite(ms) ? format(new Date(ms), INPUT_FMT) : '';
}

function parseCommitMs(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const ms = new Date(trimmed).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** Keep a preset label so a Werthilfe pick survives blur sanitize. */
function sanitizeHistoryRangeInput(raw: string): string {
  if (parseRangePreset(raw)) return raw.trim();
  const t = raw.trim().replace(',', '.');
  if (t === '') return '';
  if (!/^(?:[1-9]\d*(?:\.\d*)?|0?\.\d+)$/.test(t)) return '';
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (t.endsWith('.')) return t;
  return String(n);
}

export interface HistoryRangeBarProps {
  startMs: number;
  endMs: number;
  /** Oldest field commit. The parent decides how the window moves. */
  onCommitStart: (ms: number) => void;
  /** Newest field commit. */
  onCommitEnd: (ms: number) => void;
  /** Range field commit, in milliseconds. */
  onCommitRange: (rangeMs: number) => void;
  /** Backward anchors newest; forward anchors oldest. Same control as the monitor pill. */
  readDirection: 'forward' | 'backward';
  onReadDirectionChange: (dir: 'forward' | 'backward') => void;
  loadLimit: number;
  onLoadLimitChange?: (n: number) => void;
}

/**
 * History time window: oldest, direction, range (s/m/h/d + presets), load limit, newest.
 * The direction icon sits where the monitor pill puts it: left of the range when
 * reading forward, right of the load limit when reading backward.
 */
export function HistoryRangeBar({
  startMs,
  endMs,
  onCommitStart,
  onCommitEnd,
  onCommitRange,
  readDirection,
  onReadDirectionChange,
  loadLimit,
  onLoadLimitChange,
}: HistoryRangeBarProps) {
  const spanMs = Math.max(0, endMs - startMs);
  const [unit, setUnit] = useState<RangeUnit>('m');
  const [rangeDraft, setRangeDraft] = useState(() => formatRangeMs(spanMs, 'm'));
  const [rangeFocused, setRangeFocused] = useState(false);
  const [limitDraft, setLimitDraft] = useState(() => String(loadLimit));
  const [limitFocused, setLimitFocused] = useState(false);
  const [startDraft, setStartDraft] = useState(() => msToInput(startMs));
  const [endDraft, setEndDraft] = useState(() => msToInput(endMs));
  const [startFocused, setStartFocused] = useState(false);
  const [endFocused, setEndFocused] = useState(false);

  const [spanBase, setSpanBase] = useState(spanMs);
  if (spanMs !== spanBase) {
    setSpanBase(spanMs);
    if (!rangeFocused) setRangeDraft(formatRangeMs(spanMs, unit));
  }
  const [limitBase, setLimitBase] = useState(loadLimit);
  if (loadLimit !== limitBase) {
    setLimitBase(loadLimit);
    if (!limitFocused) setLimitDraft(String(loadLimit));
  }
  const [startBase, setStartBase] = useState(startMs);
  if (startMs !== startBase) {
    setStartBase(startMs);
    if (!startFocused) setStartDraft(msToInput(startMs));
  }
  const [endBase, setEndBase] = useState(endMs);
  if (endMs !== endBase) {
    setEndBase(endMs);
    if (!endFocused) setEndDraft(msToInput(endMs));
  }

  const commitRange = (raw: string, activeUnit: RangeUnit = unit) => {
    const text = sanitizeHistoryRangeInput(raw);
    const next = rangeValueToMs(text, activeUnit);
    if (next == null) {
      setRangeDraft(formatRangeMs(spanMs, unit));
      return;
    }
    if (activeUnit !== unit) setUnit(activeUnit);
    setRangeDraft(formatRangeMs(next, activeUnit));
    if (next !== spanMs) onCommitRange(next);
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

  const applyUnit = (nextUnit: RangeUnit) => {
    const fromDraft = rangeValueToMs(sanitizeHistoryRangeInput(rangeDraft), unit);
    const echoing = formatRangeMs(spanMs, unit) === rangeDraft;
    const ms = !echoing && fromDraft != null ? fromDraft : spanMs;
    setUnit(nextUnit);
    setRangeDraft(formatRangeMs(ms, nextUnit));
    if (!echoing && fromDraft != null && fromDraft !== spanMs) onCommitRange(fromDraft);
  };

  const onRangeKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const raw = (e.target as HTMLInputElement).value;
    const typed = parseTypedDurationUnit(raw, RANGE_UNITS);
    commitRange(typed?.value ?? raw, (typed?.unit as RangeUnit | undefined) ?? unit);
    (e.target as HTMLInputElement).blur();
  };

  const commitTime = (raw: string, which: 'start' | 'end') => {
    const ms = parseCommitMs(raw);
    if (ms == null) {
      if (which === 'start') setStartDraft(msToInput(startMs));
      else setEndDraft(msToInput(endMs));
      return;
    }
    if (which === 'start') {
      if (ms !== startMs) onCommitStart(ms);
    } else if (ms !== endMs) {
      onCommitEnd(ms);
    }
  };

  // Range stays next to the visible direction chevron; limit on the far side.
  const rangeField = (
    <DurationField
      value={rangeDraft}
      onChange={v => {
        setRangeFocused(true);
        setRangeDraft(v);
      }}
      placeholder="range"
      title="History range"
      ariaLabel="History range"
      unit={unit}
      alwaysShowUnit
      unitSwitchable
      units={RANGE_UNITS}
      suggestions={RANGE_PRESETS.map(preset => preset.label)}
      sanitize={sanitizeHistoryRangeInput}
      onUnitChange={u => applyUnit(u as RangeUnit)}
      unitTitle="Cycle range unit (s / m / h / d)"
      onBlur={(sanitized, activeUnit) => {
        setRangeFocused(false);
        commitRange(sanitized, activeUnit as RangeUnit);
      }}
      onKeyDown={onRangeKeyDown}
    />
  );
  const slash = <span aria-hidden style={{ color: 'var(--text-dim)', flexShrink: 0 }}>/</span>;
  const limitText = limitFocused ? limitDraft : String(loadLimit);
  const limitField = (
    <input
      className="glass-input"
      aria-label="History load limit"
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
        commitLimit((e.target as HTMLInputElement).value);
        (e.target as HTMLInputElement).blur();
      }}
      inputMode="numeric"
      title="History load limit"
      size={Math.max(4, limitText.length)}
      style={{
        // content-box: size/ch cover the digits; glass padding/border add outside.
        width: `${Math.max(4, limitText.length)}ch`,
        boxSizing: 'content-box',
        padding: '0.2rem 0.35rem',
        font: 'inherit',
        fontSize: '0.72rem',
        flexShrink: 0,
      }}
    />
  );
  const rangeLimitCluster = readDirection === 'forward'
    ? <>{rangeField}{slash}{limitField}</>
    : <>{limitField}{slash}{rangeField}</>;

  return (
    <div
      data-history-range-bar=""
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.35rem',
        background: 'var(--bg-subtle)',
        padding: '0.25rem 0.5rem',
        borderRadius: '8px',
        border: '1px solid var(--border-color)',
      }}
    >
      <ThemedDatetimePicker
        value={startFocused ? startDraft : msToInput(startMs)}
        onChange={v => {
          setStartFocused(true);
          setStartDraft(v);
        }}
        withSeconds
        variant="field"
        aria-label="Oldest telegram in history"
        placeholder="Oldest"
        style={dtStyle}
        openOnFocus={false}
        onBlur={() => {
          setStartFocused(false);
          commitTime(startDraft, 'start');
        }}
        onKeyDown={e => {
          if (e.key === 'Escape') {
            setStartDraft(msToInput(startMs));
            return;
          }
          if (e.key !== 'Enter') return;
          e.preventDefault();
          commitTime((e.target as HTMLInputElement).value, 'start');
          (e.target as HTMLInputElement).blur();
        }}
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
      <ThemedDatetimePicker
        value={endFocused ? endDraft : msToInput(endMs)}
        onChange={v => {
          setEndFocused(true);
          setEndDraft(v);
        }}
        withSeconds
        variant="field"
        aria-label="Newest telegram in history"
        placeholder="Newest"
        style={dtStyle}
        openOnFocus={false}
        onBlur={() => {
          setEndFocused(false);
          commitTime(endDraft, 'end');
        }}
        onKeyDown={e => {
          if (e.key === 'Escape') {
            setEndDraft(msToInput(endMs));
            return;
          }
          if (e.key !== 'Enter') return;
          e.preventDefault();
          commitTime((e.target as HTMLInputElement).value, 'end');
          (e.target as HTMLInputElement).blur();
        }}
      />
    </div>
  );
}
