import type { ActiveFilters } from '../types/filters';

/** Milliseconds of context before and after a match. */
export interface ContextBounds {
  before: number;
  after: number;
}

function nonNeg(n: number): number {
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

/**
 * Quick-filter context cannot extend past the applied side-panel window.
 * A larger typed value is cut down; a smaller one is kept.
 */
export function capContextWindow(qf: ContextBounds, sp: ContextBounds): ContextBounds {
  return {
    before: Math.min(nonNeg(qf.before), nonNeg(sp.before)),
    after: Math.min(nonNeg(qf.after), nonNeg(sp.after)),
  };
}

/**
 * Filters the list actually expands with. `null` follows the applied
 * side-panel window. An explicit quick-filter bound is capped to it.
 * The side-panel numbers themselves are left for the caller to apply.
 */
export function filtersWithQfContext(applied: ActiveFilters, qf: ContextBounds | null): ActiveFilters {
  if (!qf) return applied;
  const next = capContextWindow(qf, { before: applied.deltaBeforeMs, after: applied.deltaAfterMs });
  if (next.before === applied.deltaBeforeMs && next.after === applied.deltaAfterMs) return applied;
  return { ...applied, deltaBeforeMs: next.before, deltaAfterMs: next.after };
}
