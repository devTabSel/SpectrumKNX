import { describe, it, expect } from 'vitest';
import { contextRailSigns, expandWithDeltaContext } from './deltaContextExpansion';

interface Item {
  key: string;
  timestamp: string;
}

const item = (key: string, isoTime: string): Item => ({ key, timestamp: isoTime });
const keyOf = (i: Item) => i.key;

describe('expandWithDeltaContext', () => {
  it('with no window, returns only the matching items and no context keys', () => {
    const items = [item('a', '2024-01-01T10:00:00Z'), item('b', '2024-01-01T10:00:01Z')];
    const out = expandWithDeltaContext(items, [true, false], keyOf, new Set(), 0, 0);
    expect(out.items.map(keyOf)).toEqual(['a']);
    expect(out.contextKeys).toEqual(new Set());
  });

  it('pulls in non-matching items within the before/after window of a match, tagged as context (#343)', () => {
    const items = [
      item('a', '2024-01-01T10:00:00.000Z'),
      item('b', '2024-01-01T10:00:00.500Z'), // +500ms of a, not matching
      item('c', '2024-01-01T10:00:05.000Z'), // +5s of a, outside window
    ];
    const out = expandWithDeltaContext(items, [true, false, false], keyOf, new Set(), 0, 1000);
    expect(out.items.map(keyOf)).toEqual(['a', 'b']);
    expect(out.contextKeys).toEqual(new Set(['b']));
  });

  it('a flagged non-match anchors its own window and stays classified as context', () => {
    const items = [
      item('a', '2024-01-01T10:00:00.000Z'), // flagged, doesn't match
      item('b', '2024-01-01T10:00:00.500Z'), // near the flagged item
      item('c', '2024-01-01T10:00:10.000Z'), // far from everything
    ];
    const out = expandWithDeltaContext(items, [false, false, false], keyOf, new Set(['a']), 0, 1000);
    expect(out.items.map(keyOf)).toEqual(['a', 'b']);
    // Flag controls the anchor window, not context-row membership (#343).
    expect(out.contextKeys).toEqual(new Set(['a', 'b']));
  });

  it('flagging a pulled-in context row keeps it in contextKeys', () => {
    const items = [
      item('a', '2024-01-01T10:00:00.000Z'), // match
      item('b', '2024-01-01T10:00:00.500Z'), // context, then also flagged
    ];
    const out = expandWithDeltaContext(items, [true, false], keyOf, new Set(['b']), 0, 1000);
    expect(out.items.map(keyOf)).toEqual(['a', 'b']);
    expect(out.contextKeys).toEqual(new Set(['b']));
  });

  it('a flagged item is shown even with no window at all (before=after=0)', () => {
    const items = [item('a', '2024-01-01T10:00:00Z'), item('b', '2024-01-01T10:00:01Z')];
    const out = expandWithDeltaContext(items, [false, false], keyOf, new Set(['a']), 0, 0);
    expect(out.items.map(keyOf)).toEqual(['a']);
    expect(out.contextKeys).toEqual(new Set());
  });

  it('returns nothing when there are no matches and no flags', () => {
    const items = [item('a', '2024-01-01T10:00:00Z')];
    const out = expandWithDeltaContext(items, [false], keyOf, new Set(), 100, 100);
    expect(out.items).toEqual([]);
    expect(out.contextKeys).toEqual(new Set());
  });

  it('respects asymmetric before/after windows', () => {
    const items = [
      item('before', '2024-01-01T09:59:59.500Z'), // -500ms
      item('anchor', '2024-01-01T10:00:00.000Z'),
      item('after', '2024-01-01T10:00:00.500Z'), // +500ms
    ];
    const onlyAfter = expandWithDeltaContext(items, [false, true, false], keyOf, new Set(), 0, 1000);
    expect(onlyAfter.items.map(keyOf)).toEqual(['anchor', 'after']);
    expect(onlyAfter.contextKeys).toEqual(new Set(['after']));

    const onlyBefore = expandWithDeltaContext(items, [false, true, false], keyOf, new Set(), 1000, 0);
    expect(onlyBefore.items.map(keyOf)).toEqual(['before', 'anchor']);
    expect(onlyBefore.contextKeys).toEqual(new Set(['before']));
  });

  it('with anchorMatches off, only flagged items pull in context; matches stay visible (#319)', () => {
    const items = [
      item('m1', '2024-01-01T10:00:00.000Z'), // match, not flagged
      item('x1', '2024-01-01T10:00:00.500Z'), // near m1 only
      item('m2', '2024-01-01T10:01:00.000Z'), // match, flagged
      item('x2', '2024-01-01T10:01:00.500Z'), // near m2
    ];
    const matches = [true, false, true, false];
    const out = expandWithDeltaContext(items, matches, keyOf, new Set(['m2']), 0, 1000, false);
    expect(out.items.map(keyOf)).toEqual(['m1', 'm2', 'x2']);
    expect(out.contextKeys).toEqual(new Set(['x2']));

    const unflagged = expandWithDeltaContext(items, matches, keyOf, new Set(), 0, 1000, false);
    expect(unflagged.items.map(keyOf)).toEqual(['m1', 'm2']);
    expect(unflagged.contextKeys).toEqual(new Set());
  });
});

describe('contextRailSigns', () => {
  const anchor = Date.parse('2024-01-01T10:00:00.000Z');

  it('marks a row before an anchor (rail ∧) only', () => {
    const older = Date.parse('2024-01-01T09:59:59.500Z');
    expect(contextRailSigns(older, [anchor], 1000, 1000)).toEqual({ before: true, after: false });
  });

  it('marks a row after an anchor (rail ∨) only', () => {
    const newer = Date.parse('2024-01-01T10:00:00.500Z');
    expect(contextRailSigns(newer, [anchor], 1000, 1000)).toEqual({ before: false, after: true });
  });

  it('respects asymmetric windows and can be before one anchor and after another', () => {
    const early = Date.parse('2024-01-01T10:00:00.000Z');
    const late = Date.parse('2024-01-01T10:01:00.000Z');
    const between = Date.parse('2024-01-01T10:00:30.000Z');
    // after early (within 60s), before late (within 60s)
    expect(contextRailSigns(between, [early, late], 60_000, 60_000)).toEqual({ before: true, after: true });
    // only-after window: before late is ignored
    expect(contextRailSigns(between, [early, late], 0, 60_000)).toEqual({ before: false, after: true });
  });

  it('ignores rows outside every anchor window', () => {
    const far = Date.parse('2024-01-01T10:00:05.000Z');
    expect(contextRailSigns(far, [anchor], 1000, 1000)).toEqual({ before: false, after: false });
  });
});
