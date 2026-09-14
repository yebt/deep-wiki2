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

// Four evasions that passed at once. Each is a way to run a second Vitest,
// or to bring a second package manager into the repository, that the
// original rules could not see.
describe('checkWorkspaceShape — Vitest declared somewhere other than dependencies/devDependencies', () => {
  test('counts a member that declares vitest under peerDependencies', () => {
    const result = checkWorkspaceShape(join(FIXTURES_DIR, 'workspace-shape-peer-vitest'));

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('apps/a'))).toBe(true);
    expect(result.errors.some((e) => e.includes('apps/b'))).toBe(true);
  });
});

describe('checkWorkspaceShape — Vitest reached without declaring it', () => {
  // Bun hoists the root/other member's copy, so a member shipping a
  // vitest.config.ts runs Vitest whether or not its manifest says so.
  test('counts a member that ships a vitest.config.ts with no vitest dependency', () => {
    const result = checkWorkspaceShape(join(FIXTURES_DIR, 'workspace-shape-config-vitest'));

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('apps/a'))).toBe(true);
    expect(result.errors.some((e) => e.includes('apps/b'))).toBe(true);
  });
});

describe('checkWorkspaceShape — foreign package managers', () => {
  test('fails on a pnpm lockfile inside a workspace member, not only at the root', () => {
    const result = checkWorkspaceShape(join(FIXTURES_DIR, 'workspace-shape-member-lockfile'));

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('apps/web') && e.includes('pnpm-lock.yaml'))).toBe(true);
  });

  test('fails on an npm or yarn lockfile ("Never pnpm. Never npm.")', () => {
    const result = checkWorkspaceShape(join(FIXTURES_DIR, 'workspace-shape-alien-lockfiles'));

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('package-lock.json'))).toBe(true);
    expect(result.errors.some((e) => e.includes('yarn.lock'))).toBe(true);
  });
});
