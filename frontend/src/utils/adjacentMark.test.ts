import { expect, test } from 'vitest';
import { adjacentMark } from './adjacentMark';

const marks = [2, 9, 30];

test('next goes to the nearest mark after the current row', () => {
  expect(adjacentMark(marks, 0, 1)).toBe(2);
  expect(adjacentMark(marks, 2, 1)).toBe(9);
  expect(adjacentMark(marks, 10, 1)).toBe(30);
});

test('previous goes to the nearest mark before the current row', () => {
  expect(adjacentMark(marks, 30, -1)).toBe(9);
  expect(adjacentMark(marks, 9, -1)).toBe(2);
  expect(adjacentMark(marks, 5, -1)).toBe(2);
});

test('both directions return null at the ends (no wrap)', () => {
  expect(adjacentMark(marks, 30, 1)).toBeNull();
  expect(adjacentMark(marks, 35, 1)).toBeNull();
  expect(adjacentMark(marks, 2, -1)).toBeNull();
  expect(adjacentMark(marks, 0, -1)).toBeNull();
});

test('a single mark is only reachable from outside itself', () => {
  expect(adjacentMark([7], 3, 1)).toBe(7);
  expect(adjacentMark([7], 10, -1)).toBe(7);
  expect(adjacentMark([7], 7, 1)).toBeNull();
  expect(adjacentMark([7], 7, -1)).toBeNull();
});
