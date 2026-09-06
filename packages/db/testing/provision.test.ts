import { describe, expect, test } from 'bun:test';
import {
  assertTestDatabaseName,
  buildComposeUpArgs,
  detectContainerRuntime,
  dropTestDatabase,
  localTestUrl,
  ProvisioningError,
  resolveAdminUrl,
  TEST_DB_PREFIX,
  UnsafeDatabaseNameError,
  type ResolveAdminUrlDeps,
  type SpawnResult,
} from './provision';
import { deriveHarnessIdentity, PORT_OWNER_PS_FORMAT } from './worktree';

const MAIN_ID = deriveHarnessIdentity({ root: '/home/dev/deep-wiki', isMainWorktree: true });
const WORKTREE_ID = deriveHarnessIdentity({ root: '/home/dev/wt/probe', isMainWorktree: false });

describe('assertTestDatabaseName', () => {
  test('refuses a database name that does not start with the test prefix', () => {
    expect(() => assertTestDatabaseName('production')).toThrow(UnsafeDatabaseNameError);
  });

  test('refuses a database name that merely contains the prefix, not as its start', () => {
    expect(() => assertTestDatabaseName(`prod_${TEST_DB_PREFIX}1`)).toThrow(UnsafeDatabaseNameError);
  });

  test('accepts a database name that starts with the test prefix', () => {
    expect(() => assertTestDatabaseName(`${TEST_DB_PREFIX}42`)).not.toThrow();
  });
});

describe('dropTestDatabase', () => {
  test('refuses to drop a database outside the dw_test_ namespace, and never touches the connection', async () => {
    let called = false;
    const fakeSql = Object.assign(
      async (_strings: TemplateStringsArray, ..._values: unknown[]) => {
        called = true;
        return [];
      },
      {
        unsafe: async () => {
          called = true;
          return [];
        },
        end: async () => undefined,
      },
    );

    await expect(dropTestDatabase(fakeSql as never, 'production')).rejects.toThrow(UnsafeDatabaseNameError);
    expect(called).toBe(false);
  });

  test('issues DROP DATABASE for a name inside the dw_test_ namespace', async () => {
    const statements: string[] = [];
    const fakeSql = Object.assign(
      async () => [],
      {
        unsafe: async (sql: string) => {
          statements.push(sql);
          return [];
        },
        end: async () => undefined,
      },
    );

    await dropTestDatabase(fakeSql as never, `${TEST_DB_PREFIX}17`);

    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain(`${TEST_DB_PREFIX}17`);
    expect(statements[0]).toContain('DROP DATABASE');
  });
});

describe('buildComposeUpArgs', () => {
  test('is a fixed argument vector for podman: no shell, no interpolation, no user-supplied token', () => {
    expect(buildComposeUpArgs('podman')).toEqual(['podman', 'compose', 'up', '-d', '--wait', 'postgres']);
  });

  test('is a fixed argument vector for docker', () => {
    expect(buildComposeUpArgs('docker')).toEqual(['docker', 'compose', 'up', '-d', '--wait', 'postgres']);
  });

  test('never contains a shell metacharacter in any argument', () => {
    for (const binary of ['podman', 'docker'] as const) {
      for (const arg of buildComposeUpArgs(binary)) {
        expect(arg).not.toMatch(/[;&|$`<>]/);
      }
    }
  });
});

describe('detectContainerRuntime', () => {
  test('prefers podman when both are on PATH', () => {
    const which = (bin: string) => (bin === 'podman' || bin === 'docker' ? `/usr/bin/${bin}` : null);
    expect(detectContainerRuntime(which)).toBe('podman');
  });

  test('falls back to docker when podman is absent', () => {
    const which = (bin: string) => (bin === 'docker' ? '/usr/bin/docker' : null);
    expect(detectContainerRuntime(which)).toBe('docker');
  });

  test('returns undefined when neither runtime is on PATH', () => {
    const which = () => null;
    expect(detectContainerRuntime(which)).toBeUndefined();
  });
});

function makeDeps(overrides: Partial<ResolveAdminUrlDeps> = {}): ResolveAdminUrlDeps {
  return {
    env: {},
    probe: async () => false,
    detectRuntime: () => undefined,
    runCompose: async () => ({ code: 0, timedOut: false }) as SpawnResult,
    identity: MAIN_ID,
    portOwners: () => '',
    serverOwners: async () => [],
    ...overrides,
  };
}

describe('resolveAdminUrl', () => {
  test('uses TEST_DATABASE_URL directly when set, skipping every other step', async () => {
    let probed = false;
    const deps = makeDeps({
      env: { TEST_DATABASE_URL: 'postgres://ci:ci@ci-host:5432/deepwiki_ci' },
      probe: async () => {
        probed = true;
        return false;
      },
    });

    const url = await resolveAdminUrl(deps);

    expect(url).toBe('postgres://ci:ci@ci-host:5432/deepwiki_ci');
    expect(probed).toBe(false);
  });

  test('never skips: on total failure it throws naming the exact manual command to run', async () => {
    const deps = makeDeps({ detectRuntime: () => undefined });

    await expect(resolveAdminUrl(deps)).rejects.toThrow(/podman compose up -d --wait postgres|docker compose up -d --wait postgres|install podman or docker/i);
  });

  test('DEEPWIKI_TEST_NO_AUTOSTART=1 opts out of compose entirely and fails fast', async () => {
    let composeCalled = false;
    const deps = makeDeps({
      env: { DEEPWIKI_TEST_NO_AUTOSTART: '1' },
      detectRuntime: () => 'podman',
      runCompose: async () => {
        composeCalled = true;
        return { code: 0, timedOut: false };
      },
    });

    await expect(resolveAdminUrl(deps)).rejects.toThrow(/DEEPWIKI_TEST_NO_AUTOSTART/);
    expect(composeCalled).toBe(false);
  });

  test('connects to the port this worktree derived, not to a fixed one', async () => {
    const deps = makeDeps({ identity: WORKTREE_ID, probe: async () => true });

    expect(await resolveAdminUrl(deps)).toBe(`postgres://dw_test:dw_test@localhost:${WORKTREE_ID.ports.postgres}/postgres`);
  });

  test('the main checkout still resolves to the port the harness has always used', async () => {
    const deps = makeDeps({ probe: async () => true });

    expect(await resolveAdminUrl(deps)).toBe('postgres://dw_test:dw_test@localhost:55432/postgres');
  });

  test('a clean, actionable timeout message at the configured bound when the compose wait never completes', async () => {
    const deps = makeDeps({
      detectRuntime: () => 'podman',
      runCompose: async (_binary, timeoutMs) => {
        // Simulates the compose spawn hitting its own bound without a
        // container runtime ever becoming ready.
        return { code: null, timedOut: true, ranForMs: timeoutMs } as SpawnResult & { ranForMs: number };
      },
    });

    await expect(resolveAdminUrl(deps, 20)).rejects.toThrow(/20ms|timed out|timeout/i);
  });
});

describe('resolveAdminUrl — a worktree collision names itself', () => {
  test('refuses to quietly borrow another worktree’s Postgres when both derived the same port', async () => {
    const deps = makeDeps({
      identity: WORKTREE_ID,
      probe: async () => true,
      serverOwners: async () => ['dw_owner_99887766'],
    });

    await expect(resolveAdminUrl(deps)).rejects.toThrow(ProvisioningError);
    await expect(resolveAdminUrl(deps)).rejects.toThrow(/dw_owner_99887766/);
  });

  test('the collision error explains it is a collision, and how to step out of the way', async () => {
    const deps = makeDeps({
      identity: WORKTREE_ID,
      probe: async () => true,
      serverOwners: async () => ['dw_owner_99887766'],
    });

    await expect(resolveAdminUrl(deps)).rejects.toThrow(/another deep-wiki worktree|different worktree/i);
    await expect(resolveAdminUrl(deps)).rejects.toThrow(/DEEPWIKI_TEST_SLOT/);
  });

  test('never fails when the server carries this worktree’s own stamp', async () => {
    const deps = makeDeps({
      identity: WORKTREE_ID,
      probe: async () => true,
      serverOwners: async () => [WORKTREE_ID.ownerDatabase],
    });

    expect(await resolveAdminUrl(deps)).toBe(localTestUrl(WORKTREE_ID));
  });

  test('accepts an unstamped server rather than inventing a conflict (a container older than this check)', async () => {
    const deps = makeDeps({ identity: WORKTREE_ID, probe: async () => true, serverOwners: async () => [] });

    expect(await resolveAdminUrl(deps)).toBe(localTestUrl(WORKTREE_ID));
  });

  test('never asks the container runtime on the happy path: `podman ps` costs 15-80s on a real host', async () => {
    let asked = false;
    const deps = makeDeps({
      identity: WORKTREE_ID,
      probe: async () => true,
      serverOwners: async () => [WORKTREE_ID.ownerDatabase],
      portOwners: () => {
        asked = true;
        return '';
      },
    });

    await resolveAdminUrl(deps);
    expect(asked).toBe(false);
  });

  test('TEST_DATABASE_URL short-circuits before any ownership check', async () => {
    let asked = false;
    const deps = makeDeps({
      env: { TEST_DATABASE_URL: 'postgres://ci:ci@ci-host:5432/deepwiki_ci' },
      serverOwners: async () => {
        asked = true;
        return [];
      },
    });

    await resolveAdminUrl(deps);
    expect(asked).toBe(false);
  });

  test('when compose cannot bring the stack up, the error names the container holding the port', async () => {
    const deps = makeDeps({
      identity: WORKTREE_ID,
      detectRuntime: () => 'podman',
      runCompose: async () => ({ code: 1, timedOut: false }),
      portOwners: () =>
        `someone-elses-postgres\tunrelated-project\t0.0.0.0:${WORKTREE_ID.ports.postgres}->5432/tcp`,
    });

    await expect(resolveAdminUrl(deps)).rejects.toThrow(/someone-elses-postgres/);
    await expect(resolveAdminUrl(deps)).rejects.toThrow(/unrelated-project/);
  });
});

describe('the manual commands the failure messages print', () => {
  test('carry the environment a linked worktree needs, so pasting them cannot start the wrong stack', async () => {
    const deps = makeDeps({ identity: WORKTREE_ID, detectRuntime: () => undefined });

    await expect(resolveAdminUrl(deps)).rejects.toThrow(
      new RegExp(`COMPOSE_PROJECT_NAME=${WORKTREE_ID.dbProjectName}`),
    );
    await expect(resolveAdminUrl(deps)).rejects.toThrow(
      new RegExp(`DEEPWIKI_TEST_PG_PORT=${WORKTREE_ID.ports.postgres}`),
    );
  });

  test('the main checkout prints exactly the command it always printed, plus its own (unchanged) values', async () => {
    const deps = makeDeps({ detectRuntime: () => undefined });

    await expect(resolveAdminUrl(deps)).rejects.toThrow(/podman compose up -d --wait postgres/);
    await expect(resolveAdminUrl(deps)).rejects.toThrow(/DEEPWIKI_TEST_PG_PORT=55432/);
  });
});

describe('the port-ownership query', () => {
  test('asks the runtime for the one format parsePortOwners can read', () => {
    expect(PORT_OWNER_PS_FORMAT).toContain('{{.Ports}}');
    expect(PORT_OWNER_PS_FORMAT).toContain('com.docker.compose.project');
  });
});
