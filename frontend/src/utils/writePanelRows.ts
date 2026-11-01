import { useRef, useSyncExternalStore } from 'react';

export interface WritePanelRow {
  id: string;
  address: string;
  dpt: string;
  value: string;
  delay: string;
  every: string;
  busy: boolean;
  feedback: { ok: boolean; msg: string } | null;
  readBaseline: string | null;
}

const ROWS_STORAGE_KEY = 'spectrumknx-write-panel-rows';
const MAX_STORED_ROWS = 20;

type StoredRow = Pick<WritePanelRow, 'address' | 'dpt' | 'value' | 'delay' | 'every'>;

let rowSeq = 0;
export const newWritePanelRow = (): WritePanelRow => ({
  id: `row-${rowSeq++}`, address: '', dpt: '', value: '', delay: '', every: '', busy: false, feedback: null,
  readBaseline: null,
});

function loadStoredRows(): WritePanelRow[] | null {
  try {
    const raw = localStorage.getItem(ROWS_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    const str = (v: unknown) => (typeof v === 'string' ? v : '');
    return parsed.slice(0, MAX_STORED_ROWS).map(p => {
      const s = p as Partial<StoredRow> | null;
      return {
        ...newWritePanelRow(),
        address: str(s?.address),
        dpt: str(s?.dpt),
        value: str(s?.value),
        delay: str(s?.delay),
        every: str(s?.every),
      };
    });
  } catch {
    return null;
  }
}

function saveRows(rows: WritePanelRow[]): void {
  try {
    const stored: StoredRow[] = rows.map(({ address, dpt, value, delay, every }) => ({
      address, dpt, value, delay, every,
    }));
    localStorage.setItem(ROWS_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Storage unavailable — the rows just won't survive the next toggle.
  }
}

let storedRows: WritePanelRow[] | null = null;
let version = 0;
const listeners = new Set<() => void>();

function ensureRows(): WritePanelRow[] {
  if (!storedRows) storedRows = loadStoredRows() ?? [newWritePanelRow()];
  return storedRows;
}

function commit(next: WritePanelRow[]) {
  storedRows = next;
  saveRows(next);
  version += 1;
  listeners.forEach(listener => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getVersion() {
  return version;
}

/** Panel mount re-reads storage so a row edited before this mount is restored. */
export function useWritePanelRows(reloadFromStorage = false): WritePanelRow[] {
  const loaded = useRef(false);
  if (reloadFromStorage && !loaded.current) {
    loaded.current = true;
    storedRows = loadStoredRows() ?? [newWritePanelRow()];
  }
  useSyncExternalStore(subscribe, getVersion);
  return storedRows ?? ensureRows();
}

export function resetWritePanelRows() {
  storedRows = null;
  try { localStorage.removeItem(ROWS_STORAGE_KEY); } catch { /* ignore */ }
  version += 1;
  listeners.forEach(listener => listener());
}

export function setWritePanelRows(action: WritePanelRow[] | ((prev: WritePanelRow[]) => WritePanelRow[])) {
  const prev = ensureRows();
  commit(typeof action === 'function' ? action(prev) : action);
}

export function useWritePanelHas(address: string): boolean {
  useSyncExternalStore(subscribe, getVersion);
  return ensureRows().some(row => row.address.trim() === address);
}

/** Add this group address to the send panel, or remove every row that has it. */
export function toggleWritePanelAddress(address: string, dpt = '') {
  const trimmed = address.trim();
  if (!trimmed) return;
  const prev = ensureRows();
  const has = prev.some(row => row.address.trim() === trimmed);
  if (has) {
    const next = prev.filter(row => row.address.trim() !== trimmed);
    commit(next.length > 0 ? next : [newWritePanelRow()]);
    return;
  }
  const blank = prev.find(row => !row.address.trim());
  if (blank) {
    commit(prev.map(row => (row.id === blank.id ? { ...row, address: trimmed, dpt } : row)));
    return;
  }
  if (prev.length >= MAX_STORED_ROWS) return;
  commit([...prev, { ...newWritePanelRow(), address: trimmed, dpt }]);
}
