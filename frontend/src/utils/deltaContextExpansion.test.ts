import { describe, it, expect } from 'vitest';
import { expandWithDeltaContext, retainKeptRows } from './deltaContextExpansion';

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

  it('a flagged non-match anchors its own window and stays a context row', () => {
    const items = [
      item('a', '2024-01-01T10:00:00.000Z'), // flagged, doesn't match
      item('b', '2024-01-01T10:00:00.500Z'), // near the flagged item
      item('c', '2024-01-01T10:00:10.000Z'), // far from everything
    ];
    const out = expandWithDeltaContext(items, [false, false, false], keyOf, new Set(['a']), 0, 1000);
    expect(out.items.map(keyOf)).toEqual(['a', 'b']);
    expect(out.contextKeys).toEqual(new Set(['a', 'b']));
  });

  it('flagging a context row keeps it context and extends the window past the original anchor', () => {
    const items = [
      item('match', '2024-01-01T10:00:00.000Z'),
      item('context', '2024-01-01T10:00:00.400Z'), // inside the match window
      item('further', '2024-01-01T10:00:01.200Z'), // outside the match window, inside the context row's
      item('far', '2024-01-01T10:00:05.000Z'),
    ];
    const matches = [true, false, false, false];
    const before = expandWithDeltaContext(items, matches, keyOf, new Set(), 0, 1000);
    expect(before.items.map(keyOf)).toEqual(['match', 'context']);
    expect(before.contextKeys).toEqual(new Set(['context']));

    const flagged = expandWithDeltaContext(items, matches, keyOf, new Set(['context']), 0, 1000);
    expect(flagged.items.map(keyOf)).toEqual(['match', 'context', 'further']);
    expect(flagged.contextKeys).toEqual(new Set(['context', 'further']));
  });

  it('a flag does not keep a non-match when no window is set', () => {
    const items = [item('a', '2024-01-01T10:00:00Z'), item('b', '2024-01-01T10:00:01Z')];
    const out = expandWithDeltaContext(items, [false, true], keyOf, new Set(['a']), 0, 0);
    expect(out.items.map(keyOf)).toEqual(['b']);
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

  it('keeping a context row visible does not take it out of the context set or turn it into an anchor', () => {
    const items = [
      item('match', '2024-01-01T10:00:00.000Z'),
      item('context', '2024-01-01T10:00:00.500Z'),
      item('outside', '2024-01-01T10:00:05.000Z'),
    ];
    const expanded = expandWithDeltaContext(items, [true, false, false], keyOf, new Set(), 0, 1000);
    const kept = retainKeptRows(items, expanded, keyOf, new Set(['context', 'outside']), () => true);
    expect(kept.items.map(keyOf)).toEqual(['match', 'context', 'outside']);
    expect(kept.contextKeys).toEqual(new Set(['context']));
  });

  it('a kept row the panel filter rejects stays out', () => {
    const items = [item('kept', '2024-01-01T10:00:05.000Z')];
    const expanded = expandWithDeltaContext(items, [false], keyOf, new Set(), 0, 1000);
    const kept = retainKeptRows(items, expanded, keyOf, new Set(['kept']), () => false);
    expect(kept.items).toEqual([]);
  });
});
