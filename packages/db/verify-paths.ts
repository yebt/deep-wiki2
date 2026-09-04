import postgres from 'postgres';
import { verifyPaths } from './src/nodes/verify-paths';

/**
 * Operational repair check (design.md — "Reparent"): recomputes every
 * `path` from `parent_id` and reports any row whose stored cache
 * disagrees. Exits non-zero when a mismatch is found, so it can be wired
 * into a health check or run by hand after a suspected corruption.
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('verify:paths: DATABASE_URL is not set');
    process.exit(1);
  }

  const sql = postgres(url, { max: 1 });
  const mismatches = await verifyPaths(sql);
  await sql.end({ timeout: 1 });

  if (mismatches.length === 0) {
    console.log('verify:paths: ok — every stored path matches parent_id');
    return;
  }

  console.error(`verify:paths: found ${mismatches.length} mismatch(es):`);
  for (const mismatch of mismatches) {
    console.error(`  node ${mismatch.id} (workspace ${mismatch.workspaceId}): stored "${mismatch.storedPath}" != computed "${mismatch.computedPath}"`);
  }
  process.exit(1);
}

if (import.meta.main) {
  await main();
}
