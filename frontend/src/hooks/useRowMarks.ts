import { useEffect, useRef, useState } from 'react';
import { nextRowMarks, rowActionTargets } from '../utils/rowMarks';

/** Mouse selection of one list: plain click replaces, ctrl/cmd toggles, shift extends. */
export function useRowMarks(order: readonly string[], resetKey = 0) {
  const [marked, setMarked] = useState<string[]>([]);
  const [lastMarked, setLastMarked] = useState<string | null>(null);
  const orderRef = useRef(order);
  const markedRef = useRef(marked);
  const lastRef = useRef(lastMarked);
  const resetRef = useRef(resetKey);
  orderRef.current = order;
  markedRef.current = marked;
  lastRef.current = lastMarked;

  useEffect(() => {
    if (resetRef.current === resetKey) return;
    resetRef.current = resetKey;
    setMarked([]);
    setLastMarked(null);
  }, [resetKey]);

  const markAt = (e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; preventDefault: () => void }, id: string) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      e.preventDefault();
      window.getSelection()?.removeAllRanges();
    }
    const next = nextRowMarks(markedRef.current, lastRef.current, orderRef.current, id, e);
    setMarked(next.marked);
    setLastMarked(next.lastMarked);
  };

  const targetsFor = (id: string) => rowActionTargets(markedRef.current, orderRef.current, id);

  return { marked, lastMarked, markAt, targetsFor };
}
