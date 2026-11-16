// Time-Delta-Context expansion (#309/#318/#319): given which telegrams
// already match the active filters, pull in every other telegram within a
// before/after window around each active context button. A button may use an
// individual window; otherwise the effective quick-filter window applies.
// Shared by the live Group Monitor and History Search views.

interface Timestamped {
  timestamp: string;
}

/** Per-row window in milliseconds, independent of the quick-filter before/after. */
export interface IndividualContextWindow {
  beforeMs: number;
  afterMs: number;
  /**
   * Explicit on/off. Absent counts as on. Both sides at 0 are off either way,
   * and then the quick-filter window applies.
   */
  enabled?: boolean;
}

/** True when this window replaces the quick-filter window. */
export function individualWindowOn(window: IndividualContextWindow | undefined): boolean {
  if (!window || window.enabled === false) return false;
  return window.beforeMs > 0 || window.afterMs > 0;
}

export type IndividualContextWindows = Record<string, IndividualContextWindow>;

export interface DeltaExpansionOptions {
  /**
   * Global Time-Delta-Context switch. When false, individual windows stay
   * stored by the caller but every context list is empty.
   */
  contextEnabled?: boolean;
  individualWindows?: IndividualContextWindows;
  /** Filter misses that stay visible (mouse selection, marks, last selected). */
  pinnedKeys?: ReadonlySet<string>;
}

export interface DeltaExpansionResult<T> {
  /** Filter matches, pinned rows, and context rows reachable from them. */
  items: T[];
  /**
   * Identity keys of visible rows that do not match the primary filter and
   * were pulled in as context. A context button alone is not a member.
   */
  contextKeys: Set<string>;
  /**
   * Anchor key → context telegram keys, excluding the anchor itself.
   * Present for every active button (possibly empty). Inactive buttons are absent.
   */
  contextMembers: Map<string, readonly string[]>;
  /** Context telegram key → anchor keys whose context includes it. */
  contextParents: Map<string, readonly string[]>;
}

export interface ContextRailSigns {
  /** A selected parent telegram is later than this row → rail ∧. */
  before: boolean;
  /** A selected parent telegram is earlier than this row → rail ∨. */
  after: boolean;
}

const EMPTY_WINDOWS: IndividualContextWindows = {};

function windowOf(
  key: string,
  windows: IndividualContextWindows,
  beforeMs: number,
  afterMs: number,
): { beforeMs: number; afterMs: number } {
  const individual = windows[key];
  if (individualWindowOn(individual)) {
    return { beforeMs: individual!.beforeMs, afterMs: individual!.afterMs };
  }
  return { beforeMs, afterMs };
}

function lowerBoundTime(order: readonly number[], times: readonly number[], target: number): number {
  let lo = 0;
  let hi = order.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[order[mid]] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function upperBoundTime(order: readonly number[], times: readonly number[], target: number): number {
  let lo = 0;
  let hi = order.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[order[mid]] <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * @param items The full buffer. Display order is preserved in the result.
 * @param matches Per-item primary-filter result, same order as `items`.
 * @param anchorKeyOf Stable per-item identity.
 * @param flaggedKeys Keys whose context button is on.
 * @param beforeMs / @param afterMs Effective quick-filter window (0 when that window is off).
 * @param anchorMatches Whether every filter match anchors a window (global "all").
 */
export function expandWithDeltaContext<T extends Timestamped>(
  items: readonly T[],
  matches: boolean[],
  anchorKeyOf: (t: T) => string,
  flaggedKeys: ReadonlySet<string>,
  beforeMs: number,
  afterMs: number,
  anchorMatches = true,
  options?: DeltaExpansionOptions,
): DeltaExpansionResult<T> {
  const contextEnabled = options?.contextEnabled !== false;
  const windows = options?.individualWindows ?? EMPTY_WINDOWS;
  const pinned = options?.pinnedKeys;

  const keys = new Array<string>(items.length);
  const times = new Array<number>(items.length);
  const visible = new Uint8Array(items.length);
  for (let i = 0; i < items.length; i++) {
    keys[i] = anchorKeyOf(items[i]);
    times[i] = new Date(items[i].timestamp).getTime();
    if (matches[i] || (pinned?.has(keys[i]) ?? false)) visible[i] = 1;
  }

  const contextMembers = new Map<string, readonly string[]>();
  const contextParents = new Map<string, string[]>();
  if (!contextEnabled) {
    const kept: T[] = [];
    for (let i = 0; i < items.length; i++) if (visible[i]) kept.push(items[i]);
    return { items: kept, contextKeys: new Set(), contextMembers, contextParents };
  }

  const order = items.map((_, i) => i);
  order.sort((i, j) => times[i] - times[j] || i - j);
  const indexByKey = new Map<string, number>();
  for (let i = 0; i < items.length; i++) indexByKey.set(keys[i], i);

  const active = (i: number) => flaggedKeys.has(keys[i]) || (anchorMatches && matches[i]);

  for (let i = 0; i < items.length; i++) {
    if (!active(i)) continue;
    const span = windowOf(keys[i], windows, beforeMs, afterMs);
    const members: string[] = [];
    if ((span.beforeMs > 0 || span.afterMs > 0) && Number.isFinite(times[i])) {
      const lo = times[i] - span.beforeMs;
      const hi = times[i] + span.afterMs;
      const from = lowerBoundTime(order, times, lo);
      const to = upperBoundTime(order, times, hi);
      for (let k = from; k < to; k++) {
        const j = order[k];
        if (j === i || matches[j] || keys[j] === keys[i]) continue;
        const tj = times[j];
        const older = span.beforeMs > 0 && tj < times[i] && tj >= times[i] - span.beforeMs;
        const newer = span.afterMs > 0 && tj > times[i] && tj <= times[i] + span.afterMs;
        if (older || newer) members.push(keys[j]);
      }
    }
    contextMembers.set(keys[i], members);
    for (const member of members) {
      const parents = contextParents.get(member);
      if (parents) parents.push(keys[i]);
      else contextParents.set(member, [keys[i]]);
    }
  }

  // An active button keeps its member list even when the row is hidden.
  // Only a visible row contributes that list to the display.
  const queue: number[] = [];
  for (let i = 0; i < items.length; i++) {
    if (visible[i] && contextMembers.has(keys[i])) queue.push(i);
  }
  const expanded = new Uint8Array(items.length);
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q];
    if (expanded[i]) continue;
    expanded[i] = 1;
    const members = contextMembers.get(keys[i]);
    if (!members) continue;
    for (const member of members) {
      const j = indexByKey.get(member);
      if (j == null) continue;
      if (!visible[j]) {
        visible[j] = 1;
        queue.push(j);
      } else if (!expanded[j] && contextMembers.has(keys[j])) {
        queue.push(j);
      }
    }
  }

  const contextKeys = new Set<string>();
  const kept: T[] = [];
  for (let i = 0; i < items.length; i++) {
    if (!visible[i]) continue;
    kept.push(items[i]);
    if (!matches[i] && contextParents.has(keys[i])) contextKeys.add(keys[i]);
  }
  return { items: kept, contextKeys, contextMembers, contextParents };
}

/**
 * Rail ∧/∨ for a context row from the selected telegrams whose context
 * includes it. Window size is not consulted; membership already applied it.
 * ∨ (`after`) when a selected parent is earlier. ∧ (`before`) when one is later.
 */
export function contextRailSigns(
  rowTs: number,
  selectedParentTimestamps: readonly number[],
): ContextRailSigns {
  let before = false;
  let after = false;
  for (const pts of selectedParentTimestamps) {
    if (pts < rowTs) after = true;
    else if (pts > rowTs) before = true;
    if (before && after) break;
  }
  return { before, after };
}
