import postgres from 'postgres';
import { backfillRender } from './src/content/backfill-render';

/**
 * Runs the render-format backfill against `DATABASE_URL` (comment-overlay
 * spec: "A Render-Format Change Requires A Backfill"). Safe to re-run:
 * every row it touches leaves the staleness filter once updated, so an
 * interrupted run simply resumes where it left off on the next invocation.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('backfill:render: DATABASE_URL is not set');
    process.exit(1);
  }

  const sql = postgres(url);
  try {
    const result = await backfillRender(sql);
    console.log(`backfill:render: done — ${result.updated} updated, ${result.skipped} skipped (concurrent save)`);
  } finally {
    await sql.end();
  }
}

if (import.meta.main) {
  await main();
}
