import { describe, it, expect } from 'vitest';
import {
  contextRailSigns,
  expandWithDeltaContext,
  sideFlagsTristate,
  type ContextSideFlags,
} from './deltaContextExpansion';

interface Item {
  key: string;
  timestamp: string;
}

const item = (key: string, isoTime: string): Item => ({ key, timestamp: isoTime });
const keyOf = (i: Item) => i.key;
const flags = (before: string[] = [], after: string[] = []): ContextSideFlags => ({
  before: new Set(before),
  after: new Set(after),
});
const none = flags();

describe('expandWithDeltaContext', () => {
  it('with no window, returns only the matching items and no context keys', () => {
    const items = [item('a', '2024-01-01T10:00:00Z'), item('b', '2024-01-01T10:00:01Z')];
    const out = expandWithDeltaContext(items, [true, false], keyOf, flags([], ['a']), 0, 0);
    expect(out.items.map(keyOf)).toEqual(['a']);
    expect(out.contextKeys).toEqual(new Set());
    expect(out.contextMembers.size).toBe(0);
  });

  it('pulls non-matching items inside the flagged side of the quick-filter window', () => {
    const items = [
      item('a', '2024-01-01T10:00:00.000Z'),
      item('b', '2024-01-01T10:00:00.500Z'), // +500ms of a, not matching
      item('c', '2024-01-01T10:00:05.000Z'), // +5s of a, outside window
    ];
    const out = expandWithDeltaContext(items, [true, false, false], keyOf, flags([], ['a']), 0, 1000);
    expect(out.items.map(keyOf)).toEqual(['a', 'b']);
    expect(out.contextKeys).toEqual(new Set(['b']));
  });

  it('does not pull context around a match whose flag is off', () => {
    const items = [
      item('a', '2024-01-01T10:00:00.000Z'),
      item('b', '2024-01-01T10:00:00.500Z'),
    ];
    const out = expandWithDeltaContext(items, [true, false], keyOf, none, 0, 1000);
    expect(out.items.map(keyOf)).toEqual(['a']);
    expect(out.contextKeys).toEqual(new Set());
  });

  it('a flagged non-match keeps its member list and stays hidden until it is visible', () => {
    const items = [
      item('a', '2024-01-01T10:00:00.000Z'), // flagged, doesn't match
      item('b', '2024-01-01T10:00:00.500Z'), // near the flagged item
      item('c', '2024-01-01T10:00:10.000Z'), // far from everything
    ];
    const out = expandWithDeltaContext(items, [false, false, false], keyOf, flags([], ['a']), 0, 1000);
    expect(out.items).toEqual([]);
    expect(out.contextKeys).toEqual(new Set());
    expect(out.contextMembers.get('a')).toEqual(['b']);
    expect(out.contextParents.get('b')).toEqual(['a']);

    const pinned = expandWithDeltaContext(
      items, [false, false, false], keyOf, flags([], ['a']), 0, 1000,
      { pinnedKeys: new Set(['a']) },
    );
    expect(pinned.items.map(keyOf)).toEqual(['a', 'b']);
    expect(pinned.contextKeys).toEqual(new Set(['b']));
  });

  it('flagging a pulled-in context row keeps it in contextKeys', () => {
    const items = [
      item('a', '2024-01-01T10:00:00.000Z'), // match, after flag
      item('b', '2024-01-01T10:00:00.500Z'), // context, also flagged
    ];
    const out = expandWithDeltaContext(items, [true, false], keyOf, flags([], ['a', 'b']), 0, 1000);
    expect(out.items.map(keyOf)).toEqual(['a', 'b']);
    expect(out.contextKeys).toEqual(new Set(['b']));
  });

  it('a flagged non-match is hidden when the window is closed (before=after=0)', () => {
    const items = [item('a', '2024-01-01T10:00:00Z'), item('b', '2024-01-01T10:00:01Z')];
    const out = expandWithDeltaContext(items, [false, false], keyOf, flags(['a'], ['a']), 0, 0);
    expect(out.items).toEqual([]);
    expect(out.contextKeys).toEqual(new Set());
    expect(out.contextMembers.size).toBe(0);
  });

  it('returns nothing when there are no matches and no flags', () => {
    const items = [item('a', '2024-01-01T10:00:00Z')];
    const out = expandWithDeltaContext(items, [false], keyOf, none, 100, 100);
    expect(out.items).toEqual([]);
    expect(out.contextKeys).toEqual(new Set());
  });

  it('respects asymmetric before/after windows and flags each side alone', () => {
    const items = [
      item('before', '2024-01-01T09:59:59.500Z'), // -500ms
      item('anchor', '2024-01-01T10:00:00.000Z'),
      item('after', '2024-01-01T10:00:00.500Z'), // +500ms
    ];
    const onlyAfter = expandWithDeltaContext(items, [false, true, false], keyOf, flags([], ['anchor']), 0, 1000);
    expect(onlyAfter.items.map(keyOf)).toEqual(['anchor', 'after']);
    expect(onlyAfter.contextKeys).toEqual(new Set(['after']));

    const onlyBefore = expandWithDeltaContext(items, [false, true, false], keyOf, flags(['anchor'], []), 1000, 0);
    expect(onlyBefore.items.map(keyOf)).toEqual(['before', 'anchor']);
    expect(onlyBefore.contextKeys).toEqual(new Set(['before']));

    const beforeFlagIgnoresNewer = expandWithDeltaContext(
      items, [false, true, false], keyOf, flags(['anchor'], []), 1000, 1000,
    );
    expect(beforeFlagIgnoresNewer.items.map(keyOf)).toEqual(['before', 'anchor']);

    const afterFlagIgnoresOlder = expandWithDeltaContext(
      items, [false, true, false], keyOf, flags([], ['anchor']), 1000, 1000,
    );
    expect(afterFlagIgnoresOlder.items.map(keyOf)).toEqual(['anchor', 'after']);
  });

  it('only flagged rows pull context; an unflagged match stays visible', () => {
    const items = [
      item('m1', '2024-01-01T10:00:00.000Z'), // match, not flagged
      item('x1', '2024-01-01T10:00:00.500Z'), // near m1 only
      item('m2', '2024-01-01T10:01:00.000Z'), // match, after flag
      item('x2', '2024-01-01T10:01:00.500Z'), // near m2
    ];
    const matches = [true, false, true, false];
    const out = expandWithDeltaContext(items, matches, keyOf, flags([], ['m2']), 0, 1000);
    expect(out.items.map(keyOf)).toEqual(['m1', 'm2', 'x2']);
    expect(out.contextKeys).toEqual(new Set(['x2']));

    const unflagged = expandWithDeltaContext(items, matches, keyOf, none, 0, 1000);
    expect(unflagged.items.map(keyOf)).toEqual(['m1', 'm2']);
    expect(unflagged.contextKeys).toEqual(new Set());
  });

  it('ignores flags while Time-Delta-Context is globally off', () => {
    const items = [
      item('a', '2024-01-01T10:00:00.000Z'),
      item('b', '2024-01-01T10:00:00.500Z'),
    ];
    const out = expandWithDeltaContext(items, [true, false], keyOf, flags([], ['a']), 5000, 5000, {
      contextEnabled: false,
    });
    expect(out.items.map(keyOf)).toEqual(['a']);
    expect(out.contextMembers.size).toBe(0);
    expect(out.contextParents.size).toBe(0);
  });

  it('does not chain through a context row whose flag is off', () => {
    // a reaches b (400ms) but not c (800ms). b would reach c, and must not.
    const items = [
      item('a', '2024-01-01T10:00:00.000Z'),
      item('b', '2024-01-01T10:00:00.400Z'),
      item('c', '2024-01-01T10:00:00.800Z'),
    ];
    const out = expandWithDeltaContext(items, [true, false, false], keyOf, flags([], ['a']), 0, 500);
    expect(out.items.map(keyOf)).toEqual(['a', 'b']);
    expect(out.contextKeys).toEqual(new Set(['b']));
    expect(out.contextMembers.has('b')).toBe(false);
    expect(out.contextMembers.get('a')).toEqual(['b']);
  });

  it('a flagged context row pulls its own window once that row is visible', () => {
    const items = [
      item('a', '2024-01-01T10:00:00.000Z'),
      item('b', '2024-01-01T10:00:00.400Z'),
      item('c', '2024-01-01T10:00:00.800Z'),
    ];
    const out = expandWithDeltaContext(items, [true, false, false], keyOf, flags([], ['a', 'b']), 0, 500);
    expect(out.items.map(keyOf)).toEqual(['a', 'b', 'c']);
    expect(out.contextKeys).toEqual(new Set(['b', 'c']));
    expect(out.contextMembers.get('b')).toEqual(['c']);
    expect(out.contextParents.get('c')).toEqual(['b']);
  });

  it('covers rows inside an anchor window when the list is not time-sorted', () => {
    const items = [
      item('c', '2024-01-01T10:00:05.000Z'), // far
      item('b', '2024-01-01T10:00:00.500Z'), // +500ms of a
      item('a', '2024-01-01T10:00:00.000Z'), // match
    ];
    const out = expandWithDeltaContext(items, [false, false, true], keyOf, flags([], ['a']), 0, 1000);
    expect(out.items.map(keyOf)).toEqual(['b', 'a']);
    expect(out.contextKeys).toEqual(new Set(['b']));
  });
});

describe('sideFlagsTristate', () => {
  it('is off when nothing is visible or no row is on', () => {
    expect(sideFlagsTristate([])).toBe('none');
    expect(sideFlagsTristate([false, false])).toBe('none');
  });

  it('is on only when every visible row is on', () => {
    expect(sideFlagsTristate([true, true])).toBe('all');
  });

  it('is mixed when some visible rows are on', () => {
    expect(sideFlagsTristate([true, false])).toBe('some');
  });
});

describe('contextRailSigns', () => {
  const row = Date.parse('2024-01-01T10:00:30.000Z');

  it('shows ∨ when a selected parent is earlier and ∧ when one is later', () => {
    const earlier = Date.parse('2024-01-01T10:00:00.000Z');
    const later = Date.parse('2024-01-01T10:01:00.000Z');
    expect(contextRailSigns(row, [earlier])).toEqual({ before: false, after: true });
    expect(contextRailSigns(row, [later])).toEqual({ before: true, after: false });
    expect(contextRailSigns(row, [earlier, later])).toEqual({ before: true, after: true });
  });

  it('shows nothing without a selected parent', () => {
    expect(contextRailSigns(row, [])).toEqual({ before: false, after: false });
  });
});
