import { getPref, setPref } from './prefs';

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

const visibleColumnsKey = (instanceId: string) => `visibleColumns:${instanceId}`;

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
