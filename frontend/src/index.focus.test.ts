import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.css'), 'utf8');

test('focus ring uses :has(input:focus) and not glass-input:focus-within', () => {
  expect(css).toMatch(/\.glass-input:has\(input:focus\)/);
  expect(css).not.toMatch(/\.glass-input:focus-within\s*,/);
  expect(css).not.toMatch(/\.glass-input:focus-within\s*\{/);
  expect(css).toMatch(/button:focus/);
  expect(css).toMatch(/\[role="button"\]:focus/);
  expect(css).toMatch(/box-shadow:\s*inset 0 0 0 1px var\(--focus-ring\)/);
  expect(css).not.toMatch(/box-shadow:\s*inset 0 0 0 2px var\(--focus-ring\)/);
});

test('root and placeholders follow the send-panel look; empty datetime is placeholder-styled', () => {
  expect(css).toMatch(/color-scheme:\s*var\(--native-scheme\)/);
  expect(css).toMatch(/input::placeholder/);
  expect(css).toMatch(/font-style:\s*italic/);
  expect(css).toMatch(/input\[type="datetime-local"\]\[value=""\]:not\(:focus\)/);
  expect(css).toMatch(/input\[type="datetime-local"\]:focus/);
  // Empty datetime must not use input opacity (would dim picker + focus ring).
  const emptyBlock = css.match(
    /input\[type="datetime-local"\]\[value=""\]:not\(:focus\)\s*\{[^}]+\}/,
  )?.[0] ?? '';
  expect(emptyBlock).toMatch(/color:\s*var\(--text-dim\)/);
  expect(emptyBlock).not.toMatch(/opacity:/);
});
