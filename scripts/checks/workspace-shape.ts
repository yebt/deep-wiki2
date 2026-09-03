/**
 * Structural check: the workspace stays on Bun workspaces + `bun run -F`
 * exclusively (no pnpm, no Turborepo), and Vitest is confined to exactly
 * one workspace member (see design.md — Vue SFC / Nuxt component tests
 * require Vitest + `@nuxt/test-utils`; every other member uses `bun test`).
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export interface WorkspaceShapeResult {
  ok: boolean;
  errors: string[];
}

const BANNED_ROOT_FILES = ['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'turbo.json'];
const MEMBER_GROUPS = ['apps', 'packages'];

export function findMemberDirs(root: string): string[] {
  const members: string[] = [];

  for (const group of MEMBER_GROUPS) {
    const groupDir = join(root, group);
    if (!existsSync(groupDir) || !statSync(groupDir).isDirectory()) continue;

    for (const entry of readdirSync(groupDir)) {
      const memberDir = join(groupDir, entry);
      if (statSync(memberDir).isDirectory() && existsSync(join(memberDir, 'package.json'))) {
        members.push(memberDir);
      }
    }
  }

  return members;
}

function memberDeclaresVitest(memberDir: string): boolean {
  const pkg = JSON.parse(readFileSync(join(memberDir, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  return Object.prototype.hasOwnProperty.call(deps, 'vitest');
}

export function checkWorkspaceShape(root: string): WorkspaceShapeResult {
  const errors: string[] = [];

  for (const banned of BANNED_ROOT_FILES) {
    if (existsSync(join(root, banned))) {
      errors.push(
        `Forbidden build-tool file present at workspace root: ${banned} (this workspace uses Bun + "bun run -F" only)`,
      );
    }
  }

  const members = findMemberDirs(root);
  const vitestMembers = members.filter(memberDeclaresVitest).map((m) => relative(root, m));

  if (vitestMembers.length > 1) {
    errors.push(
      `Vitest must be confined to exactly one workspace member; found it declared in: ${vitestMembers.join(', ')}`,
    );
  }

  return { ok: errors.length === 0, errors };
}

if (import.meta.main) {
  const result = checkWorkspaceShape(process.cwd());
  if (!result.ok) {
    for (const err of result.errors) {
      console.error(`workspace-shape: ${err}`);
    }
    process.exit(1);
  }
  console.log('workspace-shape: ok');
}
