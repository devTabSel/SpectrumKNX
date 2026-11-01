import { useCallback, useLayoutEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'spectrum-knx-panel-scroll';

type ScrollMap = Record<string, number>;

function readMap(): ScrollMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: ScrollMap = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function readPanelScroll(key: string): number {
  return readMap()[key] ?? 0;
}

export function writePanelScroll(key: string, top: number): void {
  try {
    const all = readMap();
    const next = Math.max(0, Math.round(top));
    if (all[key] === next) return;
    all[key] = next;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    // Storage can be unavailable. The list still scrolls for this visit.
  }
}

/** How far a scroller can move once its content has a real height. Null while it is still empty. */
export function restoredScrollTop(saved: number, scrollHeight: number, clientHeight: number): number | null {
  if (saved <= 0) return 0;
  const max = Math.max(0, scrollHeight - clientHeight);
  if (max <= 0) return null;
  return Math.min(saved, max);
}

/**
 * Remembers a list's scroll offset across unmounts and reloads.
 * Filter and the two focus lists each keep their own place.
 */
export function usePersistedScroll(key: string) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const setRef = useCallback((el: HTMLDivElement | null) => {
    ref.current = el;
    setNode(prev => (prev === el ? prev : el));
  }, []);

  useLayoutEffect(() => {
    const el = node;
    if (!el) return;
    const saved = readPanelScroll(key);
    // A detached node reports scrollTop 0, so the last scroll event is what we keep.
    let last = el.scrollTop;
    let placed = false;
    let applying = false;

    const apply = () => {
      if (placed) return;
      if (saved <= 0) {
        applying = true;
        el.scrollTop = 0;
        last = 0;
        applying = false;
        placed = true;
        return;
      }
      const top = restoredScrollTop(saved, el.scrollHeight, el.clientHeight);
      if (top == null) return;
      applying = true;
      el.scrollTop = top;
      last = top;
      applying = false;
      // A shorter list keeps waiting, so a later growth can still reach the saved place.
      if (top >= saved) placed = true;
    };
    apply();

    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(apply) : null;
    observer?.observe(el);

    const onScroll = () => {
      if (applying) return;
      placed = true;
      last = el.scrollTop;
      writePanelScroll(key, last);
    };
    el.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      observer?.disconnect();
      el.removeEventListener('scroll', onScroll);
      if (placed) writePanelScroll(key, last);
    };
  }, [key, node]);

  return Object.assign(setRef, { get current() { return ref.current; } });
}
