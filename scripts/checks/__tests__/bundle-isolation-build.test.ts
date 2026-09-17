import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pageUrl } from '../../../apps/web/app/utils/routes';
import { checkBuildOutputIsolation, readRouteSource } from '../bundle-isolation-build';

const FIXTURES_DIR = join(import.meta.dir, '..', '__fixtures__', 'bundle-isolation-build');
const REAL_WEB_ROOT = join(import.meta.dir, '..', '..', '..', 'apps', 'web');

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

  test('fails loudly, naming the route, when the pages directory has the read route but the build has no entry for it', async () => {
    const result = await checkBuildOutputIsolation(join(FIXTURES_DIR, 'missing-route'));

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('pages/w/[workspace]/p/[id]/index.vue'))).toBe(true);
  });

  // The read route's source path was a string constant here, and the
  // routes batch (2026-09-17) moved the file from `pages/pages/[id]/` to
  // `pages/w/[workspace]/p/[id]/` without the constant following: the
  // check then failed as "no entry … has the read route moved?" against
  // every build. The path is now derived: `utils/routes.ts` says what a
  // page's address is, the pages directory says which file serves it.
  test('fails, naming the address, when no file under app/pages serves the page address routes.ts emits', async () => {
    const result = await checkBuildOutputIsolation(join(FIXTURES_DIR, 'stale-read-route'));

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes(pageUrl('<slug>', '<id>')) && e.includes('routes.ts'))).toBe(true);
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

describe('readRouteSource', () => {
  test('names the pages file whose Nuxt route serves pageUrl(), as the chunk graph keys it', () => {
    expect(readRouteSource(join(FIXTURES_DIR, 'clean', 'app', 'pages'))).toBe('pages/w/[workspace]/p/[id]/index.vue');
  });

  test('finds nothing in the pre-2026-09-17 layout, where no file serves /w/<slug>/p/<id>', () => {
    expect(readRouteSource(join(FIXTURES_DIR, 'stale-read-route', 'app', 'pages'))).toBeNull();
  });

  test('the real apps/web has exactly one file serving the page address, and it exists', () => {
    const source = readRouteSource(join(REAL_WEB_ROOT, 'app', 'pages'));

    expect(source).not.toBeNull();
    expect(existsSync(join(REAL_WEB_ROOT, 'app', source!))).toBe(true);
  });
});
