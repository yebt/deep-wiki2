import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '../../testing/provision';
import { savePage } from '../content/save-page';

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

async function seedWorkspace(): Promise<{ workspaceId: string; rootId: string }> {
  const [plan] = await sql`
    INSERT INTO plans (name, max_workspaces, max_seats, max_storage_bytes, max_ai_tokens_monthly)
    VALUES (${`plan-${crypto.randomUUID()}`}, 3, 5, '1000000', '1000') RETURNING id
  `;
  const [user] = await sql`
    INSERT INTO users (email, password_hash, display_name, plan_id)
    VALUES (${`owner-${crypto.randomUUID()}@example.com`}, 'hash', 'Owner', ${plan!.id}) RETURNING id
  `;
  const [workspace] = await sql`
    INSERT INTO workspaces (owner_id, name, slug)
    VALUES (${user!.id}, 'Acme', ${`acme-${crypto.randomUUID()}`}) RETURNING id
  `;
  const [root] = await sql`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${workspace!.id}, NULL, 'workspace', '', 0, 'root', 'Root') RETURNING id
  `;
  return { workspaceId: workspace!.id as string, rootId: root!.id as string };
}

async function seedPage(workspaceId: string, rootId: string): Promise<string> {
  const [page] = await sql`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${workspaceId}, ${rootId}, 'page', '', 0, ${`page-${crypto.randomUUID()}`}, 'Page') RETURNING id
  `;
  return page!.id as string;
}

async function seedBook(workspaceId: string, rootId: string): Promise<string> {
  const [shelf] = await sql`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${workspaceId}, ${rootId}, 'shelf', '', 0, ${`shelf-${crypto.randomUUID()}`}, 'Shelf') RETURNING id
  `;
  const [book] = await sql`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${workspaceId}, ${shelf!.id}, 'book', '', 0, ${`book-${crypto.randomUUID()}`}, 'Book') RETURNING id
  `;
  return book!.id as string;
}

async function seedChangeset(workspaceId: string, bookId: string, authorId: string): Promise<string> {
  const [changeset] = await sql`
    INSERT INTO changeset (workspace_id, book_id, author_id)
    VALUES (${workspaceId}, ${bookId}, ${authorId}) RETURNING id
  `;
  return changeset!.id as string;
}

async function seedUser(): Promise<string> {
  const [plan] = await sql`
    INSERT INTO plans (name, max_workspaces, max_seats, max_storage_bytes, max_ai_tokens_monthly)
    VALUES (${`plan-${crypto.randomUUID()}`}, 3, 5, '1000000', '1000') RETURNING id
  `;
  const [user] = await sql`
    INSERT INTO users (email, password_hash, display_name, plan_id)
    VALUES (${`author-${crypto.randomUUID()}@example.com`}, 'hash', 'Author', ${plan!.id}) RETURNING id
  `;
  return user!.id as string;
}

// versioning-and-collaboration revision-history spec: "Revision Tenant
// Isolation By Composite Foreign Key" — a cross-tenant reference MUST be
// unrepresentable, not merely unqueried.
describe('page_revision — tenant isolation', () => {
  test('a page_revision naming a page from a different workspace is rejected by the composite FK', async () => {
    const workspaceA = await seedWorkspace();
    const workspaceB = await seedWorkspace();
    const pageInA = await seedPage(workspaceA.workspaceId, workspaceA.rootId);
    await savePage(sql, { nodeId: pageInA, workspaceId: workspaceA.workspaceId, markdown: '# A\n', expectedContentHash: null });

    await expect(
      (async () => {
        await sql`
          INSERT INTO page_revision (workspace_id, page_id, content, content_hash)
          VALUES (${workspaceB.workspaceId}, ${pageInA}, '# A\n', 'hash-a')
        `;
      })(),
    ).rejects.toThrow(/page_revision_page_fk/);
  });

  test('a page_revision naming a changeset from a different workspace is rejected by the composite FK', async () => {
    const workspaceA = await seedWorkspace();
    const workspaceB = await seedWorkspace();
    const pageInA = await seedPage(workspaceA.workspaceId, workspaceA.rootId);
    await savePage(sql, { nodeId: pageInA, workspaceId: workspaceA.workspaceId, markdown: '# A\n', expectedContentHash: null });

    const bookInB = await seedBook(workspaceB.workspaceId, workspaceB.rootId);
    const authorB = await seedUser();
    const changesetInB = await seedChangeset(workspaceB.workspaceId, bookInB, authorB);

    await expect(
      (async () => {
        await sql`
          INSERT INTO page_revision (workspace_id, page_id, content, content_hash, changeset_id)
          VALUES (${workspaceA.workspaceId}, ${pageInA}, '# A\n', 'hash-a', ${changesetInB})
        `;
      })(),
    ).rejects.toThrow(/page_revision_changeset_fk/);
  });

  test('a same-tenant page_revision insert succeeds', async () => {
    const workspaceA = await seedWorkspace();
    const pageInA = await seedPage(workspaceA.workspaceId, workspaceA.rootId);
    await savePage(sql, { nodeId: pageInA, workspaceId: workspaceA.workspaceId, markdown: '# A\n', expectedContentHash: null });

    const rows = await sql`
      INSERT INTO page_revision (workspace_id, page_id, content, content_hash)
      VALUES (${workspaceA.workspaceId}, ${pageInA}, '# A\n', 'hash-a')
      RETURNING id
    `;
    expect(rows).toHaveLength(1);
  });
});

// versioning-and-collaboration revision-history spec: "Revision Is
// Immutable And Retention Is Undecided" — a mechanism (trigger), not a
// comment: no code path may UPDATE a written page_revision row.
describe('page_revision — immutability', () => {
  test('an UPDATE on an existing page_revision row raises', async () => {
    const workspaceA = await seedWorkspace();
    const pageInA = await seedPage(workspaceA.workspaceId, workspaceA.rootId);
    await savePage(sql, { nodeId: pageInA, workspaceId: workspaceA.workspaceId, markdown: '# A\n', expectedContentHash: null });

    const [revision] = await sql<{ id: string }[]>`
      INSERT INTO page_revision (workspace_id, page_id, content, content_hash)
      VALUES (${workspaceA.workspaceId}, ${pageInA}, '# A\n', 'hash-a')
      RETURNING id
    `;

    await expect(
      (async () => {
        await sql`UPDATE page_revision SET content = 'tampered' WHERE id = ${revision!.id}`;
      })(),
    ).rejects.toThrow(/immutable/);

    const [row] = await sql<{ content: string }[]>`SELECT content FROM page_revision WHERE id = ${revision!.id}`;
    expect(row!.content).toBe('# A\n');
  });
});

