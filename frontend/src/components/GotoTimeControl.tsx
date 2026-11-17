import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { format } from 'date-fns';
import { Clock } from 'lucide-react';
import { ThemedDatetimePicker } from './ThemedDatetimePicker';
import { GotoIcon } from './GotoIcon';
import { classifyGotoTarget } from '../utils/gotoTarget';
import {
  MISSING_GOTO_TITLE,
  OUTSIDE_GOTO_TITLE,
  useGotoBuffer,
  type GotoScope,
} from '../utils/gotoBuffer';

// "Quick goto time" control for the telegram list (#282): a clock button that
// opens a small time-entry popover. Submitting jumps the list to the telegram
// nearest that time and (via the parent) stops live-following.

export interface GotoTimeMods {
  /** Ctrl-click outside the buffer: load that window. */
  load?: boolean;
  /** Ctrl-click inside the buffer: add a jump target. */
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

/** date-fns pattern for an <input type="datetime-local" step="1"> value (local time). */
const INPUT_FMT = "yyyy-MM-dd'T'HH:mm:ss";

export const GotoTimeControl: React.FC<GotoTimeControlProps> = ({
  seedMs, onGoto, oldestMs = null, newestMs = null, scope = 'live',
}) => {
  const buf = useGotoBuffer();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const btnRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /** Set when Escape or an explicit submit already owns the outcome, so the blur that follows does not submit again. */
  const skipBlur = useRef(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const bounded = oldestMs != null && newestMs != null;
  const submitFrom = (raw: string, via: 'field' | 'icon', ctrl: boolean) => {
    const ms = new Date(raw).getTime();
    if (!raw || Number.isNaN(ms)) {
      skipBlur.current = true;
      setOpen(false);
      return;
    }
    const place = bounded ? classifyGotoTarget(ms, oldestMs, newestMs) : 'unknown';
    if (place === 'unknown' || place === 'inside') {
      skipBlur.current = true;
      if (ctrl && place === 'inside') onGoto(ms, { additive: true });
      else onGoto(ms);
      setOpen(false);
      return;
    }
    if (scope === 'history') {
      skipBlur.current = true;
      setOpen(false);
      return;
    }
    if (via === 'icon' && !ctrl) return;
    skipBlur.current = true;
    onGoto(ms, { load: true });
    setOpen(false);
  };

  const draftMs = value ? new Date(value).getTime() : NaN;
  const draftPlace = bounded && Number.isFinite(draftMs)
    ? classifyGotoTarget(draftMs, oldestMs, newestMs)
    : 'unknown';
  const goOutside = draftPlace === 'older' || draftPlace === 'newer';
  const goMissing = goOutside && scope === 'history';
  const goTone = goMissing ? 'missing' as const : goOutside ? 'outside' as const : 'ready' as const;

  const toggle = () => {
    if (open) { setOpen(false); return; }
    // Reseed to the newest telegram each time the popover opens.
    setValue(seedMs != null ? format(new Date(seedMs), INPUT_FMT) : '');
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
          <ThemedDatetimePicker
            className="goto-time-input"
            inputRef={inputRef}
            value={value}
            autoFocus
            withSeconds
            aria-label="Target time"
            onChange={setValue}
            onBlur={() => {
              if (skipBlur.current) {
                skipBlur.current = false;
                return;
              }
              submitFrom(inputRef.current?.value ?? value, 'field', false);
            }}
            onKeyDown={e => {
              if (e.key === 'Escape') {
                skipBlur.current = true;
                return;
              }
              if (e.key !== 'Enter') return;
              e.preventDefault();
              submitFrom((e.currentTarget as HTMLInputElement).value, 'field', e.ctrlKey || e.metaKey);
            }}
          />
          {goMissing ? (
            <style>{`
              .goto-time-popover .tt-goto-missing { opacity: 0; }
              .goto-time-popover:hover .tt-goto-missing { opacity: 1; }
            `}</style>
          ) : null}
          <button
            className={`goto-time-go${goOutside ? ' tt-goto-outside' : ''}${goMissing ? ' tt-goto-missing' : ''}`}
            onMouseDown={e => e.preventDefault()}
            onClick={e => submitFrom(inputRef.current?.value ?? value, 'icon', e.ctrlKey || e.metaKey)}
            disabled={!value}
            aria-label="Go"
            title={goMissing ? MISSING_GOTO_TITLE : goOutside ? OUTSIDE_GOTO_TITLE : 'Go'}
            style={goOutside ? { color: 'var(--warning-text)' } : undefined}
          >
            <GotoIcon tone={goTone} readDirection={buf.readDirection} size={13} />
          </button>
        </div>,
        document.body,
      )}
    </>
  );
};
