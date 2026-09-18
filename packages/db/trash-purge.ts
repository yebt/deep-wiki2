import postgres from 'postgres';
import { purgeTrash } from './src/trash/purge';

/**
 * `bun run -F @deep-wiki/db trash:purge --workspace <id|slug>`
 * `bun run -F @deep-wiki/db trash:purge --all`
 *
 * The 30-day purge's only trigger (trash-purge spec: "No On-Demand Purge
 * Exists" — this CLI is operator-invoked, on a schedule, never a route or a
 * button; see `docs/RUNNING.md`'s cron line). `--all` iterates every
 * workspace one transaction each, in the `ai-reindex.ts` shape: no
 * in-process scheduler, refuse before any database work, exit non-zero on
 * a bad invocation.
 */
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `apps/api/src/routes/workspace-ref.ts`'s own slug alphabet — anything else names nothing and is refused before any connection opens. */
const SLUG_SHAPE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function readFlag(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

/** By id or by slug, exactly `apps/api/src/routes/workspace-ref.ts`'s own resolution — a ref that is neither shape resolves to `undefined`. */
async function resolveWorkspaceId(sql: postgres.Sql, ref: string): Promise<string | undefined> {
  const [bySlug] = await sql<{ id: string }[]>`SELECT id FROM workspaces WHERE slug = ${ref}`;
  if (bySlug) return bySlug.id;
  return UUID_SHAPE.test(ref) ? ref : undefined;
}

async function purgeOne(sql: postgres.Sql, workspaceId: string): Promise<void> {
  const result = await purgeTrash(sql, { workspaceId });
  console.log(`trash:purge: workspace ${workspaceId} — run ${result.runId}, purged ${result.purgedNodes} node(s)`);
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('trash:purge: DATABASE_URL is not set');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const workspaceRef = readFlag(args, 'workspace');
  const all = args.includes('--all');

  if (!workspaceRef && !all) {
    console.error('trash:purge: --workspace <id|slug> or --all is required');
    process.exit(1);
  }
  if (workspaceRef && all) {
    console.error('trash:purge: --workspace and --all are mutually exclusive');
    process.exit(1);
  }
  if (workspaceRef && !UUID_SHAPE.test(workspaceRef) && !SLUG_SHAPE.test(workspaceRef)) {
    console.error(`trash:purge: "${workspaceRef}" is not a valid workspace id or slug`);
    process.exit(1);
  }

  const sql = postgres(url);
  try {
    if (all) {
      const workspaces = await sql<{ id: string }[]>`SELECT id FROM workspaces ORDER BY created_at`;
      for (const workspace of workspaces) {
        await purgeOne(sql, workspace.id);
      }
      return;
    }

    const workspaceId = await resolveWorkspaceId(sql, workspaceRef!);
    if (!workspaceId) {
      console.error(`trash:purge: no workspace matches "${workspaceRef}"`);
      process.exit(1);
    }
    await purgeOne(sql, workspaceId);
  } finally {
    await sql.end();
  }
}

if (import.meta.main) {
  await main();
}
