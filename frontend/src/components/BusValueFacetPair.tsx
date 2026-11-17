import { useMemo, type CSSProperties } from 'react';
import { BusValueText, BUS_VALUE_MODE_TITLE } from './BusValueText';
import { useExclusiveFacets } from '../hooks/useExclusiveFacets';
import {
  buildValueDisplayModes,
  type BusValueView,
  type ValueDisplayMode,
} from '../utils/dptValues';
import { TT } from '../utils/telegramCellStyles';

/**
 * Prefer decoded (with unit) on top and hex underneath — QF bottom matches raw
 * hex. Decimal and ≤4-bit bin remain reachable by clicking either row.
 */
const PREFERRED: readonly ValueDisplayMode[] = ['decoded', 'hex'];

interface Props {
  value: BusValueView;
  dpt?: string | null;
  style?: CSSProperties;
  rawStyle?: CSSProperties;
  className?: string;
  rawClassName?: string;
  allowFocus?: boolean;
  /** When false, omit decoded (no/mismatched DPT). */
  allowDecoded?: boolean;
  /** Outer wrapper (e.g. tt-cell + cellBox). */
  wrapClassName?: string;
  wrapStyle?: CSSProperties;
}

/**
 * Two-line exclusive bus-value display. Each row is a BusValueText that can
 * show decoded+unit, decimal, hex, or bin (≤4-bit), and cycles only to formats
 * the sibling is not currently showing.
 */
export function BusValueFacetPair({
  value,
  dpt,
  style,
  rawStyle,
  className,
  rawClassName,
  allowFocus = false,
  allowDecoded = true,
  wrapClassName,
  wrapStyle,
}: Props) {
  const modes = useMemo(
    () => buildValueDisplayModes(value, dpt, { allowDecoded }),
    [value, dpt, allowDecoded],
  );
  const available = useMemo(() => modes.map(m => m.mode), [modes]);
  const availableKey = available.join('|');

  const { assignment, canCycle, cycle, peek } = useExclusiveFacets(
    available,
    2,
    PREFERRED,
    availableKey,
  );

  const top = assignment[0] ?? 'decoded';
  const bottom = assignment[1];

  return (
    <div className={wrapClassName} style={wrapStyle}>
      <div style={{ display: 'flex', alignItems: 'center', minWidth: 0, overflow: 'hidden' }}>
        <BusValueText
          value={value}
          dpt={dpt}
          allowFocus={allowFocus}
          allowDecoded={allowDecoded}
          as="span"
          className={className}
          rawClassName={rawClassName}
          style={style}
          rawStyle={rawStyle}
          mode={top}
          onCycle={canCycle ? () => cycle(0) : undefined}
          cycleTitle={(() => {
            const next = peek(0);
            return next ? BUS_VALUE_MODE_TITLE[next] : undefined;
          })()}
        />
      </div>
      {bottom != null ? (
        <div style={{ minWidth: 0, overflow: 'hidden' }}>
          <BusValueText
            value={value}
            dpt={dpt}
            allowFocus={allowFocus}
            allowDecoded={allowDecoded}
            as="span"
            // Secondary row: keep raw-badge look as the default chrome; decoded
            // still uses tt-value (+ unit) when that facet sits here.
            className={className ?? TT.value}
            rawClassName={rawClassName}
            style={{
              fontWeight: 700,
              color: 'var(--accent-primary)',
              fontSize: '0.65rem',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
              ...style,
            }}
            rawStyle={{
              fontSize: '0.65rem',
              ...rawStyle,
            }}
            mode={bottom}
            onCycle={canCycle ? () => cycle(1) : undefined}
            cycleTitle={(() => {
              const next = peek(1);
              return next ? BUS_VALUE_MODE_TITLE[next] : undefined;
            })()}
          />
        </div>
      ) : (
        <div style={{ fontSize: '0.65rem', color: 'var(--text-dim)', overflow: 'hidden' }} aria-hidden>
          {'\u00a0'}
        </div>
      )}
    </div>
  );
}
