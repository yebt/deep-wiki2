import { describe, expect, test } from 'bun:test';
import {
  CONTAINER_STATE_PS_FORMAT,
  containerRuntimeEnv,
  listProjectContainers,
  parseContainerStates,
  restartStalledStack,
  stalledContainers,
  startContainers,
  type ProjectContainer,
  type RestartStalledDeps,
} from './containers';

const PROJECT = 'deep-wiki-test-bee1d08f';

const created: ProjectContainer = { name: `${PROJECT}_postgres_1`, project: PROJECT, state: 'created' };
const running: ProjectContainer = { name: `${PROJECT}_postgres_1`, project: PROJECT, state: 'running' };
const exited: ProjectContainer = { name: `${PROJECT}_mailpit_1`, project: PROJECT, state: 'exited' };

describe('containerRuntimeEnv', () => {
  test('drops every node_modules/.bin segment from PATH and keeps the rest in order', () => {
    const env = containerRuntimeEnv({
      PATH: '/repo/node_modules/.bin:/usr/local/bin:/repo/packages/db/node_modules/.bin:/usr/bin:/bin',
      HOME: '/home/someone',
    });
    expect(env.PATH).toBe('/usr/local/bin:/usr/bin:/bin');
    expect(env.HOME).toBe('/home/someone');
  });

  test('a PATH without any node_modules/.bin is returned unchanged, and a missing PATH stays missing', () => {
    expect(containerRuntimeEnv({ PATH: '/usr/bin:/bin' }).PATH).toBe('/usr/bin:/bin');
    expect('PATH' in containerRuntimeEnv({ HOME: '/home/someone' })).toBe(false);
  });

  test('never mutates the environment it was given', () => {
    const given = { PATH: '/repo/node_modules/.bin:/usr/bin' };
    containerRuntimeEnv(given);
    expect(given.PATH).toBe('/repo/node_modules/.bin:/usr/bin');
  });
});

describe('parseContainerStates', () => {
  test('reads one container per line in the fixed ps format, and skips anything shorter', () => {
    const output = [
      `${PROJECT}_postgres_1\t${PROJECT}\tcreated`,
      `${PROJECT}_mailpit_1\t${PROJECT}\trunning`,
      'not a container line',
      '',
    ].join('\n');

    expect(parseContainerStates(output)).toEqual([
      { name: `${PROJECT}_postgres_1`, project: PROJECT, state: 'created' },
      { name: `${PROJECT}_mailpit_1`, project: PROJECT, state: 'running' },
    ]);
  });

  test('normalises the state to lower case, so `Created` and `created` are the same answer', () => {
    expect(parseContainerStates(`x\tp\tCreated`)).toEqual([{ name: 'x', project: 'p', state: 'created' }]);
  });
});

describe('stalledContainers', () => {
  test('names the containers compose created but never started, and the ones that have since stopped', () => {
    expect(stalledContainers([created, exited], PROJECT)).toEqual([created.name, exited.name]);
  });

  test('leaves a running container alone', () => {
    expect(stalledContainers([running], PROJECT)).toEqual([]);
  });

  test('never touches another project’s container, even one in the same state', () => {
    const foreign: ProjectContainer = { name: 'other_postgres_1', project: 'other', state: 'created' };
    expect(stalledContainers([foreign, created], PROJECT)).toEqual([created.name]);
  });
});

describe('listProjectContainers', () => {
  test('asks the runtime for every container of this compose project, in the one format the parser reads', () => {
    const calls: (readonly string[])[] = [];
    const containers = listProjectContainers('podman', PROJECT, (args) => {
      calls.push(args);
      return `${PROJECT}_postgres_1\t${PROJECT}\tcreated\n`;
    });

    expect(calls).toEqual([
      ['podman', 'ps', '-a', '--filter', `label=com.docker.compose.project=${PROJECT}`, '--format', CONTAINER_STATE_PS_FORMAT],
    ]);
    expect(containers).toEqual([created]);
  });

  test('drops a container the runtime returned for another project, whatever the filter let through', () => {
    const containers = listProjectContainers('podman', PROJECT, () => `other_postgres_1\tother\tcreated\n`);
    expect(containers).toEqual([]);
  });

  test('a runtime that cannot answer is an empty list, never an error: naming the container is best effort', () => {
    const containers = listProjectContainers('podman', PROJECT, () => {
      throw new Error('podman ps: timed out');
    });
    expect(containers).toEqual([]);
  });
});

describe('startContainers', () => {
  test('starts exactly the named containers with `<binary> start`, no shell, no interpolation', () => {
    const calls: (readonly string[])[] = [];
    const started = startContainers('podman', [created.name, exited.name], (args) => {
      calls.push(args);
      return '';
    });

    expect(started).toEqual({ started: true });
    expect(calls).toEqual([['podman', 'start', created.name, exited.name]]);
  });

  test('starts nothing when there is nothing to start', () => {
    let asked = false;
    expect(
      startContainers('podman', [], () => {
        asked = true;
        return '';
      }),
    ).toEqual({ started: false, reason: 'nothing to start' });
    expect(asked).toBe(false);
  });

  test('a start the runtime refused is reported with the runtime’s own stderr, so the reason is never lost again', () => {
    const outcome = startContainers('podman', [created.name], () => {
      const error = new Error('Command failed: podman start') as Error & { stderr?: string };
      error.stderr = 'Error: unable to start container "0a02": netavark: nftables error: got invalid json: EOF while parsing a value at line 1 column 0\n';
      throw error;
    });

    if (outcome.started) throw new Error('expected the start to be refused');
    expect(outcome.reason).toContain('netavark: nftables error');
  });

  test('a start that failed without any stderr still carries the error message as its reason', () => {
    const outcome = startContainers('podman', [created.name], () => {
      throw new Error('spawnSync podman ETIMEDOUT');
    });
    expect(outcome).toEqual({ started: false, reason: 'spawnSync podman ETIMEDOUT' });
  });
});

interface TestDeps extends RestartStalledDeps {
  readonly logged: string[];
  readonly started: string[][];
}

function makeDeps(overrides: Partial<RestartStalledDeps> = {}): TestDeps {
  const logged: string[] = [];
  const started: string[][] = [];
  return {
    logged,
    started,
    projectContainers: () => [],
    startContainers: (_binary, names) => {
      started.push([...names]);
      return { started: true };
    },
    reachable: async () => false,
    log: (message) => {
      logged.push(message);
    },
    sleep: async () => {},
    ...overrides,
  };
}

describe('restartStalledStack', () => {
  test('a stack compose never created is not something to start: nothing happens and the caller still fails', async () => {
    const deps = makeDeps();
    expect(await restartStalledStack('podman', PROJECT, 100, deps)).toEqual({ healed: false, reason: `no container of ${PROJECT} exists` });
    expect(deps.started).toEqual([]);
    expect(deps.logged).toEqual([]);
  });

  test('a container left in `Created` is started once, and the stack is healed when it then answers', async () => {
    let startedAt = -1;
    let probes = 0;
    const deps = makeDeps({
      projectContainers: () => [created],
      startContainers: (_binary, names) => {
        startedAt = probes;
        deps.started.push([...names]);
        return { started: true };
      },
      reachable: async () => {
        probes += 1;
        return startedAt >= 0 && probes > startedAt + 1;
      },
    });

    expect(await restartStalledStack('podman', PROJECT, 1_000, deps)).toEqual({ healed: true });
    expect(deps.started).toEqual([[created.name]]);
    expect(deps.logged).toHaveLength(1);
    expect(deps.logged[0]).toMatch(/created/i);
    expect(deps.logged[0]).toContain(created.name);
  });

  test('a container that is running but not yet answering is waited for, never restarted', async () => {
    let probes = 0;
    const deps = makeDeps({
      projectContainers: () => [running],
      reachable: async () => {
        probes += 1;
        return probes >= 3;
      },
    });

    expect(await restartStalledStack('podman', PROJECT, 1_000, deps)).toEqual({ healed: true });
    expect(deps.started).toEqual([]);
    expect(deps.logged).toHaveLength(1);
    expect(probes).toBe(3);
  });

  test('a start the runtime refuses is a genuine failure: no wait, not healed, and the runtime’s reason is handed back', async () => {
    let probes = 0;
    const deps = makeDeps({
      projectContainers: () => [created],
      startContainers: () => ({ started: false, reason: 'Error: unable to start container: netavark: nftables error: got invalid json' }),
      reachable: async () => {
        probes += 1;
        return true;
      },
    });

    const outcome = await restartStalledStack('podman', PROJECT, 1_000, deps);
    if (outcome.healed) throw new Error('expected the stack not to be healed');
    expect(outcome.reason).toContain('netavark: nftables error');
    expect(outcome.reason).toContain(created.name);
    expect(probes).toBe(0);
  });

  test('a started container that never answers within the bound is not healed, and the wait stops at the bound', async () => {
    const waits: number[] = [];
    const deps = makeDeps({
      projectContainers: () => [created],
      reachable: async () => false,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });

    expect(await restartStalledStack('podman', PROJECT, 100, deps)).toEqual({
      healed: false,
      reason: `${created.name} was started but did not answer within 100ms`,
    });
    expect(deps.started).toEqual([[created.name]]);
    expect(waits.length).toBeGreaterThan(0);
    expect(waits.reduce((sum, ms) => sum + ms, 0)).toBeLessThanOrEqual(100);
  });
});
