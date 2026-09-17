/**
 * `GET /pages/:id/history` (revision-history spec). Absence and
 * denial-of-read share one response, the same shape used by
 * `comments.ts`/`mentions.ts` — a caller with no grant cannot tell "this
 * page does not exist" from "this page exists and you may not see it".
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createSession, savePage } from '@deep-wiki/db';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '@deep-wiki/db/testing/provision';
import postgres from 'postgres';
import { expectNoDisclosure } from '../../testing/expect-no-disclosure';
import { SESSION_COOKIE_NAME } from '../middleware/session';
import { createRevisionRoutes } from './revisions';

let db: ProvisionedTestDatabase;
let sql: postgres.Sql;

const WINDOW_MINUTES = 30;

beforeAll(async () => {
  db = await provisionTestDatabase();
  sql = postgres(db.url, { max: 10 });
});

afterAll(async () => {
  await sql.end({ timeout: 1 }).catch(() => {});
  await db.drop();
});

interface Fixture {
  readonly workspaceId: string;
  readonly pageId: string;
  readonly authorId: string;
  readonly readerCookie: string;
  readonly outsiderCookie: string;
}

async function seedUser(displayName: string): Promise<string> {
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name)
    VALUES (${`${displayName.toLowerCase()}-${crypto.randomUUID()}@example.com`}, 'hash', ${displayName})
    RETURNING id
  `;
  return user!.id;
}

async function cookieFor(userId: string): Promise<string> {
  const { token } = await createSession(sql, { userId, idleTimeoutMinutes: 30, absoluteTimeoutDays: 30 });
  return `${SESSION_COOKIE_NAME}=${token}`;
}

async function buildFixture(): Promise<Fixture> {
  const owner = await seedUser('Owner');
  const reader = await seedUser('Reader');
  const outsider = await seedUser('Outsider');

  const [ws] = await sql<{ id: string }[]>`
    INSERT INTO workspaces (owner_id, name, slug) VALUES (${owner}, 'WS', ${`ws-${crypto.randomUUID()}`}) RETURNING id
  `;
  const [root] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${ws!.id}, NULL, 'workspace', '', 0, 'root', 'Root') RETURNING id
  `;
  const [page] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${ws!.id}, ${root!.id}, 'page', '', 0, ${`page-${crypto.randomUUID()}`}, 'A Page') RETURNING id
  `;
  await sql`
    INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
    VALUES (${ws!.id}, 'user', ${reader}, ${page!.id}, 'read', 'allow')
  `;

  return { workspaceId: ws!.id, pageId: page!.id, authorId: owner, readerCookie: await cookieFor(reader), outsiderCookie: await cookieFor(outsider) };
}

function buildApp() {
  return createRevisionRoutes({ sql, sessionIdleTimeoutMinutes: 30 });
}

describe('GET /pages/:id/history', () => {
  test('returns a page\'s revisions newest first for a subject with read', async () => {
    const fixture = await buildFixture();
    const first = await savePage(sql, {
      nodeId: fixture.pageId,
      workspaceId: fixture.workspaceId,
      markdown: '# One\n',
      expectedContentHash: null,
      updatedBy: fixture.authorId, changesetWindowMinutes: WINDOW_MINUTES,
    });
    await savePage(sql, {
      nodeId: fixture.pageId,
      workspaceId: fixture.workspaceId,
      markdown: '# Two\n',
      expectedContentHash: first.contentHash,
      updatedBy: fixture.authorId, changesetWindowMinutes: WINDOW_MINUTES,
    });

    const app = buildApp();
    const res = await app.request(`/pages/${fixture.pageId}/history`, { headers: { cookie: fixture.readerCookie } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { revisions: { id: string; authorDisplayName: string | null; createdAt: string }[] };
    expect(body.revisions).toHaveLength(2);
    const first_ = new Date(body.revisions[0]!.createdAt).getTime();
    const second_ = new Date(body.revisions[1]!.createdAt).getTime();
    expect(first_).toBeGreaterThanOrEqual(second_);
    // The history screen renders "who changed it" from a name, not a raw
    // id — the route must carry it, not just `authorId`.
    expect(body.revisions[0]!.authorDisplayName).toBe('Owner');
  });

  // The history screen marks a revision whose stored bytes equal the
  // previous one's (rows minted before `savePage()` refused no-op saves —
  // docs/TODO.md Findings, 2026-09-17) from the hash, never from content.
  test('each revision carries its content hash and never its content', async () => {
    const fixture = await buildFixture();
    const first = await savePage(sql, { nodeId: fixture.pageId, workspaceId: fixture.workspaceId, markdown: '# One\n', expectedContentHash: null, updatedBy: fixture.authorId, changesetWindowMinutes: WINDOW_MINUTES });

    const app = buildApp();
    const res = await app.request(`/pages/${fixture.pageId}/history`, { headers: { cookie: fixture.readerCookie } });

    const body = (await res.json()) as { revisions: Record<string, unknown>[] };
    expect(body.revisions[0]!.contentHash).toBe(first.contentHash);
    expect(body.revisions[0]).not.toHaveProperty('content');
  });

  test('a subject with no read grant receives the same 404 as a nonexistent page', async () => {
    const fixture = await buildFixture();
    await savePage(sql, { nodeId: fixture.pageId, workspaceId: fixture.workspaceId, markdown: '# One\n', expectedContentHash: null, updatedBy: fixture.authorId, changesetWindowMinutes: WINDOW_MINUTES });

    const app = buildApp();
    const deniedRes = await app.request(`/pages/${fixture.pageId}/history`, { headers: { cookie: fixture.outsiderCookie } });
    const missingRes = await app.request(`/pages/${crypto.randomUUID()}/history`, { headers: { cookie: fixture.outsiderCookie } });

    expect(deniedRes.status).toBe(404);
    expect(missingRes.status).toBe(404);
    expect(await deniedRes.json()).toEqual(await missingRes.json());
  });
});

// changesets spec: "Book-Level History Is One Query" — the input the
// book-level diff screen needs.
describe('GET /books/:id/history', () => {
  async function seedBookFixture() {
    const owner = await seedUser('Owner');
    const reader = await seedUser('Reader');
    const outsider = await seedUser('Outsider');
    const [ws] = await sql<{ id: string }[]>`
      INSERT INTO workspaces (owner_id, name, slug) VALUES (${owner}, 'WS', ${`ws-${crypto.randomUUID()}`}) RETURNING id
    `;
    const [root] = await sql<{ id: string }[]>`
      INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
      VALUES (${ws!.id}, NULL, 'workspace', '', 0, 'root', 'Root') RETURNING id
    `;
    const [book] = await sql<{ id: string }[]>`
      INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
      VALUES (${ws!.id}, ${root!.id}, 'book', '', 0, ${`book-${crypto.randomUUID()}`}, 'Operations Handbook') RETURNING id
    `;
    const [chapter] = await sql<{ id: string }[]>`
      INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
      VALUES (${ws!.id}, ${book!.id}, 'chapter', '', 0, ${`chapter-${crypto.randomUUID()}`}, 'Chapter') RETURNING id
    `;
    // Nested at least one level below the book — direct-children-only would
    // pass a shallower fixture by accident.
    const [nestedPage] = await sql<{ id: string }[]>`
      INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
      VALUES (${ws!.id}, ${chapter!.id}, 'page', '', 0, ${`page-${crypto.randomUUID()}`}, 'Nested Page') RETURNING id
    `;
    await sql`
      INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
      VALUES (${ws!.id}, 'user', ${reader}, ${book!.id}, 'read', 'allow')
    `;

    return {
      workspaceId: ws!.id,
      bookId: book!.id,
      chapterId: chapter!.id,
      nestedPageId: nestedPage!.id,
      authorId: owner,
      readerId: reader,
      readerCookie: await cookieFor(reader),
      outsiderCookie: await cookieFor(outsider),
    };
  }

  function buildApp() {
    return createRevisionRoutes({ sql, sessionIdleTimeoutMinutes: 30 });
  }

  test('includes a changeset with a revision from a page nested under a chapter', async () => {
    const fixture = await seedBookFixture();
    await savePage(sql, {
      nodeId: fixture.nestedPageId,
      workspaceId: fixture.workspaceId,
      markdown: '# Nested\n',
      expectedContentHash: null,
      updatedBy: fixture.authorId,
      changesetWindowMinutes: WINDOW_MINUTES,
    });

    const app = buildApp();
    const res = await app.request(`/books/${fixture.bookId}/history`, { headers: { cookie: fixture.readerCookie } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      changesets: { id: string; authorDisplayName: string | null; message: string | null; revisions: { pageId: string }[] }[];
    };
    expect(body.changesets).toHaveLength(1);
    expect(body.changesets[0]!.authorDisplayName).toBe('Owner');
    expect(body.changesets[0]!.message).toBeNull();
    expect(body.changesets[0]!.revisions.map((r) => r.pageId)).toEqual([fixture.nestedPageId]);
  });

  // The screen cannot show the book's own name or link back to its tree
  // without these — neither field existed on this response at all before.
  test('carries the book title and workspaceId', async () => {
    const fixture = await seedBookFixture();
    await savePage(sql, {
      nodeId: fixture.nestedPageId,
      workspaceId: fixture.workspaceId,
      markdown: '# Nested\n',
      expectedContentHash: null,
      updatedBy: fixture.authorId,
      changesetWindowMinutes: WINDOW_MINUTES,
    });

    const app = buildApp();
    const res = await app.request(`/books/${fixture.bookId}/history`, { headers: { cookie: fixture.readerCookie } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { title: string; workspaceId: string };
    expect(body.title).toBe('Operations Handbook');
    expect(body.workspaceId).toBe(fixture.workspaceId);
  });

  // The empty-history state needs a way forward (a name and a link back to
  // the tree) even when there is nothing to list yet — book identity must
  // not ride along with the changesets array.
  test('a book with no changesets still carries its title and workspaceId', async () => {
    const fixture = await seedBookFixture();
    const app = buildApp();

    const res = await app.request(`/books/${fixture.bookId}/history`, { headers: { cookie: fixture.readerCookie } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { title: string; workspaceId: string; changesets: unknown[] };
    expect(body.title).toBe('Operations Handbook');
    expect(body.workspaceId).toBe(fixture.workspaceId);
    expect(body.changesets).toEqual([]);
  });

  // A reader who can read the book but not one page inside it must not see
  // that page's revisions — matching how `tree.ts` drops unreadable
  // descendants rather than marking them.
  test('a page inside the book the reader cannot read is dropped from the response, not merely unmarked', async () => {
    const fixture = await seedBookFixture();
    const [hiddenPage] = await sql<{ id: string }[]>`
      INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
      VALUES (${fixture.workspaceId}, ${fixture.chapterId}, 'page', '', 1, ${`hidden-${crypto.randomUUID()}`}, 'Hidden Page') RETURNING id
    `;
    // The reader inherits `read` on every descendant from the book-level
    // grant in `seedBookFixture` — this explicit, closer DENY overrides it
    // for `hiddenPage` alone.
    await sql`
      INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
      VALUES (${fixture.workspaceId}, 'user', ${fixture.readerId}, ${hiddenPage!.id}, 'read', 'deny')
    `;

    await savePage(sql, {
      nodeId: fixture.nestedPageId,
      workspaceId: fixture.workspaceId,
      markdown: '# Visible\n',
      expectedContentHash: null,
      updatedBy: fixture.authorId,
      changesetWindowMinutes: WINDOW_MINUTES,
    });
    const savedHidden = await savePage(sql, {
      nodeId: hiddenPage!.id,
      workspaceId: fixture.workspaceId,
      markdown: '# Secret\n',
      expectedContentHash: null,
      updatedBy: fixture.authorId,
      changesetWindowMinutes: WINDOW_MINUTES,
    });
    void savedHidden;

    const app = buildApp();
    const res = await app.request(`/books/${fixture.bookId}/history`, { headers: { cookie: fixture.readerCookie } });

    expect(res.status).toBe(200);
    const bodyText = await res.text();
    const body = JSON.parse(bodyText) as { changesets: { revisions: { pageId: string }[] }[] };
    const allPageIds = body.changesets.flatMap((c) => c.revisions.map((r) => r.pageId));
    expect(allPageIds).toContain(fixture.nestedPageId);
    expect(allPageIds).not.toContain(hiddenPage!.id);
    expectNoDisclosure(bodyText, { id: hiddenPage!.id }, res.headers);
  });

  test('a subject with no read grant on the book receives the same 404 as a nonexistent book', async () => {
    const fixture = await seedBookFixture();
    await savePage(sql, {
      nodeId: fixture.nestedPageId,
      workspaceId: fixture.workspaceId,
      markdown: '# One\n',
      expectedContentHash: null,
      updatedBy: fixture.authorId,
      changesetWindowMinutes: WINDOW_MINUTES,
    });

    const app = buildApp();
    const denied = await app.request(`/books/${fixture.bookId}/history`, { headers: { cookie: fixture.outsiderCookie } });
    const missing = await app.request(`/books/${crypto.randomUUID()}/history`, { headers: { cookie: fixture.outsiderCookie } });

    expect(denied.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await denied.json()).toEqual(await missing.json());
  });

  test('a book with no changesets returns an empty list rather than an error', async () => {
    const fixture = await seedBookFixture();
    const app = buildApp();

    const res = await app.request(`/books/${fixture.bookId}/history`, { headers: { cookie: fixture.readerCookie } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { changesets: unknown[] };
    expect(body.changesets).toEqual([]);
  });
});
