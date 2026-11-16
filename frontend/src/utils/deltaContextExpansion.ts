// Time-Delta-Context expansion: given which telegrams already match the
// active filters, pull in every other telegram that sits inside the
// quick-filter before (−) or after (+) window of a row whose flag is on
// for that side. A shown context row does not anchor further telegrams
// unless its own flag is on. Shared by the live Group Monitor and History.

import type { TriState } from './triState';

interface Timestamped {
  timestamp: string;
}

/** Keys whose − (before) or + (after) context flag is on. */
export interface ContextSideFlags {
  before: ReadonlySet<string>;
  after: ReadonlySet<string>;
}

/**
 * Header tristate for one side, from the visible rows.
 * No row on → off. Every row on → on. Otherwise mixed.
 * An empty list is off (no visible row is on).
 */
export function sideFlagsTristate(on: readonly boolean[]): TriState {
  if (on.length === 0) return 'none';
  let n = 0;
  for (const value of on) if (value) n++;
  if (n === 0) return 'none';
  if (n === on.length) return 'all';
  return 'some';
}

export interface DeltaExpansionOptions {
  /**
   * Global Time-Delta-Context switch. When false, flags stay stored by the
   * caller but every context list is empty.
   */
  contextEnabled?: boolean;
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

const EMPTY_SIDE_FLAGS: ContextSideFlags = { before: new Set(), after: new Set() };

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
 * @param sideFlags Keys with the before and/or after flag on.
 * @param beforeMs / @param afterMs Quick-filter window (0 when that side is off).
 *   Only a row whose flag is on for a side with a positive window anchors that side.
 *   Context rows are not anchors unless they carry their own flag.
 */
export function expandWithDeltaContext<T extends Timestamped>(
  items: readonly T[],
  matches: boolean[],
  anchorKeyOf: (t: T) => string,
  sideFlags: ContextSideFlags = EMPTY_SIDE_FLAGS,
  beforeMs = 0,
  afterMs = 0,
  options?: DeltaExpansionOptions,
): DeltaExpansionResult<T> {
  const contextEnabled = options?.contextEnabled !== false;
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

  const wantBefore = (i: number) => beforeMs > 0 && sideFlags.before.has(keys[i]);
  const wantAfter = (i: number) => afterMs > 0 && sideFlags.after.has(keys[i]);

  // One binary search per flagged side. Member lists are published even when
  // the row is hidden; only a visible row contributes them to the display.
  // A context row is queued only when it already has its own flag.
  const publishMembers = (i: number) => {
    if (contextMembers.has(keys[i])) return;
    const before = wantBefore(i);
    const after = wantAfter(i);
    if (!before && !after) return;
    const members: string[] = [];
    if (Number.isFinite(times[i])) {
      const lo = before ? times[i] - beforeMs : times[i];
      const hi = after ? times[i] + afterMs : times[i];
      const from = lowerBoundTime(order, times, lo);
      const to = upperBoundTime(order, times, hi);
      for (let k = from; k < to; k++) {
        const j = order[k];
        if (j === i || matches[j] || keys[j] === keys[i]) continue;
        const tj = times[j];
        const older = before && tj < times[i] && tj >= times[i] - beforeMs;
        const newer = after && tj > times[i] && tj <= times[i] + afterMs;
        if (older || newer) members.push(keys[j]);
      }
    }
    contextMembers.set(keys[i], members);
    for (const member of members) {
      const parents = contextParents.get(member);
      if (parents) parents.push(keys[i]);
      else contextParents.set(member, [keys[i]]);
    }
  };

  for (let i = 0; i < items.length; i++) {
    if (wantBefore(i) || wantAfter(i)) publishMembers(i);
  }

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
        if (contextMembers.has(keys[j])) queue.push(j);
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
