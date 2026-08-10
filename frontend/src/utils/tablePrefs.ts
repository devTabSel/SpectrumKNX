import { getPref, setPref } from './prefs';
import type { ColId } from './quickFilter';

export const DEFAULT_VISIBLE_COLUMNS: Record<string, boolean> = {
  time: true,
  delta: true,
  source: true,
  sourceName: true,
  target: true,
  targetName: true,
  type: true,
  dpt: true,
  data: true,
  value: true,
};

export const DEFAULT_COLUMN_ORDER: ColId[] = ['time', 'delta', 'source', 'target', 'type', 'dpt', 'value'];

const visibleColumnsKey = (instanceId: string) => `visibleColumns:${instanceId}`;
const columnOrderKey = (instanceId: string) => `columnOrder:${instanceId}`;

const normalizeColumnOrder = (raw: unknown): ColId[] => {
  if (!Array.isArray(raw)) return [...DEFAULT_COLUMN_ORDER];

  const seen = new Set<ColId>();
  const out: ColId[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    if (!DEFAULT_COLUMN_ORDER.includes(item as ColId)) continue;
    const id = item as ColId;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }

  for (const id of DEFAULT_COLUMN_ORDER) {
    if (!seen.has(id)) out.push(id);
  }
  return out;
};

export const readVisibleColumnsPref = (instanceId: string): Record<string, boolean> => {
  try {
    const scoped = getPref(visibleColumnsKey(instanceId));
    if (scoped) {
      const parsed = JSON.parse(scoped) as unknown;
      if (parsed && typeof parsed === 'object') {
        return { ...DEFAULT_VISIBLE_COLUMNS, ...(parsed as Record<string, boolean>) };
      }
    }

    // Backward compatibility: inherit old global setting if a scoped value
    // does not exist yet.
    const legacy = getPref('visibleColumns');
    if (legacy) {
      const parsed = JSON.parse(legacy) as unknown;
      if (parsed && typeof parsed === 'object') {
        return { ...DEFAULT_VISIBLE_COLUMNS, ...(parsed as Record<string, boolean>) };
      }
    }
  } catch {
    // Ignore malformed stored value
  }
  return { ...DEFAULT_VISIBLE_COLUMNS };
};

export const writeVisibleColumnsPref = (instanceId: string, visibleColumns: Record<string, boolean>): void => {
  setPref(visibleColumnsKey(instanceId), JSON.stringify(visibleColumns));
};

export const readColumnOrderPref = (instanceId: string): ColId[] => {
  try {
    const scoped = getPref(columnOrderKey(instanceId));
    if (scoped) {
      return normalizeColumnOrder(JSON.parse(scoped));
    }

    // Backward compatibility: inherit old global setting if a scoped value
    // does not exist yet.
    const legacy = getPref('columnOrder');
    if (legacy) {
      return normalizeColumnOrder(JSON.parse(legacy));
    }
  } catch {
    // Ignore malformed stored value
  }
  return [...DEFAULT_COLUMN_ORDER];
};

export const writeColumnOrderPref = (instanceId: string, columnOrder: ColId[]): void => {
  setPref(columnOrderKey(instanceId), JSON.stringify(normalizeColumnOrder(columnOrder)));
};
