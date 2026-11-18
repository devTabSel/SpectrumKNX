import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { format } from 'date-fns';
import { Clock } from 'lucide-react';
import { DateTimeField, parseEditValueMs } from './DateTimeField';
import { GotoIcon } from './GotoIcon';
import { classifyGotoTarget } from '../utils/gotoTarget';
import {
  MISSING_GOTO_TITLE,
  OUTSIDE_GOTO_TITLE,
  useGotoBuffer,
  type GotoScope,
} from '../utils/gotoBuffer';

// Clock in the telegram-list header (#282). The popover is the shared
// DateTimeField (same idle anchor as the buffer edges). Its endSlot is the
// goto button. Clicking the time edits; Enter, blur, and the goto button jump.

export interface GotoTimeMods {
  /** Enter, blur, or Ctrl-click of the goto button outside the buffer: load that window. */
  load?: boolean;
  /** Ctrl-Enter or Ctrl-click inside the buffer: add a jump target. */
  additive?: boolean;
}

interface GotoTimeControlProps {
  /** Newest telegram time (epoch ms) used to seed the input, or null when empty. */
  seedMs: number | null;
  /** Called with the chosen time (epoch ms) when the user submits. */
  onGoto: (targetMs: number, mods?: GotoTimeMods) => void;
  /** Raw-buffer (or loaded history) span. Omitted: every submit is a plain goto. */
  oldestMs?: number | null;
  newestMs?: number | null;
  /** History cannot reload a missing target. Defaults to live. */
  scope?: GotoScope;
}

/** Full local draft, same shape as DateTimeField / buffer edges. */
const INPUT_FMT = 'yyyy-MM-dd HH:mm:ss.SS';

/** Same frameless editor as the buffer-edge anchors in the status pill. */
const editStyle: CSSProperties = {
  width: `${INPUT_FMT.length}ch`,
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

export const GotoTimeControl: React.FC<GotoTimeControlProps> = ({
  seedMs, onGoto, oldestMs = null, newestMs = null, scope = 'live',
}) => {
  const buf = useGotoBuffer();
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [value, setValue] = useState('');
  const btnRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  /** Draft stays full date+time even when the field hides the date (if-differs). */
  const valueRef = useRef('');
  /** Set when Escape or an explicit submit already owns the outcome, so the blur that follows does not submit again. */
  const skipBlur = useRef(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const setDraft = (next: string) => {
    valueRef.current = next;
    setValue(next);
  };

  const bounded = oldestMs != null && newestMs != null;
  const submitFrom = (raw: string, via: 'field' | 'icon', ctrl: boolean) => {
    const ms = parseEditValueMs(raw);
    if (ms == null) {
      skipBlur.current = true;
      setFocused(false);
      setOpen(false);
      return;
    }
    const place = bounded ? classifyGotoTarget(ms, oldestMs, newestMs) : 'unknown';
    if (place === 'unknown' || place === 'inside') {
      skipBlur.current = true;
      if (ctrl && place === 'inside') onGoto(ms, { additive: true });
      else onGoto(ms);
      setFocused(false);
      setOpen(false);
      return;
    }
    if (scope === 'history') {
      skipBlur.current = true;
      setFocused(false);
      setOpen(false);
      return;
    }
    // The goto button only loads on Ctrl. Enter and blur still commit a typed time.
    if (via === 'icon' && !ctrl) return;
    skipBlur.current = true;
    onGoto(ms, { load: true });
    setFocused(false);
    setOpen(false);
  };

  const draftMs = parseEditValueMs(value);
  const draftPlace = bounded && draftMs != null
    ? classifyGotoTarget(draftMs, oldestMs, newestMs)
    : 'unknown';
  const goOutside = draftPlace === 'older' || draftPlace === 'newer';
  const goMissing = goOutside && scope === 'history';
  const goTone = goMissing ? 'missing' as const : goOutside ? 'outside' as const : 'ready' as const;

  const toggle = () => {
    if (open) { setOpen(false); return; }
    // Reseed to the newest telegram each time the popover opens.
    setFocused(false);
    setDraft(seedMs != null ? format(new Date(seedMs), INPUT_FMT) : '');
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      // Sit in the middle header row: vertically centered on the clock,
      // horizontally just to its right over the column labels.
      setPos({ top: r.top + r.height / 2, left: r.right + 6 });
    }
    setOpen(true);
  };

  // Close on Escape or an outside click, mirroring SendToGaPopover.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      skipBlur.current = true;
      setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      const n = e.target as Node;
      if ((e.target as Element | null)?.closest?.('[data-themed-datetime-picker]')) return;
      if (!cardRef.current?.contains(n) && !btnRef.current?.contains(n)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        className={`quick-filter-bar-toggle ${open ? 'open' : ''}`}
        onClick={toggle}
        title="Go to time"
        aria-label="Go to time"
      >
        <Clock size={13} />
      </button>
      {open && pos && createPortal(
        <div
          ref={cardRef}
          className="goto-time-popover"
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            transform: 'translateY(-50%)',
            zIndex: 1000,
          }}
        >
          <DateTimeField
            valueMs={draftMs}
            dateDisplay="if-differs"
            editable
            withCentiseconds
            editValue={value}
            focused={focused}
            aria-label="Target time"
            placeholder="Target time"
            editStyle={editStyle}
            onBeginEdit={() => setFocused(true)}
            onChange={setDraft}
            onBlur={() => {
              setFocused(false);
              if (skipBlur.current) {
                skipBlur.current = false;
                return;
              }
              // Draft is always full date+time; the input may show time-only.
              submitFrom(valueRef.current, 'field', false);
            }}
            onKeyDown={e => {
              if (e.key === 'Escape') {
                skipBlur.current = true;
                return;
              }
              if (e.key !== 'Enter') return;
              e.preventDefault();
              submitFrom(valueRef.current, 'field', e.ctrlKey || e.metaKey);
            }}
            endSlot={(
              <button
                type="button"
                className={`icon-button${goOutside ? ' tt-goto-outside' : ''}${goMissing ? ' tt-goto-missing' : ''}`}
                aria-label="Go"
                title={goMissing ? MISSING_GOTO_TITLE : goOutside ? OUTSIDE_GOTO_TITLE : 'Go'}
                disabled={draftMs == null}
                onMouseDown={e => e.preventDefault()}
                onClick={e => submitFrom(valueRef.current, 'icon', e.ctrlKey || e.metaKey)}
                style={{
                  color: goOutside ? 'var(--warning-text)' : 'var(--text-dim)',
                  padding: '0.15rem',
                  flexShrink: 0,
                  opacity: draftMs == null ? 0.45 : 1,
                }}
              >
                <GotoIcon tone={goTone} readDirection={buf.readDirection} size={13} />
              </button>
            )}
          />
        </div>,
        document.body,
      )}
    </>
  );
};
