import type { MonitorPauseMode, MonitorView } from './monitorView';

/** Where a goto time sits relative to the raw buffer span. */
export type GotoPlacement = 'inside' | 'older' | 'newer' | 'unknown';

/**
 * `inside` is inclusive of the buffer edges. `unknown` means there is no
 * span yet (empty buffer). Older than the span reads forward from x = target;
 * newer reads backward from y = target.
 */
export function classifyGotoTarget(
  targetMs: number,
  oldestMs: number | null,
  newestMs: number | null,
): GotoPlacement {
  if (!Number.isFinite(targetMs) || oldestMs == null || newestMs == null) return 'unknown';
  if (targetMs < oldestMs) return 'older';
  if (targetMs > newestMs) return 'newer';
  return 'inside';
}

/** Minute window a committed outside-goto anchors on `targetMs`. */
export function gotoWindow(
  placement: 'older' | 'newer',
  targetMs: number,
  rangeMinutes: number,
): { min: number; max: number } {
  const rangeMs = Math.max(1, rangeMinutes) * 60_000;
  if (placement === 'older') return { min: targetMs, max: targetMs + rangeMs };
  return { min: targetMs - rangeMs, max: targetMs };
}

/**
 * Jump targets are their own set. A plain goto replaces them; Ctrl while the
 * target is already in the buffer adds one. Adding the same key twice keeps
 * a single entry.
 */
export function nextJumpTargets(
  prev: readonly string[],
  key: string,
  additive: boolean,
): string[] {
  if (!additive) return [key];
  if (prev.includes(key)) return prev.slice();
  return [...prev, key];
}

/**
 * Every switch onto forward clears live in memory: pause `off`, follow off.
 * A view that is already in that form is returned as-is.
 */
export function enterForward(view: MonitorView): MonitorView {
  if (view.pauseMode === 'off' && view.follow === false) return view;
  return { ...view, pauseMode: 'off', follow: false };
}

/**
 * Backward goto onto a fixed y. The anchor does not follow the live edge.
 * Manual pause stays manual; every other mode parks on auto. Follow is off,
 * so a later fast-forward is not still looking at a manual latch.
 */
export function parkOnFixedY(view: MonitorView, anchorTs: number): MonitorView {
  const pauseMode: MonitorPauseMode = view.pauseMode === 'manual' ? 'manual' : 'auto';
  return { ...view, direction: 'backward', anchorTs, follow: false, pauseMode };
}
