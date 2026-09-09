import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { checkBuildOutputIsolation } from '../bundle-isolation-build';

const FIXTURES_DIR = join(import.meta.dir, '..', '__fixtures__', 'bundle-isolation-build');

// document-modes: ProseMirror Bundle Isolation Is Verified By Build
// Output, both scenarios (design.md "Read mode never reaches the
// ProseMirror bundle", layer 3).
describe('checkBuildOutputIsolation', () => {
  test('passes when the read route reaches an editor chunk only through dynamicImports', async () => {
    const result = await checkBuildOutputIsolation(join(FIXTURES_DIR, 'clean'));

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('fails when the read route STATICALLY reaches a ProseMirror module', async () => {
    const result = await checkBuildOutputIsolation(join(FIXTURES_DIR, 'violating-static-import'));

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('prosemirror-model'))).toBe(true);
  });

  test('fails loudly, naming the missing route, when the build has no entry for the expected read route', async () => {
    const result = await checkBuildOutputIsolation(join(FIXTURES_DIR, 'missing-route'));

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('pages/pages/[id]/index.vue'))).toBe(true);
  });

  test('skips gracefully — not a failure — when no build output exists yet', async () => {
    const result = await checkBuildOutputIsolation(join(FIXTURES_DIR, 'does-not-exist'));

    expect(result.ok).toBe(true);
    expect(result.skipped).toBeDefined();
  });
});
