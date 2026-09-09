import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { checkQueryBoundaries } from './query-boundaries';

const FIXTURES_DIR = join(import.meta.dir, '__fixtures__', 'query-boundaries');

describe('checkQueryBoundaries', () => {
  test('passes for a fixture that respects every boundary', () => {
    const result = checkQueryBoundaries(join(FIXTURES_DIR, 'valid'));

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('fails when a file outside packages/db/src/permissions/ references the permissions table', () => {
    const result = checkQueryBoundaries(join(FIXTURES_DIR, 'violating-permissions-path'));

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('leaky.ts') && e.includes('permissions'))).toBe(true);
  });

  test('fails when a path LIKE predicate appears outside packages/db/src/nodes/subtree.ts', () => {
    const result = checkQueryBoundaries(join(FIXTURES_DIR, 'violating-path-like'));

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('leaky-subtree.ts') && e.includes('LIKE'))).toBe(true);
  });

  test('fails when a pattern literal starts with a leading wildcard (%)', () => {
    const result = checkQueryBoundaries(join(FIXTURES_DIR, 'violating-leading-wildcard'));

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('subtree.ts') && e.includes('leading wildcard'))).toBe(true);
  });

  test('fails when lower(path) or upper(path) appears anywhere, even inside subtree.ts', () => {
    const result = checkQueryBoundaries(join(FIXTURES_DIR, 'violating-lower-upper'));

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('subtree.ts') && e.toLowerCase().includes('lower(path)'))).toBe(true);
  });

  test('fails when a zod response schema in packages/contracts declares a denylisted field', () => {
    const result = checkQueryBoundaries(join(FIXTURES_DIR, 'violating-secret-response-schema'));

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('user.ts') && e.includes('password_hash'))).toBe(true);
  });

  // knowledge-graph: Links Are Never User-Editable Directly.
  test('fails when a file outside packages/db/src/content/ writes to links or page_tags', () => {
    const result = checkQueryBoundaries(join(FIXTURES_DIR, 'violating-links-write-boundary'));

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('leaky-links.ts') && e.includes('links'))).toBe(true);
  });
});
