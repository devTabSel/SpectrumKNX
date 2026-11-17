import type { CSSProperties, KeyboardEvent, MouseEvent, ReactNode } from 'react';

export interface ExclusiveFacetSlotModel {
  key: string;
  label: string;
  title?: string;
  className?: string;
  style?: CSSProperties;
  body: ReactNode;
  /** When false, render a plain row (spacer / single-facet pad). Default true. */
  interactive?: boolean;
}

interface Props {
  slots: ExclusiveFacetSlotModel[];
  canCycle: boolean;
  onCycle: (slotIndex: number) => void;
  /** When false, toggle is mouse-only (telegram table body). */
  allowFocus?: boolean;
  /** Outer cell chrome (e.g. tt-cell + cellBox). */
  className?: string;
  style?: CSSProperties;
}

/**
 * Generic two-line (or N-line) exclusive facet display: each row is a button
 * that cycles to a facet not shown in the sibling rows.
 */
export function ExclusiveFacetPair({
  slots,
  canCycle,
  onCycle,
  allowFocus = true,
  className,
  style,
}: Props) {
  return (
    <div className={className} style={style}>
      {slots.map((slot, index) => {
        const interactive = canCycle && slot.interactive !== false;
        if (!interactive) {
          return (
            <div
              key={slot.key}
              className={slot.className}
              style={slot.style}
              title={slot.title}
              aria-hidden={!slot.label}
            >
              {slot.body}
            </div>
          );
        }
        return (
          <div
            key={slot.key}
            role="button"
            tabIndex={allowFocus ? 0 : -1}
            className={slot.className}
            style={{ ...slot.style, cursor: 'pointer' }}
            title={slot.title}
            aria-label={slot.label}
            onMouseDown={(e: MouseEvent) => {
              if (!allowFocus) e.preventDefault();
            }}
            onClick={(e: MouseEvent) => {
              e.stopPropagation();
              onCycle(index);
            }}
            onKeyDown={(e: KeyboardEvent) => {
              if (!allowFocus) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                onCycle(index);
              }
            }}
          >
            {slot.body}
          </div>
        );
      })}
    </div>
  );
}
