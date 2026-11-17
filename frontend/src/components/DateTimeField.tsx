import type {
  CSSProperties,
  KeyboardEvent,
  ReactNode,
  Ref,
} from 'react';
import { TT } from '../utils/telegramCellStyles';
import {
  idleDateTimeParts,
  shouldShowDate,
  type DateDisplayMode,
} from '../utils/dateTimeDisplay';
import { ThemedDatetimePicker } from './ThemedDatetimePicker';

const IDLE_ROW: CSSProperties = {
  display: 'inline-flex',
  flexDirection: 'row',
  alignItems: 'baseline',
  gap: '0.35rem',
  border: 0,
  outline: 'none',
  boxShadow: 'none',
  background: 'transparent',
  padding: 0,
  margin: 0,
  cursor: 'text',
  font: 'inherit',
};

/** Parse buffer-style `yyyy-MM-dd HH:mm:ss.SS` (or ISO) to epoch ms. */
export function parseEditValueMs(raw: string): number | null {
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

export interface DateTimeFieldProps {
  /** Committed instant (epoch ms), or null when empty. */
  valueMs: number | null;
  /**
   * Calendar-day reference for `dateDisplay="if-differs"` (other buffer edge,
   * QF sibling, previous row, …). When omitted or null, today (`Date.now()`)
   * is the reference day.
   */
  referenceMs?: number | null;
  /** Default `if-differs` for editable fields; pure display may override. */
  dateDisplay?: DateDisplayMode;
  /** When true, idle click focuses the picker field. */
  editable?: boolean;
  withCentiseconds?: boolean;
  /** Shown while editing (full date+time draft). */
  editValue: string;
  focused: boolean;
  'aria-label': string;
  placeholder?: string;
  inputRef?: Ref<HTMLInputElement>;
  style?: CSSProperties;
  editStyle?: CSSProperties;
  /** Optional goto (or other) control after the field. */
  endSlot?: ReactNode;
  onBeginEdit: () => void;
  onChange: (value: string) => void;
  onBlur: () => void;
  onKeyDown: (e: KeyboardEvent) => void;
}

/**
 * Single-line date/time control for buffer edges / QF / history-style inputs.
 * Idle and focused field chrome follow `dateDisplay` (e.g. if-differs): focus
 * alone does not reveal a hidden date — only a value/reference change does.
 */
export function DateTimeField({
  valueMs,
  referenceMs = null,
  dateDisplay = 'if-differs',
  editable = true,
  withCentiseconds = true,
  editValue,
  focused,
  'aria-label': ariaLabel,
  placeholder = '',
  inputRef,
  style,
  editStyle,
  endSlot,
  onBeginEdit,
  onChange,
  onBlur,
  onKeyDown,
}: DateTimeFieldProps) {
  const liveMs = focused ? (parseEditValueMs(editValue) ?? valueMs) : valueMs;
  const showDate = shouldShowDate(dateDisplay, liveMs, referenceMs);
  const parts = idleDateTimeParts(liveMs, dateDisplay, {
    referenceMs,
    withCentiseconds,
  });

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.15rem',
        flexShrink: 0,
        ...style,
      }}
    >
      {editable && focused ? (
        <ThemedDatetimePicker
          key={showDate ? 'with-date' : 'time-only'}
          inputRef={inputRef}
          value={editValue}
          onChange={onChange}
          withSeconds
          withCentiseconds={withCentiseconds}
          separator=" "
          variant="bare"
          autoFocus
          openOnFocus
          hideDateInField={!showDate}
          aria-label={ariaLabel}
          placeholder={placeholder}
          style={editStyle}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
        />
      ) : (
        <button
          type="button"
          aria-label={ariaLabel}
          title={parts.full || placeholder}
          disabled={!editable}
          onClick={() => {
            if (editable) onBeginEdit();
          }}
          style={{
            ...IDLE_ROW,
            cursor: editable ? 'text' : 'default',
            opacity: editable ? 1 : undefined,
          }}
        >
          {parts.date != null && (
            <span
              className={`subtitle-name ${TT.timeDate}`}
              style={{ marginTop: 0 }}
            >
              {parts.date}
            </span>
          )}
          {parts.time != null && (
            <span className={`mono-addr ${TT.time}`}>{parts.time}</span>
          )}
          {parts.time == null && parts.date == null && (
            <span className={`mono-addr ${TT.time}`} style={{ color: 'var(--text-dim)' }}>
              {placeholder || '—'}
            </span>
          )}
        </button>
      )}
      {endSlot}
    </div>
  );
}
