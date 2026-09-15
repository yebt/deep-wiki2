/**
 * `GET /workspaces/:id/activity` — the workspace dashboard's "what changed
 * and who is here" (apps/web/PRODUCT.md). Three lists, each filtered
 * through the caller's own grants, and one non-disclosure rule shared
 * with `tree.ts`: a caller who can read nothing in a workspace gets the
 * same 404 a workspace that never existed produces.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createReply, createRootComment, createSession, savePage } from '@deep-wiki/db';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '@deep-wiki/db/testing/provision';
import postgres from 'postgres';
import { expectNoDisclosure } from '../../testing/expect-no-disclosure';
import { SESSION_COOKIE_NAME } from '../middleware/session';
import { createActivityRoutes } from './activity';

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
  readonly readablePageId: string;
  readonly hiddenPageId: string;
  readonly ownerId: string;
  readonly readerId: string;
  readonly readerCookie: string;
  readonly outsiderCookie: string;
}

async function seedUser(displayName: string): Promise<string> {
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name)
    VALUES (${`${displayName.toLowerCase().replace(/\s+/g, '-')}-${crypto.randomUUID()}@example.com`}, 'hash', ${displayName})
    RETURNING id
  `;
  return user!.id;
}

async function cookieFor(userId: string): Promise<string> {
  const { token } = await createSession(sql, { userId, idleTimeoutMinutes: 30, absoluteTimeoutDays: 30 });
  return `${SESSION_COOKIE_NAME}=${token}`;
}

async function grant(workspaceId: string, userId: string, resourceId: string, action: string): Promise<void> {
  await sql`
    INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
    VALUES (${workspaceId}, 'user', ${userId}, ${resourceId}, ${action}, 'allow')
  `;
}

async function buildFixture(): Promise<Fixture> {
  const owner = await seedUser('Owner');
  const reader = await seedUser('Ana Ruiz');
  const outsider = await seedUser('Outsider');

  const [ws] = await sql<{ id: string }[]>`
    INSERT INTO workspaces (owner_id, name, slug) VALUES (${owner}, 'Acme Wiki', ${`ws-${crypto.randomUUID()}`}) RETURNING id
  `;
  const [root] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${ws!.id}, NULL, 'workspace', '', 0, 'root', 'Root') RETURNING id
  `;
  const [readable] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${ws!.id}, ${root!.id}, 'page', '', 0, ${`page-${crypto.randomUUID()}`}, 'Roadmap') RETURNING id
  `;
  const [hidden] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${ws!.id}, ${root!.id}, 'page', '', 1, ${`page-${crypto.randomUUID()}`}, 'Salaries') RETURNING id
  `;
  await grant(ws!.id, reader, readable!.id, 'read');

  return {
    workspaceId: ws!.id,
    readablePageId: readable!.id,
    hiddenPageId: hidden!.id,
    ownerId: owner,
    readerId: reader,
    readerCookie: await cookieFor(reader),
    outsiderCookie: await cookieFor(outsider),
  };
}

function buildApp() {
  return createActivityRoutes({ sql, sessionIdleTimeoutMinutes: 30 });
}

interface ActivityBody {
  workspace: { id: string; name: string };
  recent: { revisionId: string; pageId: string; pageTitle: string; author: { displayName: string | null }; changes: { added: number; removed: number; modified: number; moved: number } }[];
  mine: { pageId: string; pageTitle: string }[];
  threads: { id: string; pageTitle: string; quote: string; replyCount: number; mentionsYou: boolean; awaitsYou: boolean }[];
}

describe('GET /workspaces/:id/activity', () => {
  test('recent changes name the page, the author and the four class counts, newest first, only on pages the caller may read', async () => {
    const f = await buildFixture();
    const first = await savePage(sql, { nodeId: f.readablePageId, workspaceId: f.workspaceId, markdown: '# One\n\nThe launch is planned for the second quarter, pending the security review.\n', expectedContentHash: null, updatedBy: f.ownerId, changesetWindowMinutes: WINDOW_MINUTES });
    await savePage(sql, { nodeId: f.readablePageId, workspaceId: f.workspaceId, markdown: '# One\n\nThe launch is planned for the third quarter, pending the security review.\n\nA new paragraph about staffing.\n', expectedContentHash: first.contentHash, updatedBy: f.ownerId, changesetWindowMinutes: WINDOW_MINUTES });
    await savePage(sql, { nodeId: f.hiddenPageId, workspaceId: f.workspaceId, markdown: '# Salaries\n', expectedContentHash: null, updatedBy: f.ownerId, changesetWindowMinutes: WINDOW_MINUTES });

    const res = await buildApp().request(`/workspaces/${f.workspaceId}/activity`, { headers: { cookie: f.readerCookie } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as ActivityBody;
    expect(body.workspace).toEqual({ id: f.workspaceId, name: 'Acme Wiki' });
    expect(body.recent.map((change) => change.pageTitle)).toEqual(['Roadmap', 'Roadmap']);
    expect(body.recent[0]!.author.displayName).toBe('Owner');
    // The second save changed one block and added one; the first save
    // added everything against nothing.
    expect(body.recent[0]!.changes).toEqual({ added: 1, removed: 0, modified: 1, moved: 0 });
    expect(body.recent[1]!.changes).toEqual({ added: 2, removed: 0, modified: 0, moved: 0 });
    expectNoDisclosure(body, { id: f.hiddenPageId, title: 'Salaries' }, res.headers);
  });

  test('`mine` is the caller\'s own saves and nobody else\'s', async () => {
    const f = await buildFixture();
    await grant(f.workspaceId, f.readerId, f.readablePageId, 'write');
    const first = await savePage(sql, { nodeId: f.readablePageId, workspaceId: f.workspaceId, markdown: '# One\n', expectedContentHash: null, updatedBy: f.ownerId, changesetWindowMinutes: WINDOW_MINUTES });
    await savePage(sql, { nodeId: f.readablePageId, workspaceId: f.workspaceId, markdown: '# Two\n', expectedContentHash: first.contentHash, updatedBy: f.readerId, changesetWindowMinutes: WINDOW_MINUTES });

    const res = await buildApp().request(`/workspaces/${f.workspaceId}/activity`, { headers: { cookie: f.readerCookie } });

    const body = (await res.json()) as ActivityBody;
    expect(body.recent).toHaveLength(2);
    expect(body.mine).toHaveLength(1);
    expect(body.mine[0]!.pageTitle).toBe('Roadmap');
  });

  test('threads are the open ones the caller is part of or named in, on pages they may comment on, and say whether each waits on them', async () => {
    const f = await buildFixture();
    await grant(f.workspaceId, f.readerId, f.readablePageId, 'comment');
    await savePage(sql, { nodeId: f.readablePageId, workspaceId: f.workspaceId, markdown: 'Some text. ^blocka\n', expectedContentHash: null, updatedBy: f.ownerId, changesetWindowMinutes: WINDOW_MINUTES });
    await savePage(sql, { nodeId: f.hiddenPageId, workspaceId: f.workspaceId, markdown: 'Hidden text. ^blockb\n', expectedContentHash: null, updatedBy: f.ownerId, changesetWindowMinutes: WINDOW_MINUTES });

    const anchor = { blockId: 'blocka', offsetStart: 0, offsetEnd: 4, quote: 'Some', quoteHash: 'h' } as const;
    const waiting = await createRootComment(sql, { workspaceId: f.workspaceId, pageId: f.readablePageId, authorId: f.ownerId, body: 'Thoughts, @Ana Ruiz?', ...anchor });
    const answered = await createRootComment(sql, { workspaceId: f.workspaceId, pageId: f.readablePageId, authorId: f.ownerId, body: 'Another one', ...anchor });
    await createReply(sql, { workspaceId: f.workspaceId, pageId: f.readablePageId, parentId: answered.id, authorId: f.readerId, body: 'Done.' });
    await createRootComment(sql, { workspaceId: f.workspaceId, pageId: f.readablePageId, authorId: f.ownerId, body: 'Not about her', ...anchor });
    await createRootComment(sql, { workspaceId: f.workspaceId, pageId: f.hiddenPageId, authorId: f.ownerId, body: 'Secret, @Ana Ruiz', blockId: 'blockb', offsetStart: 0, offsetEnd: 6, quote: 'Hidden', quoteHash: 'h2' });

    const res = await buildApp().request(`/workspaces/${f.workspaceId}/activity`, { headers: { cookie: f.readerCookie } });

    const body = (await res.json()) as ActivityBody;
    expect(body.threads.map((thread) => thread.id).sort()).toEqual([waiting.id, answered.id].sort());
    const byId = new Map(body.threads.map((thread) => [thread.id, thread]));
    expect(byId.get(waiting.id)).toMatchObject({ mentionsYou: true, awaitsYou: true, quote: 'Some', pageTitle: 'Roadmap', replyCount: 0 });
    expect(byId.get(answered.id)).toMatchObject({ mentionsYou: false, awaitsYou: false, replyCount: 1 });
    expectNoDisclosure(body, { id: f.hiddenPageId, title: 'Salaries', values: ['Secret', 'Hidden'] }, res.headers);
  });

  test('a caller with a read grant but no comment grant gets no threads, the shape a page with none produces', async () => {
    const f = await buildFixture();
    await savePage(sql, { nodeId: f.readablePageId, workspaceId: f.workspaceId, markdown: 'Some text. ^blocka\n', expectedContentHash: null, updatedBy: f.ownerId, changesetWindowMinutes: WINDOW_MINUTES });
    await createRootComment(sql, { workspaceId: f.workspaceId, pageId: f.readablePageId, authorId: f.ownerId, body: '@Ana Ruiz look', blockId: 'blocka', offsetStart: 0, offsetEnd: 4, quote: 'Some', quoteHash: 'h' });

    const res = await buildApp().request(`/workspaces/${f.workspaceId}/activity`, { headers: { cookie: f.readerCookie } });

    expect(((await res.json()) as ActivityBody).threads).toEqual([]);
  });

  test('a caller who can read nothing in the workspace receives the same 404 as a workspace that does not exist', async () => {
    const f = await buildFixture();
    await savePage(sql, { nodeId: f.readablePageId, workspaceId: f.workspaceId, markdown: '# One\n', expectedContentHash: null, updatedBy: f.ownerId, changesetWindowMinutes: WINDOW_MINUTES });

    const app = buildApp();
    const denied = await app.request(`/workspaces/${f.workspaceId}/activity`, { headers: { cookie: f.outsiderCookie } });
    const missing = await app.request(`/workspaces/${crypto.randomUUID()}/activity`, { headers: { cookie: f.outsiderCookie } });

    expect(denied.status).toBe(404);
    expect(missing.status).toBe(404);
    const deniedText = await denied.text();
    expect(JSON.parse(deniedText)).toEqual(await missing.json());
    expectNoDisclosure(deniedText, { id: f.readablePageId, title: 'Roadmap', values: ['Acme Wiki'] }, denied.headers);
  });

  test('an unauthenticated request is refused', async () => {
    const f = await buildFixture();
    const res = await buildApp().request(`/workspaces/${f.workspaceId}/activity`);
    expect(res.status).toBe(401);
  });
});
