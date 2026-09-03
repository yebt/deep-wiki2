import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { checkWorkspaceShape } from '../workspace-shape';

const FIXTURES_DIR = join(import.meta.dir, '..', '__fixtures__');

describe('checkWorkspaceShape', () => {
  test('fails when Vitest is declared in more than one workspace member', () => {
    const result = checkWorkspaceShape(join(FIXTURES_DIR, 'violating-workspace-shape'));

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('apps/a'))).toBe(true);
    expect(result.errors.some((e) => e.includes('apps/b'))).toBe(true);
  });

  test('passes when Vitest is confined to exactly one member and no banned tooling files exist', () => {
    const result = checkWorkspaceShape(join(FIXTURES_DIR, 'valid-workspace-shape'));

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('fails when a pnpm or Turborepo file is present at the workspace root', () => {
    const result = checkWorkspaceShape(join(FIXTURES_DIR, 'violating-tooling'));

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('turbo.json'))).toBe(true);
  });
});
