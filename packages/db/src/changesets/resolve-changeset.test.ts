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
    // Simulate the first changeset's activity having lapsed well past the
    // window, and keep the exact value written so retirement can be checked
    // against it rather than against "not null" — which now() satisfies too.
    const [stamped] = await sql<{ last_activity_at: Date }[]>`
      UPDATE changeset SET last_activity_at = now() - interval '1 hour' WHERE id = ${first}
      RETURNING last_activity_at
    `;

    const second = await resolveChangeset(sql, { workspaceId, bookId, authorId, windowMinutes: 30 });

    expect(second).not.toBe(first);
    const [closed] = await sql<{ closed_at: Date | null; last_activity_at: Date }[]>`
      SELECT closed_at, last_activity_at FROM changeset WHERE id = ${first}
    `;
    // The docstring is explicit: retirement stamps the last activity, not
    // the moment of retirement. An hour separates the two here.
    expect(closed!.closed_at).not.toBeNull();
    expect(closed!.closed_at!.getTime()).toBe(stamped!.last_activity_at.getTime());
    expect(closed!.last_activity_at.getTime()).toBe(stamped!.last_activity_at.getTime());
    expect(Date.now() - closed!.closed_at!.getTime()).toBeGreaterThan(30 * 60 * 1000);
  });

  // versioning-and-collaboration changesets spec: "Changeset Tenant
  // Isolation And Book Scope". Every test above uses one book in one
  // workspace, so an implementation that joined by author_id alone —
  // across books and across tenants — passed all of them.
  test('two books in one workspace never share a changeset', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const bookA = await seedBook(workspaceId, rootId);
    const bookB = await seedBook(workspaceId, rootId);
    const authorId = await seedUser();

    const idA = await resolveChangeset(sql, { workspaceId, bookId: bookA, authorId, windowMinutes: 30 });
    const idB = await resolveChangeset(sql, { workspaceId, bookId: bookB, authorId, windowMinutes: 30 });

    expect(idA).not.toBe(idB);
    const rows = await sql<{ id: string; book_id: string }[]>`
      SELECT id, book_id FROM changeset WHERE workspace_id = ${workspaceId} AND author_id = ${authorId} ORDER BY book_id
    `;
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.book_id).sort()).toEqual([bookA, bookB].sort());
    // Re-resolving each book returns that book's own row, not the other's.
    expect(await resolveChangeset(sql, { workspaceId, bookId: bookA, authorId, windowMinutes: 30 })).toBe(idA);
    expect(await resolveChangeset(sql, { workspaceId, bookId: bookB, authorId, windowMinutes: 30 })).toBe(idB);
  });

  test('one author in two workspaces never crosses workspace_id', async () => {
    const first = await seedWorkspace();
    const second = await seedWorkspace();
    const bookOne = await seedBook(first.workspaceId, first.rootId);
    const bookTwo = await seedBook(second.workspaceId, second.rootId);
    const authorId = await seedUser();

    const idOne = await resolveChangeset(sql, {
      workspaceId: first.workspaceId,
      bookId: bookOne,
      authorId,
      windowMinutes: 30,
    });
    const idTwo = await resolveChangeset(sql, {
      workspaceId: second.workspaceId,
      bookId: bookTwo,
      authorId,
      windowMinutes: 30,
    });

    expect(idOne).not.toBe(idTwo);
    const [rowOne] = await sql<{ workspace_id: string; book_id: string }[]>`
      SELECT workspace_id, book_id FROM changeset WHERE id = ${idOne}
    `;
    const [rowTwo] = await sql<{ workspace_id: string; book_id: string }[]>`
      SELECT workspace_id, book_id FROM changeset WHERE id = ${idTwo}
    `;
    expect(rowOne!.workspace_id).toBe(first.workspaceId);
    expect(rowOne!.book_id).toBe(bookOne);
    expect(rowTwo!.workspace_id).toBe(second.workspaceId);
    expect(rowTwo!.book_id).toBe(bookTwo);
    // Neither workspace's query can see the other's row.
    const firstRows = await sql`SELECT id FROM changeset WHERE workspace_id = ${first.workspaceId} AND author_id = ${authorId}`;
    const secondRows = await sql`SELECT id FROM changeset WHERE workspace_id = ${second.workspaceId} AND author_id = ${authorId}`;
    expect(firstRows).toHaveLength(1);
    expect(secondRows).toHaveLength(1);
  });

  // windowMinutes is a parameter, not a constant: the same last_activity_at
  // must join under one window and retire under a shorter one. A hardcoded
  // window passes only one of these two.
  test('the same 45-minute-old activity joins at windowMinutes 60 and retires at 30', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const bookId = await seedBook(workspaceId, rootId);
    const wideAuthor = await seedUser();
    const narrowAuthor = await seedUser();

    const wideFirst = await resolveChangeset(sql, { workspaceId, bookId, authorId: wideAuthor, windowMinutes: 60 });
    await sql`UPDATE changeset SET last_activity_at = now() - interval '45 minutes' WHERE id = ${wideFirst}`;
    const wideSecond = await resolveChangeset(sql, { workspaceId, bookId, authorId: wideAuthor, windowMinutes: 60 });
    expect(wideSecond).toBe(wideFirst);

    const narrowFirst = await resolveChangeset(sql, { workspaceId, bookId, authorId: narrowAuthor, windowMinutes: 30 });
    await sql`UPDATE changeset SET last_activity_at = now() - interval '45 minutes' WHERE id = ${narrowFirst}`;
    const narrowSecond = await resolveChangeset(sql, { workspaceId, bookId, authorId: narrowAuthor, windowMinutes: 30 });
    expect(narrowSecond).not.toBe(narrowFirst);

    const [wideRow] = await sql<{ closed_at: Date | null }[]>`SELECT closed_at FROM changeset WHERE id = ${wideFirst}`;
    const [narrowRow] = await sql<{ closed_at: Date | null }[]>`SELECT closed_at FROM changeset WHERE id = ${narrowFirst}`;
    expect(wideRow!.closed_at).toBeNull();
    expect(narrowRow!.closed_at).not.toBeNull();
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

  // Two saves that never actually overlap prove nothing about
  // changeset_open_per_author_idx, and a comment claiming they overlapped
  // is not evidence. The overlap is therefore *asserted*: each transaction
  // records clock_timestamp() immediately before and after its own
  // resolveChangeset(), and the two intervals are checked to intersect. A
  // rendezvous makes that deterministic rather than hopeful — both
  // transactions are open and parked before either is allowed to proceed,
  // so both reach INSERT ... ON CONFLICT while the other is still
  // mid-transaction. Without ON CONFLICT this pair raises 23505.
  test('two genuinely concurrent saves by one author on two different pages resolve to exactly one changeset', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const bookId = await seedBook(workspaceId, rootId);
    const authorId = await seedUser();

    const connA = postgres(db.url, { max: 1 });
    const connB = postgres(db.url, { max: 1 });

    let arrivedA!: () => void;
    let arrivedB!: () => void;
    const atGateA = new Promise<void>((resolve) => (arrivedA = resolve));
    const atGateB = new Promise<void>((resolve) => (arrivedB = resolve));
    // Bounded so a future change that serialises the two calls fails the
    // overlap assertion below instead of hanging the suite.
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 1000));

    async function run(
      conn: postgres.Sql,
      arrive: () => void,
      peer: Promise<void>,
    ): Promise<{ id: string; start: Date; end: Date }> {
      return conn.begin(async (tx) => {
        // Open the transaction for real before announcing arrival.
        await tx`SELECT 1`;
        arrive();
        await Promise.race([peer, timeout]);

        const [before] = await tx<{ t: Date }[]>`SELECT clock_timestamp() AS t`;
        const id = await resolveChangeset(tx, { workspaceId, bookId, authorId, windowMinutes: 30 });
        const [after] = await tx<{ t: Date }[]>`SELECT clock_timestamp() AS t`;
        return { id, start: before!.t, end: after!.t };
      }) as Promise<{ id: string; start: Date; end: Date }>;
    }

    try {
      const [a, b] = await Promise.all([run(connA, arrivedA, atGateB), run(connB, arrivedB, atGateA)]);

      // The load-bearing assertion for the word "concurrent": the two
      // resolveChangeset() intervals intersect, so both calls were in
      // flight at the same instant. Sequential calls cannot satisfy both.
      expect(a.start.getTime()).toBeLessThanOrEqual(b.end.getTime());
      expect(b.start.getTime()).toBeLessThanOrEqual(a.end.getTime());

      expect(a.id).toBe(b.id);
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
