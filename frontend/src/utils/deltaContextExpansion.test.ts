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

  it('a flagged non-match keeps its member list and stays hidden until it is visible', () => {
    const items = [
      item('a', '2024-01-01T10:00:00.000Z'), // flagged, doesn't match
      item('b', '2024-01-01T10:00:00.500Z'), // near the flagged item
      item('c', '2024-01-01T10:00:10.000Z'), // far from everything
    ];
    const out = expandWithDeltaContext(items, [false, false, false], keyOf, new Set(['a']), 0, 1000);
    expect(out.items).toEqual([]);
    expect(out.contextKeys).toEqual(new Set());
    expect(out.contextMembers.get('a')).toEqual(['b']);
    expect(out.contextParents.get('b')).toEqual(['a']);

    const pinned = expandWithDeltaContext(
      items, [false, false, false], keyOf, new Set(['a']), 0, 1000, true,
      { pinnedKeys: new Set(['a']) },
    );
    expect(pinned.items.map(keyOf)).toEqual(['a', 'b']);
    expect(pinned.contextKeys).toEqual(new Set(['b']));
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

  it('a flagged non-match is hidden when the window is closed (before=after=0)', () => {
    const items = [item('a', '2024-01-01T10:00:00Z'), item('b', '2024-01-01T10:00:01Z')];
    const out = expandWithDeltaContext(items, [false, false], keyOf, new Set(['a']), 0, 0);
    expect(out.items).toEqual([]);
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

  it('uses an individual window in seconds instead of the quick-filter window', () => {
    const items = [
      item('a', '2024-01-01T10:00:00.000Z'),
      item('b', '2024-01-01T10:00:01.500Z'),
    ];
    const qf = expandWithDeltaContext(items, [true, false], keyOf, new Set(), 1000, 1000);
    expect(qf.items.map(keyOf)).toEqual(['a']);

    const individual = expandWithDeltaContext(items, [true, false], keyOf, new Set(), 1000, 1000, true, {
      individualWindows: { a: { beforeMs: 0, afterMs: 2000 } },
    });
    expect(individual.items.map(keyOf)).toEqual(['a', 'b']);
    expect(individual.contextMembers.get('a')).toEqual(['b']);
    expect(individual.contextParents.get('b')).toEqual(['a']);
  });

  it('an off individual window leaves the quick-filter window in effect', () => {
    const items = [
      item('a', '2024-01-01T10:00:00.000Z'),
      item('b', '2024-01-01T10:00:00.500Z'),
    ];
    const zero = expandWithDeltaContext(items, [true, false], keyOf, new Set(), 5000, 5000, true, {
      individualWindows: { a: { beforeMs: 0, afterMs: 0, enabled: true } },
    });
    expect(zero.items.map(keyOf)).toEqual(['a', 'b']);

    const switchedOff = expandWithDeltaContext(items, [true, false], keyOf, new Set(), 0, 0, true, {
      individualWindows: { a: { beforeMs: 0, afterMs: 2000, enabled: false } },
    });
    expect(switchedOff.items.map(keyOf)).toEqual(['a']);
  });

  it('ignores individual windows while Time-Delta-Context is globally off', () => {
    const items = [
      item('a', '2024-01-01T10:00:00.000Z'),
      item('b', '2024-01-01T10:00:00.500Z'),
    ];
    const out = expandWithDeltaContext(items, [true, false], keyOf, new Set(['a']), 5000, 5000, true, {
      contextEnabled: false,
      individualWindows: { a: { beforeMs: 10_000, afterMs: 10_000 } },
    });
    expect(out.items.map(keyOf)).toEqual(['a']);
    expect(out.contextMembers.size).toBe(0);
    expect(out.contextParents.size).toBe(0);
  });

  it('an inactive button has an empty member list and hides its hierarchy', () => {
    const items = [
      item('a', '2024-01-01T10:00:00.000Z'),
      item('b', '2024-01-01T10:00:00.500Z'),
      item('c', '2024-01-01T10:00:01.000Z'),
    ];
    const on = expandWithDeltaContext(items, [true, false, false], keyOf, new Set(['b']), 0, 600, true, {
      individualWindows: { b: { beforeMs: 0, afterMs: 1000 } },
    });
    expect(on.items.map(keyOf)).toEqual(['a', 'b', 'c']);
    expect(on.contextMembers.get('b')).toEqual(['c']);
    expect(on.contextParents.get('c')).toEqual(['b']);

    const off = expandWithDeltaContext(items, [true, false, false], keyOf, new Set(['b']), 0, 0, false, {
      individualWindows: { b: { beforeMs: 0, afterMs: 1000 } },
    });
    expect(off.items.map(keyOf)).toEqual(['a']);
    expect(off.contextMembers.has('a')).toBe(false);
    expect(off.contextMembers.get('b')).toEqual(['c']);
    expect(off.contextKeys).toEqual(new Set());
  });

  it('covers rows inside an anchor window when the list is not time-sorted', () => {
    const items = [
      item('c', '2024-01-01T10:00:05.000Z'), // far
      item('b', '2024-01-01T10:00:00.500Z'), // +500ms of a
      item('a', '2024-01-01T10:00:00.000Z'), // match
    ];
    const out = expandWithDeltaContext(items, [false, false, true], keyOf, new Set(), 0, 1000);
    expect(out.items.map(keyOf)).toEqual(['b', 'a']);
    expect(out.contextKeys).toEqual(new Set(['b']));
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
