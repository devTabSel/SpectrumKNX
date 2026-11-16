import { beforeEach, describe, expect, it } from 'vitest';
import { UI_STORAGE_KEY } from './uiState';
import { getPref, setPref } from './prefs';
import {
  BUFFER_RANGE_MINUTES_DEFAULT,
  DEFAULT_MONITOR_VIEW,
  deriveMonitorView,
  readBufferRangeMinutesPref,
  readMonitorViewPref,
  resolveMonitorStartup,
  sortConfigForReadDirection,
  writeMonitorViewPref,
  type MonitorView,
} from './monitorView';

const forwardParked: MonitorView = {
  direction: 'forward',
  anchorTs: 1_700_000_000_000,
  follow: false,
  pauseMode: 'manual',
};

beforeEach(() => {
  localStorage.clear();
});

describe('deriveMonitorView', () => {
  it('projects direction, anchor, follow and pause from the one view', () => {
    expect(deriveMonitorView(forwardParked)).toEqual({
      readDirection: 'forward',
      bufferAnchor: { direction: 'forward', ts: 1_700_000_000_000 },
      listFollow: false,
      pauseMode: 'manual',
    });
  });

  it('keeps a null anchor as the buffer edge', () => {
    expect(deriveMonitorView(DEFAULT_MONITOR_VIEW).bufferAnchor).toEqual({
      direction: 'backward',
      ts: null,
    });
  });
});

describe('sortConfigForReadDirection', () => {
  it('leaves a timestamp sort that already matches the direction', () => {
    const desc = [{ key: 'timestamp' as const, direction: 'desc' as const }];
    const withLevel = [
      { key: 'timestamp' as const, direction: 'asc' as const },
      { key: 'source_address' as const, direction: 'desc' as const },
    ];
    expect(sortConfigForReadDirection(desc, 'backward')).toBeNull();
    expect(sortConfigForReadDirection(withLevel, 'forward')).toBeNull();
  });

  it('replaces the sort so it follows the read direction', () => {
    expect(sortConfigForReadDirection(
      [{ key: 'timestamp', direction: 'desc' }],
      'forward',
    )).toEqual([{ key: 'timestamp', direction: 'asc' }]);
    expect(sortConfigForReadDirection(
      [{ key: 'source_address', direction: 'asc' }],
      'backward',
    )).toEqual([{ key: 'timestamp', direction: 'desc' }]);
  });
});

describe('monitor view preference', () => {
  it('round-trips direction, anchor, follow and pause mode', () => {
    writeMonitorViewPref(forwardParked);
    expect(readMonitorViewPref()).toEqual(forwardParked);
    expect(JSON.parse(getPref('monitorView') ?? 'null')).toEqual(forwardParked);
  });

  it('keeps anchor 0 and defaults a missing preference', () => {
    expect(readMonitorViewPref()).toEqual(DEFAULT_MONITOR_VIEW);
    writeMonitorViewPref({ ...DEFAULT_MONITOR_VIEW, anchorTs: 0, pauseMode: 'auto' });
    expect(readMonitorViewPref().anchorTs).toBe(0);
    expect(readMonitorViewPref().pauseMode).toBe('auto');
  });

  it('drops invalid fields and falls back to a legacy listFollow', () => {
    localStorage.setItem(UI_STORAGE_KEY, JSON.stringify({ v: 1, listFollow: false }));
    setPref('monitorView', JSON.stringify({
      direction: 'sideways',
      anchorTs: 'soon',
      pauseMode: 'latched',
    }));
    expect(readMonitorViewPref()).toEqual({
      direction: 'backward',
      anchorTs: null,
      follow: false,
      pauseMode: 'playing',
    });
  });

  it('prefers an explicit follow over the legacy UI flag', () => {
    localStorage.setItem(UI_STORAGE_KEY, JSON.stringify({ v: 1, listFollow: false }));
    writeMonitorViewPref({ ...DEFAULT_MONITOR_VIEW, follow: true });
    expect(readMonitorViewPref().follow).toBe(true);
  });

  it('reads the minute-range preference, defaulting when it is missing or invalid', () => {
    expect(readBufferRangeMinutesPref()).toBe(BUFFER_RANGE_MINUTES_DEFAULT);
    setPref('bufferRangeMinutes', '15');
    expect(readBufferRangeMinutesPref()).toBe(15);
    setPref('bufferRangeMinutes', '0');
    expect(readBufferRangeMinutesPref()).toBe(BUFFER_RANGE_MINUTES_DEFAULT);
  });
});

describe('resolveMonitorStartup', () => {
  const prefs = forwardParked;

  beforeEach(() => {
    writeMonitorViewPref(prefs);
    setPref('bufferRangeMinutes', '30');
  });

  it('uses the preference when the address is not a monitor URL', () => {
    expect(resolveMonitorStartup({ embedded: false, url: null })).toEqual({
      view: prefs,
      rangeMinutes: 30,
      fromUrl: false,
    });
  });

  it('lets an explicit monitor URL override direction, anchor and range', () => {
    expect(resolveMonitorStartup({
      embedded: false,
      url: { direction: 'backward', anchorTs: 5000, rangeMinutes: 15 },
    })).toEqual({
      view: { ...prefs, direction: 'backward', anchorTs: 5000 },
      rangeMinutes: 15,
      fromUrl: true,
    });
  });

  it('treats omitted URL fields as the defaults, ahead of the preference', () => {
    expect(resolveMonitorStartup({
      embedded: false,
      url: { direction: 'backward', anchorTs: null, rangeMinutes: BUFFER_RANGE_MINUTES_DEFAULT },
    })).toEqual({
      view: { ...prefs, direction: 'backward', anchorTs: null },
      rangeMinutes: BUFFER_RANGE_MINUTES_DEFAULT,
      fromUrl: true,
    });
  });

  it('ignores the URL while embedded and keeps follow and pause from the preference', () => {
    const resolved = resolveMonitorStartup({
      embedded: true,
      url: { direction: 'backward', anchorTs: null, rangeMinutes: 5 },
    });
    expect(resolved).toEqual({ view: prefs, rangeMinutes: 30, fromUrl: false });
  });
});
