import { beforeEach, describe, expect, it } from 'vitest';
import { UI_STORAGE_KEY } from './uiState';
import { getPref, setPref } from './prefs';
import {
  BUFFER_RANGE_MINUTES_DEFAULT,
  DEFAULT_MONITOR_VIEW,
  deriveMonitorView,
  normalizeMonitorView,
  readBufferRangeMinutesPref,
  readMonitorViewPref,
  resolveMonitorStartup,
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

describe('normalizeMonitorView', () => {
  it('drops live and pause from a forward view', () => {
    expect(normalizeMonitorView({
      direction: 'forward',
      anchorTs: 5000,
      follow: true,
      pauseMode: 'playing',
    })).toEqual({
      direction: 'forward',
      anchorTs: 5000,
      follow: false,
      pauseMode: 'off',
    });
    expect(normalizeMonitorView({
      ...forwardParked,
      pauseMode: 'auto',
    }).pauseMode).toBe('off');
    expect(normalizeMonitorView(forwardParked).pauseMode).toBe('off');
  });

  it('leaves a backward playing, auto or manual view unchanged', () => {
    const playing = DEFAULT_MONITOR_VIEW;
    expect(normalizeMonitorView(playing)).toBe(playing);
    const manual: MonitorView = { ...playing, follow: false, pauseMode: 'manual' };
    expect(normalizeMonitorView(manual)).toBe(manual);
  });

  it('does not treat off as live when the direction is backward', () => {
    expect(normalizeMonitorView({
      direction: 'backward',
      anchorTs: null,
      follow: true,
      pauseMode: 'off',
    })).toEqual({
      direction: 'backward',
      anchorTs: null,
      follow: false,
      pauseMode: 'auto',
    });
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
      view: { ...prefs, follow: false, pauseMode: 'off' },
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

  it('normalizes a forward URL over a playing preference', () => {
    writeMonitorViewPref({ ...DEFAULT_MONITOR_VIEW, follow: true, pauseMode: 'playing' });
    expect(resolveMonitorStartup({
      embedded: false,
      url: { direction: 'forward', anchorTs: 5000, rangeMinutes: 15 },
    }).view).toEqual({
      direction: 'forward',
      anchorTs: 5000,
      follow: false,
      pauseMode: 'off',
    });
  });

  it('ignores the URL while embedded and normalizes a forward preference', () => {
    const resolved = resolveMonitorStartup({
      embedded: true,
      url: { direction: 'backward', anchorTs: null, rangeMinutes: 5 },
    });
    expect(resolved).toEqual({
      view: { ...prefs, follow: false, pauseMode: 'off' },
      rangeMinutes: 30,
      fromUrl: false,
    });
  });
});
