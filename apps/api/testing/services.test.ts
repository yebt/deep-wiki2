import { describe, expect, test } from 'bun:test';
import type { ProjectContainer } from '@deep-wiki/db/testing/containers';
import { harnessIdentity } from '@deep-wiki/db/testing/worktree';
import { ensureTestServices, type EnsureTestServicesDeps } from './services';

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
      return { code: 0, timedOut: false };
    },
    projectContainers: () => [],
    startContainers: (_binary, names) => {
      trace.started.push([...names]);
      return true;
    },
    portOwners: () => '',
    log: (message) => {
      trace.logged.push(message);
    },
    ...overrides,
  };
  return { deps, trace };
}

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
      runCompose: async () => ({ code: 125, timedOut: false }),
      projectContainers: () => stalled,
    });

    await ensureTestServices(deps, 200);
    expect(trace.started).toEqual([stalled.map((c) => c.name)]);
    expect(trace.logged).toHaveLength(1);
    expect(trace.logged[0]).toContain(`${PROJECT}_mailpit_1`);
  });

  test('a genuine failure still throws, naming the exact manual command: nothing left to start', async () => {
    const { deps, trace } = makeDeps({
      runCompose: async () => ({ code: 125, timedOut: false }),
      projectContainers: () => [],
    });

    await expect(ensureTestServices(deps, 50)).rejects.toThrow(/podman compose up -d --wait/);
    await expect(ensureTestServices(deps, 50)).rejects.toThrow(/COMPOSE_PROJECT_NAME=/);
    expect(trace.started).toEqual([]);
  });

  test('a genuine failure still throws when the started containers never answer within the bound', async () => {
    const { deps, trace } = makeDeps({
      runCompose: async () => ({ code: null, timedOut: true }),
      projectContainers: () => stalled,
    });

    await expect(ensureTestServices(deps, 50)).rejects.toThrow(/did not bring up a reachable Mailpit\/MinIO within 50ms/);
    expect(trace.started).toHaveLength(1);
  });

  test('no container runtime on PATH is its own failure, with the manual command', async () => {
    const { deps } = makeDeps({ detectRuntime: () => undefined });
    await expect(ensureTestServices(deps, 50)).rejects.toThrow(/no container runtime found on PATH/);
  });
});
