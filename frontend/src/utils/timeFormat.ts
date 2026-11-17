// Date-aware time formatting for the visualization (#281). When the plotted
// range spans more than one calendar day, time-only labels ("14:30") are
// ambiguous, so axis ticks, tooltips and the pan/zoom timeline show a date too.
//
// TODO(charts): During the charts rework, switch axis ticks / tooltips /
// TimeBrush edges from these ad-hoc formatters to the reusable DateTime
// display control (DateTimeFacetPair / shared date-time facets) so chart and
// telegram-table time rendering stay one module.

import { format } from 'date-fns';

/** Facets shared by the telegram-table TIME cell pair control. */
export type DateTimeFacet = 'date' | 'time';

export const DATE_TIME_FACETS: readonly DateTimeFacet[] = ['time', 'date'];

/** True when the two instants fall on different calendar days (local time). */
export const spansMultipleDays = (minMs: number, maxMs: number): boolean =>
  new Date(minMs).toDateString() !== new Date(maxMs).toDateString();

/** Local calendar date for a telegram / buffer edge (`yyyy-MM-dd`). */
export const formatDateFacet = (value: Date | number | string): string =>
  format(value instanceof Date ? value : new Date(value), 'yyyy-MM-dd');

/**
 * Local clock time. Centiseconds match the telegram TIME column
 * (`HH:mm:ss.SS`); without them, whole seconds (`HH:mm:ss`).
 */
export const formatTimeFacet = (
  value: Date | number | string,
  withCentiseconds = true,
): string => {
  const d = value instanceof Date ? value : new Date(value);
  return format(d, withCentiseconds ? 'HH:mm:ss.SS' : 'HH:mm:ss');
};

export const formatDateTimeFacet = (
  value: Date | number | string,
  facet: DateTimeFacet,
  withCentiseconds = true,
): string => (
  facet === 'date' ? formatDateFacet(value) : formatTimeFacet(value, withCentiseconds)
);

/**
 * Axis tick label: `HH:mm`, prefixed with a short `MM-DD` date on multi-day
 * ranges so ticks that cross midnight stay unambiguous.
 */
export const formatAxisTime = (ms: number, multiDay: boolean): string => {
  const d = new Date(ms);
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
  if (!multiDay) return time;
  const date = d.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit' });
  return `${date} ${time}`;
};

/**
 * Full timestamp for tooltips and the pan/zoom timeline edges: `HH:mm:ss`,
 * with a `YYYY-MM-DD` date prefix on multi-day ranges.
 */
export const formatFullTime = (ms: number, multiDay: boolean): string => {
  const d = new Date(ms);
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  if (!multiDay) return time;
  const date = d.toLocaleDateString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit' });
  return `${date} ${time}`;
};
