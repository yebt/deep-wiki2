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
 * dedicated test-only port (55432) rather than the dev stack's 5432. This
 * machine (like any self-hoster's) may already run unrelated services on
 * 5432/1025/8025/9000 (verified during this change), so provisioning must
 * not assume dev-stack ports are free. The compose file in this directory
 * is entirely separate from the repository root's `compose.yaml`.
 */
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

export const TEST_DB_PREFIX = 'dw_test_';
const TEMPLATE_DB_NAME = 'deepwiki_test_template';
const COMPOSE_DIR = import.meta.dir;
const DEFAULT_MIGRATIONS_FOLDER = join(import.meta.dir, '..', 'drizzle');
const LOCAL_TEST_URL = 'postgres://dw_test:dw_test@localhost:55432/postgres';
export const COMPOSE_TIMEOUT_MS = 90_000;

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

async function defaultRunCompose(binary: ContainerRuntime, timeoutMs: number): Promise<SpawnResult> {
  const proc = Bun.spawn(buildComposeUpArgs(binary) as string[], {
    cwd: COMPOSE_DIR,
    stdout: 'ignore',
    stderr: 'ignore',
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutMs);

  const code = await proc.exited;
  clearTimeout(timer);
  return { code, timedOut };
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
}

export const defaultProvisionDeps: ResolveAdminUrlDeps = {
  env: process.env,
  probe: defaultProbe,
  detectRuntime: () => detectContainerRuntime(),
  runCompose: defaultRunCompose,
};

function noRuntimeMessage(): string {
  return (
    'no container runtime found on PATH: install podman or docker, or set TEST_DATABASE_URL ' +
    'to an already-reachable Postgres. Manual fallback: (cd packages/db/testing && podman compose up -d --wait postgres)'
  );
}

function noAutostartMessage(): string {
  return (
    'DEEPWIKI_TEST_NO_AUTOSTART=1 is set and no reachable test Postgres was found: run ' +
    '(cd packages/db/testing && podman compose up -d --wait postgres) manually, or unset the variable.'
  );
}

function timeoutMessage(binary: ContainerRuntime, timeoutMs: number): string {
  return (
    `${binary} compose did not report postgres healthy within ${timeoutMs}ms (timed out). ` +
    `Run (cd packages/db/testing && ${buildComposeUpArgs(binary).join(' ')}) manually to see the underlying error.`
  );
}

function composeFailedMessage(binary: ContainerRuntime, code: number | null): string {
  return (
    `${binary} compose exited with code ${code}. ` +
    `Run (cd packages/db/testing && ${buildComposeUpArgs(binary).join(' ')}) manually to see the underlying error.`
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

  if (await deps.probe(LOCAL_TEST_URL)) {
    return LOCAL_TEST_URL;
  }

  if (deps.env.DEEPWIKI_TEST_NO_AUTOSTART === '1') {
    throw new ProvisioningError(noAutostartMessage());
  }

  const binary = deps.detectRuntime();
  if (!binary) {
    throw new ProvisioningError(noRuntimeMessage());
  }

  const result = await deps.runCompose(binary, timeoutMs);
  if (result.timedOut) {
    throw new ProvisioningError(timeoutMessage(binary, timeoutMs));
  }
  if (result.code !== 0) {
    throw new ProvisioningError(composeFailedMessage(binary, result.code));
  }

  if (!(await deps.probe(LOCAL_TEST_URL))) {
    throw new ProvisioningError(composeFailedMessage(binary, result.code));
  }

  return LOCAL_TEST_URL;
}

function withDatabase(url: string, databaseName: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

async function withMaintenanceConnection<T>(adminUrl: string, fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(withDatabase(adminUrl, 'postgres'), { max: 1 });
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
  const client = postgres(templateUrl, { max: 1 });
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
