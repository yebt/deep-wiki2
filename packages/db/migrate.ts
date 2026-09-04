import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './src/client';

/**
 * Runs pending Drizzle migrations from ./drizzle against DATABASE_URL.
 * The migration journal is empty in Phase 0 (no domain schema yet), so a
 * clean run is expected to be a no-op success once a database is reachable
 * (docs/SPECS.md — bootstrap sequence: install, compose up, migrate, seed).
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('migrate: DATABASE_URL is not set');
    process.exit(1);
  }

  const db = createDb(url);
  try {
    await migrate(db, { migrationsFolder: './drizzle' });
    console.log('migrate: done');
  } finally {
    // postgres.js keeps its pool open, so without this the process applies
    // the migrations, prints "done", and then hangs forever. Anyone
    // following the documented bootstrap sequence would read that as a
    // failure and kill a run that had already succeeded.
    await db.$client.end();
  }
}

if (import.meta.main) {
  await main();
}
