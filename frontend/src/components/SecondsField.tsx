import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';

import { sanitizeSecondsInput } from '../utils/sendCorrespondence';
import { selectAllMouseDown, selectInputText } from '../utils/selectInputText';

const secondsBareInput: CSSProperties = {
  border: 'none',
  outline: 'none',
  background: 'transparent',
  padding: 0,
  color: 'var(--text-main)',
  font: 'inherit',
  fontSize: 'inherit',
  minWidth: 0,
};

/**
 * Delay/Every (and similar): glass shell fills the track; column width comes
 * from text (value + unit, or placeholder), not the UA input default.
 *
 * Shared by the send panel, send popover, telegram-table context fields, and
 * the buffer status-pill range control.
 */
export function SecondsField({
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
  sanitize = sanitizeSecondsInput,
  /** When set, the unit suffix is clickable (e.g. cycle s/m/h on the range field). */
  onUnitClick,
  unitTitle,
  alwaysShowUnit = false,
  /** Optional control rendered before the value (e.g. clear icon in range). */
  startSlot,
  /** Optional control rendered after the unit. */
  endSlot,
  textAlign = 'right',
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
  /** Called after sanitize with the committed value. */
  onBlur?: (sanitized: string) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void;
  /** Override blur sanitize (default: positive integers only). */
  sanitize?: (raw: string) => string;
  onUnitClick?: () => void;
  unitTitle?: string;
  /** Show the unit even when the value is empty (range field). */
  alwaysShowUnit?: boolean;
  startSlot?: ReactNode;
  endSlot?: ReactNode;
  textAlign?: 'left' | 'right';
}) {
  const showUnit = alwaysShowUnit || value.trim() !== '';
  // Floor against placeholder and a typical filled "0" so empty tracks stay usable.
  const inputCh = Math.max(value.length, placeholder.length, 1) + 1;
  const fill = col != null;
  // Icon slots (status-pill range): keep value+unit as one cluster aligned L/R.
  const clustered = startSlot != null || endSlot != null;
  const unitClickable = !!onUnitClick && !disabled;
  const unitNode = showUnit && (
    unitClickable ? (
      <button
        type="button"
        onClick={e => {
          e.preventDefault();
          e.stopPropagation();
          onUnitClick();
        }}
        title={unitTitle ?? `Unit: ${unit}`}
        aria-label={unitTitle ?? `Unit: ${unit}`}
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
      placeholder={placeholder}
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      autoFocus={autoFocus}
      onMouseDown={selectAllMouseDown}
      onChange={e => { if (!disabled) onChange(e.target.value); }}
      onFocus={e => { if (!disabled) selectInputText(e.currentTarget); }}
      onBlur={() => {
        if (disabled) return;
        const next = sanitize(value);
        if (next !== value) onChange(next);
        onBlur?.(next);
      }}
      onKeyDown={onKeyDown}
      inputMode="decimal"
      title={title}
      style={{
        ...secondsBareInput,
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
    <div
      {...(col != null ? { 'data-wtb-col': col } : {})}
      style={{ width: fill ? '100%' : 'max-content', minWidth: 0 }}
    >
    <div
      data-seconds-field
      className="glass-input"
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
      }}
    >
      {startSlot}
      {clustered ? (
        <span
          data-seconds-value-unit=""
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
        </span>
      ) : (
        <>
          {inputEl}
          {unitNode}
        </>
      )}
      {endSlot}
    </div>
    </div>
  );
}
