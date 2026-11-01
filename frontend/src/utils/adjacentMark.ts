/**
 * Index of the marked row to jump to from row `from` (#442): the nearest one
 * after it (`dir` 1, further down) or before it (`dir` -1, further up).
 * No wrap: null when that direction has no further mark.
 * `markedIndices` must be ascending.
 */
export function adjacentMark(markedIndices: number[], from: number, dir: 1 | -1): number | null {
  const target = dir === 1
    ? markedIndices.find(i => i > from)
    : markedIndices.findLast(i => i < from);
  return target === undefined ? null : target;
}
