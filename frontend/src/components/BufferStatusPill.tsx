import { useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react';
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
import { ThemedDatetimePicker } from './ThemedDatetimePicker';
import { SecondsField } from './SecondsField';

const INPUT_FMT = "yyyy-MM-dd'T'HH:mm:ss";
/** Local datetime-with-seconds display width (YYYY-MM-DDTHH:mm:ss). */
const DT_WIDTH_CH = INPUT_FMT.length;

export type ReadDirection = 'forward' | 'backward';
export type RangeUnit = 's' | 'm' | 'h';

const RANGE_UNITS: RangeUnit[] = ['s', 'm', 'h'];

/** Format canonical minutes into the active unit for the range field. */
export function formatRangeMinutes(minutes: number, unit: RangeUnit): string {
  if (unit === 's') return String(Math.round(minutes * 60));
  if (unit === 'h') {
    const h = minutes / 60;
    return Number.isInteger(h) ? String(h) : (Math.round(h * 100) / 100).toString();
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
  const next = Math.max(1, Math.round(minutes));
  return next;
}

/** Positive number (optional one decimal) for the range draft. */
export function sanitizeRangeInput(raw: string): string {
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
  filteredCount: number;
  totalCount: number;
  filterActive: boolean;
  onClear: (opts: { pauseAuto: boolean }) => void;
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
  historyLoadError: string | null;
  onOldestCommit: (ms: number) => void;
  onNewestCommit: (ms: number) => void;
  /** Load the buffer forward starting at the oldest telegram in the DB. */
  onLoadFromDbOldest: () => void;
  /** Load the buffer covering up to the newest telegram in the DB. */
  onLoadFromDbNewest: () => void;
}

const pillStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.45rem',
  marginRight: '1rem',
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
 * Live-header buffer status pill: rewind → oldest → direction → range →
 * clear/spinner → direction → newest → fast-forward → play/pause →
 * WS LED → rate → count → export.
 */
export function BufferStatusPill({
  oldestMs,
  newestMs,
  readDirection,
  onReadDirectionChange,
  loadLimit,
  rangeMinutes,
  onRangeMinutesChange,
  filteredCount,
  totalCount,
  filterActive,
  onClear,
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
  historyLoadError,
  onOldestCommit,
  onNewestCommit,
  onLoadFromDbOldest,
  onLoadFromDbNewest,
}: BufferStatusPillProps) {
  const [oldestDraft, setOldestDraft] = useState(() => msToInput(oldestMs));
  const [newestDraft, setNewestDraft] = useState(() => msToInput(newestMs));
  const [rangeUnit, setRangeUnit] = useState<RangeUnit>('m');
  const [rangeDraft, setRangeDraft] = useState(() => formatRangeMinutes(rangeMinutes, 'm'));
  const [oldestFocused, setOldestFocused] = useState(false);
  const [newestFocused, setNewestFocused] = useState(false);
  const [rangeFocused, setRangeFocused] = useState(false);

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

  const countText = filterActive
    ? `${filteredCount}/${totalCount}`
    : String(totalCount);

  const countWidthCh = useMemo(() => Math.max(1, countText.length), [countText]);

  const bufferFull = totalCount >= loadLimit;
  const rangeTitle = `${totalCount}/${loadLimit}`;

  const commitOldest = (raw: string) => {
    const ms = parseCommitMs(raw);
    if (ms == null) {
      setOldestDraft(msToInput(oldestMs));
      return;
    }
    if (oldestMs != null && ms === oldestMs) return;
    onOldestCommit(ms);
  };

  const commitNewest = (raw: string) => {
    const ms = parseCommitMs(raw);
    if (ms == null) {
      setNewestDraft(msToInput(newestMs));
      return;
    }
    if (newestMs != null && ms === newestMs) return;
    onNewestCommit(ms);
  };

  const commitRange = (raw: string = rangeDraft) => {
    const sanitized = sanitizeRangeInput(raw);
    const next = rangeValueToMinutes(sanitized, rangeUnit);
    if (next == null) {
      setRangeDraft(formatRangeMinutes(rangeMinutes, rangeUnit));
      return;
    }
    setRangeDraft(formatRangeMinutes(next, rangeUnit));
    if (next !== rangeMinutes) onRangeMinutesChange(next);
  };

  const cycleRangeUnit = () => {
    const idx = RANGE_UNITS.indexOf(rangeUnit);
    const nextUnit = RANGE_UNITS[(idx + 1) % RANGE_UNITS.length];
    // Prefer the last committed duration so a half-typed draft does not jump.
    const fromDraft = rangeValueToMinutes(sanitizeRangeInput(rangeDraft), rangeUnit);
    const minutes = fromDraft ?? rangeMinutes;
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
      onClick={e => onClear({ pauseAuto: e.ctrlKey || e.metaKey })}
      title={
        bufferFull
          ? `Buffer full (${totalCount}/${loadLimit}). Clear (also wipes the local telegram cache). Ctrl-click pauses automatically.`
          : 'Clear (also wipes the local telegram cache). Ctrl-click pauses automatically.'
      }
      aria-label="Clear (also wipes the local telegram cache). Ctrl-click pauses automatically."
      style={{
        color: bufferFull ? 'var(--warning-text)' : 'var(--text-dim)',
        padding: 0,
        flexShrink: 0,
      }}
    >
      <Trash2 size={14} />
    </button>
  );

  // Backward: icon left, value+unit right. Forward: value+unit left, icon right.
  const rangeIconLeft = readDirection === 'backward';

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

      <ThemedDatetimePicker
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
          commitOldest(oldestDraft);
        }}
        onKeyDown={e => {
          if (e.key !== 'Enter') return;
          commitOldest((e.currentTarget as HTMLInputElement).value);
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
        title={rangeTitle}
        ariaLabel="Buffer range"
        unit={rangeUnit}
        alwaysShowUnit
        sanitize={sanitizeRangeInput}
        onUnitClick={cycleRangeUnit}
        unitTitle="Cycle range unit (s / m / h)"
        textAlign={rangeIconLeft ? 'right' : 'left'}
        startSlot={rangeIconLeft ? rangeAction : undefined}
        endSlot={rangeIconLeft ? undefined : rangeAction}
        onBlur={sanitized => {
          setRangeFocused(false);
          commitRange(sanitized);
        }}
        onKeyDown={onRangeKeyDown}
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
          commitNewest(newestDraft);
        }}
        onKeyDown={e => {
          if (e.key !== 'Enter') return;
          commitNewest((e.currentTarget as HTMLInputElement).value);
        }}
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

      <button
        type="button"
        className="icon-button"
        onClick={onTogglePause}
        title={pauseTitle}
        aria-label={pauseTitle}
        disabled={pauseDisabled}
        style={{
          color: pauseColor,
          padding: '0.15rem',
          opacity: pauseDisabled ? 0.45 : 1,
          cursor: pauseDisabled ? 'not-allowed' : 'pointer',
        }}
      >
        {pauseMode === 'playing'
          ? <Play size={15} fill="currentColor" />
          : <Pause size={15} fill="currentColor" />}
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
        title={filterActive ? 'Filtered/buffer' : 'Telegrams in buffer'}
        aria-label={filterActive ? `${filteredCount} filtered of ${totalCount} in buffer` : `${totalCount} in buffer`}
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
