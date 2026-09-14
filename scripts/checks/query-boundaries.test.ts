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

  // A response schema is written in the contracts layer's camelCase, not the
  // database's snake_case. Both spellings name the same secret.
  test('fails when a zod response schema declares a denylisted field in camelCase', () => {
    const result = checkQueryBoundaries(join(FIXTURES_DIR, 'violating-secret-response-schema-camelcase'));

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('user.ts') && e.includes('passwordHash'))).toBe(true);
    expect(result.errors.some((e) => e.includes('user.ts') && e.includes('sessionToken'))).toBe(true);
    expect(result.errors.some((e) => e.includes('user.ts') && e.includes('resetToken'))).toBe(true);
  });

  // The same query, expressed through Drizzle's builder instead of SQL text.
  test('fails when the permissions table is read through a Drizzle builder call', () => {
    const result = checkQueryBoundaries(join(FIXTURES_DIR, 'violating-permissions-drizzle'));

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('leaky-drizzle.ts') && e.includes('permissions'))).toBe(true);
  });

  test('fails when a path LIKE predicate is expressed as a Drizzle ilike() call', () => {
    const result = checkQueryBoundaries(join(FIXTURES_DIR, 'violating-path-like-drizzle'));

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('leaky-subtree-drizzle.ts') && e.includes('LIKE'))).toBe(true);
  });

  test('fails when links or page_tags are written through a Drizzle builder call', () => {
    const result = checkQueryBoundaries(join(FIXTURES_DIR, 'violating-links-write-drizzle'));

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('leaky-links-drizzle.ts') && e.includes('links'))).toBe(true);
  });

  test('fails when a leading wildcard is assembled by concatenation', () => {
    const result = checkQueryBoundaries(join(FIXTURES_DIR, 'violating-leading-wildcard-concat'));

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('search.ts') && e.includes('leading wildcard'))).toBe(true);
  });

  test('fails when a leading wildcard is built in a template literal', () => {
    const result = checkQueryBoundaries(join(FIXTURES_DIR, 'violating-leading-wildcard-template'));

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('search.ts') && e.includes('leading wildcard'))).toBe(true);
  });
});
