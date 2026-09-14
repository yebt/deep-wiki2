import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '../../testing/provision';
import { writeRevision } from './insert-revision';

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

async function seedPageUnder(workspaceId: string, parentId: string): Promise<string> {
  const [page] = await sql`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${workspaceId}, ${parentId}, 'page', '', 0, ${`page-${crypto.randomUUID()}`}, 'Page') RETURNING id
  `;
  return page!.id as string;
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

// Extracted from save-page.ts's transaction body (task 3.11's REFACTOR).
// `savePage`'s own integration tests (save-page.test.ts) already exercise
// this through the whole transaction; these tests isolate `writeRevision`
// itself against both branches design.md names: a book resolves and joins
// a changeset, or none does and the revision still lands with a null one.
describe('writeRevision', () => {
  test('writes a revision joining a changeset when the page has a book ancestor and an author', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const bookId = await seedBook(workspaceId, rootId);
    const pageId = await seedPageUnder(workspaceId, bookId);
    const authorId = await seedUser();
    // page_revision's FK requires a page_content row to exist first.
    await sql`
      INSERT INTO page_content (node_id, workspace_id, markdown, content_hash)
      VALUES (${pageId}, ${workspaceId}, '# Hi\n', 'hash-1')
    `;

    const result = await writeRevision(sql, {
      nodeId: pageId,
      workspaceId,
      content: '# Hi\n',
      contentHash: 'hash-1',
      blockIndex: {},
      updatedBy: authorId,
      changesetWindowMinutes: 30,
    });

    expect(result.changesetId).not.toBeNull();
    const [row] = await sql<{ content: string; changeset_id: string }[]>`
      SELECT content, changeset_id FROM page_revision WHERE page_id = ${pageId}
    `;
    expect(row!.content).toBe('# Hi\n');
    expect(row!.changeset_id).toBe(result.changesetId!);
  });

  test('writes a revision with a null changeset when the page has no book ancestor', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const pageId = await seedPageUnder(workspaceId, rootId);
    const authorId = await seedUser();
    await sql`
      INSERT INTO page_content (node_id, workspace_id, markdown, content_hash)
      VALUES (${pageId}, ${workspaceId}, '# Hi\n', 'hash-2')
    `;

    const result = await writeRevision(sql, {
      nodeId: pageId,
      workspaceId,
      content: '# Hi\n',
      contentHash: 'hash-2',
      blockIndex: {},
      updatedBy: authorId,
      changesetWindowMinutes: 30,
    });

    expect(result.changesetId).toBeNull();
    const [row] = await sql<{ changeset_id: string | null }[]>`
      SELECT changeset_id FROM page_revision WHERE page_id = ${pageId}
    `;
    expect(row!.changeset_id).toBeNull();
  });

  // The real bug (versioning-and-collaboration Phase 3 apply log): making
  // `changesetWindowMinutes` optional meant a book-scoped, authored save
  // that omitted it silently skipped changeset resolution entirely rather
  // than erroring — a book-scoped save then grouped nothing and said
  // nothing, and the book-history e2e seed produced zero changesets this
  // way, caught only by a direct DB query. `changesetWindowMinutes` is
  // required in `WriteRevisionInput` now (no `?`), so this omission is a
  // TypeScript error at every real call site; this test additionally
  // proves that a caller who bypasses the type system (e.g. untyped JS, or
  // an `as any` cast) still fails LOUDLY at runtime rather than silently —
  // `resolveChangeset`'s own SQL template rejects an `undefined` bound
  // parameter.
  test('a book-scoped, authored save throws rather than silently skipping changeset resolution when changesetWindowMinutes is missing at runtime', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const bookId = await seedBook(workspaceId, rootId);
    const pageId = await seedPageUnder(workspaceId, bookId);
    const authorId = await seedUser();
    await sql`
      INSERT INTO page_content (node_id, workspace_id, markdown, content_hash)
      VALUES (${pageId}, ${workspaceId}, '# Hi\n', 'hash-3')
    `;

    const inputMissingWindow = {
      nodeId: pageId,
      workspaceId,
      content: '# Hi\n',
      contentHash: 'hash-3',
      blockIndex: {},
      updatedBy: authorId,
      // Deliberately absent — simulates a caller that bypasses the type
      // system. `as never` documents that this is intentionally invalid,
      // not an accidental omission.
    } as unknown as Parameters<typeof writeRevision>[1];

    await expect(writeRevision(sql, inputMissingWindow)).rejects.toThrow();

    const [row] = await sql<{ changeset_id: string | null }[]>`
      SELECT changeset_id FROM page_revision WHERE page_id = ${pageId}
    `;
    expect(row).toBeUndefined();
  });
});
