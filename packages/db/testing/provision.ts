/**
 * Deterministic Postgres provisioning for database-backed tests
 * (design.md — "How both get a database", D15).
 *
 * `TEST_DATABASE_URL` set -> use it directly (the CI path). Otherwise probe
 * a dedicated local test Postgres and, if unreachable, bring it up via
 * `podman compose` (or `docker compose`) against the compose file in this
 * directory, bounded at `COMPOSE_TIMEOUT_MS`. Once a server is reachable, a
 * shared `deepwiki_test_template` database is migrated once, and every
 * suite gets its own `dw_test_<n>` database created `TEMPLATE
 * deepwiki_test_template`, dropped in `afterAll`.
 *
 * This module never skips. `describe.skipIf` would make GATE-1 green while
 * proving nothing — the precise failure this harness exists to prevent. A
 * total failure throws with the exact command to run instead.
 *
 * Deviation from design.md's literal wording: the local fallback probes a
 * dedicated test-only port (55432 on the main checkout) rather than the
 * dev stack's 5432. This machine (like any self-hoster's) may already run
 * unrelated services on 5432/1025/8025/9000 (verified during this change),
 * so provisioning must not assume dev-stack ports are free. The compose
 * file in this directory is entirely separate from the repository root's
 * `compose.yaml`.
 *
 * Both that port and the compose project name are per-worktree — see
 * ./worktree.ts, which derives them from this worktree's absolute path so
 * two git worktrees can run their suites at the same time. The main
 * checkout keeps 55432 and the project name `deep-wiki-test`.
 */
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import {
  containerRuntimeEnv,
  listProjectContainers,
  restartStalledStack,
  startContainers,
  type ProjectContainer,
  type StartOutcome,
} from './containers';
import {
  composeEnvPrefix,
  dbComposeEnv,
  findForeignPortOwner,
  harnessIdentity,
  listPortOwners,
  OWNER_DB_PREFIX,
  type ForeignPortOwner,
  type HarnessIdentity,
} from './worktree';

/**
 * `SavePageInput.changesetWindowMinutes`/`WriteRevisionInput.changesetWindowMinutes`
 * are required (versioning-and-collaboration Phase 3 apply log's deferred
 * fix): every `savePage()`/`writeRevision()` caller must thread a real
 * value now, including the many tests in this package and `apps/api` that
 * do not care about changeset grouping at all (a page with no book
 * ancestor never joins one regardless of the value). This is that value —
 * one arbitrary, positive test constant, imported everywhere a test needs
 * "a" window, rather than a bare `30` (or some other number) retyped at
 * every call site. It is deliberately unrelated to `CHANGESET_WINDOW_MINUTES`
 * in `packages/contracts/src/env.ts` — that is the single source of the
 * *production* default; `packages/db` never reads env, so its own tests
 * cannot import that value and do not need to: only its positivity matters
 * here, never its magnitude.
 */
export const TEST_CHANGESET_WINDOW_MINUTES = 30;

export const TEST_DB_PREFIX = 'dw_test_';
const TEMPLATE_DB_NAME = 'deepwiki_test_template';
const COMPOSE_DIR = import.meta.dir;
const DEFAULT_MIGRATIONS_FOLDER = join(import.meta.dir, '..', 'drizzle');
export const COMPOSE_TIMEOUT_MS = 90_000;

/** The admin URL for this worktree's own test Postgres. */
export function localTestUrl(id: HarnessIdentity): string {
  return `postgres://dw_test:dw_test@localhost:${id.ports.postgres}/postgres`;
}

export class UnsafeDatabaseNameError extends Error {
  constructor(name: string) {
    super(
      `refusing to operate on database "${name}": test provisioning only ever creates or drops ` +
        `databases whose name starts with "${TEST_DB_PREFIX}"`,
    );
    this.name = 'UnsafeDatabaseNameError';
  }
}

export class ProvisioningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProvisioningError';
  }
}

export function assertTestDatabaseName(name: string): void {
  if (!name.startsWith(TEST_DB_PREFIX)) {
    throw new UnsafeDatabaseNameError(name);
  }
}

export type ContainerRuntime = 'podman' | 'docker';

export interface SpawnResult {
  readonly code: number | null;
  readonly timedOut: boolean;
  /**
   * What compose wrote to stderr, tail-bounded. Never `'ignore'`d again:
   * the 2026-09-16 exit-125 sat undiagnosed for a day with the cause —
   * `netavark: nftables error: got invalid json` — on this stream.
   */
  readonly stderr: string;
}

/** How much of compose's stderr a failure message carries: the end, where the error is. */
export const COMPOSE_STDERR_TAIL_CHARS = 2_000;

/** The last `limit` characters of `text`, trimmed. */
export function stderrTail(text: string, limit: number = COMPOSE_STDERR_TAIL_CHARS): string {
  const trimmed = text.trim();
  return trimmed.length <= limit ? trimmed : `…${trimmed.slice(-limit)}`;
}

/**
 * The exact, fixed argument vector for bringing up the test postgres
 * service — no shell, no interpolation, no user-supplied token. The
 * compose file itself is never named on the command line; it is resolved
 * by running with `COMPOSE_DIR` as the process cwd (see `runCompose`).
 */
export function buildComposeUpArgs(binary: ContainerRuntime): readonly string[] {
  return [binary, 'compose', 'up', '-d', '--wait', 'postgres'];
}

export function detectContainerRuntime(which: (bin: string) => string | null = (bin) => Bun.which(bin)): ContainerRuntime | undefined {
  if (which('podman')) return 'podman';
  if (which('docker')) return 'docker';
  return undefined;
}

/**
 * The environment the compose process runs with: `env` with every
 * `node_modules/.bin` removed from `PATH` (`containerRuntimeEnv` — the
 * `nft` that netavark must not find), plus this worktree's compose
 * variables on top.
 *
 * The compose project name travels in `COMPOSE_PROJECT_NAME` rather than a
 * `-p` flag, so `buildComposeUpArgs` stays the fixed, token-free vector it
 * has always been. Verified against this host's provider (podman-compose
 * 1.6.0): `COMPOSE_PROJECT_NAME` is honoured at `up` time — note that
 * `podman compose config` does *not* reflect it, which is why the compose
 * files interpolate the same variable into their own `name:` as well, so
 * `config` and `up` agree.
 */
export function composeProcessEnv(id: HarnessIdentity, env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...containerRuntimeEnv(env), ...dbComposeEnv(id) };
}

async function runComposeFor(id: HarnessIdentity, env: NodeJS.ProcessEnv, binary: ContainerRuntime, timeoutMs: number): Promise<SpawnResult> {
  const proc = Bun.spawn(buildComposeUpArgs(binary) as string[], {
    cwd: COMPOSE_DIR,
    env: composeProcessEnv(id, env),
    stdout: 'ignore',
    stderr: 'pipe',
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutMs);

  // Read stderr while the process runs, never after: a compose that fills
  // the pipe and blocks on it would otherwise wait for a reader that is
  // itself waiting for the exit.
  const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  clearTimeout(timer);
  return { code, timedOut, stderr: stderrTail(stderr) };
}

async function defaultProbe(url: string): Promise<boolean> {
  const sql = postgres(url, { max: 1, connect_timeout: 2, onnotice: () => {} });
  try {
    await sql`select 1`;
    return true;
  } catch {
    return false;
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}

export interface ResolveAdminUrlDeps {
  readonly env: Record<string, string | undefined>;
  probe(url: string): Promise<boolean>;
  detectRuntime(): ContainerRuntime | undefined;
  runCompose(binary: ContainerRuntime, timeoutMs: number): Promise<SpawnResult>;
  /** This worktree's derived identity. Defaults to the running worktree's. */
  readonly identity?: HarnessIdentity;
  /** The `dw_owner_*` databases stamped on the server answering `url`. */
  serverOwners?(url: string): Promise<string[]>;
  /** `podman|docker ps` output, used only to name a port's real owner. */
  portOwners?(): string;
  /** This project's containers in any state, asked only once compose has already failed. */
  projectContainers?(binary: ContainerRuntime): ProjectContainer[];
  /** `podman|docker start <names>`: whether the runtime accepted it, and its stderr when it did not. */
  startContainers?(binary: ContainerRuntime, names: readonly string[]): StartOutcome;
  /** Where the one retry announces itself. */
  log?(message: string): void;
}

/**
 * Reads the owner stamps off a running test Postgres. One cheap query on
 * a connection we were opening anyway; the alternative — asking the
 * container runtime which project publishes the port — measured 15-80
 * seconds of `podman ps` on the development host and cannot live on the
 * path every suite takes.
 */
async function defaultServerOwners(url: string): Promise<string[]> {
  const sql = postgres(withDatabase(url, 'postgres'), { max: 1, connect_timeout: 2, onnotice: () => {} });
  try {
    const rows = await sql<{ datname: string }[]>`
      select datname from pg_database where datname like ${`${OWNER_DB_PREFIX}%`}
    `;
    return rows.map((row) => row.datname);
  } catch {
    return [];
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}

let cachedPortOwners: string | undefined;

function defaultPortOwners(): string {
  // One bounded `ps` per process, and only ever on a path that is already
  // failing — never on the path a green run takes.
  cachedPortOwners ??= listPortOwners(detectContainerRuntime() ?? 'podman');
  return cachedPortOwners;
}

export interface ProvisionDepsOptions {
  /** The worktree to provision for. Defaults to the running one. */
  readonly identity?: HarnessIdentity;
  /** The environment compose and the runtime are spawned from. Defaults to this process's. */
  readonly env?: NodeJS.ProcessEnv;
}

/**
 * The real dependencies — real compose, real `ps`/`start`, real probe —
 * bound to one worktree identity. `defaultProvisionDeps` is this for the
 * running worktree; `provision.integration.test.ts` builds a second set
 * for a throwaway project so it can drive the genuine path against a
 * container it deliberately left in `Created`, without touching the
 * Postgres the rest of the suite is using.
 */
export function createProvisionDeps(options: ProvisionDepsOptions = {}): ResolveAdminUrlDeps {
  const env = options.env ?? process.env;
  const identityOf = (): HarnessIdentity => options.identity ?? harnessIdentity();
  return {
    env,
    probe: defaultProbe,
    detectRuntime: () => detectContainerRuntime(),
    runCompose: (binary, timeoutMs) => runComposeFor(identityOf(), env, binary, timeoutMs),
    serverOwners: defaultServerOwners,
    portOwners: defaultPortOwners,
    ...(options.identity ? { identity: options.identity } : {}),
    projectContainers: (binary) => listProjectContainers(binary, identityOf().dbProjectName),
    startContainers,
    log: (message) => console.warn(`packages/db/testing: ${message}`),
  };
}

export const defaultProvisionDeps: ResolveAdminUrlDeps = createProvisionDeps();

/**
 * The manual command, carrying the environment that makes it mean the
 * same thing this process meant. Pasting it from a linked worktree
 * without the prefix would start the *main checkout's* stack.
 */
function manualCommand(id: HarnessIdentity, binary: ContainerRuntime = 'podman'): string {
  return `(cd packages/db/testing && ${composeEnvPrefix(dbComposeEnv(id))} ${buildComposeUpArgs(binary).join(' ')})`;
}

function noRuntimeMessage(id: HarnessIdentity): string {
  return (
    'no container runtime found on PATH: install podman or docker, or set TEST_DATABASE_URL ' +
    `to an already-reachable Postgres. Manual fallback: ${manualCommand(id)}`
  );
}

function noAutostartMessage(id: HarnessIdentity): string {
  return (
    'DEEPWIKI_TEST_NO_AUTOSTART=1 is set and no reachable test Postgres was found: run ' +
    `${manualCommand(id)} manually, or unset the variable.`
  );
}

/** Compose's own last words, when it had any, as a paragraph the failure message can end with. */
function composeSaid(binary: ContainerRuntime, stderr: string): string {
  return stderr ? `\n${binary} compose said:\n${stderr}` : '';
}

function timeoutMessage(binary: ContainerRuntime, timeoutMs: number, id: HarnessIdentity, stderr: string): string {
  return (
    `${binary} compose did not report postgres healthy within ${timeoutMs}ms (timed out). ` +
    `Run ${manualCommand(id, binary)} manually to see the underlying error.` +
    composeSaid(binary, stderr)
  );
}

function composeFailedMessage(binary: ContainerRuntime, code: number | null, id: HarnessIdentity, stderr: string): string {
  return (
    `${binary} compose exited with code ${code}. ` +
    `Run ${manualCommand(id, binary)} manually to see the underlying error.` +
    composeSaid(binary, stderr)
  );
}

/**
 * The honest version of "the database timed out". Two worktrees derive
 * the same port only if their path digests land on the same slot; when
 * that happens the harness must say so, because silently reusing the
 * other worktree's Postgres would mean running this worktree's suites
 * against the other one's migrations — flaky application behaviour with
 * no application cause, which is exactly the failure this harness exists
 * to prevent.
 */
export function ownerConflictMessage(owners: readonly string[], id: HarnessIdentity): string {
  return (
    `the Postgres answering on port ${id.ports.postgres} belongs to a different worktree: it is stamped ` +
    `${owners.map((owner) => `"${owner}"`).join(', ')}, but this worktree (${id.root}, slot ${id.slot}) is ` +
    `"${id.ownerDatabase}". Two worktrees derived the same harness slot. Running against it would migrate and query ` +
    'the other worktree’s database, so provisioning stops here instead. Move this worktree out of the way with ' +
    'DEEPWIKI_TEST_SLOT=<1..248> (or DEEPWIKI_TEST_PG_PORT=<port>), or stop the other worktree’s stack.'
  );
}

/** The same answer, when the obstacle is a container rather than another worktree's Postgres. */
export function portConflictMessage(owner: ForeignPortOwner, id: HarnessIdentity): string {
  return (
    `host port ${owner.port} is already published by container "${owner.container}"` +
    (owner.project ? ` of a different compose project ("${owner.project}")` : ' outside any compose project') +
    `, but this worktree (${id.root}, slot ${id.slot}, project "${id.dbProjectName}") needs it for its own test Postgres. ` +
    'This is a port collision, not a broken database. Move this worktree out of the way with ' +
    `DEEPWIKI_TEST_SLOT=<1..248> (or DEEPWIKI_TEST_PG_PORT=<port>), or stop "${owner.container}".`
  );
}

/**
 * Resolves the admin connection URL used to create/drop per-suite test
 * databases. Never skips: every failure path throws a `ProvisioningError`
 * naming the exact manual command to run (D15).
 */
export async function resolveAdminUrl(deps: ResolveAdminUrlDeps, timeoutMs: number = COMPOSE_TIMEOUT_MS): Promise<string> {
  const envUrl = deps.env.TEST_DATABASE_URL;
  if (envUrl) {
    return envUrl;
  }

  const id = deps.identity ?? harnessIdentity();
  const url = localTestUrl(id);

  // Only ever on a path that is already failing: `podman ps` is slow
  // enough (15-80s measured) that it must never touch a green run.
  const assertPortIsOurs = (): void => {
    const foreign = findForeignPortOwner(deps.portOwners?.() ?? '', [id.ports.postgres], id.dbProjectName);
    if (foreign) {
      throw new ProvisioningError(portConflictMessage(foreign, id));
    }
  };

  const assertServerIsOurs = async (): Promise<void> => {
    const owners = (await deps.serverOwners?.(url)) ?? [];
    // No stamp at all: a container older than this check. Nothing to
    // conclude, and inventing a conflict would be worse than missing one.
    if (owners.length === 0 || owners.includes(id.ownerDatabase)) return;
    throw new ProvisioningError(ownerConflictMessage(owners, id));
  };

  if (await deps.probe(url)) {
    // Something answers on our port. Before trusting it, make sure it is
    // ours: another worktree's Postgres would happily accept the
    // connection and then serve this suite the wrong schema.
    await assertServerIsOurs();
    return url;
  }

  if (deps.env.DEEPWIKI_TEST_NO_AUTOSTART === '1') {
    throw new ProvisioningError(noAutostartMessage(id));
  }

  const binary = deps.detectRuntime();
  if (!binary) {
    throw new ProvisioningError(noRuntimeMessage(id));
  }

  const result = await deps.runCompose(binary, timeoutMs);
  let failure: string | undefined;
  if (result.timedOut) failure = timeoutMessage(binary, timeoutMs, id, result.stderr);
  else if (result.code !== 0) failure = composeFailedMessage(binary, result.code, id, result.stderr);
  else if (!(await deps.probe(url))) failure = composeFailedMessage(binary, result.code, id, result.stderr);

  // Compose can come back with the container created and never started —
  // killed at the bound, or (2026-09-16) refused by the runtime for a
  // reason that also sinks the retry below, see containers.ts. The one
  // retry is kept for the first case; for the second, its reason now
  // rides along in the failure instead of vanishing into a `false`.
  if (failure !== undefined) {
    const outcome = await restartStalledStack(binary, id.dbProjectName, timeoutMs, {
      projectContainers: (bin) => deps.projectContainers?.(bin) ?? [],
      startContainers: (bin, names) => deps.startContainers?.(bin, names) ?? { started: false, reason: 'no runtime access' },
      reachable: () => deps.probe(url),
      log: (message) => deps.log?.(message),
    });
    if (!outcome.healed) {
      assertPortIsOurs();
      throw new ProvisioningError(`${failure}\nThe one retry did not help: ${outcome.reason}`);
    }
  }

  await assertServerIsOurs();
  return url;
}

function withDatabase(url: string, databaseName: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function withMaintenanceConnection<T>(adminUrl: string, fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(withDatabase(adminUrl, 'postgres'), { max: 1, onnotice: () => {} });
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}

let templateReady: Promise<void> | undefined;

/**
 * Migrates `deepwiki_test_template` exactly once per process. Every
 * suite's database is then a cheap `CREATE DATABASE ... TEMPLATE` copy
 * instead of re-running every migration per suite.
 */
export async function ensureTemplateDatabase(adminUrl: string, migrationsFolder: string = DEFAULT_MIGRATIONS_FOLDER): Promise<void> {
  await withMaintenanceConnection(adminUrl, async (sql) => {
    const rows = await sql`select 1 from pg_database where datname = ${TEMPLATE_DB_NAME}`;
    if (rows.length === 0) {
      await sql.unsafe(`CREATE DATABASE "${TEMPLATE_DB_NAME}"`);
    }
  });

  const templateUrl = withDatabase(adminUrl, TEMPLATE_DB_NAME);
  const client = postgres(templateUrl, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client.end({ timeout: 1 }).catch(() => {});
  }
}

function randomTestDatabaseName(): string {
  return `${TEST_DB_PREFIX}${randomBytes(8).toString('hex')}`;
}

export interface ProvisionedTestDatabase {
  readonly url: string;
  readonly name: string;
  drop(): Promise<void>;
}

export async function dropTestDatabase(adminSql: Pick<postgres.Sql, 'unsafe'>, name: string): Promise<void>;
export async function dropTestDatabase(adminUrl: string, name: string): Promise<void>;
export async function dropTestDatabase(adminSqlOrUrl: Pick<postgres.Sql, 'unsafe'> | string, name: string): Promise<void> {
  assertTestDatabaseName(name);

  if (typeof adminSqlOrUrl === 'string') {
    await withMaintenanceConnection(adminSqlOrUrl, (sql) => sql.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`));
    return;
  }

  await adminSqlOrUrl.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
}

/**
 * Provisions a fresh, isolated test database for one suite. Resolves the
 * admin connection, migrates the shared template once per process, then
 * creates a `dw_test_<n>` database as a template copy. Callers MUST call
 * `.drop()` in `afterAll`.
 */
export async function provisionTestDatabase(
  deps: ResolveAdminUrlDeps = defaultProvisionDeps,
  migrationsFolder: string = DEFAULT_MIGRATIONS_FOLDER,
): Promise<ProvisionedTestDatabase> {
  const adminUrl = await resolveAdminUrl(deps);

  templateReady ??= ensureTemplateDatabase(adminUrl, migrationsFolder);
  await templateReady;

  const name = randomTestDatabaseName();
  assertTestDatabaseName(name);

  await withMaintenanceConnection(adminUrl, (sql) => sql.unsafe(`CREATE DATABASE "${name}" TEMPLATE "${TEMPLATE_DB_NAME}"`));

  return {
    url: withDatabase(adminUrl, name),
    name,
    drop: () => dropTestDatabase(adminUrl, name),
  };
}
