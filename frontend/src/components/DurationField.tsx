import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';

import { sanitizeSecondsInput } from '../utils/sendCorrespondence';
import { selectAllMouseDown, selectInputText } from '../utils/selectInputText';

/** Above the send popover (z-index 1000) so the suggestion list stays visible. */
const PORTAL_MENU_Z = 1100;

const durationBareInput: CSSProperties = {
  border: 'none',
  outline: 'none',
  background: 'transparent',
  padding: 0,
  color: 'var(--text-main)',
  font: 'inherit',
  fontSize: 'inherit',
  minWidth: 0,
};

/** Match a trailing unit from `units` (optional whitespace, case-insensitive). */
export function parseTypedDurationUnit(
  raw: string,
  units: readonly string[],
): { value: string; unit: string } | null {
  if (units.length === 0) return null;
  const escaped = units
    .slice()
    .sort((a, b) => b.length - a.length)
    .map(u => u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  // Numeric value only (same shape as range presets) so "5 ms" is not "5 m"+"s".
  const re = new RegExp(`^(\\d+(?:[.,]\\d+)?)\\s*(${escaped.join('|')})$`, 'i');
  const match = raw.trim().match(re);
  if (!match) return null;
  const value = match[1].replace(',', '.');
  const matched = match[2].toLowerCase();
  const unit = units.find(u => u.toLowerCase() === matched);
  if (unit == null) return null;
  return { value, unit };
}

function nextUnit(current: string, units: readonly string[]): string {
  const idx = units.findIndex(u => u.toLowerCase() === current.toLowerCase());
  if (idx < 0) return units[0];
  return units[(idx + 1) % units.length];
}

/**
 * Duration / delay / range: glass shell; width from value + unit (or placeholder).
 *
 * Shared by the send panel, send popover, telegram-table context fields, and
 * the buffer status-pill / history range controls.
 */
export function DurationField({
  value,
  onChange,
  placeholder,
  title,
  col,
  unit = 's',
  disabled = false,
  ariaLabel,
  autoFocus = false,
  onBlur,
  onKeyDown,
  /** Preset labels shown in a portaled list under this field (range). */
  suggestions,
  sanitize = sanitizeSecondsInput,
  /** When true, the unit suffix cycles through `units` on click. */
  unitSwitchable = false,
  /** Allowed units for click-cycle and typed-suffix adoption. */
  units,
  onUnitChange,
  unitTitle,
  alwaysShowUnit = false,
  /** Optional control rendered before the value (e.g. clear icon in range). */
  startSlot,
  /** Optional control rendered after the unit. */
  endSlot,
  textAlign = 'right',
  /** Value text color. The unit keeps its own color. */
  color,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  title: string;
  /** Write-panel grid column (`data-wtb-col`). Omit for content-sized popover use. */
  col?: string;
  /** Suffix shown while a value is present (`s` for delay/every, `ms` for context). */
  unit?: string;
  disabled?: boolean;
  ariaLabel?: string;
  autoFocus?: boolean;
  /** Called after sanitize with the committed value and the active unit. */
  onBlur?: (sanitized: string, activeUnit: string) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  /** Preset labels. A non-focusable chevron after the unit opens the list. */
  suggestions?: readonly string[];
  /** Override blur sanitize (default: positive integers only). */
  sanitize?: (raw: string) => string;
  unitSwitchable?: boolean;
  units?: readonly string[];
  onUnitChange?: (unit: string) => void;
  unitTitle?: string;
  /** Show the unit even when the value is empty (range field). */
  alwaysShowUnit?: boolean;
  startSlot?: ReactNode;
  endSlot?: ReactNode;
  textAlign?: 'left' | 'right';
  /** Value text color. The unit suffix is not recolored. */
  color?: string;
}) {
  const suggestionList = suggestions ?? [];
  const hasSuggestions = suggestionList.length > 0 && !disabled;
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [box, setBox] = useState<{ top: number; left: number; width: number } | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const pickedRef = useRef(false);
  const listId = useId();
  const showUnit = alwaysShowUnit || value.trim() !== '';
  // Floor against placeholder and a typical filled "0" so empty tracks stay usable.
  const inputCh = Math.max(value.length, placeholder.length, 1) + 1;
  const fill = col != null;
  // Icon slots (status-pill range): keep value+unit as one cluster aligned L/R.
  const clustered = startSlot != null || endSlot != null;
  const canSwitch = unitSwitchable && !disabled && (units?.length ?? 0) > 0 && !!onUnitChange;

  const closeList = () => {
    setOpen(false);
    setHighlight(-1);
  };

  const commitText = (rawInput: string) => {
    let raw = rawInput;
    let activeUnit = unit;
    if (unitSwitchable && units && units.length > 0) {
      const typed = parseTypedDurationUnit(raw, units);
      if (typed) {
        raw = typed.value;
        activeUnit = typed.unit;
        if (typed.unit !== unit) onUnitChange?.(typed.unit);
      }
    }
    const next = sanitize(raw);
    if (next !== value) onChange(next);
    onBlur?.(next, activeUnit);
  };

  const pickSuggestion = (label: string) => {
    pickedRef.current = true;
    closeList();
    commitText(label);
    inputRef.current?.blur();
  };

  const place = () => {
    const el = shellRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.max(r.width, 112);
    let left = r.left;
    if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8);
    const menu = menuRef.current;
    const estimate = Math.min(240, suggestionList.length * 28 + 10);
    const measured = menu?.offsetHeight ?? 0;
    const menuH = measured > 0 ? measured : estimate;
    const below = r.bottom + 4;
    const above = r.top - 4 - menuH;
    const top = below + menuH > window.innerHeight - 8 && above >= 8 ? above : below;
    if (menu) {
      menu.style.top = `${top}px`;
      menu.style.left = `${left}px`;
      menu.style.width = `${width}px`;
      return;
    }
    setBox({ top, left, width });
  };

  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, suggestionList.length]);

  // The menu mounts after the first measurement. Re-place against its real height
  // (flip above the field when the list would leave the viewport).
  useLayoutEffect(() => {
    if (!open || !box || !menuRef.current) return;
    place();
  }, [open, box, suggestionList.length]);

  useLayoutEffect(() => {
    if (!open) return;
    const el = inputRef.current;
    if (el && document.activeElement === el) el.select();
  }, [open, box]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (shellRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      closeList();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!hasSuggestions) {
      onKeyDown?.(e);
      return;
    }
    if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        closeList();
      }
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) setOpen(true);
      setHighlight(h => {
        if (suggestionList.length === 0) return -1;
        if (h < 0) return e.key === 'ArrowDown' ? 0 : suggestionList.length - 1;
        const dir = e.key === 'ArrowDown' ? 1 : -1;
        return Math.max(0, Math.min(suggestionList.length - 1, h + dir));
      });
      return;
    }
    if (e.key === 'Enter' && open && highlight >= 0 && suggestionList[highlight] != null) {
      e.preventDefault();
      e.stopPropagation();
      pickSuggestion(suggestionList[highlight]);
      return;
    }
    if (e.key === 'Enter' && open) closeList();
    onKeyDown?.(e);
  };

  const chevron = hasSuggestions && (
    <span
      aria-hidden
      data-duration-chevron=""
      onMouseDown={e => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={() => {
        if (open) {
          closeList();
          return;
        }
        setHighlight(-1);
        setOpen(true);
        inputRef.current?.focus();
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        flexShrink: 0,
        color: 'var(--text-dim)',
        cursor: 'pointer',
        padding: 0,
      }}
    >
      <ChevronDown size={13} />
    </span>
  );

  const unitNode = showUnit && (
    canSwitch ? (
      <button
        type="button"
        onClick={e => {
          e.preventDefault();
          e.stopPropagation();
          onUnitChange(nextUnit(unit, units!));
        }}
        title={unitTitle ?? `Unit: ${unit}`}
        aria-label={unitTitle ?? `Unit: ${unit}`}
        data-duration-unit=""
        style={{
          border: 'none',
          background: 'transparent',
          padding: 0,
          margin: 0,
          font: 'inherit',
          fontSize: '0.72rem',
          color: 'var(--accent-primary)',
          fontWeight: 600,
          whiteSpace: 'nowrap',
          flexShrink: 0,
          cursor: 'pointer',
        }}
      >
        {unit}
      </button>
    ) : (
      <span
        data-duration-unit=""
        style={{
          fontSize: '0.72rem',
          color: 'var(--text-dim)',
          whiteSpace: 'nowrap',
          flexShrink: 0,
          pointerEvents: 'none',
        }}
      >
        {unit}
      </span>
    )
  );
  const inputEl = (
    <input
      ref={inputRef}
      placeholder={placeholder}
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-expanded={hasSuggestions ? open : undefined}
      aria-controls={hasSuggestions && open ? listId : undefined}
      autoFocus={autoFocus}
      onMouseDown={selectAllMouseDown}
      onChange={e => {
        if (disabled) return;
        onChange(e.target.value);
        if (hasSuggestions) {
          setHighlight(-1);
          setOpen(true);
        }
      }}
      onFocus={e => {
        if (disabled) return;
        selectInputText(e.currentTarget);
        if (hasSuggestions) setOpen(true);
      }}
      onBlur={() => {
        if (disabled) return;
        if (pickedRef.current) {
          pickedRef.current = false;
          return;
        }
        closeList();
        commitText(value);
      }}
      onKeyDown={onInputKeyDown}
      inputMode="decimal"
      title={title}
      style={{
        ...durationBareInput,
        ...(color ? { color } : {}),
        // Clustered: content width so the unit stays glued to the value.
        // Fill tracks (QF / send): grow with the shell. Else: ch-sized.
        ...(clustered
          ? { width: `${inputCh}ch`, minWidth: `${inputCh}ch`, flex: '0 0 auto' }
          : {
              flex: '1 1 auto',
              width: fill ? '100%' : `${inputCh}ch`,
              minWidth: fill ? 0 : `${inputCh}ch`,
            }),
        textAlign: clustered ? 'right' : textAlign,
      }}
    />
  );
  return (
    <>
    <div
      {...(col != null ? { 'data-wtb-col': col } : {})}
      style={{ width: fill ? '100%' : 'max-content', minWidth: 0 }}
    >
    <div
      ref={shellRef}
      data-duration-field
      className="glass-input"
      onMouseDown={e => {
        if (!hasSuggestions) return;
        const target = e.target as HTMLElement;
        if (target.closest('[data-duration-unit], [data-duration-chevron]')) return;
        if (e.defaultPrevented) return;
        const input = inputRef.current;
        if (e.target === input && document.activeElement === input) return;
        e.preventDefault();
        setHighlight(-1);
        setOpen(true);
        input?.focus();
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        // Clustered (pill range): wide enough that value+unit can sit on one
        // side and the icon on the other (left/right per textAlign).
        width: fill ? '100%' : clustered ? '100%' : 'max-content',
        minWidth: clustered ? '6.75rem' : undefined,
        maxWidth: '100%',
        boxSizing: 'border-box',
        padding: '0.2rem 0.35rem',
        gap: '0.3rem',
        fontSize: '0.72rem',
        opacity: disabled ? 0.45 : 1,
        justifyContent: clustered ? 'space-between' : undefined,
        ...(color ? { color } : {}),
      }}
    >
      {startSlot}
      {clustered ? (
        <span
          data-duration-value-unit=""
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.15rem',
            flex: '1 1 auto',
            minWidth: 0,
            // left = value+unit at start (icon in endSlot); right = at end (icon in startSlot).
            justifyContent: textAlign === 'left' ? 'flex-start' : 'flex-end',
          }}
        >
          {inputEl}
          {unitNode}
          {chevron}
        </span>
      ) : (
        <>
          {inputEl}
          {unitNode}
          {chevron}
        </>
      )}
      {endSlot}
    </div>
    </div>
    {open && hasSuggestions && box && createPortal(
      <div
        ref={menuRef}
        id={listId}
        data-portaled-menu
        role="listbox"
        aria-label="Range presets"
        style={{
          position: 'fixed',
          top: box.top,
          left: box.left,
          width: box.width,
          zIndex: PORTAL_MENU_Z,
          maxHeight: 240,
          overflowY: 'auto',
          background: 'var(--bg-panel)',
          border: '1px solid var(--border-color)',
          borderRadius: 8,
          boxShadow: 'var(--shadow-lg)',
          padding: '0.25rem',
        }}
      >
        {suggestionList.map((label, i) => (
          <button
            type="button"
            key={label}
            role="option"
            aria-selected={i === highlight}
            onMouseDown={e => {
              e.preventDefault();
              pickSuggestion(label);
            }}
            onMouseEnter={() => setHighlight(i)}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              padding: '0.3rem 0.45rem',
              fontSize: '0.75rem',
              color: 'var(--text-main)',
              background: i === highlight ? 'rgba(99,102,241,0.18)' : 'transparent',
            }}
          >
            {label}
          </button>
        ))}
      </div>,
      document.body,
    )}
    </>
  );
}
