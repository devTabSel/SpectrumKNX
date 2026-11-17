import { describe, expect, it } from 'vitest';
import {
  classifyGotoTarget,
  enterForward,
  gotoWindow,
  nextJumpTargets,
  parkOnFixedY,
} from './gotoTarget';
import { DEFAULT_MONITOR_VIEW, type MonitorView } from './monitorView';

describe('classifyGotoTarget', () => {
  const oldest = 1_000;
  const newest = 5_000;

  it('treats the buffer edges as inside', () => {
    expect(classifyGotoTarget(oldest, oldest, newest)).toBe('inside');
    expect(classifyGotoTarget(newest, oldest, newest)).toBe('inside');
    expect(classifyGotoTarget(3_000, oldest, newest)).toBe('inside');
  });

  it('splits targets outside the span into older and newer', () => {
    expect(classifyGotoTarget(oldest - 1, oldest, newest)).toBe('older');
    expect(classifyGotoTarget(newest + 1, oldest, newest)).toBe('newer');
  });

  it('is unknown when the buffer has no span', () => {
    expect(classifyGotoTarget(1_000, null, null)).toBe('unknown');
    expect(classifyGotoTarget(Number.NaN, oldest, newest)).toBe('unknown');
  });
});

describe('gotoWindow', () => {
  it('anchors forward on x and backward on y', () => {
    expect(gotoWindow('older', 10_000, 1)).toEqual({ min: 10_000, max: 70_000 });
    expect(gotoWindow('newer', 10_000, 1)).toEqual({ min: 10_000 - 60_000, max: 10_000 });
  });
});

describe('nextJumpTargets', () => {
  it('replaces on a plain goto and adds on ctrl', () => {
    expect(nextJumpTargets(['a', 'b'], 'c', false)).toEqual(['c']);
    expect(nextJumpTargets(['a'], 'b', true)).toEqual(['a', 'b']);
    expect(nextJumpTargets(['a', 'b'], 'a', true)).toEqual(['a', 'b']);
  });
});

describe('forward and fixed-y pause', () => {
  const manual: MonitorView = {
    ...DEFAULT_MONITOR_VIEW,
    pauseMode: 'manual',
    follow: false,
  };

  it('clears live in memory on every forward entry', () => {
    expect(enterForward(manual)).toMatchObject({ pauseMode: 'off', follow: false });
    expect(enterForward({ ...manual, direction: 'forward', pauseMode: 'playing', follow: true }))
      .toMatchObject({ pauseMode: 'off', follow: false });
    const already = enterForward(manual);
    expect(enterForward(already)).toBe(already);
  });

  it('parks a fixed y without keeping play, and keeps a manual latch', () => {
    expect(parkOnFixedY({ ...DEFAULT_MONITOR_VIEW, pauseMode: 'playing' }, 42)).toMatchObject({
      direction: 'backward',
      anchorTs: 42,
      follow: false,
      pauseMode: 'auto',
    });
    expect(parkOnFixedY(manual, 42).pauseMode).toBe('manual');
    expect(parkOnFixedY({ ...DEFAULT_MONITOR_VIEW, direction: 'forward', pauseMode: 'off', follow: false }, 7))
      .toMatchObject({ direction: 'backward', anchorTs: 7, follow: false, pauseMode: 'auto' });
  });
});
