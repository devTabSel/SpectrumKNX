import { useState, type CSSProperties, type KeyboardEvent } from 'react';
import { format } from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ThemedDatetimePicker } from './ThemedDatetimePicker';
import { SecondsField } from './SecondsField';
import {
  formatRangeMs,
  nextRangeUnit,
  parseRangePreset,
  RANGE_PRESETS,
  rangeValueToMs,
  type RangeUnit,
} from '../utils/rangeWindow';

const INPUT_FMT = "yyyy-MM-dd'T'HH:mm:ss";
const DT_WIDTH_CH = INPUT_FMT.length;
const RANGE_LIST_ID = 'history-range-presets';

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

/** Keep a preset label so the datalist value survives blur sanitize. */
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
 * History time window: oldest, direction, range (s/m/h/t + presets), load limit, newest.
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

  const commitRange = (raw: string) => {
    const preset = parseRangePreset(raw);
    const active = preset?.unit ?? unit;
    const text = preset ? String(preset.value) : sanitizeHistoryRangeInput(raw);
    const next = rangeValueToMs(text, active);
    if (next == null) {
      setRangeDraft(formatRangeMs(spanMs, unit));
      return;
    }
    if (preset) setUnit(preset.unit);
    setRangeDraft(formatRangeMs(next, active));
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

  const cycleUnit = () => {
    const nextUnit = nextRangeUnit(unit);
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
    commitRange((e.target as HTMLInputElement).value);
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
      <datalist id={RANGE_LIST_ID}>
        {RANGE_PRESETS.map(preset => <option key={preset.label} value={preset.label}>{preset.label}</option>)}
      </datalist>
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
        title="History range"
        ariaLabel="History range"
        unit={unit}
        alwaysShowUnit
        list={RANGE_LIST_ID}
        sanitize={sanitizeHistoryRangeInput}
        onUnitClick={cycleUnit}
        unitTitle="Cycle range unit (s / m / h / t)"
        textAlign={readDirection === 'backward' ? 'right' : 'left'}
        onBlur={sanitized => {
          setRangeFocused(false);
          commitRange(sanitized);
        }}
        onKeyDown={onRangeKeyDown}
      />
      <span aria-hidden style={{ color: 'var(--text-dim)', flexShrink: 0 }}>/</span>
      <input
        aria-label="History load limit"
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
          commitLimit((e.target as HTMLInputElement).value);
          (e.target as HTMLInputElement).blur();
        }}
        inputMode="numeric"
        title="History load limit"
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
