import { describe, expect, test } from 'bun:test';
import type { ProjectContainer } from '@deep-wiki/db/testing/containers';
import { harnessIdentity } from '@deep-wiki/db/testing/worktree';
import { composeProcessEnv, ensureTestServices, type EnsureTestServicesDeps } from './services';

/**
 * `ensureTestServices` brings the Mailpit/MinIO stack up when it is not
 * answering, and — since 2026-09-16 — starts the container compose
 * created and left behind before it gives up (docs/TODO.md Findings:
 * `podman compose up -d --wait` exited 125 under load with both
 * containers in `Created`, and every later attempt failed the same way
 * until a human ran the printed command). Every runtime touch is
 * injected: nothing here spawns podman.
 */
const PROJECT = harnessIdentity().apiProjectName;
const stalled: ProjectContainer[] = [
  { name: `${PROJECT}_mailpit_1`, project: PROJECT, state: 'created' },
  { name: `${PROJECT}_minio_1`, project: PROJECT, state: 'created' },
];

interface Trace {
  composeRuns: number;
  readonly started: string[][];
  readonly logged: string[];
}

function makeDeps(overrides: Partial<EnsureTestServicesDeps> = {}): { deps: EnsureTestServicesDeps; trace: Trace } {
  const trace: Trace = { composeRuns: 0, started: [], logged: [] };
  const deps: EnsureTestServicesDeps = {
    reachable: async () => false,
    detectRuntime: () => 'podman',
    runCompose: async () => {
      trace.composeRuns += 1;
      return { code: 0, timedOut: false, stderr: '' };
    },
    projectContainers: () => [],
    startContainers: (_binary, names) => {
      trace.started.push([...names]);
      return { started: true };
    },
    portOwners: () => '',
    log: (message) => {
      trace.logged.push(message);
    },
    ...overrides,
  };
  return { deps, trace };
}

describe('composeProcessEnv', () => {
  test('carries this worktree’s compose variables and a PATH with no node_modules/.bin, whatever `bun run` prepended', () => {
    const id = harnessIdentity();
    const env = composeProcessEnv(id, { PATH: '/repo/node_modules/.bin:/usr/bin:/bin', HOME: '/home/dev' });

    expect(env.PATH).toBe('/usr/bin:/bin');
    expect(env.HOME).toBe('/home/dev');
    expect(env.COMPOSE_PROJECT_NAME).toBe(id.apiProjectName);
    expect(env.DEEPWIKI_TEST_MAILPIT_SMTP_PORT).toBe(String(id.ports.mailpitSmtp));
    expect(env.DEEPWIKI_TEST_MINIO_PORT).toBe(String(id.ports.minioApi));
  });
});

describe('ensureTestServices', () => {
  test('a stack that already answers is left alone: no compose, no runtime', async () => {
    const { deps, trace } = makeDeps({ reachable: async () => true });
    await ensureTestServices(deps, 100);
    expect(trace.composeRuns).toBe(0);
    expect(trace.started).toEqual([]);
  });

  test('healthy first try: compose once, and the runtime is never asked what it left behind', async () => {
    let probes = 0;
    let asked = false;
    const { deps, trace } = makeDeps({
      reachable: async () => {
        probes += 1;
        return probes > 1;
      },
      projectContainers: () => {
        asked = true;
        return [];
      },
    });

    await ensureTestServices(deps, 100);
    expect(trace.composeRuns).toBe(1);
    expect(asked).toBe(false);
    expect(trace.logged).toEqual([]);
  });

  test('compose returns with both containers in `Created`: they are started once, waited for, and the stack is up — logged', async () => {
    const { deps, trace } = makeDeps({
      reachable: async () => trace.started.length > 0,
      runCompose: async () => ({ code: 125, timedOut: false, stderr: '' }),
      projectContainers: () => stalled,
    });

    await ensureTestServices(deps, 200);
    expect(trace.started).toEqual([stalled.map((c) => c.name)]);
    expect(trace.logged).toHaveLength(1);
    expect(trace.logged[0]).toContain(`${PROJECT}_mailpit_1`);
  });

  test('a genuine failure still throws, naming the exact manual command: nothing left to start', async () => {
    const { deps, trace } = makeDeps({
      runCompose: async () => ({ code: 125, timedOut: false, stderr: '' }),
      projectContainers: () => [],
    });

    await expect(ensureTestServices(deps, 50)).rejects.toThrow(/podman compose up -d --wait/);
    await expect(ensureTestServices(deps, 50)).rejects.toThrow(/COMPOSE_PROJECT_NAME=/);
    expect(trace.started).toEqual([]);
  });

  test('a genuine failure still throws when the started containers never answer within the bound', async () => {
    const { deps, trace } = makeDeps({
      runCompose: async () => ({ code: null, timedOut: true, stderr: '' }),
      projectContainers: () => stalled,
    });

    await expect(ensureTestServices(deps, 50)).rejects.toThrow(/did not bring up a reachable Mailpit\/MinIO within 50ms/);
    expect(trace.started).toHaveLength(1);
  });

  test('compose’s stderr and the retry’s reason are in the thrown error: the cause is never discarded again', async () => {
    const netavark =
      'Error: unable to start container "0a02": netavark: nftables error: got invalid json: EOF while parsing a value at line 1 column 0';
    const { deps } = makeDeps({
      runCompose: async () => ({ code: 125, timedOut: false, stderr: `>>>> Executing external compose provider\n${netavark}\n` }),
      projectContainers: () => stalled,
      startContainers: () => ({ started: false, reason: netavark }),
    });

    await expect(ensureTestServices(deps, 50)).rejects.toThrow(/exited with code 125/);
    await expect(ensureTestServices(deps, 50)).rejects.toThrow(/podman compose said:\n[\s\S]*netavark: nftables error/);
    await expect(ensureTestServices(deps, 50)).rejects.toThrow(/The one retry did not help: podman start .* failed: .*netavark/);
  });

  test('no container runtime on PATH is its own failure, with the manual command', async () => {
    const { deps } = makeDeps({ detectRuntime: () => undefined });
    await expect(ensureTestServices(deps, 50)).rejects.toThrow(/no container runtime found on PATH/);
  });
});
