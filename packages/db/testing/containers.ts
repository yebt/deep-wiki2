/**
 * What to do when `compose up -d --wait` comes back without a stack.
 *
 * Seen on this host on 2026-09-16, three times in one day, under load:
 * `podman compose up -d --wait` exits 125 (or is killed at the
 * `COMPOSE_TIMEOUT_MS` bound) having *created* the container but never
 * started it. The container then sits in `Created` under the worktree's
 * deterministic compose project name, and every later `up` against the
 * same name failed the same way in seconds — until somebody ran the
 * printed manual command by hand, which started it in three seconds and
 * reported it healthy. The fix the human applied was `start the container
 * that is already there`, so this module does exactly that, once, and
 * says so: the honest failure with the manual command is still the
 * answer when there is nothing to start or starting it does not help.
 *
 * Shared by `packages/db/testing/provision.ts` (Postgres) and
 * `apps/api/testing/services.ts` (Mailpit/MinIO), which are the two
 * places that bring a compose stack up. Node APIs only — `worktree.ts`'s
 * rule — so Playwright's Node process can load whatever imports it.
 */
import { execFileSync } from 'node:child_process';

/**
 * The `--format` string whose output `parseContainerStates` reads. Fixed
 * and shared so the parser and the command can never drift. The project
 * label is read back even though the query filters on it: podman's
 * `--filter label=` is exact, but the parser should not have to trust that.
 */
export const CONTAINER_STATE_PS_FORMAT = '{{.Names}}\t{{index .Labels "com.docker.compose.project"}}\t{{.State}}';

/**
 * `ps -a` on a loaded host is not free (`podman ps` measured 15-80s
 * around a couple of dozen containers), so this is bounded — but it only
 * ever runs on a path that has already failed, where the alternative is
 * a human running the command by hand.
 */
export const CONTAINER_PS_TIMEOUT_MS = 15_000;
/** `podman start` of a container that already exists: seconds when it works, and a bound when it does not. */
export const CONTAINER_START_TIMEOUT_MS = 30_000;

export interface ProjectContainer {
  readonly name: string;
  readonly project: string;
  /** podman's `.State`, lower-cased: `created`, `running`, `exited`, ... */
  readonly state: string;
}

/**
 * The states `start` is the answer to: compose created the container and
 * never started it, or it was started and has since stopped. A `running`
 * container is left alone — it may simply not be healthy yet.
 */
export const STALLED_STATES: ReadonlySet<string> = new Set(['created', 'configured', 'initialized', 'exited', 'stopped']);

export function parseContainerStates(psOutput: string): ProjectContainer[] {
  const containers: ProjectContainer[] = [];
  for (const line of psOutput.split('\n')) {
    const [name, project, state] = line.split('\t');
    if (!name || project === undefined || state === undefined) continue;
    containers.push({ name, project, state: state.trim().toLowerCase() });
  }
  return containers;
}

/** The containers of `project` that need `start`, by name. */
export function stalledContainers(containers: readonly ProjectContainer[], project: string): string[] {
  return containers.filter((c) => c.project === project && STALLED_STATES.has(c.state)).map((c) => c.name);
}

/** Runs one fixed argument vector — no shell — and returns its stdout. */
export type ContainerExec = (args: readonly string[], timeoutMs: number) => string;

const defaultExec: ContainerExec = (args, timeoutMs) =>
  execFileSync(args[0] as string, args.slice(1) as string[], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: timeoutMs,
  });

/**
 * Every container of one compose project, in any state. A runtime that
 * cannot answer is an empty list, never an error: not being able to name
 * the container makes the failure less useful, but it is not itself one.
 */
export function listProjectContainers(binary: string, project: string, exec: ContainerExec = defaultExec): ProjectContainer[] {
  try {
    const output = exec(
      [binary, 'ps', '-a', '--filter', `label=com.docker.compose.project=${project}`, '--format', CONTAINER_STATE_PS_FORMAT],
      CONTAINER_PS_TIMEOUT_MS,
    );
    return parseContainerStates(output).filter((c) => c.project === project);
  } catch {
    return [];
  }
}

/** `<binary> start <names>`: true when the runtime accepted it. */
export function startContainers(binary: string, names: readonly string[], exec: ContainerExec = defaultExec): boolean {
  if (names.length === 0) return false;
  try {
    exec([binary, 'start', ...names], CONTAINER_START_TIMEOUT_MS);
    return true;
  } catch {
    return false;
  }
}

export interface RestartStalledDeps<Binary extends string = string> {
  projectContainers(binary: Binary): ProjectContainer[];
  startContainers(binary: Binary, names: readonly string[]): boolean;
  /** Whether the stack answers — the same probe the caller trusts on the happy path. */
  reachable(): Promise<boolean>;
  /** Where "compose left X unstarted; starting it" goes: this is a retry a human should be able to see. */
  log(message: string): void;
  sleep?(ms: number): Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One bounded retry after a failed `compose up`. Starts whatever compose
 * left behind unstarted, then waits up to `timeoutMs` for the stack to
 * answer. `true` means it does; `false` means the caller's original
 * failure, with its manual command, is the right thing to raise.
 *
 * Nothing left behind is not retried: there is nothing to start, and
 * `compose up` a second time is what the human already gets told to do.
 */
export async function restartStalledStack<Binary extends string>(
  binary: Binary,
  project: string,
  timeoutMs: number,
  deps: RestartStalledDeps<Binary>,
): Promise<boolean> {
  const containers = deps.projectContainers(binary);
  if (containers.length === 0) return false;

  const stalled = stalledContainers(containers, project);
  if (stalled.length > 0) {
    deps.log(
      `${project}: ${binary} compose left ${stalled.join(', ')} created but not running; ` +
        `starting ${stalled.length === 1 ? 'it' : 'them'} once and waiting up to ${timeoutMs}ms.`,
    );
    if (!deps.startContainers(binary, stalled)) return false;
  } else {
    deps.log(
      `${project}: ${binary} compose returned before ${containers.map((c) => c.name).join(', ')} answered; ` +
        `waiting up to ${timeoutMs}ms.`,
    );
  }

  const sleep = deps.sleep ?? defaultSleep;
  const interval = Math.max(10, Math.min(1_000, Math.floor(timeoutMs / 10)));
  const deadline = Date.now() + timeoutMs;
  let waited = 0;
  while (true) {
    if (await deps.reachable()) return true;
    if (waited + interval > timeoutMs || Date.now() + interval > deadline) return false;
    await sleep(interval);
    waited += interval;
  }
}
