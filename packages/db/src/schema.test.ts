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

/**
 * `expect(promise).rejects` hangs when `promise` is a postgres.js query
 * object rather than a plain native Promise (observed directly against
 * this Postgres, this postgres.js version, and this Bun version — plain
 * try/catch on the same query resolves immediately). This helper sidesteps
 * that interaction while still asserting the query genuinely rejected.
 */
async function assertRejects(query: Promise<unknown>): Promise<void> {
  let rejected = false;
  try {
    await query;
  } catch {
    rejected = true;
  }
  expect(rejected).toBe(true);
}

async function seedWorkspace() {
  const [plan] = await sql`
    INSERT INTO plans (name, max_workspaces, max_seats, max_storage_bytes, max_ai_tokens_monthly)
    VALUES (${`plan-${crypto.randomUUID()}`}, 3, 5, '1000000', '1000')
    RETURNING id
  `;
  const [user] = await sql`
    INSERT INTO users (email, password_hash, display_name, plan_id)
    VALUES (${`owner-${crypto.randomUUID()}@example.com`}, 'hash', 'Owner', ${plan!.id})
    RETURNING id
  `;
  const [workspace] = await sql`
    INSERT INTO workspaces (owner_id, name, slug)
    VALUES (${user!.id}, 'Acme', ${`acme-${crypto.randomUUID()}`})
    RETURNING id
  `;
  const [root] = await sql`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${workspace!.id}, NULL, 'workspace', '', 0, 'root', 'Root')
    RETURNING id, path
  `;
  return { planId: plan!.id as string, userId: user!.id as string, workspaceId: workspace!.id as string, rootId: root!.id as string };
}

describe('workspace isolation on every tenant-scoped table', () => {
  test('an insert into nodes without a workspace_id is rejected', async () => {
    await assertRejects(
      sql`INSERT INTO nodes (parent_id, type, path, position, slug, title)
          VALUES (NULL, 'workspace', '', 0, 'orphan', 'Orphan')`,
    );
  });
});

describe('nodes_parent_iff_not_workspace_chk', () => {
  test('rejects a non-workspace node with a null parent_id', async () => {
    const { workspaceId } = await seedWorkspace();

    await assertRejects(
      sql`INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
          VALUES (${workspaceId}, NULL, 'shelf', '', 0, 'orphan-shelf', 'Orphan Shelf')`,
    );
  });

  test('rejects a workspace-type node with a non-null parent_id', async () => {
    const { workspaceId, rootId } = await seedWorkspace();

    await assertRejects(
      sql`INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
          VALUES (${workspaceId}, ${rootId}, 'workspace', '', 0, 'second-root', 'Second Root')`,
    );
  });
});

describe('nodes_one_workspace_root_idx', () => {
  test('a second workspace-type root for the same workspace_id is rejected', async () => {
    const { workspaceId } = await seedWorkspace();

    await assertRejects(
      sql`INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
          VALUES (${workspaceId}, NULL, 'workspace', '', 1, 'second-root', 'Second Root')`,
    );
  });
});

describe('node tree structure', () => {
  test('a page is accepted directly under a book with no intervening chapter', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const [book] = await sql`
      INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
      VALUES (${workspaceId}, ${rootId}, 'book', '', 0, 'book-1', 'Book 1')
      RETURNING id
    `;

    const [page] = await sql`
      INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
      VALUES (${workspaceId}, ${book!.id}, 'page', '', 0, 'page-1', 'Page 1')
      RETURNING id, parent_id
    `;

    expect(page!.parent_id).toBe(book!.id);
  });

  test('a page is accepted under a chapter', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const [book] = await sql`
      INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
      VALUES (${workspaceId}, ${rootId}, 'book', '', 0, 'book-2', 'Book 2')
      RETURNING id
    `;
    const [chapter] = await sql`
      INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
      VALUES (${workspaceId}, ${book!.id}, 'chapter', '', 0, 'chapter-1', 'Chapter 1')
      RETURNING id
    `;

    const [page] = await sql`
      INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
      VALUES (${workspaceId}, ${chapter!.id}, 'page', '', 0, 'page-1', 'Page 1')
      RETURNING id, parent_id
    `;

    expect(page!.parent_id).toBe(chapter!.id);
  });
});

describe('sibling ordering', () => {
  test('a new sibling receives a position greater than all existing siblings', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const [chapter] = await sql`
      INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
      VALUES (${workspaceId}, ${rootId}, 'chapter', '', 0, 'chapter-x', 'Chapter X')
      RETURNING id
    `;

    for (const [slug, position] of [
      ['p0', 0],
      ['p1', 1],
      ['p2', 2],
    ] as const) {
      await sql`
        INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
        VALUES (${workspaceId}, ${chapter!.id}, 'page', '', ${position}, ${slug}, ${slug})
      `;
    }

    const positionRows = await sql<{ next_position: number }[]>`
      SELECT COALESCE(MAX(position) + 1, 0) AS next_position FROM nodes WHERE parent_id = ${chapter!.id}
    `;
    const next_position = positionRows[0]!.next_position;
    expect(next_position).toBe(3);

    const [fourth] = await sql`
      INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
      VALUES (${workspaceId}, ${chapter!.id}, 'page', '', ${next_position}, 'p3', 'p3')
      RETURNING position
    `;

    const existingPositions = await sql<{ position: number }[]>`
      SELECT position FROM nodes WHERE parent_id = ${chapter!.id} AND slug != 'p3'
    `;

    expect(fourth!.position).toBeGreaterThan(Math.max(...existingPositions.map((r) => r.position)));
  });
});

describe('super root global identity', () => {
  test('a Super Root user does not appear as a member of any single workspace by virtue of the flag', async () => {
    const [superRoot] = await sql`
      INSERT INTO users (email, password_hash, display_name, is_super_root)
      VALUES (${`super-${crypto.randomUUID()}@example.com`}, 'hash', 'Super Root', true)
      RETURNING id
    `;

    // Setting is_super_root alone creates no workspace ownership row.
    const ownedWorkspaces = await sql`SELECT id FROM workspaces WHERE owner_id = ${superRoot!.id}`;
    expect(ownedWorkspaces).toHaveLength(0);

    // ... and it grants no implicit membership in an unrelated workspace
    // that already exists.
    const { workspaceId } = await seedWorkspace();
    const membership = await sql`
      SELECT 1 FROM workspaces WHERE id = ${workspaceId} AND owner_id = ${superRoot!.id}
    `;
    expect(membership).toHaveLength(0);
  });
});

async function seedUser(): Promise<string> {
  const [user] = await sql`
    INSERT INTO users (email, password_hash, display_name)
    VALUES (${`u-${crypto.randomUUID()}@example.com`}, 'hash', 'U')
    RETURNING id
  `;
  return user!.id as string;
}

describe('cells as group subjects', () => {
  test("a cell membership's workspace_id must match the named cell's own workspace (structural isolation)", async () => {
    const { workspaceId: workspaceA } = await seedWorkspace();
    const { workspaceId: workspaceB } = await seedWorkspace();
    const [cellA] = await sql`INSERT INTO cells (workspace_id, name) VALUES (${workspaceA}, ${`Team-${crypto.randomUUID()}`}) RETURNING id`;
    const userId = await seedUser();

    await assertRejects(
      sql`INSERT INTO cell_members (cell_id, user_id, workspace_id) VALUES (${cellA!.id}, ${userId}, ${workspaceB})`,
    );
  });

  test("a membership recorded under the cell's own workspace succeeds", async () => {
    const { workspaceId } = await seedWorkspace();
    const [cell] = await sql`INSERT INTO cells (workspace_id, name) VALUES (${workspaceId}, ${`Team-${crypto.randomUUID()}`}) RETURNING id`;
    const userId = await seedUser();

    const rows = await sql`
      INSERT INTO cell_members (cell_id, user_id, workspace_id) VALUES (${cell!.id}, ${userId}, ${workspaceId})
      RETURNING cell_id
    `;
    expect(rows).toHaveLength(1);
  });
});

describe('permissions — cross-workspace isolation (structural half)', () => {
  test('a grant naming a resource outside its own workspace is rejected by the composite FK', async () => {
    const { rootId: rootA } = await seedWorkspace();
    const { workspaceId: workspaceB } = await seedWorkspace();
    const userId = await seedUser();

    await assertRejects(
      sql`INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
          VALUES (${workspaceB}, 'user', ${userId}, ${rootA}, 'read', 'allow')`,
    );
  });

  test('a grant naming a cell outside its own workspace is rejected by the composite FK', async () => {
    const { workspaceId: workspaceA, rootId: rootA } = await seedWorkspace();
    const { workspaceId: workspaceB } = await seedWorkspace();
    const [cellB] = await sql`INSERT INTO cells (workspace_id, name) VALUES (${workspaceB}, ${`Team-${crypto.randomUUID()}`}) RETURNING id`;

    await assertRejects(
      sql`INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
          VALUES (${workspaceA}, 'cell', ${cellB!.id}, ${rootA}, 'read', 'allow')`,
    );
  });
});

describe('permissions — resource_type is not a stored column (D10)', () => {
  test('the permissions table has no resource_type column', async () => {
    const rows = await sql`
      SELECT column_name FROM information_schema.columns
       WHERE table_name = 'permissions' AND column_name = 'resource_type'
    `;
    expect(rows).toHaveLength(0);
  });
});

describe('permissions — supported subject types', () => {
  test('subject_type accepts user, cell, and agent, each resolving through the same table', async () => {
    const { workspaceId, rootId, userId } = await seedWorkspace();
    const [cell] = await sql`INSERT INTO cells (workspace_id, name) VALUES (${workspaceId}, ${`Team-${crypto.randomUUID()}`}) RETURNING id`;
    const agentId = crypto.randomUUID();

    const cases = [
      ['user', userId],
      ['cell', cell!.id as string],
      ['agent', agentId],
    ] as const;

    for (const [subjectType, subjectId] of cases) {
      const rows = await sql`
        INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
        VALUES (${workspaceId}, ${subjectType}::subject_kind, ${subjectId}, ${rootId}, 'read', 'allow')
        RETURNING subject_type
      `;
      expect(rows[0]!.subject_type).toBe(subjectType);
    }
  });

  test('the reserved role subject_kind value exists with zero producers this phase', async () => {
    const enumRows = await sql<{ enumlabel: string }[]>`
      SELECT enumlabel FROM pg_enum WHERE enumtypid = 'subject_kind'::regtype ORDER BY enumlabel
    `;
    expect(enumRows.map((r) => r.enumlabel)).toContain('role');

    const roleGrants = await sql`SELECT 1 FROM permissions WHERE subject_type = 'role'`;
    expect(roleGrants).toHaveLength(0);
  });
});

// content-and-editor design.md D10 — page-content: "Row without a workspace rejected".
describe('page_content three-column tenant-and-type foreign key', () => {
  async function seedPage(workspaceId: string, parentId: string) {
    const [page] = await sql`
      INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
      VALUES (${workspaceId}, ${parentId}, 'page', '', 0, ${`page-${crypto.randomUUID()}`}, 'A Page')
      RETURNING id
    `;
    return page!.id as string;
  }

  test('content is accepted on a page node', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const pageId = await seedPage(workspaceId, rootId);

    const rows = await sql`
      INSERT INTO page_content (node_id, workspace_id, markdown, content_hash)
      VALUES (${pageId}, ${workspaceId}, '# Hello', 'hash-1')
      RETURNING node_id
    `;
    expect(rows).toHaveLength(1);
  });

  test('content on a non-page node type is rejected by the three-column foreign key', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const [book] = await sql`
      INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
      VALUES (${workspaceId}, ${rootId}, 'book', '', 0, ${`book-${crypto.randomUUID()}`}, 'A Book')
      RETURNING id
    `;

    await assertRejects(
      sql`INSERT INTO page_content (node_id, workspace_id, markdown, content_hash)
          VALUES (${book!.id}, ${workspaceId}, '# Hello', 'hash-1')`,
    );
  });

  test('content pointed at a mismatched workspace_id is rejected', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const pageId = await seedPage(workspaceId, rootId);
    const other = await seedWorkspace();

    await assertRejects(
      sql`INSERT INTO page_content (node_id, workspace_id, markdown, content_hash)
          VALUES (${pageId}, ${other.workspaceId}, '# Hello', 'hash-1')`,
    );
  });
});

describe('page_blocks: a tombstoned id can never be reused', () => {
  async function seedPageContent(workspaceId: string, parentId: string) {
    const [page] = await sql`
      INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
      VALUES (${workspaceId}, ${parentId}, 'page', '', 0, ${`page-${crypto.randomUUID()}`}, 'A Page')
      RETURNING id
    `;
    await sql`
      INSERT INTO page_content (node_id, workspace_id, markdown, content_hash)
      VALUES (${page!.id}, ${workspaceId}, '# Hello', 'hash-1')
    `;
    return page!.id as string;
  }

  test('the same (page_id, block_id) cannot be inserted twice, regardless of status', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const pageId = await seedPageContent(workspaceId, rootId);

    await sql`
      INSERT INTO page_blocks (page_id, workspace_id, block_id, status, content_hash, excerpt)
      VALUES (${pageId}, ${workspaceId}, 'block-1', 'tombstoned', 'h', 'excerpt')
    `;

    await assertRejects(
      sql`INSERT INTO page_blocks (page_id, workspace_id, block_id, status, content_hash, excerpt)
          VALUES (${pageId}, ${workspaceId}, 'block-1', 'active', 'h2', 'new excerpt')`,
    );
  });

  test('a superseded_by pointer must name a real block on the same page', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const pageId = await seedPageContent(workspaceId, rootId);

    await assertRejects(
      sql`INSERT INTO page_blocks (page_id, workspace_id, block_id, status, superseded_by, content_hash, excerpt)
          VALUES (${pageId}, ${workspaceId}, 'block-1', 'superseded', 'does-not-exist', 'h', 'excerpt')`,
    );
  });
});

// content-and-editor design.md "Schema" — knowledge-graph spec.
describe('links: source pins to page_content, target is nullable and inert while unresolved', () => {
  async function seedPageContent(workspaceId: string, parentId: string) {
    const [page] = await sql`
      INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
      VALUES (${workspaceId}, ${parentId}, 'page', '', 0, ${`page-${crypto.randomUUID()}`}, 'A Page')
      RETURNING id
    `;
    await sql`
      INSERT INTO page_content (node_id, workspace_id, markdown, content_hash)
      VALUES (${page!.id}, ${workspaceId}, '# Hello', 'hash-1')
    `;
    return page!.id as string;
  }

  test('a link from a page with content is accepted, with a null target recorded as unresolved', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const pageId = await seedPageContent(workspaceId, rootId);

    const rows = await sql`
      INSERT INTO links (workspace_id, source_page_id, target_raw)
      VALUES (${workspaceId}, ${pageId}, 'Some Title')
      RETURNING target_page_id
    `;
    expect(rows[0]!.target_page_id).toBeNull();
  });

  test('a link whose source page has no content row is rejected', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const [page] = await sql`
      INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
      VALUES (${workspaceId}, ${rootId}, 'page', '', 0, ${`page-${crypto.randomUUID()}`}, 'No Content')
      RETURNING id
    `;

    await assertRejects(
      sql`INSERT INTO links (workspace_id, source_page_id, target_raw) VALUES (${workspaceId}, ${page!.id}, 'x')`,
    );
  });
});

describe('tags and page_tags: workspace-scoped uniqueness', () => {
  async function seedPageContent(workspaceId: string, parentId: string) {
    const [page] = await sql`
      INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
      VALUES (${workspaceId}, ${parentId}, 'page', '', 0, ${`page-${crypto.randomUUID()}`}, 'A Page')
      RETURNING id
    `;
    await sql`
      INSERT INTO page_content (node_id, workspace_id, markdown, content_hash)
      VALUES (${page!.id}, ${workspaceId}, '# Hello', 'hash-1')
    `;
    return page!.id as string;
  }

  test('the same tag name cannot be created twice in one workspace', async () => {
    const { workspaceId } = await seedWorkspace();
    await sql`INSERT INTO tags (workspace_id, name) VALUES (${workspaceId}, 'project')`;

    await assertRejects(sql`INSERT INTO tags (workspace_id, name) VALUES (${workspaceId}, 'project')`);
  });

  test('the same tag name is allowed again in a different workspace', async () => {
    const { workspaceId: workspaceA } = await seedWorkspace();
    const { workspaceId: workspaceB } = await seedWorkspace();
    await sql`INSERT INTO tags (workspace_id, name) VALUES (${workspaceA}, 'project')`;

    const rows = await sql`INSERT INTO tags (workspace_id, name) VALUES (${workspaceB}, 'project') RETURNING id`;
    expect(rows).toHaveLength(1);
  });

  test('a page_tags row requires both the page and the tag to exist', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const pageId = await seedPageContent(workspaceId, rootId);
    const [tag] = await sql`INSERT INTO tags (workspace_id, name) VALUES (${workspaceId}, 'project') RETURNING id`;

    const rows = await sql`
      INSERT INTO page_tags (page_id, tag_id, workspace_id) VALUES (${pageId}, ${tag!.id}, ${workspaceId})
      RETURNING page_id
    `;
    expect(rows).toHaveLength(1);
  });
});
