import { beforeEach, expect, test } from 'vitest';
import { getPref, setPref } from './prefs';
import {
  DPT_TREE_EXPANDED_PREF,
  displayedTreeNode,
  readSectionOpen,
  readTreeExpand,
  sectionOpenPrefKey,
  toggleTreeNode,
  writeSectionOpen,
  writeTreeExpand,
} from './filterPanelExpandPref';

beforeEach(() => {
  localStorage.clear();
});

test('a missing section preference uses the caller default', () => {
  expect(readSectionOpen('direction', true)).toBe(true);
  expect(readSectionOpen('dpt', false)).toBe(false);
});

test('section open state round-trips and ignores anything that is not 0 or 1', () => {
  writeSectionOpen('direction', false);
  expect(getPref(sectionOpenPrefKey('direction'))).toBe('0');
  expect(readSectionOpen('direction', true)).toBe(false);

  writeSectionOpen('direction', true);
  expect(readSectionOpen('direction', false)).toBe(true);

  setPref(sectionOpenPrefKey('direction'), 'yes');
  expect(readSectionOpen('direction', true)).toBe(true);
  setPref(sectionOpenPrefKey('dpt'), '{"open":false}');
  expect(readSectionOpen('dpt', false)).toBe(false);
});

test('a missing or broken tree preference is ignored', () => {
  expect(readTreeExpand(DPT_TREE_EXPANDED_PREF)).toBeNull();

  setPref(DPT_TREE_EXPANDED_PREF, '');
  expect(readTreeExpand(DPT_TREE_EXPANDED_PREF)).toBeNull();

  setPref(DPT_TREE_EXPANDED_PREF, 'not json');
  expect(readTreeExpand(DPT_TREE_EXPANDED_PREF)).toBeNull();

  setPref(DPT_TREE_EXPANDED_PREF, JSON.stringify({ expanded: [1], collapsed: [] }));
  expect(readTreeExpand(DPT_TREE_EXPANDED_PREF)).toBeNull();

  setPref(DPT_TREE_EXPANDED_PREF, JSON.stringify({ expanded: ['1'] }));
  expect(readTreeExpand(DPT_TREE_EXPANDED_PREF)).toBeNull();

  setPref(DPT_TREE_EXPANDED_PREF, 'null');
  expect(readTreeExpand(DPT_TREE_EXPANDED_PREF)).toBeNull();
});

test('a tree preference stores expanded and collapsed node ids', () => {
  writeTreeExpand(DPT_TREE_EXPANDED_PREF, {
    expanded: new Set(['9', '1']),
    collapsed: new Set(['5']),
  });
  const read = readTreeExpand(DPT_TREE_EXPANDED_PREF);
  expect(read?.expanded).toEqual(new Set(['1', '9']));
  expect(read?.collapsed).toEqual(new Set(['5']));

  // A bare array is just the expanded set, so older values still apply.
  setPref(DPT_TREE_EXPANDED_PREF, JSON.stringify(['1/1', '2']));
  const bare = readTreeExpand(DPT_TREE_EXPANDED_PREF);
  expect(bare?.expanded).toEqual(new Set(['1/1', '2']));
  expect(bare?.collapsed.size).toBe(0);
});

test('an id listed as both expanded and collapsed is dropped', () => {
  setPref(DPT_TREE_EXPANDED_PREF, JSON.stringify({
    expanded: ['1', '9'],
    collapsed: ['1'],
  }));
  const read = readTreeExpand(DPT_TREE_EXPANDED_PREF);
  expect(read?.expanded.has('1')).toBe(false);
  expect(read?.collapsed.has('1')).toBe(false);
  expect(read?.expanded.has('9')).toBe(true);
});

test('manual toggles record a departure from the default and ignore search-only opens', () => {
  const opened = toggleTreeNode(null, '1/1', false, false, false);
  expect(opened.expanded).toEqual(new Set(['1/1']));
  expect(opened.collapsed.size).toBe(0);

  const closed = toggleTreeNode(null, '1', true, true, false);
  expect(closed.collapsed).toEqual(new Set(['1']));
  expect(closed.expanded.size).toBe(0);

  // Search had the node open; dismissing that must stick, or the next search reopens it.
  const dismissed = toggleTreeNode(null, '9', false, true, true);
  expect(dismissed.collapsed).toEqual(new Set(['9']));
  expect(displayedTreeNode(dismissed, '9', false, true)).toBe(false);

  // Closing back onto the default removes the override.
  const restored = toggleTreeNode(opened, '1/1', false, true, false);
  expect(restored.expanded.size).toBe(0);
  expect(restored.collapsed.size).toBe(0);
  expect(displayedTreeNode(null, '1', true, false)).toBe(true);
  expect(displayedTreeNode(null, '1/1', false, true)).toBe(true);
});
