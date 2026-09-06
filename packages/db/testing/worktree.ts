/**
 * Per-worktree identity for the whole test harness.
 *
 * Two implementation tracks developed side by side in separate git
 * worktrees used to destroy each other's containers. The cause was not
 * port contention: `packages/db/testing/compose.yaml` and
 * `apps/api/testing/compose.yaml` each declared a fixed compose *project
 * name*, and compose treats "same project name" as "same stack" no matter
 * which directory the file came from. Verified on this host with
 * podman-compose 1.6.0: running `podman compose up -d` from a second
 * directory whose file carries the same `name:` **replaced** the first
 * directory's running container rather than starting a second one. The
 * first worktree's database then vanished mid-run, which surfaces as
 * inexplicable application flakiness — the worst failure mode available.
 *
 * So every value that must be unique per worktree — both compose project
 * names, five container host ports, the two e2e server ports and the
 * MinIO test bucket — is derived here, from one fact: the absolute path
 * of the worktree, as reported by `git rev-parse --show-toplevel`.
 * Nothing is configured by hand and nothing is remembered between runs;
 * the derivation is a pure function, so the same worktree gets the same
 * values on every run and a rerun reuses its own containers instead of
 * orphaning them.
 *
 * Three properties matter and are enforced by worktree.test.ts:
 *
 *  - The main checkout is slot 0 and keeps the values the harness has
 *    always used (55432, 11025/18025, 19000/19001, 4000/4173, project
 *    `deep-wiki-test` / `deep-wiki-api-test`). Nothing changes for
 *    someone working normally. "Main checkout" is decided by git, not by
 *    a path: a linked worktree's git dir is `<main>/.git/worktrees/<n>`
 *    while the main worktree's git dir *is* the common git dir.
 *  - Every other worktree gets a contiguous block of 8 ports inside
 *    13008-14990. That range was chosen because it is empty on this
 *    host (`ss -ltn` at the time of writing), sits clear of every port
 *    this project's dev and test stacks publish (5432/1025/8025/9000/
 *    9001/8000 and their 2xxxx dev-stack and 1xxxx/55432 test-stack
 *    variants), is far above 1024 — rootless podman cannot bind below
 *    that, and `scripts/checks/compose.ts` enforces it — and stays below
 *    32768, where this kernel's ephemeral port range begins.
 *  - An explicit environment variable always wins over the derivation.
 *
 * The compose files interpolate the same variables this module emits,
 * each with the main checkout's value as its `${VAR:-default}` default,
 * so the file and the code can never disagree about a port.
 *
 * Deliberately free of Bun-only APIs: `e2e/ports.ts` imports this module
 * from Playwright's Node process, where `import.meta.dir` and `Bun.*`
 * do not exist.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** First port of the derived block. Slot 0 (the main checkout) never uses it. */
export const HARNESS_PORT_BASE = 13000;
/** Ports reserved per worktree: five containers, two e2e servers, one spare. */
export const HARNESS_PORTS_PER_SLOT = 8;
/** Slots 0..248; 0 is the main checkout, 1..248 are derived. */
export const HARNESS_SLOT_COUNT = 249;

export interface HarnessPorts {
  readonly postgres: number;
  readonly mailpitSmtp: number;
  readonly mailpitHttp: number;
  readonly minioApi: number;
  readonly minioConsole: number;
  readonly api: number;
  readonly web: number;
}

/** The values the harness has used since it existed. Slot 0 keeps them exactly. */
export const MAIN_CHECKOUT_PORTS: HarnessPorts = {
  postgres: 55432,
  mailpitSmtp: 11025,
  mailpitHttp: 18025,
  minioApi: 19000,
  minioConsole: 19001,
  api: 4000,
  web: 4173,
};

const DB_PROJECT_BASE = 'deep-wiki-test';
const API_PROJECT_BASE = 'deep-wiki-api-test';
const MINIO_BUCKET_BASE = 'deep-wiki-test';

/** Offset of each service inside a slot's block. Index 7 is unused, on purpose. */
const PORT_OFFSETS: Record<keyof HarnessPorts, number> = {
  postgres: 0,
  mailpitSmtp: 1,
  mailpitHttp: 2,
  minioApi: 3,
  minioConsole: 4,
  api: 5,
  web: 6,
};

/** The environment variable that overrides each port, one per port. */
export const PORT_ENV_VARS: Record<keyof HarnessPorts, string> = {
  postgres: 'DEEPWIKI_TEST_PG_PORT',
  mailpitSmtp: 'DEEPWIKI_TEST_MAILPIT_SMTP_PORT',
  mailpitHttp: 'DEEPWIKI_TEST_MAILPIT_HTTP_PORT',
  minioApi: 'DEEPWIKI_TEST_MINIO_PORT',
  minioConsole: 'DEEPWIKI_TEST_MINIO_CONSOLE_PORT',
  api: 'DEEPWIKI_E2E_API_PORT',
  web: 'DEEPWIKI_E2E_WEB_PORT',
};

const SLOT_ENV_VAR = 'DEEPWIKI_TEST_SLOT';
const TAG_ENV_VAR = 'DEEPWIKI_TEST_WORKTREE_TAG';

export interface GitFacts {
  /** Absolute path of this worktree's own root. */
  readonly root: string;
  /** True for the repository's main checkout, false for a linked worktree. */
  readonly isMainWorktree: boolean;
}

export interface HarnessIdentity extends GitFacts {
  /** 0 for the main checkout, 1..248 for a linked worktree. */
  readonly slot: number;
  /** '' for the main checkout, otherwise 8 hex characters of the path digest. */
  readonly tag: string;
  readonly dbProjectName: string;
  readonly apiProjectName: string;
  readonly minioBucket: string;
  /**
   * A database the test Postgres container creates on first boot, named
   * after this worktree. It is the harness's cheap ownership stamp: one
   * `pg_database` lookup on a connection provisioning already opens tells
   * us whether the server answering on our port is ours or another
   * worktree's. (Asking the container runtime instead would be correct
   * and unusable — `podman ps` measured 15-80 seconds on the development
   * host, so it is reserved for the failure path.)
   */
  readonly ownerDatabase: string;
  readonly ports: HarnessPorts;
}

/** Every owner database the harness creates, matched as a SQL LIKE pattern. */
export const OWNER_DB_PREFIX = 'dw_owner_';

function digest(root: string): string {
  return createHash('sha256').update(root).digest('hex');
}

/** 8 hex characters of the worktree path's digest — the project-name suffix. */
export function worktreeTag(root: string): string {
  return digest(root).slice(0, 8);
}

/** A stable 1..248 port-block slot for a worktree path. Never 0. */
export function worktreeSlot(root: string): number {
  const value = Number.parseInt(digest(root).slice(0, 8), 16);
  return 1 + (value % (HARNESS_SLOT_COUNT - 1));
}

function readPortOverride(env: Record<string, string | undefined>, variable: string): number | undefined {
  const raw = env[variable];
  if (raw === undefined || raw === '') return undefined;

  const port = Number(raw);
  if (!Number.isInteger(port)) {
    throw new Error(`${variable}="${raw}" is not an integer port number`);
  }
  if (port < 1024 || port > 65535) {
    throw new Error(`${variable}=${port} is out of range: a test harness port must be between 1024 and 65535`);
  }
  return port;
}

function readSlotOverride(env: Record<string, string | undefined>): number | undefined {
  const raw = env[SLOT_ENV_VAR];
  if (raw === undefined || raw === '') return undefined;

  const slot = Number(raw);
  if (!Number.isInteger(slot) || slot < 1 || slot >= HARNESS_SLOT_COUNT) {
    throw new Error(`${SLOT_ENV_VAR}="${raw}" must be an integer between 1 and ${HARNESS_SLOT_COUNT - 1}`);
  }
  return slot;
}

/**
 * The pure core: worktree facts plus environment in, every value the
 * harness needs out. No I/O, no clock, no randomness.
 */
export function deriveHarnessIdentity(facts: GitFacts, env: Record<string, string | undefined> = {}): HarnessIdentity {
  const slotOverride = readSlotOverride(env);
  const slot = slotOverride ?? (facts.isMainWorktree ? 0 : worktreeSlot(facts.root));

  const derivedTag = env[TAG_ENV_VAR] || (slot === 0 ? '' : worktreeTag(facts.root));
  const suffix = derivedTag === '' ? '' : `-${derivedTag}`;

  const ports = Object.fromEntries(
    (Object.keys(PORT_OFFSETS) as (keyof HarnessPorts)[]).map((service) => {
      const override = readPortOverride(env, PORT_ENV_VARS[service]);
      const derived =
        slot === 0
          ? MAIN_CHECKOUT_PORTS[service]
          : HARNESS_PORT_BASE + slot * HARNESS_PORTS_PER_SLOT + PORT_OFFSETS[service];
      return [service, override ?? derived];
    }),
  ) as unknown as HarnessPorts;

  return {
    root: facts.root,
    isMainWorktree: facts.isMainWorktree,
    slot,
    tag: derivedTag,
    dbProjectName: `${DB_PROJECT_BASE}${suffix}`,
    apiProjectName: `${API_PROJECT_BASE}${suffix}`,
    minioBucket: `${MINIO_BUCKET_BASE}${suffix}`,
    ownerDatabase: `${OWNER_DB_PREFIX}${(derivedTag || 'main').replace(/[^a-z0-9_]/gi, '_').toLowerCase()}`,
    ports,
  };
}

export type GitExec = (args: readonly string[]) => string;

function defaultGitExec(args: readonly string[]): string {
  return execFileSync('git', args as string[], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

/**
 * Locates this worktree and decides whether it is the repository's main
 * checkout. A linked worktree's `--absolute-git-dir` is
 * `<main>/.git/worktrees/<name>` while its `--git-common-dir` points back
 * at `<main>/.git`; in the main worktree the two are the same directory.
 *
 * `--git-common-dir` is reported relative to the **current directory**,
 * not to the toplevel (`../../.git` when asked from `apps/api`), so it is
 * resolved against `cwd`. Resolving it against the toplevel instead walks
 * two directories too far up, and every workspace member then decides it
 * is a linked worktree and shifts its ports — observed for real while
 * building this.
 *
 * If git cannot answer at all (a source tarball, git not installed), the
 * harness falls back to the checkout this file ships in and behaves as
 * the main checkout — i.e. exactly as it did before this module existed.
 */
export function resolveGitFacts(exec: GitExec = defaultGitExec, cwd: string = process.cwd()): GitFacts {
  const fallbackRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

  try {
    const root = exec(['rev-parse', '--show-toplevel']).trim();
    const gitDir = resolve(cwd, exec(['rev-parse', '--absolute-git-dir']).trim());
    const commonDir = resolve(cwd, exec(['rev-parse', '--git-common-dir']).trim());
    return { root: root || fallbackRoot, isMainWorktree: gitDir === commonDir };
  } catch {
    return { root: fallbackRoot, isMainWorktree: true };
  }
}

let cached: HarnessIdentity | undefined;

/**
 * This process's harness identity, resolved once. Every consumer
 * (provision.ts, apps/api/testing/services.ts, e2e/ports.ts) goes through
 * here so a single worktree can never end up with two answers.
 */
export function harnessIdentity(): HarnessIdentity {
  cached ??= deriveHarnessIdentity(resolveGitFacts(), process.env);
  return cached;
}

/** The env `packages/db/testing/compose.yaml` interpolates. */
export function dbComposeEnv(id: HarnessIdentity): Record<string, string> {
  return {
    COMPOSE_PROJECT_NAME: id.dbProjectName,
    DEEPWIKI_TEST_PG_PORT: String(id.ports.postgres),
    DEEPWIKI_TEST_OWNER_DB: id.ownerDatabase,
  };
}

/** The env `apps/api/testing/compose.yaml` interpolates. */
export function apiComposeEnv(id: HarnessIdentity): Record<string, string> {
  return {
    COMPOSE_PROJECT_NAME: id.apiProjectName,
    DEEPWIKI_TEST_MAILPIT_SMTP_PORT: String(id.ports.mailpitSmtp),
    DEEPWIKI_TEST_MAILPIT_HTTP_PORT: String(id.ports.mailpitHttp),
    DEEPWIKI_TEST_MINIO_PORT: String(id.ports.minioApi),
    DEEPWIKI_TEST_MINIO_CONSOLE_PORT: String(id.ports.minioConsole),
  };
}

/** Renders a compose env as a shell prefix, for error messages a human can paste. */
export function composeEnvPrefix(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');
}

export interface PortOwner {
  readonly container: string;
  readonly project: string;
}

export interface ForeignPortOwner extends PortOwner {
  readonly port: number;
}

/**
 * The `--format` string whose output `parsePortOwners` reads. Fixed and
 * shared so the parser and the command can never drift.
 */
export const PORT_OWNER_PS_FORMAT = '{{.Names}}\t{{index .Labels "com.docker.compose.project"}}\t{{.Ports}}';

/**
 * Maps published host port -> the container publishing it, from
 * `podman|docker ps --format PORT_OWNER_PS_FORMAT`. Handles the range
 * form podman prints when consecutive ports are published together
 * (`0.0.0.0:19000-19001->9000-9001/tcp`) and skips container ports that
 * are not published to the host at all.
 */
export function parsePortOwners(psOutput: string): Map<number, PortOwner> {
  const owners = new Map<number, PortOwner>();

  for (const line of psOutput.split('\n')) {
    const [container, project, ports] = line.split('\t');
    if (container === undefined || project === undefined || ports === undefined) continue;

    for (const mapping of ports.split(',')) {
      const match = /^(?:[^\s:]+:)?(\d+)(?:-(\d+))?->/.exec(mapping.trim());
      if (!match) continue;

      const from = Number(match[1]);
      const to = match[2] === undefined ? from : Number(match[2]);
      for (let port = from; port <= to; port += 1) {
        owners.set(port, { container, project });
      }
    }
  }

  return owners;
}

/**
 * The honest answer to "why can I not have this port?". Returns the first
 * of `ports` that some *other* compose project (or a bare container) is
 * already publishing, so a slot collision between two worktrees reports
 * itself by name instead of surfacing as a compose timeout.
 */
export function findForeignPortOwner(
  psOutput: string,
  ports: readonly number[],
  ownProject: string,
): ForeignPortOwner | undefined {
  const owners = parsePortOwners(psOutput);

  for (const port of ports) {
    const owner = owners.get(port);
    if (owner && owner.project !== ownProject) {
      return { port, ...owner };
    }
  }

  return undefined;
}

/**
 * How long `listPortOwners` will wait for the container runtime. Bounded
 * because it is not free: `podman ps` measured 15-80 seconds on the
 * development host with a couple of dozen containers around, which is why
 * this is only ever called on a path that is already failing, and why it
 * gives up rather than adding a minute to an error.
 */
export const PORT_OWNER_TIMEOUT_MS = 5_000;

/**
 * Best-effort `ps` against the container runtime. A failure here is never
 * fatal: not being able to name the culprit makes the error less useful,
 * but it is not itself an error.
 */
export function listPortOwners(binary: string, exec: (args: readonly string[]) => string = (args) =>
  execFileSync(args[0] as string, args.slice(1) as string[], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: PORT_OWNER_TIMEOUT_MS,
  })): string {
  try {
    return exec([binary, 'ps', '--format', PORT_OWNER_PS_FORMAT]);
  } catch {
    return '';
  }
}

/**
 * Prints the harness environment for this worktree as shell `export`
 * lines, so a human can drive `podman compose` by hand from a linked
 * worktree without every value silently falling back to the main
 * checkout's defaults:
 *
 *   eval "$(bun run packages/db/testing/worktree.ts)"
 */
if (import.meta.main) {
  const id = harnessIdentity();
  const lines = [
    `# deep-wiki test harness — ${id.isMainWorktree ? 'main checkout' : 'linked worktree'} (slot ${id.slot})`,
    `# ${id.root}`,
    ...Object.entries({ ...dbComposeEnv(id), ...apiComposeEnv(id) })
      .filter(([key]) => key !== 'COMPOSE_PROJECT_NAME')
      .map(([key, value]) => `export ${key}=${value}`),
    `export DEEPWIKI_E2E_API_PORT=${id.ports.api}`,
    `export DEEPWIKI_E2E_WEB_PORT=${id.ports.web}`,
    `# db stack:  COMPOSE_PROJECT_NAME=${id.dbProjectName}`,
    `# api stack: COMPOSE_PROJECT_NAME=${id.apiProjectName}`,
  ];
  console.log(lines.join('\n'));
}
