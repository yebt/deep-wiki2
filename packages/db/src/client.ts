import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { describeInvalidDatabaseUrl } from './database-url';
import * as schema from './schema';

export type Db = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Builds a Drizzle client bound to `url`. `postgres.js` connects lazily —
 * no network I/O happens until the first query — so this factory is safe
 * to call in a unit test with no live database reachable.
 *
 * Deliberately *not* guarded by `guardDatabaseIdentity`. This factory's
 * only consumer is `migrate.ts`, and a migrator whose job is to install
 * deep-wiki's schema must be able to run against a database that does not
 * have it yet. Long-lived application clients are guarded where they are
 * built (`apps/api/src/index.ts`); see `./database-identity.ts` for why
 * the check hangs off the first query rather than off a factory.
 */
export function createDb(url: string): Db {
  // postgres.js throws ERR_INVALID_URL from inside its own parser, which
  // names nothing the developer typed. Fail here instead, with the cause.
  const problem = describeInvalidDatabaseUrl(url);
  if (problem) {
    throw new Error(problem);
  }

  const client = postgres(url, { max: 1 });
  return drizzle(client, { schema });
}
