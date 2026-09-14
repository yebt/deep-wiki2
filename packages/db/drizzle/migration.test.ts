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

  // 0008's comment on `page_blocks` claims a tombstoned id "can never be
  // reused for a new block", but UNIQUE (page_id, block_id) only forbids a
  // second row — it does not stop `ON CONFLICT ... DO UPDATE SET status =
  // 'active'` from flipping the existing one. 0016 adds the mechanism that
  // comment was already asserting; without it, deleting every tombstone
  // check in `packages/db` would leave the suite green.
  test('the page_blocks_forbid_resurrection trigger exists on page_blocks', async () => {
    const rows = await sql<{ tgname: string }[]>`
      SELECT tgname FROM pg_trigger
      WHERE tgrelid = 'page_blocks'::regclass AND tgname = 'page_blocks_forbid_resurrection_trigger'
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

  test('page_locks exists with its composite foreign key into page_content', async () => {
    const tables = await sql<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE tablename = 'page_locks'
    `;
    expect(tables).toHaveLength(1);

    const fk = await sql<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'page_locks'::regclass AND conname = 'page_locks_page_fk' AND contype = 'f'
    `;
    expect(fk).toHaveLength(1);
  });

  test('page_blocks carries the split_from column and its composite self-referential foreign key', async () => {
    const columns = await sql<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'page_blocks' AND column_name = 'split_from'
    `;
    expect(columns).toHaveLength(1);

    const fk = await sql<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'page_blocks'::regclass AND conname = 'page_blocks_split_from_fk' AND contype = 'f'
    `;
    expect(fk).toHaveLength(1);
  });

  test('changeset and page_revision exist with their composite foreign keys and the immutability trigger', async () => {
    const tables = await sql<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE tablename IN ('changeset', 'page_revision') ORDER BY tablename
    `;
    expect(tables.map((r) => r.tablename)).toEqual(['changeset', 'page_revision']);

    const bookFk = await sql<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'changeset'::regclass AND conname = 'changeset_book_fk' AND contype = 'f'
    `;
    expect(bookFk).toHaveLength(1);

    const openPerAuthorIdx = await sql<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'changeset' AND indexname = 'changeset_open_per_author_idx'
    `;
    expect(openPerAuthorIdx).toHaveLength(1);

    const revisionFks = await sql<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'page_revision'::regclass AND contype = 'f'
      ORDER BY conname
    `;
    const revisionFkNames = revisionFks.map((r) => r.conname);
    expect(revisionFkNames).toContain('page_revision_changeset_fk');
    expect(revisionFkNames).toContain('page_revision_page_fk');

    const trigger = await sql<{ tgname: string }[]>`
      SELECT tgname FROM pg_trigger
      WHERE tgrelid = 'page_revision'::regclass AND tgname = 'page_revision_forbid_update_trigger'
    `;
    expect(trigger).toHaveLength(1);
  });

  test('comments exists with its composite foreign keys and the root-has-anchor CHECK', async () => {
    const tables = await sql<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE tablename = 'comments'
    `;
    expect(tables).toHaveLength(1);

    const fks = await sql<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'comments'::regclass AND contype = 'f'
      ORDER BY conname
    `;
    const fkNames = fks.map((r) => r.conname);
    expect(fkNames).toContain('comments_page_fk');
    expect(fkNames).toContain('comments_block_fk');
    expect(fkNames).toContain('comments_parent_fk');

    const check = await sql<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'comments'::regclass AND conname = 'comments_root_has_anchor' AND contype = 'c'
    `;
    expect(check).toHaveLength(1);
  });

  // 0015: `comments_parent_fk` originally keyed on (parent_id,
  // workspace_id), which constrains the tenant while every reader of the
  // thread depends on the narrower page scope the key never mentioned.
  // The fix is the column list itself — a reply naming a parent on
  // another page has no referenced row to match.
  test('comments_parent_fk carries page_id, not workspace_id alone', async () => {
    const [row] = await sql<{ columns: string[]; referenced: string[] }[]>`
      SELECT
        ARRAY(
          SELECT a.attname::text FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
          ORDER BY k.ord
        ) AS columns,
        ARRAY(
          SELECT a.attname::text FROM unnest(c.confkey) WITH ORDINALITY AS k(attnum, ord)
          JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.attnum
          ORDER BY k.ord
        ) AS referenced
      FROM pg_constraint c
      WHERE c.conrelid = 'comments'::regclass AND c.conname = 'comments_parent_fk' AND c.contype = 'f'
    `;
    expect(row).toBeDefined();
    expect([...row!.columns].sort()).toEqual(['page_id', 'parent_id', 'workspace_id']);
    expect([...row!.referenced].sort()).toEqual(['id', 'page_id', 'workspace_id']);
  });

  // editing-presence spec: "Presence Table Tenant Isolation By Composite
  // Foreign Key" — closed here in its strongest form, a view has no rows
  // to be cross-tenant, and it selects straight from page_locks (which
  // already carries `page_locks_page_fk`).
  test('presence view exists and selects from page_locks', async () => {
    const views = await sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.views WHERE table_name = 'presence'
    `;
    expect(views).toHaveLength(1);

    const definition = await sql<{ definition: string }[]>`
      SELECT pg_get_viewdef('presence'::regclass, true) AS definition
    `;
    expect(definition[0]!.definition).toContain('page_locks');
  });
});

/**
 * Rollback order is `0014 -> 0013 -> ... -> 0008` (design.md "Migration /
 * Rollout"): `links`/`page_tags`/`page_locks`/`comments` all carry foreign
 * keys into `page_content` (`comments` also into `page_blocks`), and the
 * `presence` view selects from `page_locks` — so 0010's down migration
 * (dropping `page_locks`) can only run cleanly once 0014's down has
 * already dropped the view, and 0008's down migration can only run
 * cleanly once every later down has already dropped what depends on it —
 * the same dependency order the up migrations establish, in reverse.
 */
describe('0015_comment_parent_page_scope down migration', () => {
  // 0015 only re-keys an existing constraint on `comments`; it creates no
  // table and no foreign key into an earlier migration's table, so it adds
  // no new rollback-ordering dependency — 0013's down still drops the whole
  // table on its own.
  test('reverses cleanly: comments_parent_fk is back to (parent_id, workspace_id)', async () => {
    const rollback = await provisionTestDatabase();
    const rollbackSql = postgres(rollback.url, { max: 1 });
    try {
      const downSql = await Bun.file(
        new URL('./down/0015_comment_parent_page_scope.down.sql', import.meta.url),
      ).text();
      await rollbackSql.unsafe(downSql);

      const [row] = await rollbackSql<{ columns: string[] }[]>`
        SELECT ARRAY(
          SELECT a.attname::text FROM unnest(c.conkey) AS k(attnum)
          JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
        ) AS columns
        FROM pg_constraint c
        WHERE c.conrelid = 'comments'::regclass AND c.conname = 'comments_parent_fk' AND c.contype = 'f'
      `;
      expect([...row!.columns].sort()).toEqual(['parent_id', 'workspace_id']);

      const unique = await rollbackSql<{ conname: string }[]>`
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'comments'::regclass AND conname = 'comments_id_page_workspace_unique'
      `;
      expect(unique).toHaveLength(0);
    } finally {
      await rollbackSql.end({ timeout: 1 }).catch(() => {});
      await rollback.drop();
    }
    // Provision + connect + re-add the constraint + drop lands within a few
    // milliseconds of bun's 5s default on a loaded machine; the explicit
    // budget keeps a slow run from reporting as a rollback failure.
  }, 20_000);
});

describe('0014_presence_view down migration', () => {
  test('reverses cleanly: the presence view is gone', async () => {
    const rollback = await provisionTestDatabase();
    const rollbackSql = postgres(rollback.url, { max: 1 });
    try {
      const downSql = await Bun.file(new URL('./down/0014_presence_view.down.sql', import.meta.url)).text();
      await rollbackSql.unsafe(downSql);

      const views = await rollbackSql<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.views WHERE table_name = 'presence'
      `;
      expect(views).toHaveLength(0);
    } finally {
      await rollbackSql.end({ timeout: 1 }).catch(() => {});
      await rollback.drop();
    }
  });
});

describe('0013_comments down migration', () => {
  test('reverses cleanly: comments is gone', async () => {
    const rollback = await provisionTestDatabase();
    const rollbackSql = postgres(rollback.url, { max: 1 });
    try {
      const downSql = await Bun.file(new URL('./down/0013_comments.down.sql', import.meta.url)).text();
      await rollbackSql.unsafe(downSql);

      const tables = await rollbackSql<{ tablename: string }[]>`
        SELECT tablename FROM pg_tables WHERE tablename = 'comments'
      `;
      expect(tables).toHaveLength(0);
    } finally {
      await rollbackSql.end({ timeout: 1 }).catch(() => {});
      await rollback.drop();
    }
  });
});

describe('0012_page_revisions_and_changesets down migration', () => {
  test('reverses cleanly: page_revision, changeset and the immutability trigger are all gone', async () => {
    const rollback = await provisionTestDatabase();
    const rollbackSql = postgres(rollback.url, { max: 1 });
    try {
      const downSql = await Bun.file(
        new URL('./down/0012_page_revisions_and_changesets.down.sql', import.meta.url),
      ).text();
      await rollbackSql.unsafe(downSql);

      const tables = await rollbackSql<{ tablename: string }[]>`
        SELECT tablename FROM pg_tables WHERE tablename IN ('page_revision', 'changeset')
      `;
      expect(tables).toHaveLength(0);

      const trigger = await rollbackSql<{ tgname: string }[]>`SELECT tgname FROM pg_trigger WHERE tgname = 'page_revision_forbid_update_trigger'`;
      expect(trigger).toHaveLength(0);
    } finally {
      await rollbackSql.end({ timeout: 1 }).catch(() => {});
      await rollback.drop();
    }
  });
});

describe('0011_block_split_provenance down migration', () => {
  test('reverses cleanly: split_from and its foreign key are gone', async () => {
    const rollback = await provisionTestDatabase();
    const rollbackSql = postgres(rollback.url, { max: 1 });
    try {
      const downSql = await Bun.file(
        new URL('./down/0011_block_split_provenance.down.sql', import.meta.url),
      ).text();
      await rollbackSql.unsafe(downSql);

      const columns = await rollbackSql<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'page_blocks' AND column_name = 'split_from'
      `;
      expect(columns).toHaveLength(0);
    } finally {
      await rollbackSql.end({ timeout: 1 }).catch(() => {});
      await rollback.drop();
    }
  });
});

describe('0010_page_locks down migration', () => {
  test('reverses cleanly: page_locks is gone', async () => {
    const rollback = await provisionTestDatabase();
    const rollbackSql = postgres(rollback.url, { max: 1 });
    try {
      // 0014's presence view selects straight from page_locks — its down
      // must run first, the same rollback-order trap 0008's test already
      // documents: a filtered run of just this describe block would have
      // passed before 0014 existed and silently breaks once it does.
      const presenceViewDown = await Bun.file(new URL('./down/0014_presence_view.down.sql', import.meta.url)).text();
      await rollbackSql.unsafe(presenceViewDown);

      const downSql = await Bun.file(new URL('./down/0010_page_locks.down.sql', import.meta.url)).text();
      await rollbackSql.unsafe(downSql);

      const tables = await rollbackSql<{ tablename: string }[]>`
        SELECT tablename FROM pg_tables WHERE tablename = 'page_locks'
      `;
      expect(tables).toHaveLength(0);
    } finally {
      await rollbackSql.end({ timeout: 1 }).catch(() => {});
      await rollback.drop();
    }
  });
});

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
      // 0009's, 0010's, 0011's, 0012's, 0013's and 0014's tables/columns/
      // views all carry foreign keys into page_content or page_blocks, or
      // (0014's presence view) select straight from page_locks — their
      // down migrations must run first, exactly as a real rollback would
      // (0014 -> 0013 -> 0012 -> 0011 -> 0010 -> 0009 -> 0008). This is
      // the exact trap named in the versioning-and-collaboration tasks: a
      // migration whose columns reference an earlier migration's table
      // breaks that earlier migration's isolated down-test until the
      // newer one's down runs first — only the full suite catches it, a
      // filtered run will not, because a filtered run never executes this
      // shared ordering.
      const presenceViewDown = await Bun.file(new URL('./down/0014_presence_view.down.sql', import.meta.url)).text();
      await rollbackSql.unsafe(presenceViewDown);

      const commentsDown = await Bun.file(new URL('./down/0013_comments.down.sql', import.meta.url)).text();
      await rollbackSql.unsafe(commentsDown);

      const pageRevisionsDown = await Bun.file(
        new URL('./down/0012_page_revisions_and_changesets.down.sql', import.meta.url),
      ).text();
      await rollbackSql.unsafe(pageRevisionsDown);

      const splitProvenanceDown = await Bun.file(
        new URL('./down/0011_block_split_provenance.down.sql', import.meta.url),
      ).text();
      await rollbackSql.unsafe(splitProvenanceDown);

      const pageLocksDown = await Bun.file(new URL('./down/0010_page_locks.down.sql', import.meta.url)).text();
      await rollbackSql.unsafe(pageLocksDown);

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

/**
 * 0016 only adds a trigger and its function on an existing table. It
 * creates no table and no foreign key into an earlier migration's table,
 * so — like 0015 — it adds no new rollback-ordering dependency: 0008's
 * down still drops `page_blocks`, and a table's triggers go with it.
 */
describe('0016_page_blocks_no_resurrection down migration', () => {
  test('reverses cleanly: the trigger and its function are both gone', async () => {
    const rollback = await provisionTestDatabase();
    const rollbackSql = postgres(rollback.url, { max: 1 });
    try {
      const downSql = await Bun.file(
        new URL('./down/0016_page_blocks_no_resurrection.down.sql', import.meta.url),
      ).text();
      await rollbackSql.unsafe(downSql);

      const triggers = await rollbackSql<{ tgname: string }[]>`
        SELECT tgname FROM pg_trigger
        WHERE tgrelid = 'page_blocks'::regclass AND tgname = 'page_blocks_forbid_resurrection_trigger'
      `;
      expect(triggers).toHaveLength(0);

      const functions = await rollbackSql<{ proname: string }[]>`
        SELECT proname FROM pg_proc WHERE proname = 'page_blocks_forbid_resurrection'
      `;
      expect(functions).toHaveLength(0);
    } finally {
      await rollbackSql.end({ timeout: 1 }).catch(() => {});
      await rollback.drop();
    }
  });
});
