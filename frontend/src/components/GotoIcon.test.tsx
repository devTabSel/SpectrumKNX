import { render } from '@testing-library/react';
import { expect, test } from 'vitest';
import { GotoIcon, gotoGlyphKind } from './GotoIcon';

test('gotoGlyphKind: inside/filtered scroll; outside/missing follow read direction', () => {
  expect(gotoGlyphKind('ready', 'forward')).toBe('scroll');
  expect(gotoGlyphKind('filtered', 'backward')).toBe('scroll');
  expect(gotoGlyphKind('outside', 'forward')).toBe('load-forward');
  expect(gotoGlyphKind('outside', 'backward')).toBe('load-backward');
  expect(gotoGlyphKind('missing', 'forward')).toBe('load-forward');
  expect(gotoGlyphKind('missing', 'backward')).toBe('load-backward');
});

test('GotoIcon renders lucide load glyphs for outside tones', () => {
  const { container, rerender } = render(
    <GotoIcon tone="outside" readDirection="forward" />,
  );
  expect(container.querySelector('.lucide-arrow-right-from-line')).toBeTruthy();

  rerender(<GotoIcon tone="outside" readDirection="backward" />);
  expect(container.querySelector('.lucide-arrow-left-from-line')).toBeTruthy();

  rerender(<GotoIcon tone="ready" readDirection="forward" />);
  expect(container.querySelector('.lucide-arrow-right-from-line')).toBeNull();
  expect(container.querySelector('svg')).toBeTruthy();
});
