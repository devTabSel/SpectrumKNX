/**
 * Exclusive facet assignment for paired displays: each slot shows one facet
 * from a shared available set, and no two slots share the same facet.
 *
 * Used by telegram-table TIME (date|time) and VALUE (decoded|decimal|hex|bin).
 */

/** Fill up to `slotCount` slots from `preferred`, then from `available`, uniquely. */
export function initialExclusiveAssignment<F>(
  available: readonly F[],
  slotCount: number,
  preferred?: readonly F[],
): F[] {
  if (slotCount <= 0 || available.length === 0) return [];
  const out: F[] = [];
  const used = new Set<F>();
  const take = (facet: F) => {
    if (out.length >= slotCount || used.has(facet)) return;
    if (!available.includes(facet)) return;
    out.push(facet);
    used.add(facet);
  };
  for (const p of preferred ?? []) take(p);
  for (const a of available) take(a);
  return out;
}

/**
 * Re-fit an assignment when `available` changes: keep still-valid facets in
 * order, then top up from available.
 */
export function clampExclusiveAssignment<F>(
  available: readonly F[],
  assignment: readonly F[],
): F[] {
  return initialExclusiveAssignment(available, assignment.length, assignment);
}

/**
 * Cycle `slotIndex` to the next facet that is not shown in another slot.
 * When every other facet is taken (typical 2-of-2 date/time), swap with the
 * sibling that holds the next preferred facet.
 */
export function cycleExclusiveSlot<F>(
  available: readonly F[],
  assignment: readonly F[],
  slotIndex: number,
): F[] {
  if (
    available.length === 0
    || assignment.length === 0
    || slotIndex < 0
    || slotIndex >= assignment.length
  ) {
    return [...assignment];
  }

  const cur = assignment[slotIndex];
  const otherTaken = new Set(
    assignment.filter((_, i) => i !== slotIndex),
  );

  const start = available.indexOf(cur);
  const orderStart = start < 0 ? 0 : start;

  for (let step = 1; step <= available.length; step++) {
    const cand = available[(orderStart + step) % available.length];
    if (otherTaken.has(cand)) continue;
    if (cand === cur) {
      // Wrapped: only the current facet is free → must steal from a sibling.
      break;
    }
    const next = [...assignment];
    next[slotIndex] = cand;
    return next;
  }

  // Steal: take the next facet in `available` after `cur` from whoever holds it
  // (2-slot case → swap). Prefer that facet; else swap with the first sibling.
  const want = available[(orderStart + 1) % available.length];
  const next = [...assignment];
  let donor = next.findIndex((f, i) => i !== slotIndex && f === want);
  if (donor < 0) {
    donor = next.findIndex((_, i) => i !== slotIndex);
  }
  if (donor < 0) return next;

  const stolen = next[donor];
  next[donor] = cur;
  next[slotIndex] = stolen;
  return next;
}

/** Title helper: next facet a click would land on (after exclusive cycle). */
export function peekExclusiveCycle<F>(
  available: readonly F[],
  assignment: readonly F[],
  slotIndex: number,
): F | null {
  const next = cycleExclusiveSlot(available, assignment, slotIndex);
  if (next.length !== assignment.length) return null;
  if (next.every((f, i) => f === assignment[i])) return null;
  return next[slotIndex] ?? null;
}
