import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '../../testing/provision';
import { resolveBookId, resolveChangeset } from './resolve-changeset';

let db: ProvisionedTestDatabase;
let sql: postgres.Sql;

beforeAll(async () => {
  db = await provisionTestDatabase();
  sql = postgres(db.url, { max: 5 });
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

// versioning-and-collaboration changesets spec: "Book-Level History Is One
// Query" needs resolveBookId; changesets/revision-history need it for the
// changeset FK. Exercised directly here rather than only through savePage.
describe('resolveBookId', () => {
  test('walks the ancestor chain to the nearest book', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const bookId = await seedBook(workspaceId, rootId);
    const pageId = await seedPageUnder(workspaceId, bookId);

    const resolved = await resolveBookId(sql, { nodeId: pageId, workspaceId });
    expect(resolved).toBe(bookId);
  });

  test('a page with no book ancestor resolves to null', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const pageId = await seedPageUnder(workspaceId, rootId);

    const resolved = await resolveBookId(sql, { nodeId: pageId, workspaceId });
    expect(resolved).toBeNull();
  });
});

// changesets spec: "Saves Group Implicitly By Author, Book, And Window";
// "Changeset Tenant Isolation And Book Scope" arbitrated by
// changeset_open_per_author_idx.
describe('resolveChangeset', () => {
  test('two saves inside the window share a changeset', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const bookId = await seedBook(workspaceId, rootId);
    const authorId = await seedUser();

    const first = await resolveChangeset(sql, { workspaceId, bookId, authorId, windowMinutes: 30 });
    const second = await resolveChangeset(sql, { workspaceId, bookId, authorId, windowMinutes: 30 });

    expect(second).toBe(first);
    const rows = await sql`SELECT id FROM changeset WHERE workspace_id = ${workspaceId} AND book_id = ${bookId} AND author_id = ${authorId}`;
    expect(rows).toHaveLength(1);
  });

  test('a save outside the window starts a new changeset', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const bookId = await seedBook(workspaceId, rootId);
    const authorId = await seedUser();

    const first = await resolveChangeset(sql, { workspaceId, bookId, authorId, windowMinutes: 30 });
    // Simulate the first changeset's activity having lapsed well past the window.
    await sql`UPDATE changeset SET last_activity_at = now() - interval '1 hour' WHERE id = ${first}`;

    const second = await resolveChangeset(sql, { workspaceId, bookId, authorId, windowMinutes: 30 });

    expect(second).not.toBe(first);
    const [closed] = await sql<{ closed_at: Date | null }[]>`SELECT closed_at FROM changeset WHERE id = ${first}`;
    expect(closed!.closed_at).not.toBeNull();
  });

  test('different authors never share a changeset', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const bookId = await seedBook(workspaceId, rootId);
    const authorA = await seedUser();
    const authorB = await seedUser();

    const idA = await resolveChangeset(sql, { workspaceId, bookId, authorId: authorA, windowMinutes: 30 });
    const idB = await resolveChangeset(sql, { workspaceId, bookId, authorId: authorB, windowMinutes: 30 });

    expect(idA).not.toBe(idB);
  });

  // Quality-bar flag: two saves that never actually race prove nothing
  // about changeset_open_per_author_idx. Both transactions below delay by
  // the same amount, started together via Promise.all, so both reach
  // their real INSERT..ON CONFLICT statement while the other is still
  // mid-transaction — a genuine race on the partial unique index, not two
  // sequential calls that merely happen to agree.
  test('two genuinely concurrent saves by one author on two different pages resolve to exactly one changeset', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const bookId = await seedBook(workspaceId, rootId);
    const authorId = await seedUser();

    const connA = postgres(db.url, { max: 1 });
    const connB = postgres(db.url, { max: 1 });
    try {
      const runA = connA.begin(async (tx) => {
        await tx`SELECT pg_sleep(0.3)`;
        return resolveChangeset(tx, { workspaceId, bookId, authorId, windowMinutes: 30 });
      });
      const runB = connB.begin(async (tx) => {
        await tx`SELECT pg_sleep(0.3)`;
        return resolveChangeset(tx, { workspaceId, bookId, authorId, windowMinutes: 30 });
      });

      const [idA, idB] = await Promise.all([runA, runB]);

      expect(idA).toBe(idB);
      const rows = await sql`
        SELECT id FROM changeset WHERE workspace_id = ${workspaceId} AND book_id = ${bookId} AND author_id = ${authorId}
      `;
      expect(rows).toHaveLength(1);
    } finally {
      await connA.end({ timeout: 1 }).catch(() => {});
      await connB.end({ timeout: 1 }).catch(() => {});
    }
  });
});
