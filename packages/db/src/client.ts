import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

export type Db = ReturnType<typeof drizzle<typeof schema>>;

/**
 * Builds a Drizzle client bound to `url`. `postgres.js` connects lazily —
 * no network I/O happens until the first query — so this factory is safe
 * to call in a unit test with no live database reachable.
 */
export function createDb(url: string): Db {
  const client = postgres(url, { max: 1 });
  return drizzle(client, { schema });
}
