import { useCallback, useSyncExternalStore } from 'react';

// Open and closed filter categories (Source, Target, …) and the branches
// inside them (address groups and DPT groups).
//
// Only a category or branch the user has explicitly opened or closed is stored.
// Every other one keeps its default, so a middle group still starts collapsed
// and a selected DPT group still starts open. The record lives at module
// scope and in localStorage, so it survives the panel unmounting and a reload.

const STORAGE_KEY = 'spectrum-knx.filter-branches';

const load = (): Record<string, boolean> => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const overrides: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'boolean') overrides[key] = value;
    }
    return overrides;
  } catch {
    return {};
  }
};

let overrides: Record<string, boolean> = load();
let version = 0;
const listeners = new Set<() => void>();

const persist = () => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // Ignore storage write failures (e.g. private mode quota)
  }
};

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

const getSnapshot = () => version;

const emit = () => {
  version += 1;
  persist();
  listeners.forEach(listener => listener());
};

/** Remember several branches in one update. A value already stored is left as it is. */
export function setFilterBranches(updates: Record<string, boolean>): void {
  let changed = false;
  const next = { ...overrides };
  for (const [key, open] of Object.entries(updates)) {
    if (key in next && next[key] === open) continue;
    next[key] = open;
    changed = true;
  }
  if (!changed) return;
  overrides = next;
  emit();
}

/** Remember one branch. Writing the value already stored does nothing. */
export function setFilterBranch(key: string, open: boolean): void {
  setFilterBranches({ [key]: open });
}

export function filterBranchOpen(key: string, defaultOpen: boolean): boolean {
  return key in overrides ? overrides[key] : defaultOpen;
}

/** Re-render when any remembered branch changes. */
export function useFilterBranchRevision(): void {
  useSyncExternalStore(subscribe, getSnapshot);
}

/** Subscribe a filter branch to its persisted open state. */
export function useFilterBranch(key: string, defaultOpen: boolean): [boolean, (open: boolean) => void] {
  useSyncExternalStore(subscribe, getSnapshot);
  const open = filterBranchOpen(key, defaultOpen);
  const setOpen = useCallback((next: boolean) => {
    if (filterBranchOpen(key, defaultOpen) === next) return;
    setFilterBranch(key, next);
  }, [key, defaultOpen]);
  return [open, setOpen];
}

/** Test helper. Reads the stored branches again, as a page reload would. */
export function reloadFilterBranches(): void {
  overrides = load();
  version += 1;
  listeners.forEach(listener => listener());
}

/** Test helper. Drops every remembered branch. */
export function resetFilterBranches(): void {
  overrides = {};
  version += 1;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage failures
  }
  listeners.forEach(listener => listener());
}
