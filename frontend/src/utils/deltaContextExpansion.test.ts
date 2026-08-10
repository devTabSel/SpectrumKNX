import { describe, it, expect } from 'vitest';
import { expandWithDeltaContext } from './deltaContextExpansion';

interface Item {
  key: string;
  timestamp: string;
}

const item = (key: string, isoTime: string): Item => ({ key, timestamp: isoTime });
const keyOf = (i: Item) => i.key;

describe('expandWithDeltaContext', () => {
  it('with no window, returns only the matching items and no context reasons', () => {
    const items = [item('a', '2024-01-01T10:00:00Z'), item('b', '2024-01-01T10:00:01Z')];
    const out = expandWithDeltaContext(items, [true, false], keyOf, new Set(), 0, 0);
    expect(out.items.map(keyOf)).toEqual(['a']);
    expect(out.contextReasons).toEqual(new Map());
  });

  it('does not pull in context rows around a plain filter match without a message-context flag', () => {
    const items = [
      item('a', '2024-01-01T10:00:00.000Z'),
      item('b', '2024-01-01T10:00:00.500Z'), // +500ms of a, not matching
      item('c', '2024-01-01T10:00:05.000Z'), // +5s of a, outside window
    ];
    const out = expandWithDeltaContext(items, [true, false, false], keyOf, new Set(), 0, 1000);
    expect(out.items.map(keyOf)).toEqual(['a']);
    expect(out.contextReasons).toEqual(new Map());
  });

  it('a flagged item that is not in the matched list does not anchor context', () => {
    const items = [
      item('a', '2024-01-01T10:00:00.000Z'), // flagged, doesn't match
      item('b', '2024-01-01T10:00:00.500Z'), // near the flagged item
      item('c', '2024-01-01T10:00:10.000Z'), // far from everything
    ];
    const out = expandWithDeltaContext(items, [false, false, false], keyOf, new Set(['a']), 0, 1000);
    expect(out.items.map(keyOf)).toEqual([]);
    expect(out.contextReasons).toEqual(new Map());
  });

  it('a context message can have its own flag and still remain context when another in-list flagged message pulls it in', () => {
    const items = [
      item('a', '2024-01-01T10:00:00.000Z'),
      item('b', '2024-01-01T10:00:00.500Z'),
      item('c', '2024-01-01T10:00:10.000Z'),
    ];
    const out = expandWithDeltaContext(items, [true, false, false], keyOf, new Set(['a', 'b']), 1000, 1000);
    expect(out.items.map(keyOf)).toEqual(['a', 'b']);
    expect(out.contextReasons).toEqual(new Map([['b', 'delta']]));
  });

  it('a flagged item not in the matched list is not shown with no window (before=after=0)', () => {
    const items = [item('a', '2024-01-01T10:00:00Z'), item('b', '2024-01-01T10:00:01Z')];
    const out = expandWithDeltaContext(items, [false, false], keyOf, new Set(['a']), 0, 0);
    expect(out.items.map(keyOf)).toEqual([]);
    expect(out.contextReasons).toEqual(new Map());
  });

  it('returns nothing when there are no matches and no flags', () => {
    const items = [item('a', '2024-01-01T10:00:00Z')];
    const out = expandWithDeltaContext(items, [false], keyOf, new Set(), 100, 100);
    expect(out.items).toEqual([]);
    expect(out.contextReasons).toEqual(new Map());
  });

  it('respects asymmetric before/after windows', () => {
    const items = [
      item('before', '2024-01-01T09:59:59.500Z'), // -500ms
      item('anchor', '2024-01-01T10:00:00.000Z'),
      item('after', '2024-01-01T10:00:00.500Z'), // +500ms
    ];
    const onlyAfter = expandWithDeltaContext(items, [false, true, false], keyOf, new Set(), 0, 1000);
    expect(onlyAfter.items.map(keyOf)).toEqual(['anchor']);
    expect(onlyAfter.contextReasons).toEqual(new Map());

    const onlyBefore = expandWithDeltaContext(items, [false, true, false], keyOf, new Set(), 1000, 0);
    expect(onlyBefore.items.map(keyOf)).toEqual(['anchor']);
    expect(onlyBefore.contextReasons).toEqual(new Map());
  });

  it('keeps normal matches visible even when no message-context flag anchors a window', () => {
    const items = [
      item('a', '2024-01-01T10:00:00.000Z'),
      item('b', '2024-01-01T10:00:00.500Z'),
    ];
    const out = expandWithDeltaContext(items, [false, true], keyOf, new Set(), 1000, 1000);
    expect(out.items.map(keyOf)).toEqual(['b']);
    expect(out.contextReasons).toEqual(new Map());
  });

  it('a marked item is always kept, tagged with reason "marked", even with no window and no flags (#380)', () => {
    const items = [
      item('a', '2024-01-01T10:00:00.000Z'),
      item('b', '2024-01-01T10:00:10.000Z'),
    ];
    const out = expandWithDeltaContext(items, [true, false], keyOf, new Set(), 0, 0, new Map([['b', 'marked']]));
    expect(out.items.map(keyOf)).toEqual(['a', 'b']);
    expect(out.contextReasons).toEqual(new Map([['b', 'marked']]));
  });

  it('a marked item wins the "marked" reason over an overlapping delta-context window (#380)', () => {
    const items = [
      item('anchor', '2024-01-01T10:00:00.000Z'),
      item('both', '2024-01-01T10:00:00.500Z'), // within window AND marked
    ];
    const out = expandWithDeltaContext(items, [true, false], keyOf, new Set(['anchor']), 1000, 1000, new Map([['both', 'marked']]));
    expect(out.items.map(keyOf)).toEqual(['anchor', 'both']);
    expect(out.contextReasons).toEqual(new Map([['both', 'marked']]));
  });

  it('marked forcing is independent of the delta-context flags/window state', () => {
    const items = [
      item('a', '2024-01-01T10:00:00.000Z'),
      item('marked-only', '2024-01-01T12:00:00.000Z'), // far away, no window active
    ];
    const out = expandWithDeltaContext(items, [true, false], keyOf, new Set(), 0, 0, new Map([['marked-only', 'marked']]));
    expect(out.items.map(keyOf)).toEqual(['a', 'marked-only']);
    expect(out.contextReasons).toEqual(new Map([['marked-only', 'marked']]));
  });

  it('a flagged row kept by non-delta context (marked) also anchors delta-context expansion', () => {
    const items = [
      item('marked-anchor', '2024-01-01T10:00:00.000Z'),
      item('nearby', '2024-01-01T10:00:00.500Z'),
      item('far', '2024-01-01T10:00:10.000Z'),
    ];
    const out = expandWithDeltaContext(
      items,
      [false, false, false],
      keyOf,
      new Set(['marked-anchor']),
      1000,
      1000,
      new Map([['marked-anchor', 'marked']]),
    );
    expect(out.items.map(keyOf)).toEqual(['marked-anchor', 'nearby']);
    expect(out.contextReasons).toEqual(new Map([
      ['marked-anchor', 'marked'],
      ['nearby', 'delta'],
    ]));
  });

  it('a visualization-forced row stays visible with its own reason and can anchor delta-context expansion', () => {
    const items = [
      item('viz-anchor', '2024-01-01T10:00:00.000Z'),
      item('nearby', '2024-01-01T10:00:00.400Z'),
      item('far', '2024-01-01T10:00:10.000Z'),
    ];
    const out = expandWithDeltaContext(
      items,
      [false, false, false],
      keyOf,
      new Set(['viz-anchor']),
      1000,
      1000,
      new Map([['viz-anchor', 'visualization']]),
    );
    expect(out.items.map(keyOf)).toEqual(['viz-anchor', 'nearby']);
    expect(out.contextReasons).toEqual(new Map([
      ['viz-anchor', 'visualization'],
      ['nearby', 'delta'],
    ]));
  });

  it('a visualization-forced row keeps its reason even when it also matches the active filters', () => {
    const items = [
      item('viz-match', '2024-01-01T10:00:00.000Z'),
      item('other', '2024-01-01T10:00:01.000Z'),
    ];
    const out = expandWithDeltaContext(
      items,
      [true, true],
      keyOf,
      new Set(),
      0,
      0,
      new Map([['viz-match', 'visualization']]),
    );
    expect(out.items.map(keyOf)).toEqual(['viz-match', 'other']);
    expect(out.contextReasons).toEqual(new Map([['viz-match', 'visualization']]));
  });
});
