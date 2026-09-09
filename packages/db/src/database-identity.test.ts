/**
 * Every case here runs against a real Postgres. A test that stubbed the
 * probe's own query would prove nothing about whether the probe runs, or
 * when — the two things this module exists to guarantee — so each state
 * is a real database on the auto-provisioned test server, reached over a
 * real connection.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { defaultProvisionDeps, dropTestDatabase, ensureTemplateDatabase, resolveAdminUrl, TEST_DB_PREFIX } from '../testing/provision';
import { DatabaseIdentityError, guardDatabaseIdentity } from './database-identity';

const TEMPLATE_DB_NAME = 'deepwiki_test_template';
/** A password no other string in this suite contains, so the no-leak assertion can only pass honestly. */
const SENTINEL_PASSWORD = 'p4ssw0rd-must-never-be-echoed';

let adminUrl: string;
let admin: postgres.Sql;
let target: string;
const createdDatabases: string[] = [];
const createdRoles: string[] = [];
const openClients: postgres.Sql[] = [];

function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

function testDatabaseName(): string {
  return `${TEST_DB_PREFIX}${randomBytes(6).toString('hex')}`;
}

async function createDatabase(template?: string): Promise<string> {
  const name = testDatabaseName();
  await admin.unsafe(`CREATE DATABASE "${name}"${template ? ` TEMPLATE "${template}"` : ''}`);
  createdDatabases.push(name);
  return name;
}

function connect(databaseName: string, options: postgres.Options<Record<string, never>> = {}): postgres.Sql {
  const client = postgres(withDatabase(adminUrl, databaseName), { max: 1, onnotice: () => {}, ...options });
  openClients.push(client);
  return client;
}

async function inDatabase(databaseName: string, statements: readonly string[]): Promise<void> {
  const sql = postgres(withDatabase(adminUrl, databaseName), { max: 1, onnotice: () => {} });
  try {
    for (const statement of statements) {
      await sql.unsafe(statement);
    }
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}

async function messageFromFirstQuery(sql: postgres.Sql): Promise<string> {
  let caught: unknown;
  try {
    await sql`SELECT 1`;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(DatabaseIdentityError);
  return (caught as Error).message;
}

beforeAll(async () => {
  adminUrl = await resolveAdminUrl(defaultProvisionDeps);
  await ensureTemplateDatabase(adminUrl);
  admin = postgres(withDatabase(adminUrl, 'postgres'), { max: 1, onnotice: () => {} });
  const parsed = new URL(adminUrl);
  target = `${parsed.hostname}:${parsed.port}`;
}, 120_000);

afterAll(async () => {
  await Promise.all(openClients.map((client) => client.end({ timeout: 1 }).catch(() => {})));
  for (const name of createdDatabases) {
    await dropTestDatabase(admin, name).catch(() => {});
  }
  for (const role of createdRoles) {
    await admin.unsafe(`DROP ROLE IF EXISTS "${role}"`).catch(() => {});
  }
  await admin.end({ timeout: 1 }).catch(() => {});
}, 60_000);

describe('guardDatabaseIdentity — a migrated deep-wiki database', () => {
  test('lets queries through and returns their rows', async () => {
    const name = await createDatabase(TEMPLATE_DB_NAME);
    const sql = guardDatabaseIdentity(connect(name));

    const rows = await sql`SELECT count(*)::int AS n FROM workspaces`;

    expect(rows[0]!.n).toBe(0);
  });

  test('lets `unsafe` queries and transactions through too', async () => {
    const name = await createDatabase(TEMPLATE_DB_NAME);
    const sql = guardDatabaseIdentity(connect(name));

    const rows = await sql.unsafe('SELECT count(*)::int AS n FROM cell_members');
    const inTransaction = await sql.begin(async (tx) => tx`SELECT 7 AS n`);

    expect(rows[0]!.n).toBe(0);
    expect((inTransaction as unknown as { n: number }[])[0]!.n).toBe(7);
  });

  test('establishes identity once per client, not once per query', async () => {
    const name = await createDatabase(TEMPLATE_DB_NAME);
    let probeQueries = 0;
    let applicationQueries = 0;
    // Counted at the driver's own write path, not on a stub: every string
    // below is one that actually reached the socket.
    const sql = guardDatabaseIdentity(
      connect(name, {
        debug: (_connection: number, query: string) => {
          if (query.includes('to_regclass')) probeQueries += 1;
          if (query.includes('identity_probe_witness')) applicationQueries += 1;
        },
      } as postgres.Options<Record<string, never>>),
    );

    for (let i = 0; i < 5; i += 1) {
      await sql`SELECT ${i} AS identity_probe_witness`;
    }

    expect(applicationQueries).toBe(5);
    expect(probeQueries).toBe(1);
  });

  test('concurrent first queries share one probe', async () => {
    const name = await createDatabase(TEMPLATE_DB_NAME);
    let probeQueries = 0;
    const sql = guardDatabaseIdentity(
      connect(name, {
        debug: (_connection: number, query: string) => {
          if (query.includes('to_regclass')) probeQueries += 1;
        },
      } as postgres.Options<Record<string, never>>),
    );

    await Promise.all([sql`SELECT 1`, sql`SELECT 2`, sql`SELECT 3`, sql`SELECT 4`]);

    expect(probeQueries).toBe(1);
  });
});

describe('guardDatabaseIdentity — a database that is not deep-wiki’s', () => {
  let foreignDatabase: string;

  beforeAll(async () => {
    foreignDatabase = await createDatabase();
    await inDatabase(foreignDatabase, [
      'CREATE TABLE restaurants (id serial PRIMARY KEY, name text)',
      'CREATE TABLE menu_items (id serial PRIMARY KEY, name text)',
      'CREATE TABLE orders (id serial PRIMARY KEY, total numeric)',
    ]);
  });

  test('the first query fails, naming the host and port that were reached', async () => {
    const message = await messageFromFirstQuery(guardDatabaseIdentity(connect(foreignDatabase)));

    expect(message).toContain(target);
    expect(message).toContain(foreignDatabase);
  });

  test('the message says the database has no deep-wiki schema, and names what is there instead', async () => {
    const message = await messageFromFirstQuery(guardDatabaseIdentity(connect(foreignDatabase)));

    expect(message).toContain('no deep-wiki schema');
    expect(message).toContain('public.workspaces');
    expect(message).toContain('public.menu_items');
    expect(message).not.toContain('migrations have not run');
  });

  test('every later query fails the same way, rather than running against the foreign schema', async () => {
    const sql = guardDatabaseIdentity(connect(foreignDatabase));

    const first = await messageFromFirstQuery(sql);
    const second = await messageFromFirstQuery(sql);

    expect(second).toBe(first);
  });

  test('the message never echoes the connection string or the password it carries', async () => {
    const role = `dw_leak_${randomBytes(4).toString('hex')}`;
    await admin.unsafe(`CREATE ROLE "${role}" LOGIN PASSWORD '${SENTINEL_PASSWORD}'`);
    createdRoles.push(role);
    await admin.unsafe(`GRANT CONNECT ON DATABASE "${foreignDatabase}" TO "${role}"`);
    const parsed = new URL(adminUrl);
    const url = `postgres://${role}:${SENTINEL_PASSWORD}@${parsed.hostname}:${parsed.port}/${foreignDatabase}`;
    const client = postgres(url, { max: 1, onnotice: () => {} });
    openClients.push(client);

    const message = await messageFromFirstQuery(guardDatabaseIdentity(client));

    expect(message).not.toContain(SENTINEL_PASSWORD);
    expect(message).not.toContain(url);
    expect(message).not.toContain(role);
    expect(message).not.toContain('postgres://');
  });
});

describe('guardDatabaseIdentity — deep-wiki’s own database before migrations have run', () => {
  test('an empty database is reported as unmigrated, not as a collision', async () => {
    const name = await createDatabase();

    const message = await messageFromFirstQuery(guardDatabaseIdentity(connect(name)));

    expect(message).toContain('migrations have not run');
    expect(message).toContain('bun run -F @deep-wiki/db migrate');
    expect(message).toContain(target);
    expect(message).not.toContain('is not deep-wiki');
  });

  test('a half-applied migration run is reported as an unfinished run, not as either of the other two', async () => {
    const name = await createDatabase();
    await inDatabase(name, [
      'CREATE SCHEMA drizzle',
      'CREATE TABLE drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint)',
      'CREATE TABLE workspaces (id uuid PRIMARY KEY)',
    ]);

    const message = await messageFromFirstQuery(guardDatabaseIdentity(connect(name)));

    expect(message).toContain('did not finish');
    expect(message).toContain('public.cell_members');
    expect(message).toContain('bun run -F @deep-wiki/db migrate');
    expect(message).not.toContain('migrations have not run');
    expect(message).not.toContain('is not deep-wiki');
  });
});
