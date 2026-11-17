import type { CSSProperties } from 'react';
import { ExclusiveFacetPair } from './ExclusiveFacetPair';
import { useExclusiveFacets } from '../hooks/useExclusiveFacets';
import { TT } from '../utils/telegramCellStyles';
import {
  DATE_TIME_FACETS,
  formatDateTimeFacet,
  type DateTimeFacet,
} from '../utils/timeFormat';

const FACET_TITLE: Record<DateTimeFacet, string> = {
  time: 'Show time',
  date: 'Show date',
};

interface Props {
  /** Telegram timestamp (ISO) or epoch ms / Date. */
  value: Date | number | string;
  /** Match telegram TIME column centiseconds (default true). */
  withCentiseconds?: boolean;
  allowFocus?: boolean;
  className?: string;
  style?: CSSProperties;
  /** Preferred top/bottom order (default time then date). */
  preferred?: readonly DateTimeFacet[];
  /**
   * `2` (default): telegram TIME cell — time and date on two exclusive rows.
   * `1`: compact single row that cycles time ↔ date (status pill edges).
   */
  lines?: 1 | 2;
}

const TIME_STYLE: CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const DATE_STYLE: CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

/**
 * Reusable date/time display as an exclusive facet pair (telegram TIME cell).
 * Click a row to swap/cycle so the visible rows always show different facets.
 */
export function DateTimeFacetPair({
  value,
  withCentiseconds = true,
  allowFocus = false,
  className,
  style,
  preferred = DATE_TIME_FACETS,
  lines = 2,
}: Props) {
  const slotCount = lines === 1 ? 1 : 2;
  const { assignment, canCycle, cycle, peek } = useExclusiveFacets(
    DATE_TIME_FACETS,
    slotCount,
    preferred,
  );

  return (
    <ExclusiveFacetPair
      className={className}
      style={style}
      canCycle={canCycle}
      allowFocus={allowFocus}
      onCycle={cycle}
      slots={assignment.map((facet, index) => {
        const next = peek(index);
        const label = formatDateTimeFacet(value, facet, withCentiseconds);
        // Date/time chrome stays facet-specific in both 1- and 2-line layouts.
        return {
          key: `${facet}-${index}`,
          label,
          title: next ? FACET_TITLE[next] : undefined,
          className: facet === 'time'
            ? `mono-addr ${TT.time}`
            : `subtitle-name ${TT.timeDate}`,
          style: facet === 'time' ? TIME_STYLE : DATE_STYLE,
          body: label,
        };
      })}
    />
  );
}
