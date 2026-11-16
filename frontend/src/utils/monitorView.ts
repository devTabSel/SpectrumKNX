import type { PauseMode } from './bufferPauseMode';
import { getPref, setPref } from './prefs';
import { UI_STORAGE_KEY } from './uiState';

/**
 * Pause carried by the monitor view. `off` is the forward read: there is no
 * live edge and the snapshot is not frozen. Backward uses playing | auto | manual.
 */
export type MonitorPauseMode = PauseMode | 'off';

/** Read axis of the group monitor. Forward is oldest-first. */
export type ReadDirection = 'forward' | 'backward';

/**
 * The group-monitor view. Single source for the read direction, the explicit
 * buffer anchor, list follow, and the pause mode.
 *
 * `anchorTs === null` is the buffer edge: oldest when reading forward, the
 * live edge when reading backward. It is not the table's scroll pin.
 */
export interface MonitorView {
  direction: ReadDirection;
  anchorTs: number | null;
  follow: boolean;
  pauseMode: MonitorPauseMode;
}

export const DEFAULT_MONITOR_VIEW: MonitorView = {
  direction: 'backward',
  anchorTs: null,
  follow: true,
  pauseMode: 'playing',
};

/** Preference default for the minute window. Also the URL default. */
export const BUFFER_RANGE_MINUTES_DEFAULT = 60;

export const MONITOR_VIEW_PREF = 'monitorView';

const PAUSE_MODES: readonly PauseMode[] = ['playing', 'auto', 'manual'];

export interface MonitorViewDerived {
  readDirection: ReadDirection;
  /** Cache anchor. `ts === null` keeps the buffer edge (see MonitorView). */
  bufferAnchor: { direction: ReadDirection; ts: number | null };
  listFollow: boolean;
  pauseMode: MonitorPauseMode;
}

/** Projects the view onto the values the monitor and the cache consume. */
export function deriveMonitorView(view: MonitorView): MonitorViewDerived {
  return {
    readDirection: view.direction,
    bufferAnchor: { direction: view.direction, ts: view.anchorTs },
    listFollow: view.follow,
    pauseMode: view.pauseMode,
  };
}

/** Direction, anchor and range as carried by a monitor URL. */
export interface MonitorUrlFields {
  direction: ReadDirection;
  anchorTs: number | null;
  rangeMinutes: number;
}

function isPauseMode(value: unknown): value is PauseMode {
  return typeof value === 'string' && (PAUSE_MODES as readonly string[]).includes(value);
}

function isMonitorPauseMode(value: unknown): value is MonitorPauseMode {
  return value === 'off' || isPauseMode(value);
}

/**
 * Forward has no live or pause. The stored form is `pauseMode: 'off'` and
 * follow off, so a reload does not revive Play. `off` on a backward view is
 * not a live mode: it becomes auto without follow (no automatic live).
 * A backward playing | auto | manual view is returned unchanged.
 */
export function normalizeMonitorView(view: MonitorView): MonitorView {
  if (view.direction === 'forward') {
    if (view.pauseMode === 'off' && view.follow === false) return view;
    return { ...view, follow: false, pauseMode: 'off' };
  }
  if (view.pauseMode === 'off') {
    return { ...view, follow: false, pauseMode: 'auto' };
  }
  return view;
}

function sanitizeMonitorView(raw: unknown, legacyFollow?: boolean): MonitorView {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Partial<MonitorView>;
  const anchorTs = typeof p.anchorTs === 'number' && Number.isFinite(p.anchorTs) ? p.anchorTs : null;
  return {
    direction: p.direction === 'forward' || p.direction === 'backward' ? p.direction : 'backward',
    anchorTs,
    follow: typeof p.follow === 'boolean' ? p.follow : (legacyFollow ?? DEFAULT_MONITOR_VIEW.follow),
    pauseMode: isMonitorPauseMode(p.pauseMode) ? p.pauseMode : DEFAULT_MONITOR_VIEW.pauseMode,
  };
}

/** Follow used to live in the UI-session blob. Read once when the view pref is absent. */
function readLegacyListFollow(): boolean | undefined {
  try {
    const raw = localStorage.getItem(UI_STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { listFollow?: unknown };
    return typeof parsed.listFollow === 'boolean' ? parsed.listFollow : undefined;
  } catch {
    return undefined;
  }
}

export function readMonitorViewPref(): MonitorView {
  const legacyFollow = readLegacyListFollow();
  try {
    const raw = getPref(MONITOR_VIEW_PREF);
    if (raw == null || raw.trim() === '') return sanitizeMonitorView(undefined, legacyFollow);
    return sanitizeMonitorView(JSON.parse(raw) as unknown, legacyFollow);
  } catch {
    return sanitizeMonitorView(undefined, legacyFollow);
  }
}

export function writeMonitorViewPref(view: MonitorView): void {
  setPref(MONITOR_VIEW_PREF, JSON.stringify(sanitizeMonitorView(view)));
}

export function readBufferRangeMinutesPref(): number {
  const n = Number(getPref('bufferRangeMinutes') || BUFFER_RANGE_MINUTES_DEFAULT);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : BUFFER_RANGE_MINUTES_DEFAULT;
}

/**
 * Startup view. A monitor URL (regular browser tab) supplies direction, anchor
 * and range, including their defaults for omitted params, and wins over the
 * preference. Follow and pause mode are not in the URL. Embedded mode and a
 * bare address keep the preference: the iframe URL is not the workspace.
 * A forward result is normalized to `pauseMode: 'off'` and follow off.
 */
export function resolveMonitorStartup(opts: {
  embedded: boolean;
  url: MonitorUrlFields | null;
}): { view: MonitorView; rangeMinutes: number; fromUrl: boolean } {
  const view = readMonitorViewPref();
  const rangeMinutes = readBufferRangeMinutesPref();
  if (opts.embedded || opts.url == null) {
    return { view: normalizeMonitorView(view), rangeMinutes, fromUrl: false };
  }
  return {
    view: normalizeMonitorView({
      ...view,
      direction: opts.url.direction,
      anchorTs: opts.url.anchorTs,
    }),
    rangeMinutes: opts.url.rangeMinutes,
    fromUrl: true,
  };
}
