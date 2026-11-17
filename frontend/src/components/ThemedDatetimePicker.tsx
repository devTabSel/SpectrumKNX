import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Play } from 'lucide-react';

export type DatetimeMode = 'datetime' | 'date' | 'time';
/**
 * Popover action row:
 * - standard: Clear | Now | OK
 * - since: Since… | Clear  (TIME filter "von")
 * - before: Before… | Live | Clear  (TIME filter "bis")
 */
export type DatetimeActions = 'standard' | 'since' | 'before';
/** Separator between date and time in datetime values. */
export type DatetimeSeparator = 'T' | ' ';

interface Props {
  value: string;
  onChange: (value: string) => void;
  mode?: DatetimeMode;
  /** Include seconds in datetime/time values (default true). */
  withSeconds?: boolean;
  /** Append centiseconds `.SS` after seconds (requires withSeconds). */
  withCentiseconds?: boolean;
  /** Date/time join character (default `T`). */
  separator?: DatetimeSeparator;
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
  'aria-label'?: string;
  placeholder?: string;
  inputRef?: Ref<HTMLInputElement>;
  onBlur?: () => void;
  autoFocus?: boolean;
  /** Open the popover when the field receives focus (default true). */
  openOnFocus?: boolean;
  onKeyDown?: (e: KeyboardEvent) => void;
  /** bare = no chrome (inside ValueFieldShell); field = glass-like standalone input. */
  variant?: 'bare' | 'field';
  /** Inclusive local calendar day bounds from telegram DB (YYYY-MM-DD). */
  minDate?: string;
  maxDate?: string;
  /** Inclusive local instants for field clamp (YYYY-MM-DDTHH:mm[:ss]). */
  minDateTime?: string;
  maxDateTime?: string;
  /** Which action chips to show under the time column (default standard). */
  actions?: DatetimeActions;
  /** Optional Live action (before variant) — e.g. resume list follow. */
  onLive?: () => void;
  /** Decorative field chevron (default false). */
  showChevron?: boolean;
  /** Trailing control inside the field chrome (e.g. goto). */
  endSlot?: ReactNode;
  /**
   * When true with mode `datetime`, the field shows only the time (segment
   * edit / wheel on h–cs) while the draft and onChange stay full date+time.
   * Used so if-differs idle chrome does not expand on focus alone.
   */
  hideDateInField?: boolean;
}

type Parts = { y: number; mo: number; d: number; h: number; mi: number; s: number; cs: number };
type SegKey = 'year' | 'month' | 'day' | 'h' | 'mi' | 's' | 'cs';
type FieldSeg = { key: SegKey; start: number; end: number; maxLen: number };

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const CELL = 28;

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function dateKey(y: number, mo: number, d: number) {
  return `${String(y).padStart(4, '0')}-${pad(mo + 1)}-${pad(d)}`;
}

function parseCs(raw: string | undefined): number {
  if (raw == null || raw === '') return 0;
  const digits = raw.replace(/\D/g, '').slice(0, 2);
  if (!digits) return 0;
  return Math.min(99, Number(digits.padEnd(2, '0')));
}

function parseParts(value: string, mode: DatetimeMode): Parts | null {
  const now = new Date();
  if (!value.trim()) {
    return {
      y: now.getFullYear(), mo: now.getMonth(), d: now.getDate(),
      h: now.getHours(), mi: now.getMinutes(), s: now.getSeconds(), cs: 0,
    };
  }
  if (mode === 'time') {
    const m = value.match(/^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/);
    if (!m) return null;
    return {
      y: now.getFullYear(), mo: now.getMonth(), d: now.getDate(),
      h: Number(m[1]), mi: Number(m[2]), s: Number(m[3] ?? 0), cs: parseCs(m[4]),
    };
  }
  if (mode === 'date') {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return {
      y: Number(m[1]), mo: Number(m[2]) - 1, d: Number(m[3]),
      h: 0, mi: 0, s: 0, cs: 0,
    };
  }
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?/);
  if (!m) return null;
  return {
    y: Number(m[1]), mo: Number(m[2]) - 1, d: Number(m[3]),
    h: Number(m[4]), mi: Number(m[5]), s: Number(m[6] ?? 0), cs: parseCs(m[7]),
  };
}

function formatTime(p: Parts, withSeconds: boolean, withCentiseconds: boolean): string {
  if (!withSeconds) return `${pad(p.h)}:${pad(p.mi)}`;
  const base = `${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}`;
  return withCentiseconds ? `${base}.${pad(p.cs)}` : base;
}

function formatParts(
  p: Parts,
  mode: DatetimeMode,
  withSeconds: boolean,
  separator: DatetimeSeparator = 'T',
  withCentiseconds = false,
): string {
  const date = dateKey(p.y, p.mo, p.d);
  const time = formatTime(p, withSeconds, withCentiseconds && withSeconds);
  if (mode === 'date') return date;
  if (mode === 'time') return time;
  return `${date}${separator}${time}`;
}

function daysInMonth(y: number, mo: number) {
  return new Date(y, mo + 1, 0).getDate();
}

function inRange(y: number, mo: number, d: number, minDate?: string, maxDate?: string) {
  const key = dateKey(y, mo, d);
  if (minDate && key < minDate) return false;
  if (maxDate && key > maxDate) return false;
  return true;
}

function clampDay(y: number, mo: number, d: number) {
  return Math.min(d, daysInMonth(y, mo));
}

function fieldSegKeys(
  mode: DatetimeMode,
  withSeconds: boolean,
  withCentiseconds = false,
): SegKey[] {
  const cs = withSeconds && withCentiseconds;
  if (mode === 'time') {
    if (!withSeconds) return ['h', 'mi'];
    return cs ? ['h', 'mi', 's', 'cs'] : ['h', 'mi', 's'];
  }
  if (mode === 'date') return ['year', 'month', 'day'];
  if (!withSeconds) return ['year', 'month', 'day', 'h', 'mi'];
  return cs
    ? ['year', 'month', 'day', 'h', 'mi', 's', 'cs']
    : ['year', 'month', 'day', 'h', 'mi', 's'];
}

function fieldSegments(
  text: string,
  mode: DatetimeMode,
  withSeconds: boolean,
  withCentiseconds = false,
): FieldSeg[] {
  const keys = fieldSegKeys(mode, withSeconds, withCentiseconds);
  const out: FieldSeg[] = [];
  if (mode === 'time') {
    out.push({ key: 'h', start: 0, end: 2, maxLen: 2 });
    out.push({ key: 'mi', start: 3, end: 5, maxLen: 2 });
    if (withSeconds) out.push({ key: 's', start: 6, end: 8, maxLen: 2 });
    if (withSeconds && withCentiseconds) out.push({ key: 'cs', start: 9, end: 11, maxLen: 2 });
    return out.filter(s => keys.includes(s.key));
  }
  out.push({ key: 'year', start: 0, end: 4, maxLen: 4 });
  out.push({ key: 'month', start: 5, end: 7, maxLen: 2 });
  out.push({ key: 'day', start: 8, end: 10, maxLen: 2 });
  if (mode === 'datetime') {
    out.push({ key: 'h', start: 11, end: 13, maxLen: 2 });
    out.push({ key: 'mi', start: 14, end: 16, maxLen: 2 });
    if (withSeconds) out.push({ key: 's', start: 17, end: 19, maxLen: 2 });
    if (withSeconds && withCentiseconds) out.push({ key: 'cs', start: 20, end: 22, maxLen: 2 });
  }
  return out.filter(s => keys.includes(s.key) && s.end <= text.length);
}

function segAtCaret(segs: FieldSeg[], caret: number): FieldSeg | null {
  if (!segs.length) return null;
  for (const s of segs) {
    if (caret >= s.start && caret <= s.end) return s;
  }
  for (const s of segs) {
    if (caret < s.start) return s;
  }
  return segs[segs.length - 1];
}

const popoverPanel: CSSProperties = {
  position: 'fixed',
  zIndex: 1100,
  display: 'flex',
  flexDirection: 'column',
  gap: '0.45rem',
  padding: '0.55rem 0.65rem',
  background: 'var(--bg-panel)',
  backdropFilter: 'var(--glass-blur)',
  WebkitBackdropFilter: 'var(--glass-blur)',
  border: '1px solid var(--border-color)',
  borderRadius: 10,
  boxShadow: 'var(--shadow-lg)',
  color: 'var(--text-main)',
  fontSize: '0.75rem',
  boxSizing: 'border-box',
  userSelect: 'none',
};

const iconBtn = (disabled = false): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  padding: 0,
  border: 'none',
  borderRadius: 6,
  background: 'transparent',
  color: disabled ? 'var(--text-dim)' : 'var(--text-main)',
  cursor: disabled ? 'default' : 'pointer',
  opacity: disabled ? 0.35 : 1,
});

const dayBtn = (selected: boolean, muted: boolean, disabled: boolean): CSSProperties => ({
  width: CELL,
  height: CELL,
  padding: 0,
  border: 'none',
  borderRadius: '50%',
  background: selected ? 'var(--accent-primary)' : 'transparent',
  color: selected
    ? 'white'
    : muted || disabled
      ? 'var(--text-dim)'
      : 'var(--text-main)',
  cursor: disabled ? 'default' : 'pointer',
  font: 'inherit',
  fontSize: '0.72rem',
  fontWeight: selected ? 600 : 400,
  opacity: disabled ? 0.35 : 1,
});

/** Day-cell look for Now / Clear / OK. */
const chipBtn = (accent = false, disabled = false): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: CELL,
  height: CELL,
  padding: '0 0.4rem',
  border: 'none',
  borderRadius: CELL / 2,
  background: accent ? 'var(--accent-primary)' : 'transparent',
  color: accent ? 'white' : disabled ? 'var(--text-dim)' : 'var(--text-main)',
  cursor: disabled ? 'default' : 'pointer',
  font: 'inherit',
  fontSize: '0.65rem',
  fontWeight: accent ? 600 : 500,
  opacity: disabled ? 0.35 : 1,
});

const iconBtnStyle = (disabled = false): CSSProperties => iconBtn(disabled);

/** Comparable local instant string for clamping (date / datetime / time). */
function partsCompareKey(
  p: Parts,
  mode: DatetimeMode,
  withSeconds: boolean,
  withCentiseconds = false,
): string {
  return formatParts(
    p,
    mode === 'time' ? 'datetime' : mode,
    withSeconds,
    'T',
    withCentiseconds,
  );
}

/**
 * Clamp to telegram DB span: before oldest → oldest; after newest → newest.
 * Field entry itself is unrestricted; callers apply this on blur/OK.
 */
function clampPartsToDb(
  p: Parts,
  mode: DatetimeMode,
  withSeconds: boolean,
  minDateTime?: string,
  maxDateTime?: string,
  minDate?: string,
  maxDate?: string,
  withCentiseconds = false,
): Parts {
  if (mode === 'time') return p;
  const minBound = minDateTime ?? minDate;
  const maxBound = maxDateTime ?? maxDate;
  if (!minBound && !maxBound) return p;

  if (mode === 'date') {
    const key = dateKey(p.y, p.mo, p.d);
    if (minBound) {
      const minDay = minBound.slice(0, 10);
      if (key < minDay) return parseParts(minDay, 'date') ?? p;
    }
    if (maxBound) {
      const maxDay = maxBound.slice(0, 10);
      if (key > maxDay) return parseParts(maxDay, 'date') ?? p;
    }
    return p;
  }

  const cur = partsCompareKey(p, 'datetime', withSeconds, withCentiseconds);
  const toInstant = (bound: string, which: 'min' | 'max') => {
    if (bound.includes('T') || bound.includes(' ')) return bound.replace(' ', 'T');
    return which === 'min' ? `${bound}T00:00:00` : `${bound}T23:59:59`;
  };
  const norm = (bound: string) => {
    const t = bound.replace(' ', 'T');
    if (withCentiseconds && withSeconds) {
      if (t.length >= 22) return t.slice(0, 22);
      if (t.length >= 19) return `${t.slice(0, 19)}.00`;
      return `${t}:00.00`.slice(0, 22);
    }
    if (withSeconds) {
      return t.length >= 19 ? t.slice(0, 19) : `${t}:00`.slice(0, 19);
    }
    return t.slice(0, 16);
  };
  if (minBound) {
    const minInst = toInstant(minBound, 'min');
    if (cur < norm(minInst)) return parseParts(minInst, 'datetime') ?? p;
  }
  if (maxBound) {
    const maxInst = toInstant(maxBound, 'max');
    if (cur > norm(maxInst)) return parseParts(maxInst, 'datetime') ?? p;
  }
  return p;
}

/**
 * One step of a field segment with carry into larger units:
 * cs→s→mi→h→day→month→year (and the reverse on underflow).
 */
function stepParts(p: Parts, key: SegKey, dir: 1 | -1): Parts {
  const next = { ...p };
  if (key === 'year') {
    next.y = next.y + dir;
    next.d = clampDay(next.y, next.mo, next.d);
    return next;
  }
  if (key === 'month') {
    let mo = next.mo + dir;
    let y = next.y;
    if (mo > 11) { mo = 0; y += 1; }
    if (mo < 0) { mo = 11; y -= 1; }
    next.mo = mo;
    next.y = y;
    next.d = clampDay(y, mo, next.d);
    return next;
  }
  if (key === 'day') {
    const dim = daysInMonth(next.y, next.mo);
    let d = next.d + dir;
    if (d > dim) {
      let mo = next.mo + 1;
      let y = next.y;
      if (mo > 11) { mo = 0; y += 1; }
      next.y = y;
      next.mo = mo;
      next.d = 1;
      return next;
    }
    if (d < 1) {
      let mo = next.mo - 1;
      let y = next.y;
      if (mo < 0) { mo = 11; y -= 1; }
      next.y = y;
      next.mo = mo;
      next.d = daysInMonth(y, mo);
      return next;
    }
    next.d = d;
    return next;
  }
  if (key === 'h') {
    let h = next.h + dir;
    if (h > 23) {
      next.h = 0;
      return stepParts(next, 'day', 1);
    }
    if (h < 0) {
      next.h = 23;
      return stepParts(next, 'day', -1);
    }
    next.h = h;
    return next;
  }
  if (key === 'mi') {
    let mi = next.mi + dir;
    if (mi > 59) {
      next.mi = 0;
      return stepParts(next, 'h', 1);
    }
    if (mi < 0) {
      next.mi = 59;
      return stepParts(next, 'h', -1);
    }
    next.mi = mi;
    return next;
  }
  if (key === 's') {
    let s = next.s + dir;
    if (s > 59) {
      next.s = 0;
      return stepParts(next, 'mi', 1);
    }
    if (s < 0) {
      next.s = 59;
      return stepParts(next, 'mi', -1);
    }
    next.s = s;
    return next;
  }
  if (key === 'cs') {
    let cs = next.cs + dir;
    if (cs > 99) {
      next.cs = 0;
      return stepParts(next, 's', 1);
    }
    if (cs < 0) {
      next.cs = 99;
      return stepParts(next, 's', -1);
    }
    next.cs = cs;
    return next;
  }
  return next;
}

/**
 * Themed Chromium-style date/time picker.
 * - Field: segmented edit (Tab / click / digits / arrows) like native datetime-local.
 * - Popover: mouse-only calendar + time spins (no keyboard/focus navigation).
 */
export function ThemedDatetimePicker({
  value,
  onChange,
  mode = 'datetime',
  withSeconds = true,
  withCentiseconds = false,
  separator = 'T',
  className,
  style,
  disabled = false,
  'aria-label': ariaLabel,
  placeholder,
  inputRef,
  onBlur,
  autoFocus,
  openOnFocus = true,
  onKeyDown,
  variant = 'field',
  minDate,
  maxDate,
  minDateTime,
  maxDateTime,
  actions = 'standard',
  onLive,
  showChevron,
  endSlot,
  hideDateInField = false,
}: Props) {
  const useCs = withSeconds && withCentiseconds;
  // Field chrome may hide the date; draft / onChange stay on the real mode.
  const fieldMode: DatetimeMode = hideDateInField && mode === 'datetime' ? 'time' : mode;
  const fmt = (p: Parts) => formatParts(p, mode, withSeconds, separator, useCs);
  const fmtField = (p: Parts) => formatParts(p, fieldMode, withSeconds, separator, useCs);
  const [open, setOpen] = useState(false);
  const [fieldFocused, setFieldFocused] = useState(false);
  /** After Clear: keep the input blank while focused (draft still seeds the calendar). */
  const [cleared, setCleared] = useState(false);
  const [activeSeg, setActiveSeg] = useState<SegKey>(() => fieldSegKeys(fieldMode, withSeconds, useCs)[0]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const localInputRef = useRef<HTMLInputElement>(null);
  const skipFocusOpen = useRef(false);
  const digitBuf = useRef('');
  const pendingSelect = useRef<SegKey | null>(null);
  const ignoreSelect = useRef(false);
  /** True while a pointer is down on the field — skip focus/layout caret resets. */
  const mouseDownOnField = useRef(false);
  /** Focus just opened the popover; the trailing mouseup must not toggle it closed. */
  const openedByThisPointer = useRef(false);
  const activeSegRef = useRef(activeSeg);
  const openRef = useRef(open);
  activeSegRef.current = activeSeg;
  openRef.current = open;
  const valueAtFocus = useRef(value);
  const dirty = useRef(false);
  /** Escape restores the focused value; the blur that follows must not commit the draft. */
  const escapeRevert = useRef(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const markDirty = () => {
    dirty.current = true;
    setCleared(false);
  };

  const base = useMemo(() => parseParts(value, mode) ?? parseParts('', mode)!, [value, mode]);
  const [viewY, setViewY] = useState(base.y);
  const [viewMo, setViewMo] = useState(base.mo);
  const [draft, setDraft] = useState(base);

  const valueParts = useMemo(() => parseParts(value, mode), [value, mode]);
  const shown = cleared
    ? ''
    : (fieldFocused || open)
      ? fmtField(draft)
      : (hideDateInField && mode === 'datetime' && valueParts
        ? fmtField(valueParts)
        : value);
  const segs = useMemo(
    () => fieldSegments(shown, fieldMode, withSeconds, useCs),
    [shown, fieldMode, withSeconds, useCs],
  );

  /** Publish draft immediately so parents (e.g. goto icons) track uncommitted edits. */
  const publishDraft = (p: Parts) => {
    markDirty();
    setDraft(p);
    setViewY(p.y);
    setViewMo(p.mo);
    onChange(fmt(p));
  };

  const wasOpen = useRef(false);
  useEffect(() => {
    if (!open) {
      wasOpen.current = false;
      return;
    }
    const p = parseParts(value, mode) ?? parseParts('', mode)!;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- copy the committed value into the open picker
    setDraft(p);
    setViewY(p.y);
    setViewMo(p.mo);
    if (!wasOpen.current) {
      wasOpen.current = true;
    }
  }, [open, value, mode]);

  const place = () => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = mode === 'time' ? 160 : mode === 'date' ? 240 : 360;
    let left = r.left;
    if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8);
    let top = r.bottom + 4;
    const estH = mode === 'time' ? 160 : 320;
    if (top + estH > window.innerHeight - 8) top = Math.max(8, r.top - estH - 4);
    setPos({ top, left });
  };

  useLayoutEffect(() => {
    if (!open) return;
    place();
    const onScroll = () => place();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, mode]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const n = e.target as Node;
      if (!cardRef.current?.contains(n) && !wrapRef.current?.contains(n)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const closePicker = () => setOpen(false);
  const openPicker = () => {
    if (disabled) return;
    setOpen(true);
  };

  const commitDraft = (p: Parts = draft) => {
    const clamped = clampPartsToDb(
      { ...p, d: clampDay(p.y, p.mo, p.d) },
      mode,
      withSeconds,
      minDateTime,
      maxDateTime,
      minDate,
      maxDate,
      useCs,
    );
    setDraft(clamped);
    setViewY(clamped.y);
    setViewMo(clamped.mo);
    const formatted = fmt(clamped);
    onChange(formatted);
    valueAtFocus.current = formatted;
    dirty.current = false;
  };

  const selectSeg = (key: SegKey, keepDigits = false) => {
    if (!keepDigits) digitBuf.current = '';
    pendingSelect.current = key;
    setActiveSeg(key);
    const el = localInputRef.current;
    const text = fmtField(draft);
    const list = fieldSegments(text, fieldMode, withSeconds, useCs);
    const seg = list.find(s => s.key === key);
    if (el && seg) {
      ignoreSelect.current = true;
      el.setSelectionRange(seg.start, seg.end);
      queueMicrotask(() => { ignoreSelect.current = false; });
    }
  };

  useLayoutEffect(() => {
    const key = pendingSelect.current ?? activeSeg;
    if (!fieldFocused) return;
    // A field click owns the caret until mouseup selects/toggles — don't snap back.
    if (mouseDownOnField.current) return;
    const el = localInputRef.current;
    if (!el) return;
    const list = fieldSegments(shown, fieldMode, withSeconds, useCs);
    const seg = list.find(s => s.key === key);
    if (!seg) return;
    ignoreSelect.current = true;
    el.setSelectionRange(seg.start, seg.end);
    pendingSelect.current = null;
    queueMicrotask(() => { ignoreSelect.current = false; });
  }, [shown, activeSeg, fieldFocused, fieldMode, withSeconds, useCs]);

  const applySegmentDigits = (key: SegKey, digits: string) => {
    const maxLen = key === 'year' ? 4 : 2;
    const raw = digits.replace(/\D/g, '').slice(-maxLen);
    if (!raw) return;
    let n = Number(raw);
    const next = { ...draft };
    if (key === 'year') {
      next.y = Math.min(9999, Math.max(0, n));
      next.d = clampDay(next.y, next.mo, next.d);
    } else if (key === 'month') {
      n = Math.min(12, Math.max(1, n));
      next.mo = n - 1;
      next.d = clampDay(next.y, next.mo, next.d);
    } else if (key === 'day') {
      const dim = daysInMonth(next.y, next.mo);
      next.d = Math.min(dim, Math.max(1, n));
    } else if (key === 'h') {
      next.h = Math.min(23, Math.max(0, n));
    } else if (key === 'mi') {
      next.mi = Math.min(59, Math.max(0, n));
    } else if (key === 's') {
      next.s = Math.min(59, Math.max(0, n));
    } else if (key === 'cs') {
      next.cs = Math.min(99, Math.max(0, Number(raw.padEnd(2, '0').slice(0, 2))));
    }
    pendingSelect.current = key;
    publishDraft(next);
  };

  /** ArrowUp/Down: free segment scroll in the field (DB clamp happens on blur/OK). */
  const bumpSeg = (key: SegKey, dir: 1 | -1) => {
    const candidate = stepParts(draft, key, dir);
    pendingSelect.current = key;
    publishDraft(candidate);
  };

  useEffect(() => {
    const el = localInputRef.current;
    if (!el || !fieldFocused || disabled) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      digitBuf.current = '';
      bumpSeg(activeSeg, e.deltaY < 0 ? 1 : -1);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [fieldFocused, activeSeg, disabled, draft, mode, withSeconds, useCs, separator]);

  const shiftFieldSeg = (dir: 1 | -1): boolean => {
    const keys = fieldSegKeys(fieldMode, withSeconds, useCs);
    const idx = keys.indexOf(activeSeg);
    const next = keys[idx + dir];
    if (!next) return false;
    selectSeg(next);
    return true;
  };

  const todayParts = () => {
    const n = new Date();
    return {
      y: n.getFullYear(), mo: n.getMonth(), d: n.getDate(),
      h: n.getHours(), mi: n.getMinutes(), s: n.getSeconds(),
      cs: Math.floor(n.getMilliseconds() / 10),
    };
  };
  const todayAllowed = (() => {
    const t = todayParts();
    return inRange(t.y, t.mo, t.d, minDate, maxDate);
  })();

  const canShiftMonth = (dir: 1 | -1) => {
    let mo = viewMo + dir;
    let y = viewY;
    if (mo > 11) { mo = 0; y += 1; }
    if (mo < 0) { mo = 11; y -= 1; }
    const dim = daysInMonth(y, mo);
    const first = dateKey(y, mo, 1);
    const last = dateKey(y, mo, dim);
    if (minDate && last < minDate) return false;
    if (maxDate && first > maxDate) return false;
    return true;
  };

  const shiftMonth = (dir: 1 | -1) => {
    if (!canShiftMonth(dir)) return;
    let mo = viewMo + dir;
    let y = viewY;
    if (mo > 11) { mo = 0; y += 1; }
    if (mo < 0) { mo = 11; y -= 1; }
    setViewMo(mo);
    setViewY(y);
  };

  const pickDay = (y: number, mo: number, d: number) => {
    const next = { ...draft, y, mo, d };
    publishDraft(next);
    selectSeg('day');
  };

  const setTimePart = (key: 'h' | 'mi' | 's', n: number) => {
    const next = { ...draft };
    if (key === 'h') next.h = ((n % 24) + 24) % 24;
    if (key === 'mi') next.mi = ((n % 60) + 60) % 60;
    if (key === 's') next.s = ((n % 60) + 60) % 60;
    publishDraft(next);
    selectSeg(key);
  };

  useEffect(() => {
    const card = cardRef.current;
    if (!open || !card) return;
    const onWheel = (e: WheelEvent) => {
      const target = e.target as HTMLElement | null;
      const monthNav = target?.closest?.('[data-cal-month-nav]');
      if (monthNav) {
        e.preventDefault();
        shiftMonth(e.deltaY < 0 ? 1 : -1);
        return;
      }
      const spin = target?.closest?.('[data-time-spin]');
      if (!spin) return;
      const key = spin.getAttribute('data-time-spin');
      if (key !== 'h' && key !== 'mi' && key !== 's') return;
      e.preventDefault();
      setTimePart(key, draft[key] + (e.deltaY < 0 ? 1 : -1));
    };
    card.addEventListener('wheel', onWheel, { passive: false });
    return () => card.removeEventListener('wheel', onWheel);
  }, [open, pos, draft.h, draft.mi, draft.s, viewMo, viewY, minDate, maxDate]);

  const runClear = () => {
    setCleared(true);
    dirty.current = false;
    valueAtFocus.current = '';
    onChange('');
    const p = parseParts('', mode)!;
    setDraft(p);
    setViewY(p.y);
    setViewMo(p.mo);
    closePicker();
  };

  /** Apply current local now and close. */
  const runNow = () => {
    if (!todayAllowed) return;
    const p = todayParts();
    commitDraft(p);
    closePicker();
  };

  const runOk = () => {
    commitDraft();
    closePicker();
  };

  const calendarCells = useMemo(() => {
    const first = new Date(viewY, viewMo, 1).getDay();
    const dim = daysInMonth(viewY, viewMo);
    const prevDim = daysInMonth(viewY, viewMo === 0 ? 11 : viewMo - 1);
    const cells: { day: number; mo: number; y: number; inMonth: boolean; enabled: boolean }[] = [];
    for (let i = first - 1; i >= 0; i--) {
      const mo = viewMo === 0 ? 11 : viewMo - 1;
      const y = viewMo === 0 ? viewY - 1 : viewY;
      const day = prevDim - i;
      cells.push({ day, mo, y, inMonth: false, enabled: inRange(y, mo, day, minDate, maxDate) });
    }
    for (let d = 1; d <= dim; d++) {
      cells.push({
        day: d, mo: viewMo, y: viewY, inMonth: true,
        enabled: inRange(viewY, viewMo, d, minDate, maxDate),
      });
    }
    let next = 1;
    const nextMo = viewMo === 11 ? 0 : viewMo + 1;
    const nextY = viewMo === 11 ? viewY + 1 : viewY;
    while (cells.length % 7 !== 0) {
      const day = next++;
      cells.push({
        day, mo: nextMo, y: nextY, inMonth: false,
        enabled: inRange(nextY, nextMo, day, minDate, maxDate),
      });
    }
    return cells;
  }, [viewY, viewMo, minDate, maxDate]);

  const timePh = !withSeconds
    ? 'HH:mm'
    : useCs
      ? 'HH:mm:ss.SS'
      : 'HH:mm:ss';
  const displayPlaceholder = placeholder
    ?? (mode === 'date'
      ? 'YYYY-MM-DD'
      : mode === 'time'
        ? timePh
        : `YYYY-MM-DD${separator}${timePh}`);

  const setInputRef = (el: HTMLInputElement | null) => {
    localInputRef.current = el;
    if (typeof inputRef === 'function') inputRef(el);
    // eslint-disable-next-line react-hooks/immutability -- forward the node to the caller's ref
    else if (inputRef && 'current' in inputRef) (inputRef as { current: HTMLInputElement | null }).current = el;
  };

  const useHostChrome = Boolean(className) && variant === 'field';
  const chevronVisible = showChevron === true;
  const hasEndSlot = endSlot != null;
  const explicitWidth = style?.width;
  const wrapWidth: CSSProperties['width'] = explicitWidth != null
    ? 'fit-content'
    : variant === 'bare'
      ? undefined
      : '100%';
  /** When an endSlot is present, chrome sits on the wrap so the button is inside the field. */
  const shellChrome = variant === 'field' && hasEndSlot && !useHostChrome;
  const fieldStyle: CSSProperties = variant === 'bare'
    ? {
        ...style,
        border: 'none',
        outline: 'none',
        background: 'transparent',
        padding: 0,
        color: 'inherit',
        font: 'inherit',
        width: '100%',
        minWidth: 0,
        cursor: disabled ? 'default' : 'text',
      }
    : shellChrome
      ? {
          border: 'none',
          outline: 'none',
          background: 'transparent',
          padding: 0,
          color: 'var(--text-main)',
          fontSize: '0.7rem',
          fontFamily: "'JetBrains Mono', monospace",
          fontVariantNumeric: 'tabular-nums',
          width: explicitWidth ?? '100%',
          minWidth: 0,
          cursor: disabled ? 'default' : 'text',
          boxSizing: 'border-box',
          ...style,
          // Keep size tokens from style, but chrome lives on the wrap.
          borderWidth: undefined,
          borderStyle: undefined,
          borderColor: undefined,
          background: 'transparent',
          padding: 0,
        }
    : useHostChrome
      ? {
          width: '100%',
          boxSizing: 'border-box',
          outline: 'none',
          cursor: disabled ? 'default' : 'text',
          ...style,
        }
      : {
          width: '100%',
          boxSizing: 'border-box',
          background: 'var(--bg-inset)',
          border: '1px solid var(--border-color)',
          borderRadius: 6,
          padding: '0.25rem 0.45rem',
          color: 'var(--text-main)',
          fontSize: '0.75rem',
          fontFamily: "'JetBrains Mono', monospace",
          outline: 'none',
          cursor: disabled ? 'default' : 'text',
          ...style,
        };

  const onFieldKeyDown = (e: KeyboardEvent) => {
    onKeyDown?.(e);
    if (e.defaultPrevented) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      skipFocusOpen.current = true;
      const original = valueAtFocus.current;
      const p = parseParts(original, mode) ?? parseParts('', mode)!;
      setDraft(p);
      setViewY(p.y);
      setViewMo(p.mo);
      const wasDirty = dirty.current;
      dirty.current = false;
      escapeRevert.current = true;
      setCleared(original.trim() === '');
      // Always restore for live drafts — even when the controlled `value` prop
      // has not caught up yet (or the parent is uncontrolled).
      if (wasDirty || value !== original) onChange(original);
      closePicker();
      // Leave the field so a parent blur sees the restored value and does not jump.
      localInputRef.current?.blur();
      return;
    }

    // Tab / Shift-Tab leave the field (browser focus order). Segments use ←/→.

    if (/^\d$/.test(e.key)) {
      e.preventDefault();
      if (!open && openOnFocus) openPicker();
      const key = activeSeg;
      const maxLen = key === 'year' ? 4 : 2;
      digitBuf.current = (digitBuf.current + e.key).slice(-maxLen);
      applySegmentDigits(key, digitBuf.current);
      if (digitBuf.current.length >= maxLen) {
        const keys = fieldSegKeys(fieldMode, withSeconds, useCs);
        const i = keys.indexOf(key);
        digitBuf.current = '';
        if (i >= 0 && i < keys.length - 1) {
          pendingSelect.current = keys[i + 1];
          setActiveSeg(keys[i + 1]);
        } else {
          pendingSelect.current = key;
        }
      } else {
        pendingSelect.current = key;
      }
      return;
    }

    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      if (!open && openOnFocus) openPicker();
      shiftFieldSeg(e.key === 'ArrowRight' ? 1 : -1);
      return;
    }

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open && openOnFocus) openPicker();
      digitBuf.current = '';
      bumpSeg(activeSeg, e.key === 'ArrowDown' ? 1 : -1);
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      runOk();
    }
  };

  const onInputMouseDown = () => {
    if (disabled) return;
    mouseDownOnField.current = true;
  };

  /**
   * Click on a non-active segment → select it (picker stays/opens).
   * Click on the already-selected segment → toggle the calendar popover
   * (except the mouseup of the pointer that just focused/opened).
   */
  const onInputMouseUp = () => {
    const el = localInputRef.current;
    if (!el) {
      mouseDownOnField.current = false;
      openedByThisPointer.current = false;
      return;
    }
    // Read caret after the browser placed it; win over focus layout ignoreSelect.
    ignoreSelect.current = false;
    const caret = el.selectionStart ?? 0;
    const list = fieldSegments(el.value || shown, fieldMode, withSeconds, useCs);
    const hit = segAtCaret(list, caret);
    mouseDownOnField.current = false;
    if (!hit) {
      openedByThisPointer.current = false;
      return;
    }

    if (hit.key === activeSegRef.current) {
      if (openedByThisPointer.current) {
        // Opening click: keep popover open, keep this segment selected.
        openedByThisPointer.current = false;
        selectSeg(hit.key);
        if (!openRef.current) openPicker();
        return;
      }
      if (openRef.current) {
        skipFocusOpen.current = true;
        closePicker();
      } else {
        openPicker();
      }
      selectSeg(hit.key);
      return;
    }

    openedByThisPointer.current = false;
    selectSeg(hit.key);
    if (!openRef.current) openPicker();
  };

  const onWrapMouseDown = (e: ReactMouseEvent) => {
    if (disabled) return;
    const target = e.target as HTMLElement;
    const onField = target === localInputRef.current || localInputRef.current?.contains(target);
    // Field clicks are owned by onInputMouseDown/Up (select vs toggle).
    if (onField) return;
    e.preventDefault();
    if (open) {
      skipFocusOpen.current = true;
      commitDraft();
      closePicker();
    } else {
      openPicker();
    }
    localInputRef.current?.focus();
  };

  const keepFieldFocus = (e: ReactMouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Keep the field focused so the picker cannot click through to another control.
    if (document.activeElement !== localInputRef.current) {
      localInputRef.current?.focus({ preventScroll: true });
    }
  };

  const timeSpin = (key: 'h' | 'mi' | 's', label: string, cur: number, max: number) => (
    <div
      key={key}
      data-time-spin={key}
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, width: 40 }}
    >
      <div style={{ fontSize: '0.6rem', color: 'var(--text-dim)' }}>{label}</div>
      <button
        type="button"
        tabIndex={-1}
        aria-label={`Increase ${label}`}
        style={iconBtn()}
        onClick={() => setTimePart(key, cur + 1)}
      >
        <ChevronUp size={14} />
      </button>
      <div
        role="spinbutton"
        aria-label={label === 'HH' ? 'hour' : label === 'MM' ? 'minute' : 'second'}
        aria-valuenow={cur}
        aria-valuemin={0}
        aria-valuemax={max}
        style={{
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: '0.85rem',
          fontWeight: 600,
          height: 28,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          borderRadius: 4,
          background: 'var(--bg-inset)',
        }}
      >
        {pad(cur)}
      </div>
      <button
        type="button"
        tabIndex={-1}
        aria-label={`Decrease ${label}`}
        style={iconBtn()}
        onClick={() => setTimePart(key, cur - 1)}
      >
        <ChevronDown size={14} />
      </button>
    </div>
  );

  return (
    <>
      <div
        ref={wrapRef}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: hasEndSlot ? 2 : undefined,
          width: wrapWidth,
          minWidth: 0,
          position: 'relative',
          flex: variant === 'bare' ? '1 1 auto' : undefined,
          flexShrink: explicitWidth != null || shellChrome ? 0 : undefined,
          ...(shellChrome
            ? {
                background: 'var(--bg-inset)',
                border: '1px solid var(--border-color)',
                borderRadius: 6,
                padding: '0.15rem 0.2rem 0.15rem 0.35rem',
                boxSizing: 'border-box' as const,
                height: style?.height,
              }
            : null),
        }}
        onMouseDown={onWrapMouseDown}
      >
        <input
          // eslint-disable-next-line react-hooks/immutability -- callback ref merges the local node with inputRef
          ref={setInputRef}
          type="text"
          disabled={disabled}
          className={className}
          style={fieldStyle}
          value={shown}
          placeholder={displayPlaceholder}
          aria-label={ariaLabel}
          aria-haspopup="dialog"
          aria-expanded={open}
          autoFocus={autoFocus}
          spellCheck={false}
          onFocus={() => {
            if (disabled) return;
            setFieldFocused(true);
            valueAtFocus.current = value;
            dirty.current = false;
            setCleared(!value.trim());
            const p = parseParts(value, mode) ?? parseParts('', mode)!;
            setDraft(p);
            setViewY(p.y);
            setViewMo(p.mo);
            digitBuf.current = '';
            // Keyboard/programmatic focus starts on the first segment. A pointer
            // click leaves the caret alone — mouseup selects/toggles.
            if (!mouseDownOnField.current) {
              const first = fieldSegKeys(fieldMode, withSeconds, useCs)[0];
              pendingSelect.current = first;
              setActiveSeg(first);
            }
            if (skipFocusOpen.current) {
              skipFocusOpen.current = false;
              return;
            }
            if (openOnFocus) {
              openPicker();
              if (mouseDownOnField.current) openedByThisPointer.current = true;
            }
          }}
          onChange={e => {
            const v = e.target.value;
            markDirty();
            // Freehand: when the date is hidden, accept a pasted full datetime or
            // a time-only edit merged onto the draft's calendar day.
            if (hideDateInField && mode === 'datetime') {
              const asFull = parseParts(v, mode);
              if (asFull) {
                setDraft(asFull);
                setViewY(asFull.y);
                setViewMo(asFull.mo);
                onChange(fmt(asFull));
                return;
              }
              const typed = parseParts(v, 'time');
              if (typed) {
                const next = { ...draft, h: typed.h, mi: typed.mi, s: typed.s, cs: typed.cs };
                setDraft(next);
                setViewY(next.y);
                setViewMo(next.mo);
                onChange(fmt(next));
                return;
              }
              onChange(v);
              return;
            }
            const typed = parseParts(v, mode);
            if (typed) {
              setDraft(typed);
              setViewY(typed.y);
              setViewMo(typed.mo);
              onChange(fmt(typed));
            } else {
              onChange(v);
            }
          }}
          onMouseDown={onInputMouseDown}
          onMouseUp={onInputMouseUp}
          onBlur={() => {
            const reverting = escapeRevert.current;
            escapeRevert.current = false;
            setFieldFocused(false);
            digitBuf.current = '';
            if (!reverting) {
              if (cleared) {
                onChange('');
                dirty.current = false;
              } else if (dirty.current) {
                commitDraft();
              }
            }
            closePicker();
            onBlur?.();
          }}
          onKeyDown={onFieldKeyDown}
        />
        {hasEndSlot ? (
          <span
            style={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}
            onMouseDown={e => {
              // Keep field focus while clicking the trailing control.
              e.preventDefault();
            }}
          >
            {endSlot}
          </span>
        ) : null}
        {chevronVisible && (
          <span
            aria-hidden
            style={{
              position: 'absolute',
              right: hasEndSlot ? 22 : 4,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--text-dim)',
              padding: 2,
              pointerEvents: 'none',
              display: 'inline-flex',
            }}
          >
            <ChevronDown size={14} />
          </span>
        )}
      </div>
      {open && pos && createPortal(
        <div
          ref={cardRef}
          role="dialog"
          aria-label="Date and time picker"
          data-themed-datetime-picker
          data-active-seg={activeSeg}
          style={{ ...popoverPanel, top: pos.top, left: pos.left, pointerEvents: 'auto' }}
          onMouseDown={keepFieldFocus}
          onClick={e => e.stopPropagation()}
        >
          <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'stretch' }}>
            {mode !== 'time' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                <div
                  data-cal-month-nav
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}
                >
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label="Previous month"
                    aria-disabled={!canShiftMonth(-1)}
                    style={iconBtnStyle(!canShiftMonth(-1))}
                    onClick={() => { if (canShiftMonth(-1)) shiftMonth(-1); }}
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <div
                    data-cal-heading
                    style={{ fontWeight: 600, fontSize: '0.78rem', textAlign: 'center', minWidth: 120 }}
                  >
                    {MONTHS[viewMo]} {viewY}
                  </div>
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label="Next month"
                    aria-disabled={!canShiftMonth(1)}
                    style={iconBtnStyle(!canShiftMonth(1))}
                    onClick={() => { if (canShiftMonth(1)) shiftMonth(1); }}
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
                <div
                  role="grid"
                  aria-label="Calendar"
                  style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}
                >
                  {WEEKDAYS.map(w => (
                    <div
                      key={w}
                      style={{
                        width: CELL,
                        height: 20,
                        textAlign: 'center',
                        fontSize: '0.6rem',
                        color: 'var(--text-dim)',
                        lineHeight: '20px',
                      }}
                    >
                      {w}
                    </div>
                  ))}
                  {calendarCells.map((c, i) => {
                    const selected = c.y === draft.y && c.mo === draft.mo && c.day === draft.d;
                    return (
                      <button
                        key={`${c.y}-${c.mo}-${c.day}-${i}`}
                        type="button"
                        tabIndex={-1}
                        aria-disabled={!c.enabled}
                        aria-label={`${c.y}-${pad(c.mo + 1)}-${pad(c.day)}`}
                        aria-pressed={selected}
                        style={dayBtn(selected, !c.inMonth, !c.enabled)}
                        onClick={() => {
                          if (c.enabled) pickDay(c.y, c.mo, c.day);
                        }}
                      >
                        {c.day}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div
              data-side-block
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'stretch',
                justifyContent: mode === 'date' ? 'flex-end' : 'flex-start',
                gap: '0.35rem',
                paddingLeft: mode === 'time' ? 0 : 4,
                borderLeft: mode === 'time' ? 'none' : '1px solid var(--border-subtle)',
                minWidth: 56,
                alignSelf: 'stretch',
              }}
            >
              {actions === 'standard' && (
                <div
                  data-action-row="now-clear"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 4,
                    width: '100%',
                  }}
                >
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label="Now"
                    aria-disabled={!todayAllowed}
                    style={chipBtn(false, !todayAllowed)}
                    onClick={() => { if (todayAllowed) runNow(); }}
                  >
                    Now
                  </button>
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label="Clear"
                    style={chipBtn(false)}
                    onClick={runClear}
                  >
                    Clear
                  </button>
                </div>
              )}

              {mode !== 'date' && (
                <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center', justifyContent: 'center', marginBottom: '0.15rem' }}>
                  {timeSpin('h', 'HH', draft.h, 23)}
                  <span style={{ color: 'var(--text-dim)', marginTop: 18 }}>:</span>
                  {timeSpin('mi', 'MM', draft.mi, 59)}
                  {withSeconds && (
                    <>
                      <span style={{ color: 'var(--text-dim)', marginTop: 18 }}>:</span>
                      {timeSpin('s', 'SS', draft.s, 59)}
                    </>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', gap: 4, alignItems: 'center', justifyContent: 'center' }}>
                {actions === 'since' && (
                  <>
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label="Since"
                      style={chipBtn(true)}
                      onClick={runOk}
                    >
                      Since…
                    </button>
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label="Clear"
                      style={chipBtn(false)}
                      onClick={runClear}
                    >
                      Clear
                    </button>
                  </>
                )}
                {actions === 'before' && (
                  <>
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label="Before"
                      style={chipBtn(true)}
                      onClick={runOk}
                    >
                      Before…
                    </button>
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label="Live"
                      title="Live"
                      style={{
                        ...chipBtn(false),
                        color: '#22c55e',
                        minWidth: CELL,
                        padding: 0,
                      }}
                      onClick={() => {
                        runClear();
                        onLive?.();
                      }}
                    >
                      <Play size={14} fill="currentColor" />
                    </button>
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-label="Clear"
                      style={chipBtn(false)}
                      onClick={runClear}
                    >
                      Clear
                    </button>
                  </>
                )}
                {actions === 'standard' && (
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label="OK"
                    style={chipBtn(true)}
                    onClick={runOk}
                  >
                    OK
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
