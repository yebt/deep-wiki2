/**
 * Establishes, once per client, that the Postgres on the other end of a
 * connection is actually deep-wiki's.
 *
 * The failure this exists to prevent is not a refused connection. On a
 * developer machine the conventional Postgres port is frequently already
 * published by an unrelated compose project, so `DATABASE_URL` pointing at
 * `localhost:5432` connects *successfully* to somebody else's server. What
 * follows is wrong or missing data — "a workspace and no pages" — which
 * reads as a bug in deep-wiki and has cost this project time twice. A port
 * check cannot catch it: the port is open, it is simply the wrong server.
 *
 * ── The seam ───────────────────────────────────────────────────────────
 *
 * `createDb`/`postgres()` is the wrong place for the check. `postgres.js`
 * connects lazily, so a factory runs before any connection exists; and
 * `createDb`'s only consumer is `migrate.ts`, whose whole job is to run
 * against a database that legitimately has no deep-wiki schema yet.
 *
 * The check therefore hangs off the first *query*. `postgres.js` builds
 * every query — tagged template or `unsafe` — as an inert `Query` object
 * and only sends it when `Query.handle()` calls `query.handler(query)`;
 * `handle()` is already async. Swapping that per-query `handler` for one
 * that awaits the probe first delays the send without reimplementing any
 * of `postgres.js`'s query API: the object handed back is the real
 * `Query`, so `.values()`, `.raw()`, `.cursor()` and `.forEach()` all
 * still work. `begin()` and `reserve()` are gated directly because they
 * build their own scoped client.
 *
 * The probe is one round trip, memoised per client — never per query.
 *
 * ── Identity ───────────────────────────────────────────────────────────
 *
 * `public.workspaces` alone is too common a table name to identify
 * anything, and `drizzle.__drizzle_migrations` identifies *any* Drizzle
 * project. Identity here is `public.workspaces` — the tenancy root
 * deep-wiki cannot exist without — together with `public.cell_members`,
 * whose name comes from deep-wiki's own domain model. A database with
 * both is deep-wiki's. `database-identity.test.ts` pins this to a really
 * migrated database, so a rename in `schema.ts` fails there rather than
 * turning into false collision reports in development.
 *
 * ── Two failure modes, two messages ────────────────────────────────────
 *
 * A foreign database and *our own database before migrations have run*
 * must never produce the same message: the second is a normal state on
 * first setup, and reporting it as a collision would replace one
 * confusing error with another.
 *
 * Nothing here echoes the connection string. Host and port are read from
 * the driver's parsed options, the database name from
 * `current_database()`; the user and password are never touched. This is
 * the same rule `database-url.ts` follows, and its test is mirrored here.
 */
import type postgres from 'postgres';

const IDENTITY_TABLES = ['public.workspaces', 'public.cell_members'] as const;
const MIGRATION_JOURNAL = 'drizzle.__drizzle_migrations';
const MIGRATE_COMMAND = 'bun run -F @deep-wiki/db migrate';
const SAMPLE_LIMIT = 5;

export class DatabaseIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseIdentityError';
  }
}

interface IdentityObservation {
  readonly database: string;
  readonly tableCount: number;
  readonly sampleTables: readonly string[];
  readonly hasWorkspaces: boolean;
  readonly hasCellMembers: boolean;
  readonly hasMigrationJournal: boolean;
}

/** Everything the message is allowed to name about where we connected. */
interface ConnectionTarget {
  readonly host: string;
  readonly port: number | string;
}

/**
 * One round trip. `to_regclass` returns NULL rather than erroring for a
 * relation — or a schema — that does not exist, so all three markers can
 * be asked for at once, whatever is or is not there.
 */
const PROBE_SQL = `
  WITH t AS (
    SELECT n.nspname || '.' || c.relname AS name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('r', 'p')
       AND n.nspname NOT IN ('pg_catalog', 'information_schema', 'drizzle')
       AND n.nspname !~ '^pg_toast'
       AND n.nspname !~ '^pg_temp'
  )
  SELECT
    current_database()::text AS "database",
    (SELECT count(*)::int FROM t) AS "tableCount",
    (SELECT coalesce(array_agg(name), ARRAY[]::text[])
       FROM (SELECT name FROM t ORDER BY name LIMIT ${SAMPLE_LIMIT}) s) AS "sampleTables",
    (to_regclass('public.workspaces') IS NOT NULL) AS "hasWorkspaces",
    (to_regclass('public.cell_members') IS NOT NULL) AS "hasCellMembers",
    (to_regclass('${MIGRATION_JOURNAL}') IS NOT NULL) AS "hasMigrationJournal"
`;

function targetOf(client: postgres.Sql): ConnectionTarget {
  // `ParsedOptions` carries `host: string[]` / `port: number[]` for
  // multi-host URLs. Reading only these two keeps the password — which
  // lives on the same object — out of reach by construction.
  const options = client.options;
  return {
    host: options.host[0] ?? 'unknown host',
    port: options.port[0] ?? 'unknown port',
  };
}

function list(items: readonly string[], conjunction: 'and' | 'or' = 'and'): string {
  if (items.length === 0) return 'nothing';
  if (items.length === 1) return items[0]!;
  return `${items.slice(0, -1).join(', ')} ${conjunction} ${items[items.length - 1]!}`;
}

function sample(observation: IdentityObservation): string {
  if (observation.sampleTables.length === 0) return '';
  const shown = observation.sampleTables.join(', ');
  return observation.tableCount > observation.sampleTables.length ? `${shown}, …` : shown;
}

function where(target: ConnectionTarget, observation: IdentityObservation): string {
  return `Reached ${target.host}:${target.port}, database "${observation.database}".`;
}

export function describeForeignDatabase(target: ConnectionTarget, observation: IdentityObservation): string {
  return [
    `deep-wiki connected to a database that is not deep-wiki's.`,
    '',
    where(target, observation),
    `That database has no deep-wiki schema — no ${list([...IDENTITY_TABLES], 'or')}, and no ${MIGRATION_JOURNAL} journal — ` +
      `but it does hold ${observation.tableCount} other ${observation.tableCount === 1 ? 'table' : 'tables'} (${sample(observation)}).`,
    '',
    `Something other than deep-wiki is serving ${target.host}:${target.port}. Point DATABASE_URL at deep-wiki's own ` +
      `Postgres, or move the other service off that port. Queries stop here rather than run against a foreign schema, ` +
      `because the data that comes back would read as a bug in deep-wiki.`,
  ].join('\n');
}

export function describeUnmigratedDatabase(target: ConnectionTarget, observation: IdentityObservation): string {
  return [
    `deep-wiki's database has no schema yet: migrations have not run.`,
    '',
    where(target, observation),
    `The database is empty — no tables at all, and no ${MIGRATION_JOURNAL} journal. This is the normal state on a ` +
      `first setup, not a port collision.`,
    '',
    `Run \`${MIGRATE_COMMAND}\` against this database, then start again.`,
  ].join('\n');
}

export function describeIncompleteSchema(target: ConnectionTarget, observation: IdentityObservation): string {
  const found = IDENTITY_TABLES.filter((table) =>
    table === 'public.workspaces' ? observation.hasWorkspaces : observation.hasCellMembers,
  );
  const missing = IDENTITY_TABLES.filter((table) => !found.includes(table));
  const journal = observation.hasMigrationJournal ? `${MIGRATION_JOURNAL} is present, and ` : '';

  return [
    `deep-wiki's schema is incomplete: the migration run did not finish.`,
    '',
    where(target, observation),
    `${journal}${found.length > 0 ? `${list([...found])} ${found.length === 1 ? 'exists' : 'exist'}` : 'no deep-wiki table exists'}, ` +
      `but ${list([...missing])} ${missing.length === 1 ? 'does' : 'do'} not. A migration run that stopped part-way leaves exactly this state.`,
    '',
    `Run \`${MIGRATE_COMMAND}\` against this database. If you did not expect deep-wiki's schema here at all, this host ` +
      `and port may belong to another project.`,
  ].join('\n');
}

/** The whole decision, in one place, from one observation. */
export function explainIdentity(target: ConnectionTarget, observation: IdentityObservation): string | undefined {
  if (observation.hasWorkspaces && observation.hasCellMembers) return undefined;

  // Something of ours is here, just not all of it: an interrupted
  // migration run, never a foreign server.
  if (observation.hasWorkspaces || observation.hasCellMembers) {
    return describeIncompleteSchema(target, observation);
  }

  if (observation.tableCount === 0) {
    return observation.hasMigrationJournal
      ? describeIncompleteSchema(target, observation)
      : describeUnmigratedDatabase(target, observation);
  }

  return describeForeignDatabase(target, observation);
}

export async function probeDatabaseIdentity(client: postgres.Sql): Promise<void> {
  const rows = await client.unsafe<IdentityObservation[]>(PROBE_SQL);
  const row = rows[0];
  if (!row) {
    throw new DatabaseIdentityError('the database identity probe returned no rows, which should be impossible');
  }

  const observation: IdentityObservation = {
    database: row.database,
    tableCount: row.tableCount,
    sampleTables: row.sampleTables ?? [],
    hasWorkspaces: row.hasWorkspaces,
    hasCellMembers: row.hasCellMembers,
    hasMigrationJournal: row.hasMigrationJournal,
  };

  const problem = explainIdentity(targetOf(client), observation);
  if (problem) {
    throw new DatabaseIdentityError(problem);
  }
}

/**
 * `postgres.js`'s internal per-query send hook. Not part of its public
 * types, which is why it is named here rather than cast away at the call
 * site: the real-database tests below fail loudly if a driver upgrade
 * moves it.
 */
type QueryHandler = ((query: PendingQueryInternals) => void) & { debug?: unknown };

interface PendingQueryInternals {
  handler: QueryHandler;
  reject(error: unknown): void;
}

function isPendingQuery(value: unknown): value is PendingQueryInternals {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<PendingQueryInternals>;
  return typeof candidate.handler === 'function' && typeof candidate.reject === 'function';
}

/**
 * Returns a client that establishes the database's identity before it
 * sends its first query, and fails every query afterwards if it cannot.
 *
 * The returned object is a proxy over the same client: `end()`,
 * `options`, `listen()` and everything else pass straight through, and
 * the connection is still opened lazily.
 */
export function guardDatabaseIdentity<T extends postgres.Sql>(client: T): T {
  let established: Promise<void> | undefined;

  // Memoised, including its rejection: a failed probe keeps failing with
  // the same message rather than re-asking a server that is not ours.
  const ready = (): Promise<void> => (established ??= probeDatabaseIdentity(client));

  const gate = (value: unknown): unknown => {
    if (!isPendingQuery(value)) return value;

    const send = value.handler;
    const gated: QueryHandler = (query) => {
      ready().then(
        () => send(query),
        (error: unknown) => query.reject(error),
      );
    };
    // `Query.origin` reads `handler.debug`; keep the driver's own flag.
    gated.debug = send.debug;
    value.handler = gated;
    return value;
  };

  const proxy = new Proxy(client as unknown as (...args: unknown[]) => unknown, {
    apply(target, thisArg, args) {
      // A tagged-template call builds a Query; `sql('name')` and
      // `sql({...})` build an Identifier or a Builder, which `gate`
      // returns untouched.
      return gate(Reflect.apply(target, thisArg, args));
    },
    get(target, property) {
      const value = Reflect.get(target, property);

      if (property === 'unsafe' && typeof value === 'function') {
        return (...args: unknown[]) => gate((value as (...a: unknown[]) => unknown).apply(target, args));
      }

      // `begin` and `reserve` build their own scoped client from a
      // closure this proxy cannot reach, so they are gated up front.
      if ((property === 'begin' || property === 'reserve') && typeof value === 'function') {
        return async (...args: unknown[]) => {
          await ready();
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      }

      return value;
    },
  });

  return proxy as unknown as T;
}
