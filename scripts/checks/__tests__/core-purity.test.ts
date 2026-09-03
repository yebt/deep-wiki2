import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { checkCorePurity } from '../core-purity';

const FIXTURES_DIR = join(import.meta.dir, '..', '__fixtures__');

describe('checkCorePurity', () => {
  test('rejects a deliberate framework import and identifies file + import', () => {
    const result = checkCorePurity(join(FIXTURES_DIR, 'violating-core'));

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('hono'))).toBe(true);
    expect(result.errors.some((e) => e.includes('src/index.ts'))).toBe(true);
  });

  test('rejects a non-empty dependencies manifest even without a scanned import', () => {
    const result = checkCorePurity(join(FIXTURES_DIR, 'violating-core'));

    expect(result.errors.some((e) => /dependencies/i.test(e))).toBe(true);
  });

  test('passes a package with only relative imports and an empty manifest', () => {
    const result = checkCorePurity(join(FIXTURES_DIR, 'clean-core'));

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });
});
