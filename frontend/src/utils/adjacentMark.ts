/**
 * Index of the marked row to jump to from row `from` (#442): the nearest one
 * after it (`dir` 1) or before it (`dir` -1). No wrap — `null` when none.
 * `markedIndices` must be ascending.
 */
export function adjacentMark(markedIndices: number[], from: number, dir: 1 | -1): number | null {
  if (markedIndices.length === 0) return null;
  return dir === 1
    ? markedIndices.find(i => i > from) ?? null
    : markedIndices.findLast(i => i < from) ?? null;
}
