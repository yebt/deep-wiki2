/**
 * Structural check: the workspace stays on Bun workspaces + `bun run -F`
 * exclusively (no pnpm, no npm, no yarn, no Turborepo), and Vitest is
 * confined to exactly one workspace member (see design.md — Vue SFC / Nuxt
 * component tests require Vitest + `@nuxt/test-utils`; every other member
 * uses `bun test`).
 *
 * Two rules, and both of them used to be evadable:
 *
 *  1. A foreign package manager's marker file is banned anywhere in the
 *     workspace, not only at the root. `apps/web/pnpm-lock.yaml` installs
 *     an `apps/web/node_modules` that shadows Bun's hoisted tree just as
 *     effectively as a root lockfile would, and until now it passed. So
 *     did `package-lock.json` and `yarn.lock`, which were not listed at
 *     all despite CLAUDE.md's "Never pnpm. Never npm."
 *
 *  2. "This member runs Vitest" is not the same question as "this member's
 *     `dependencies`/`devDependencies` name vitest". Two ways to run a
 *     second Vitest were invisible:
 *       - declaring it under `peerDependencies` (the manifest read only two
 *         of the three dependency kinds — `core-purity.ts`'s `checkManifest`
 *         already reads all three);
 *       - declaring it nowhere and shipping a `vitest.config.ts`. Bun hoists
 *         the one member that does declare vitest to the root
 *         `node_modules`, so `vitest run` resolves from any member. The
 *         config file is the intent; the manifest entry is only paperwork.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export interface WorkspaceShapeResult {
  ok: boolean;
  errors: string[];
}

/**
 * Marker files of a package manager or task runner this workspace does not
 * use. Banned at the root and inside every workspace member alike.
 */
const BANNED_TOOLING_FILES = [
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'turbo.json',
];

const MEMBER_GROUPS = ['apps', 'packages'];

/**
 * A Vitest config file makes a member run Vitest whether or not its
 * manifest declares the dependency. Covers every extension Vitest itself
 * resolves, plus the workspace form.
 */
const VITEST_CONFIG_PATTERN = /^vitest\.(config|workspace)\.(m|c)?(t|j)s$/;

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

interface MemberManifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

/**
 * All three dependency kinds, exactly as `core-purity.ts` reads them: a
 * `peerDependencies` entry installs and resolves like any other here.
 */
export function manifestDeclaresVitest(manifest: MemberManifest): boolean {
  const deps = { ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies };
  return Object.prototype.hasOwnProperty.call(deps, 'vitest');
}

export function hasVitestConfigFile(memberDir: string): boolean {
  return readdirSync(memberDir).some((entry) => VITEST_CONFIG_PATTERN.test(entry));
}

function memberRunsVitest(memberDir: string): boolean {
  const manifest = JSON.parse(readFileSync(join(memberDir, 'package.json'), 'utf8')) as MemberManifest;
  return manifestDeclaresVitest(manifest) || hasVitestConfigFile(memberDir);
}

function checkBannedFilesIn(root: string, dir: string, errors: string[]): void {
  for (const banned of BANNED_TOOLING_FILES) {
    const candidate = join(dir, banned);
    if (!existsSync(candidate)) continue;

    errors.push(
      `Forbidden build-tool file present: ${relative(root, candidate) || banned} ` +
        '(this workspace uses Bun + "bun run -F" only)',
    );
  }
}

export function checkWorkspaceShape(root: string): WorkspaceShapeResult {
  const errors: string[] = [];

  checkBannedFilesIn(root, root, errors);

  const members = findMemberDirs(root);

  for (const memberDir of members) {
    checkBannedFilesIn(root, memberDir, errors);
  }

  const vitestMembers = members.filter(memberRunsVitest).map((m) => relative(root, m));

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
