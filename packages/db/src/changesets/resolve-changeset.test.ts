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

async function seedChapterUnder(workspaceId: string, parentId: string): Promise<string> {
  const [chapter] = await sql`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${workspaceId}, ${parentId}, 'chapter', '', 0, ${`chapter-${crypto.randomUUID()}`}, 'Chapter') RETURNING id
  `;
  return chapter!.id as string;
}

async function seedBookUnder(workspaceId: string, parentId: string): Promise<string> {
  const [book] = await sql`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${workspaceId}, ${parentId}, 'book', '', 0, ${`book-${crypto.randomUUID()}`}, 'Book') RETURNING id
  `;
  return book!.id as string;
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

  // The single-hop fixture above passes even for an implementation that
  // only ever looks at the page's own parent. This one is two hops below
  // its book, so nothing but the recursive arm can reach it.
  test('walks past an intermediate chapter to a book two levels up', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const bookId = await seedBook(workspaceId, rootId);
    const chapterId = await seedChapterUnder(workspaceId, bookId);
    const pageId = await seedPageUnder(workspaceId, chapterId);

    const resolved = await resolveBookId(sql, { nodeId: pageId, workspaceId });
    expect(resolved).toBe(bookId);
    // Pin the shape the assertion depends on: the page really is two hops
    // below the book, so a one-hop implementation cannot pass by accident.
    const [parent] = await sql<{ parent_id: string; type: string }[]>`
      SELECT parent_id, type FROM nodes WHERE id = ${pageId}
    `;
    expect(parent!.parent_id).toBe(chapterId);
    expect(parent!.type).toBe('page');
  });

  // Defensive: `LEGAL_PARENT_TYPES` in nodes/move.ts forbids a book under a
  // book, so this shape is only reachable by direct insert. The walk still
  // has to answer deterministically — `LIMIT 1` over a recursive CTE has no
  // inherent order — and "nearest" is the only answer that means anything.
  test('the nearest book wins when books are nested', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const outerBookId = await seedBook(workspaceId, rootId);
    const innerBookId = await seedBookUnder(workspaceId, outerBookId);
    const pageId = await seedPageUnder(workspaceId, innerBookId);

    const resolved = await resolveBookId(sql, { nodeId: pageId, workspaceId });
    expect(resolved).toBe(innerBookId);
    expect(resolved).not.toBe(outerBookId);
  });

  // The walk is workspace-scoped at its seed: asking for a node under the
  // wrong tenant resolves nothing, rather than reaching into that tenant's
  // tree because the id happened to be known.
  test('a node addressed with another workspace id resolves to null', async () => {
    const first = await seedWorkspace();
    const second = await seedWorkspace();
    const bookId = await seedBook(first.workspaceId, first.rootId);
    const pageId = await seedPageUnder(first.workspaceId, bookId);

    expect(await resolveBookId(sql, { nodeId: pageId, workspaceId: first.workspaceId })).toBe(bookId);
    expect(await resolveBookId(sql, { nodeId: pageId, workspaceId: second.workspaceId })).toBeNull();
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
