import { expect, test } from 'vitest';
import { DEFAULT_FILTERS } from '../types/filters';
import { capContextWindow, filtersWithQfContext } from './contextWindow';

const sp = { before: 500, after: 250 };

test('a quick-filter context bound is cut down to the side-panel window on input', () => {
  expect(capContextWindow({ before: 800, after: 250 }, sp)).toEqual({ before: 500, after: 250 });
  expect(capContextWindow({ before: 500, after: 900 }, sp)).toEqual({ before: 500, after: 250 });
  expect(capContextWindow({ before: 100, after: 40 }, sp)).toEqual({ before: 100, after: 40 });
});

test('a smaller applied side-panel window caps an existing quick-filter bound', () => {
  const qf = { before: 400, after: 200 };
  expect(capContextWindow(qf, { before: 150, after: 200 })).toEqual({ before: 150, after: 200 });
  expect(capContextWindow(qf, { before: 400, after: 50 })).toEqual({ before: 400, after: 50 });
  // Growing the side panel does not raise a bound the user already set.
  expect(capContextWindow(qf, { before: 900, after: 900 })).toEqual(qf);
});

test('filtersWithQfContext follows the side panel until a quick-filter bound is set', () => {
  const applied = { ...DEFAULT_FILTERS, deltaBeforeMs: 500, deltaAfterMs: 250 };
  expect(filtersWithQfContext(applied, null)).toBe(applied);
  const narrowed = filtersWithQfContext(applied, { before: 1000, after: 10 });
  expect(narrowed.deltaBeforeMs).toBe(500);
  expect(narrowed.deltaAfterMs).toBe(10);
  expect(narrowed.sources).toBe(applied.sources);
});
