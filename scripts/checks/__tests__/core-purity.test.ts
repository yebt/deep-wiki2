import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { checkManifest, checkCorePurity } from '../core-purity';

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

// scanImports() elides type-only imports (measured), so an `import type` from a
// framework is invisible to the AST scan. If that framework were declared only
// under devDependencies, nothing checked it either. Both holes had to be open at
// once, and both were.
describe('declared dependencies of every kind', () => {
  test('devDependencies count as a dependency for packages/core', () => {
    const result = checkManifest({ devDependencies: { vue: '^3' } });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('vue');
  });

  test('peerDependencies count too', () => {
    expect(checkManifest({ peerDependencies: { hono: '^4' } }).ok).toBe(false);
  });

  test('a manifest declaring nothing passes', () => {
    expect(checkManifest({}).ok).toBe(true);
  });
});
