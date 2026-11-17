import type { CSSProperties } from 'react';
import { format } from 'date-fns';
import { Clock } from 'lucide-react';

import type { Telegram } from '../hooks/useWebSocket';
import { EventTypeLabel } from './EventTypeLabel';
import {
  FILTERED_GOTO_TITLE,
  MISSING_GOTO_TITLE,
  OUTSIDE_GOTO_TITLE,
  gotoIconTone,
  useGotoBuffer,
  type GotoIconTone,
} from '../utils/gotoBuffer';

/** Shared event timestamp shape used by send panel, popover, and building views. */
// eslint-disable-next-line react-refresh/only-export-components -- shared timestamp helper
export function formatTelegramWhen(timestamp: string | Date | undefined | null): string {
  if (timestamp == null || timestamp === '') return '';
  const d = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(d.getTime())) return '';
  return format(d, 'yyyy-MM-dd HH:mm:ss');
}

/** Prefer simplified_type (READ / WRITE / RESPONSE); fall back to telegram_type. */
// eslint-disable-next-line react-refresh/only-export-components -- shared telegram helper
export function telegramEventType(telegram: Pick<Telegram, 'simplified_type' | 'telegram_type'> | null | undefined): string {
  if (!telegram) return '';
  const raw = (telegram.simplified_type ?? telegram.telegram_type ?? '').trim();
  if (raw === 'Write' || raw === 'Read' || raw === 'Response') return raw.toUpperCase();
  return raw;
}

/**
 * Ctrl/Cmd adds to the jump targets when the row is in the buffer, and is
 * the load gesture when it is outside. Shift ranges from the last selected row.
 * `load` is set only for an outside Ctrl-click.
 */
export type TelegramJumpMods = { additive?: boolean; range?: boolean; load?: boolean };

interface Props {
  /** ISO timestamp or Date of the bus event. */
  timestamp?: string | Date | null;
  /** Optional event kind shown after the jump (READ / WRITE / RESPONSE). */
  eventType?: string | null;
  /** When the kind is a Read, color it green once a later Response has answered it. */
  readAnswered?: boolean;
  /** When set, render the jump button immediately right of the timestamp.
   *  Ctrl/Cmd and Shift are forwarded as selection modifiers. */
  onJump?: (mods?: TelegramJumpMods) => void;
  /**
   * Overrides the buffer-span tone.
   * `missing`: target is outside the loaded history span (hover-only, no click).
   * `filtered`: target is loaded but hidden by the quick filter. The icon stays
   * visible; a plain click does nothing and Ctrl/Cmd adds the jump.
   */
  tone?: GotoIconTone;
  /** aria-label / title for the jump button. */
  jumpLabel?: string;
  /** Reserve the usual row height with no content (empty send-panel cells). */
  empty?: boolean;
  /** Keep a jump-sized spacer when `onJump` is absent (column alignment). */
  reserveJump?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * Compact event chrome: Date/Time, optional Jump immediately to its right,
 * then optional event type. Jump never sits between other content and the time.
 */
export function TelegramWhenJump({
  timestamp,
  eventType,
  readAnswered = false,
  onJump,
  tone: toneProp,
  jumpLabel = 'Go to telegram',
  empty = false,
  reserveJump = false,
  className,
  style,
}: Props) {
  const buf = useGotoBuffer();
  if (empty) {
    return <span aria-hidden className={className} style={{ display: 'inline-block', height: 18, ...style }} />;
  }

  const when = formatTelegramWhen(timestamp);
  const typeLabel = (eventType ?? '').trim();
  if (!when && !typeLabel && !onJump && !reserveJump) {
    return <span aria-hidden className={className} style={{ display: 'inline-block', height: 18, ...style }} />;
  }

  const targetMs = timestamp == null || timestamp === ''
    ? null
    : new Date(timestamp instanceof Date ? timestamp : timestamp).getTime();
  const tone = toneProp ?? gotoIconTone(Number.isFinite(targetMs) ? targetMs : null, buf);
  const missing = tone === 'missing';
  const outside = tone === 'outside';
  const filtered = tone === 'filtered';
  const label = missing
    ? MISSING_GOTO_TITLE
    : outside
      ? OUTSIDE_GOTO_TITLE
      : filtered
        ? FILTERED_GOTO_TITLE
        : jumpLabel;
  const jump = onJump ? (
    <button
      type="button"
      className={`quick-filter-bar-toggle${outside ? ' tt-goto-outside' : ''}${missing ? ' tt-goto-missing' : ''}${filtered ? ' tt-goto-filtered' : ''}`}
      title={label}
      aria-label={label}
      onClick={e => {
        if (missing) return;
        const ctrl = e.ctrlKey || e.metaKey;
        if (filtered) {
          if (!ctrl) return;
          onJump({ additive: true, range: e.shiftKey });
          return;
        }
        if (outside) {
          if (!ctrl) return;
          onJump({ load: true });
          return;
        }
        const additive = ctrl;
        const range = e.shiftKey;
        if (additive || range) onJump({ additive, range });
        else onJump();
      }}
      style={{
        flexShrink: 0,
        margin: 0,
        color: outside || missing || filtered ? 'var(--warning-text)' : undefined,
      }}
    >
      <Clock size={13} />
    </button>
  ) : reserveJump ? (
    <span aria-hidden style={{ display: 'inline-block', width: 18, height: 18, flexShrink: 0 }} />
  ) : null;

  return (
    <span
      className={['tt-when-jump', className].filter(Boolean).join(' ')}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.35rem',
        minWidth: 0,
        fontSize: '0.72rem',
        color: 'var(--text-dim)',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {when ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', flexShrink: 0 }}>
          <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{when}</span>
          {jump}
        </span>
      ) : (
        jump
      )}
      {typeLabel ? (
        <EventTypeLabel kind={typeLabel} answered={readAnswered} style={{ flexShrink: 0 }} />
      ) : null}
      {missing || outside ? (
        <style>{`
          .tt-goto-missing { opacity: 0; }
          .log-row:hover .tt-goto-missing,
          .tt-when-jump:hover .tt-goto-missing { opacity: 1; }
          .quick-filter-bar-toggle.tt-goto-outside:hover,
          .quick-filter-bar-toggle.tt-goto-missing:hover { color: var(--warning-text); }
        `}</style>
      ) : null}
    </span>
  );
}
