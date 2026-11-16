import { describe, expect, it } from 'vitest';
import { nextTriState } from './triState';

describe('nextTriState', () => {
  it('plain click: off → all on, on → all off, mixed → all off', () => {
    expect(nextTriState('none')).toBe('all');
    expect(nextTriState('all')).toBe('none');
    expect(nextTriState('some')).toBe('none');
  });

  it('ctrl-click: off → all on, on → all off, mixed → all on', () => {
    expect(nextTriState('none', { ctrl: true })).toBe('all');
    expect(nextTriState('all', { ctrl: true })).toBe('none');
    expect(nextTriState('some', { ctrl: true })).toBe('all');
  });

  it('a false ctrl flag matches a plain click', () => {
    expect(nextTriState('some', { ctrl: false })).toBe('none');
    expect(nextTriState('none', { ctrl: false })).toBe('all');
  });
});
