import { useEffect, useMemo, useState } from 'react';
import {
  clampExclusiveAssignment,
  cycleExclusiveSlot,
  initialExclusiveAssignment,
  peekExclusiveCycle,
} from '../utils/exclusiveFacets';

/**
 * Stateful exclusive facet assignment for paired slot UIs.
 * `availableKey` should change when the available set's membership changes
 * (e.g. joined mode ids) so the assignment is re-clamped.
 */
export function useExclusiveFacets<F>(
  available: readonly F[],
  slotCount: number,
  preferred?: readonly F[],
  availableKey?: string,
) {
  const [assignment, setAssignment] = useState(() => (
    initialExclusiveAssignment(available, slotCount, preferred)
  ));

  const key = availableKey ?? available.map(String).join('\0');

  useEffect(() => {
    setAssignment(prev => {
      const next = clampExclusiveAssignment(available, prev.length ? prev : preferred ?? []);
      const filled = next.length >= Math.min(slotCount, available.length)
        ? next
        : initialExclusiveAssignment(available, slotCount, preferred);
      if (
        filled.length === prev.length
        && filled.every((f, i) => f === prev[i])
      ) {
        return prev;
      }
      return filled;
    });
  // available is mirrored by key; preferred is initial-only intent on key change
  // eslint-disable-next-line react-hooks/exhaustive-deps -- clamp on membership key
  }, [key, slotCount]);

  return useMemo(() => ({
    assignment,
    canCycle: available.length > 1 && assignment.length >= 1,
    cycle(slotIndex: number) {
      setAssignment(prev => cycleExclusiveSlot(available, prev, slotIndex));
    },
    peek(slotIndex: number) {
      return peekExclusiveCycle(available, assignment, slotIndex);
    },
  }), [assignment, available]);
}
