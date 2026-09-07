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
});
