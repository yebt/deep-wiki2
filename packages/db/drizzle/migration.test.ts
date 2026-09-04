/**
 * Guards against a silent drift between the hand-written migration SQL and
 * what actually exists in the database after `migrate()` runs. Drizzle's
 * DSL cannot express the `nodes_set_path` trigger, the composite
 * tenant-isolation foreign key, or the `path` CHECK constraints
 * (schema.ts's module doc comment), so nothing in `schema.ts` would catch
 * a migration that silently dropped one of them. This test asserts the
 * hand-written objects exist directly against Postgres's own catalogs.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '../testing/provision';

let db: ProvisionedTestDatabase;
let sql: postgres.Sql;

beforeAll(async () => {
  db = await provisionTestDatabase();
  sql = postgres(db.url, { max: 1 });
});

afterAll(async () => {
  await sql.end({ timeout: 1 }).catch(() => {});
  await db.drop();
});

describe('after migrate: hand-written objects exist', () => {
  test('the nodes_set_path trigger exists on nodes', async () => {
    const rows = await sql<{ tgname: string }[]>`
      SELECT tgname FROM pg_trigger
      WHERE tgrelid = 'nodes'::regclass AND tgname = 'nodes_set_path_trigger'
    `;
    expect(rows).toHaveLength(1);
  });

  test('the parent-iff-not-workspace CHECK constraint exists', async () => {
    const rows = await sql<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'nodes'::regclass AND conname = 'nodes_parent_iff_not_workspace_chk'
    `;
    expect(rows).toHaveLength(1);
  });

  test('the path shape and length CHECK constraints exist', async () => {
    const rows = await sql<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'nodes'::regclass
        AND conname IN ('nodes_path_shape_chk', 'nodes_path_length_chk')
      ORDER BY conname
    `;
    expect(rows.map((r) => r.conname)).toEqual(['nodes_path_length_chk', 'nodes_path_shape_chk']);
  });

  test('the composite tenant-isolation foreign key exists on (parent_id, workspace_id)', async () => {
    const rows = await sql<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'nodes'::regclass AND conname = 'nodes_parent_fk' AND contype = 'f'
    `;
    expect(rows).toHaveLength(1);
  });

  test('the one-workspace-root-per-workspace partial unique index exists', async () => {
    const rows = await sql<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes
      WHERE tablename = 'nodes' AND indexname = 'nodes_one_workspace_root_idx'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.indexdef).toContain('WHERE');
    expect(rows[0]!.indexdef.toLowerCase()).toContain("type = 'workspace'");
  });

  test('the workspace_id + path index uses text_pattern_ops', async () => {
    const rows = await sql<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes
      WHERE tablename = 'nodes' AND indexname = 'nodes_ws_path_idx'
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.indexdef).toContain('text_pattern_ops');
  });
});
