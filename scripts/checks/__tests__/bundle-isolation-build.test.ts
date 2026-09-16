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

  // Bundle hygiene (docs/TODO.md, 2026-09-16): the server env schema —
  // every server-side variable's name, `AI_KEK_*` included — shipped in
  // every page's client bundle through the contracts barrel. Its names in
  // a client chunk are the fingerprint of that leak.
  test('fails when any client chunk carries the server env schema (an AI_KEK variable name)', async () => {
    const result = await checkBuildOutputIsolation(join(FIXTURES_DIR, 'violating-server-env'));

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('contracts.def456.js') && e.includes('AI_KEK'))).toBe(true);
  });

  test('a clean build with client chunks that name only public config passes the server-env scan', async () => {
    const result = await checkBuildOutputIsolation(join(FIXTURES_DIR, 'clean'));

    expect(result.ok).toBe(true);
    expect(result.scannedClientChunks).toBe(1);
  });
});
