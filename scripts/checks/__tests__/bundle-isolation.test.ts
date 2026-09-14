import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { checkBundleIsolation } from '../bundle-isolation';

const FIXTURES_DIR = join(import.meta.dir, '..', '__fixtures__', 'bundle-isolation');

// document-modes: An eager shared import fails the test. design.md "Read
// mode never reaches the ProseMirror bundle", layer 2.
describe('checkBundleIsolation', () => {
  test('passes a clean tree: the "." export reaches only prosemirror-model, and apps/web mounts the editor dynamically', () => {
    const result = checkBundleIsolation(join(FIXTURES_DIR, 'valid'));

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('fails when the "." export transitively reaches milkdown', () => {
    const result = checkBundleIsolation(join(FIXTURES_DIR, 'violating-milkdown-closure'));

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('milkdown') || e.includes('@milkdown/'))).toBe(true);
  });

  test('fails when the "." export transitively reaches a ProseMirror view/editing package', () => {
    const result = checkBundleIsolation(join(FIXTURES_DIR, 'violating-prosemirror-view'));

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('prosemirror-view'))).toBe(true);
  });

  test('does NOT fail on prosemirror-model — the schema and data model the "." export legitimately needs', () => {
    const result = checkBundleIsolation(join(FIXTURES_DIR, 'valid'));

    expect(result.errors.some((e) => e.includes('prosemirror-model'))).toBe(false);
  });

  test('fails when an apps/web file statically imports @deep-wiki/editor/mount', () => {
    const result = checkBundleIsolation(join(FIXTURES_DIR, 'violating-eager-mount-import'));

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('@deep-wiki/editor/mount'))).toBe(true);
  });

  test('a dynamic import() of @deep-wiki/editor/mount from apps/web is allowed', () => {
    const result = checkBundleIsolation(join(FIXTURES_DIR, 'valid'));

    expect(result.errors.some((e) => e.includes('@deep-wiki/editor/mount'))).toBe(false);
  });

  // node:crypto has no browser build; apps/web's edit route imports the
  // "." export directly in the browser (fromMarkdown/toMarkdown), so this
  // closure must never reach it either — the same class of problem as
  // Milkdown/ProseMirror-view, just a different forbidden dependency
  // (packages/markdown/src/pipeline.ts's own doc comment records the
  // real incident this generalises from).
  test('fails when the "." export transitively reaches node:crypto', () => {
    const result = checkBundleIsolation(join(FIXTURES_DIR, 'violating-node-crypto'));

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('node:crypto') || e.includes('crypto'))).toBe(true);
  });
});

// The closure must not stop at a workspace-package boundary. These four
// cover the ways a forbidden module reached the "." export while the walk
// only followed specifiers starting with ".".
describe('checkBundleIsolation — the closure crosses every edge it can resolve', () => {
  // The recorded regression, verbatim: packages/editor importing the
  // @deep-wiki/markdown BARREL instead of @deep-wiki/markdown/pipeline
  // transitively reaches node:crypto (packages/markdown/src/pipeline.ts's
  // own doc comment). A walk that stops at the workspace boundary calls
  // that clean.
  test('fails when the "." export reaches node:crypto THROUGH a @deep-wiki workspace package barrel', () => {
    const result = checkBundleIsolation(join(FIXTURES_DIR, 'violating-workspace-barrel-closure'));

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('node:crypto'))).toBe(true);
  });

  test('a forbidden import behind an extensionless relative edge resolving to .vue is still reached', () => {
    const result = checkBundleIsolation(join(FIXTURES_DIR, 'violating-hidden-vue-edge'));

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('prosemirror-view'))).toBe(true);
  });

  test('a forbidden import behind an extensionless relative edge resolving to .mts is still reached', () => {
    const result = checkBundleIsolation(join(FIXTURES_DIR, 'violating-hidden-mts-edge'));

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('@milkdown/core'))).toBe(true);
  });

  // A dropped edge is a hole, not a pass: an unresolvable relative
  // specifier must fail loudly rather than silently truncating the walk.
  test('an unresolvable relative specifier is a reported ERROR, never a silently dropped edge', () => {
    const result = checkBundleIsolation(join(FIXTURES_DIR, 'violating-unresolvable-relative'));

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('./ghost'))).toBe(true);
  });
});

describe('checkBundleIsolation — every static form of the mount import', () => {
  test('fails when an apps/web file statically RE-EXPORTS from @deep-wiki/editor/mount', () => {
    const result = checkBundleIsolation(join(FIXTURES_DIR, 'violating-eager-mount-reexport'));

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('@deep-wiki/editor/mount'))).toBe(true);
  });

  test('fails when an apps/web file has a bare side-effect import of @deep-wiki/editor/mount', () => {
    const result = checkBundleIsolation(join(FIXTURES_DIR, 'violating-eager-mount-side-effect'));

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('@deep-wiki/editor/mount'))).toBe(true);
  });
});
