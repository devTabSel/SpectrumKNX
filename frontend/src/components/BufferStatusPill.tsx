import { useMemo, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
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
  AlertTriangle,
} from 'lucide-react';
import { ThemedDatetimePicker } from './ThemedDatetimePicker';

const INPUT_FMT = "yyyy-MM-dd'T'HH:mm:ss";
/** Local datetime-with-seconds display width (YYYY-MM-DDTHH:mm:ss). */
const DT_WIDTH_CH = INPUT_FMT.length;

export type ReadDirection = 'forward' | 'backward';

export interface BufferStatusPillProps {
  /** Oldest telegram in the raw buffer (epoch ms), or null when empty. */
  oldestMs: number | null;
  /** Newest telegram in the raw buffer (epoch ms), or null when empty. */
  newestMs: number | null;
  /** Time-sort fill axis: forward = asc, backward = desc. */
  readDirection: ReadDirection;
  loadLimit: number;
  onLoadLimitChange: (n: number) => void;
  filteredCount: number;
  totalCount: number;
  filterActive: boolean;
  onClear: (opts: { pauseAuto: boolean }) => void;
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
  bufferLimitWarning?: ReactNode;
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
 * Live-header buffer status pill: rewind → oldest → direction → loadLimit →
 * clear → direction → newest → fast-forward → play/pause → WS LED → rate → count → export.
 */
export function BufferStatusPill({
  oldestMs,
  newestMs,
  readDirection,
  loadLimit,
  onLoadLimitChange,
  filteredCount,
  totalCount,
  filterActive,
  onClear,
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
  bufferLimitWarning,
}: BufferStatusPillProps) {
  const [oldestDraft, setOldestDraft] = useState(() => msToInput(oldestMs));
  const [newestDraft, setNewestDraft] = useState(() => msToInput(newestMs));
  const [limitDraft, setLimitDraft] = useState(String(loadLimit));
  // Mirror committed buffer bounds into the editable drafts when the parent
  // value changes (React "adjust state while rendering" pattern).
  const [oldestBaseline, setOldestBaseline] = useState(oldestMs);
  if (oldestMs !== oldestBaseline) {
    setOldestBaseline(oldestMs);
    setOldestDraft(msToInput(oldestMs));
  }
  const [newestBaseline, setNewestBaseline] = useState(newestMs);
  if (newestMs !== newestBaseline) {
    setNewestBaseline(newestMs);
    setNewestDraft(msToInput(newestMs));
  }
  const [limitBaseline, setLimitBaseline] = useState(loadLimit);
  if (loadLimit !== limitBaseline) {
    setLimitBaseline(loadLimit);
    setLimitDraft(String(loadLimit));
  }

  const countText = filterActive
    ? `${filteredCount} / ${totalCount}`
    : String(totalCount);

  const countWidthCh = useMemo(() => Math.max(1, countText.length), [countText]);
  const limitWidthCh = useMemo(
    () => Math.max(1, limitDraft.length || String(loadLimit).length),
    [limitDraft, loadLimit],
  );

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

  const commitLimit = () => {
    const n = Number(limitDraft);
    if (!Number.isFinite(n) || n < 1) {
      setLimitDraft(String(loadLimit));
      return;
    }
    const next = Math.floor(n);
    if (next !== loadLimit) onLoadLimitChange(next);
    else setLimitDraft(String(loadLimit));
  };

  const onLimitKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      (e.target as HTMLInputElement).blur();
    }
  };

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
        value={oldestDraft}
        onChange={setOldestDraft}
        withSeconds
        variant="field"
        aria-label="Oldest telegram in buffer"
        placeholder="Oldest"
        style={dtStyle}
        onBlur={() => commitOldest(oldestDraft)}
        onKeyDown={e => {
          if (e.key !== 'Enter') return;
          // Do not preventDefault — picker Enter applies draft + closes.
          commitOldest((e.currentTarget as HTMLInputElement).value);
        }}
      />

      {readDirection === 'forward' && (
        <span title="Reading forward" style={{ display: 'inline-flex', flexShrink: 0 }}>
          <ChevronRight
            size={14}
            aria-label="Reading forward"
            style={{ color: 'var(--accent-primary)' }}
          />
        </span>
      )}

      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        className="glass-input"
        aria-label="Load limit"
        title="Load limit"
        value={limitDraft}
        onChange={e => setLimitDraft(e.target.value.replace(/\D/g, ''))}
        onBlur={commitLimit}
        onKeyDown={onLimitKeyDown}
        style={{
          width: `${limitWidthCh}ch`,
          fontSize: '0.7rem',
          padding: '0.15rem 0.3rem',
          height: '1.55rem',
          minHeight: 0,
          textAlign: 'right',
          fontVariantNumeric: 'tabular-nums',
        }}
      />

      <button
        type="button"
        className="icon-button"
        onClick={e => onClear({ pauseAuto: e.ctrlKey || e.metaKey })}
        title="Clear (also wipes the local telegram cache). Ctrl-click pauses automatically."
        aria-label="Clear (also wipes the local telegram cache). Ctrl-click pauses automatically."
        style={{ color: 'var(--text-dim)', padding: '0.15rem' }}
      >
        <Trash2 size={15} />
      </button>

      {readDirection === 'backward' && (
        <span title="Reading backward" style={{ display: 'inline-flex', flexShrink: 0 }}>
          <ChevronLeft
            size={14}
            aria-label="Reading backward"
            style={{ color: 'var(--accent-primary)' }}
          />
        </span>
      )}

      <ThemedDatetimePicker
        value={newestDraft}
        onChange={setNewestDraft}
        withSeconds
        variant="field"
        aria-label="Newest telegram in buffer"
        placeholder="Newest"
        style={dtStyle}
        onBlur={() => commitNewest(newestDraft)}
        onKeyDown={e => {
          if (e.key !== 'Enter') return;
          // Do not preventDefault — picker Enter applies draft + closes.
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
          gap: '0.3rem',
          fontFamily: 'var(--font-mono, ui-monospace, monospace)',
          width: `${countWidthCh}ch`,
          minWidth: `${countWidthCh}ch`,
          fontVariantNumeric: 'tabular-nums',
          textAlign: 'left',
          whiteSpace: 'nowrap',
          flexShrink: 0,
        }}
        title={filterActive ? 'Filtered / buffer' : 'Telegrams in buffer'}
        aria-label={filterActive ? `${filteredCount} filtered of ${totalCount} in buffer` : `${totalCount} in buffer`}
      >
        {countText}
        {bufferLimitWarning}
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

      {isHistoryLoading && (
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--accent-primary)' }}>
          <span className="chip-spinner" /> History: loading…
        </span>
      )}
      {!isHistoryLoading && historyLoadError && (
        <span
          title={historyLoadError}
          style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', color: 'var(--error)' }}
        >
          <AlertTriangle size={13} /> History: failed
        </span>
      )}
    </div>
  );
}
