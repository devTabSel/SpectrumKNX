import { describe, expect, test } from 'vitest';
import {
  addKeys,
  removeKeys,
  soleKeys,
  splitLegacyMarkReasons,
  toggleKey,
} from './markReasons';

describe('row flag key lists', () => {
  test('add / remove / toggle keep the list stable when nothing changes', () => {
    const keys = ['a'];
    expect(addKeys(keys, ['a'])).toBe(keys);
    expect(addKeys(keys, ['b'])).toEqual(['a', 'b']);
    expect(removeKeys(keys, ['z'])).toBe(keys);
    expect(removeKeys(['a', 'b'], ['a'])).toEqual(['b']);
    expect(toggleKey(['a'], 'a')).toEqual([]);
    expect(toggleKey(['a'], 'b')).toEqual(['a', 'b']);
    expect(soleKeys(['b', 'b', 'a'])).toEqual(['b', 'a']);
  });

  test('splitLegacyMarkReasons keeps manual, mouse, and hidden', () => {
    expect(splitLegacyMarkReasons({
      a: ['manual', 'goto', 'auto', 'hidden'],
      b: ['mouse', 'context'],
      c: ['goto'],
    })).toEqual({
      markedKeys: ['a'],
      mouseSelectedKeys: ['b'],
      hiddenKeys: ['a'],
    });
  });
});
