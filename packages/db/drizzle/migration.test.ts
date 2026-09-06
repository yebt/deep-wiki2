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

  test('the composite tenant-isolation foreign key exists on cell_members (cell_id, workspace_id)', async () => {
    const rows = await sql<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'cell_members'::regclass AND conname = 'cell_members_cell_fk' AND contype = 'f'
    `;
    expect(rows).toHaveLength(1);
  });

  test('the permissions lookup index exists', async () => {
    const rows = await sql<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE tablename = 'permissions' AND indexname = 'permissions_lookup_idx'
    `;
    expect(rows).toHaveLength(1);
  });

  test('the permissions table carries the composite resource and subject-cell foreign keys', async () => {
    const rows = await sql<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'permissions'::regclass AND contype = 'f'
      ORDER BY conname
    `;
    const names = rows.map((r) => r.conname);
    expect(names).toContain('permissions_resource_fk');
    expect(names).toContain('permissions_subject_cell_fk');
  });

  test('nodes gains the three-column (id, workspace_id, type) unique key', async () => {
    const rows = await sql<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'nodes'::regclass AND conname = 'nodes_id_workspace_id_type_key' AND contype = 'u'
    `;
    expect(rows).toHaveLength(1);
  });

  test('page_content and page_blocks exist with the three-column tenant-and-type foreign key', async () => {
    const tables = await sql<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE tablename IN ('page_content', 'page_blocks') ORDER BY tablename
    `;
    expect(tables.map((r) => r.tablename)).toEqual(['page_blocks', 'page_content']);

    const fk = await sql<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'page_content'::regclass AND conname = 'page_content_node_fk' AND contype = 'f'
    `;
    expect(fk).toHaveLength(1);
  });

  test('page_blocks carries the workspace/page/status index', async () => {
    const rows = await sql<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'page_blocks' AND indexname = 'page_blocks_workspace_page_status_idx'
    `;
    expect(rows).toHaveLength(1);
  });

  test('links, tags and page_tags exist with their tenant-scoped uniqueness', async () => {
    const tables = await sql<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE tablename IN ('links', 'tags', 'page_tags') ORDER BY tablename
    `;
    expect(tables.map((r) => r.tablename)).toEqual(['links', 'page_tags', 'tags']);

    const fk = await sql<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'links'::regclass AND conname = 'links_source_fk' AND contype = 'f'
    `;
    expect(fk).toHaveLength(1);

    const tagUnique = await sql<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'tags'::regclass AND conname = 'tags_workspace_name_unique' AND contype = 'u'
    `;
    expect(tagUnique).toHaveLength(1);
  });
});

/**
 * Rollback order is `0010 -> 0009 -> 0008` (design.md "Migration /
 * Rollout"): `links`/`page_tags` carry foreign keys into `page_content`,
 * so 0008's down migration can only run cleanly once 0009's own down has
 * already dropped them — the same dependency order the up migrations
 * establish, in reverse.
 */
describe('0009_knowledge_graph down migration', () => {
  test('reverses cleanly: links, tags and page_tags are all gone', async () => {
    const rollback = await provisionTestDatabase();
    const rollbackSql = postgres(rollback.url, { max: 1 });
    try {
      const downSql = await Bun.file(new URL('./down/0009_knowledge_graph.down.sql', import.meta.url)).text();
      await rollbackSql.unsafe(downSql);

      const tables = await rollbackSql<{ tablename: string }[]>`
        SELECT tablename FROM pg_tables WHERE tablename IN ('links', 'tags', 'page_tags')
      `;
      expect(tables).toHaveLength(0);
    } finally {
      await rollbackSql.end({ timeout: 1 }).catch(() => {});
      await rollback.drop();
    }
  });
});

describe('0008_page_content down migration', () => {
  test('reverses cleanly: page_content, page_blocks, block_status and the unique key are all gone', async () => {
    const rollback = await provisionTestDatabase();
    const rollbackSql = postgres(rollback.url, { max: 1 });
    try {
      // 0009's tables carry foreign keys into page_content — its down
      // migration must run first, exactly as a real rollback would.
      const knowledgeGraphDown = await Bun.file(
        new URL('./down/0009_knowledge_graph.down.sql', import.meta.url),
      ).text();
      await rollbackSql.unsafe(knowledgeGraphDown);

      const downSql = await Bun.file(
        new URL('./down/0008_page_content.down.sql', import.meta.url),
      ).text();
      await rollbackSql.unsafe(downSql);

      const tables = await rollbackSql<{ tablename: string }[]>`
        SELECT tablename FROM pg_tables WHERE tablename IN ('page_content', 'page_blocks')
      `;
      expect(tables).toHaveLength(0);

      const uniqueKey = await rollbackSql<{ conname: string }[]>`
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'nodes'::regclass AND conname = 'nodes_id_workspace_id_type_key'
      `;
      expect(uniqueKey).toHaveLength(0);

      const enumType = await rollbackSql<{ typname: string }[]>`
        SELECT typname FROM pg_type WHERE typname = 'block_status'
      `;
      expect(enumType).toHaveLength(0);
    } finally {
      await rollbackSql.end({ timeout: 1 }).catch(() => {});
      await rollback.drop();
    }
  });
});
