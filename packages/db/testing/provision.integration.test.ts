import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listProjectContainers } from './containers';
import { composeProcessEnv, createProvisionDeps, localTestUrl, resolveAdminUrl } from './provision';
import { harnessIdentity, type HarnessIdentity } from './worktree';

/**
 * The one test here drives the REAL path — real `podman compose`, real
 * `podman ps`/`start`, real Postgres probe — from a container it has
 * deliberately left in `Created`, under a `PATH` poisoned the way `bun
 * run` poisons it: a `node_modules/.bin` in front, holding an `nft` that
 * is not nftables. That is the exact state the 2026-09-16 "self-healing"
 * commit (2d10af6) was written for and proven against fakes only; the
 * next full verification hit the same exit 125, the same `Created`, and
 * the same manual command. The fakes could not have caught it: the
 * container runtime found `@vercel/nft` where it wanted `nft`, from any
 * process `bun run` started (containers.ts).
 *
 * It uses its own compose project and its own port, so it never touches
 * the Postgres the rest of this package's suites are running against,
 * and it tears its stack down after itself.
 *
 * Skipped — loudly — only when there is no `podman` on PATH: the point is
 * the runtime, and there is nothing to prove without one. `docker` is not
 * enough here because the whole failure is rootless podman's netavark.
 */
const PODMAN = Bun.which('podman');
if (!PODMAN) {
  console.warn('provision.integration.test.ts: no `podman` on PATH — the real-runtime provisioning test is SKIPPED, not passed.');
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => (port > 0 ? resolve(port) : reject(new Error('could not find a free port'))));
    });
  });
}

/** A throwaway identity next to this worktree's: same worktree, its own compose project, owner stamp and port. */
async function throwawayIdentity(): Promise<HarnessIdentity> {
  const base = harnessIdentity();
  return {
    ...base,
    dbProjectName: `${base.dbProjectName}-heal`,
    ownerDatabase: `${base.ownerDatabase}_heal`,
    ports: { ...base.ports, postgres: await freePort() },
  };
}

/**
 * What `bun run` does to PATH, reproduced on purpose and independently
 * of whether `@vercel/nft` happens to be installed: a `node_modules/.bin`
 * first on PATH, holding an `nft` that answers nothing and exits 0 —
 * which is all Vercel's does when netavark calls it.
 */
function plantWrongNft(): { readonly dir: string; readonly env: NodeJS.ProcessEnv } {
  const dir = mkdtempSync(join(tmpdir(), 'deep-wiki-wrong-nft-'));
  const bin = join(dir, 'node_modules', '.bin');
  mkdirSync(bin, { recursive: true });
  const nft = join(bin, 'nft');
  writeFileSync(nft, '#!/bin/sh\nexit 0\n');
  chmodSync(nft, 0o755);
  return { dir, env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ''}` } };
}

function compose(id: HarnessIdentity, args: readonly string[]): void {
  execFileSync(PODMAN as string, ['compose', ...args], {
    cwd: import.meta.dir,
    env: composeProcessEnv(id),
    stdio: ['ignore', 'ignore', 'pipe'],
    timeout: 60_000,
  });
}

describe.skipIf(!PODMAN)('provisioning from a container compose left in `Created` — against the real runtime', () => {
  let id: HarnessIdentity;
  let planted: ReturnType<typeof plantWrongNft>;

  beforeAll(async () => {
    id = await throwawayIdentity();
    planted = plantWrongNft();
    try {
      compose(id, ['down', '-v']);
    } catch {
      // Nothing to tear down from an earlier run: the usual case.
    }
    // `create` and stop: exactly what compose leaves behind when its own
    // `start` is refused.
    compose(id, ['up', '-d', '--no-start', 'postgres']);
  });

  afterAll(() => {
    try {
      if (id) compose(id, ['down', '-v']);
    } finally {
      if (planted) rmSync(planted.dir, { recursive: true, force: true });
    }
  });

  test(
    'the container is started and the server answers, even with the wrong `nft` first on PATH',
    async () => {
      const before = listProjectContainers('podman', id.dbProjectName);
      expect(before.map((c) => c.state)).toEqual(['created']);

      const deps = createProvisionDeps({ identity: id, env: planted.env });
      const url = await resolveAdminUrl(deps);

      expect(url).toBe(localTestUrl(id));
      expect(await deps.probe(url)).toBe(true);
      const after = listProjectContainers('podman', id.dbProjectName);
      expect(after.map((c) => c.state)).toEqual(['running']);
    },
    120_000,
  );
});
