import { formatDateFacet, formatTimeFacet } from './timeFormat';

/** How a single-line date/time control shows the calendar day. */
export type DateDisplayMode =
  | 'always'
  | 'never'
  | 'date-only'
  | 'time-only'
  | 'if-differs';

/**
 * Resolve the if-differs calendar reference: missing/null → now.
 * `nowMs` is injectable for tests.
 */
export function resolveReferenceMs(
  referenceMs?: number | null,
  nowMs: number = Date.now(),
): number {
  return referenceMs ?? nowMs;
}

/** True when two instants fall on different local calendar days. */
export function datesDiffer(
  valueMs: number | null | undefined,
  referenceMs?: number | null,
  nowMs: number = Date.now(),
): boolean {
  if (valueMs == null) return true;
  const ref = resolveReferenceMs(referenceMs, nowMs);
  return formatDateFacet(valueMs) !== formatDateFacet(ref);
}

/** Whether the date facet should appear for the given display policy. */
export function shouldShowDate(
  mode: DateDisplayMode,
  valueMs: number | null | undefined,
  referenceMs?: number | null,
  nowMs: number = Date.now(),
): boolean {
  if (valueMs == null) return false;
  switch (mode) {
    case 'always':
    case 'date-only':
      return true;
    case 'never':
    case 'time-only':
      return false;
    case 'if-differs':
      return datesDiffer(valueMs, referenceMs, nowMs);
    default:
      return true;
  }
}

export interface IdleDateTimeParts {
  date: string | null;
  time: string | null;
  /** Full title / tooltip string (always date + time when known). */
  full: string;
}

/** Idle single-line parts for a DateTimeField (not the edit picker). */
export function idleDateTimeParts(
  valueMs: number | null | undefined,
  mode: DateDisplayMode,
  opts?: {
    referenceMs?: number | null;
    withCentiseconds?: boolean;
    /** Injectable clock for if-differs when reference is omitted. */
    nowMs?: number;
  },
): IdleDateTimeParts {
  if (valueMs == null) return { date: null, time: null, full: '' };
  const withCs = opts?.withCentiseconds !== false;
  const date = formatDateFacet(valueMs);
  const time = formatTimeFacet(valueMs, withCs);
  const showDate = shouldShowDate(mode, valueMs, opts?.referenceMs, opts?.nowMs);
  const showTime = mode !== 'date-only';
  return {
    date: showDate ? date : null,
    time: showTime ? time : null,
    full: `${date} ${time}`,
  };
}
