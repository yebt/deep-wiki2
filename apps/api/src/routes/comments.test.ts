/**
 * Comment routes (comment-threads, comment-overlay specs): the indicator
 * endpoint must never disclose comment existence to a subject without
 * `comment`; creation mints a persisted anchor for an unanchored block;
 * mentions notify only a recipient who can already read the page.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { can, createSession } from '@deep-wiki/db';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '@deep-wiki/db/testing/provision';
import { ok, type MailSendError, type MailSender, type Result, type SendMailInput } from '@deep-wiki/core';
import { sliceBlocks, parse } from '@deep-wiki/markdown';
import postgres from 'postgres';
import { expectNoDisclosure } from '../../testing/expect-no-disclosure';
import { SESSION_COOKIE_NAME } from '../middleware/session';
import { createCommentRoutes } from './comments';

let db: ProvisionedTestDatabase;
let sql: postgres.Sql;

beforeAll(async () => {
  db = await provisionTestDatabase();
  sql = postgres(db.url, { max: 10 });
});

afterAll(async () => {
  await sql.end({ timeout: 1 }).catch(() => {});
  await db.drop();
});

class RecordingMailSender implements MailSender {
  readonly sent: SendMailInput[] = [];
  async send(input: SendMailInput): Promise<Result<void, MailSendError>> {
    this.sent.push(input);
    return ok(undefined);
  }
}

interface Fixture {
  readonly workspaceId: string;
  readonly pageId: string;
  readonly readerCookie: string;
  readonly commenterCookie: string;
  readonly commenterUserId: string;
  readonly mentionedNoReadUserId: string;
  readonly mentionedNoReadEmail: string;
}

async function seedUser(email: string): Promise<string> {
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name) VALUES (${email}, 'hash', 'User') RETURNING id
  `;
  return user!.id;
}

async function cookieFor(userId: string): Promise<string> {
  const { token } = await createSession(sql, { userId, idleTimeoutMinutes: 30, absoluteTimeoutDays: 30 });
  return `${SESSION_COOKIE_NAME}=${token}`;
}

async function buildFixture(): Promise<Fixture> {
  const [owner] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name) VALUES (${`owner-${crypto.randomUUID()}@example.com`}, 'hash', 'Owner') RETURNING id
  `;
  const reader = await seedUser(`reader-${crypto.randomUUID()}@example.com`);
  const commenter = await seedUser(`commenter-${crypto.randomUUID()}@example.com`);
  const mentionedNoReadEmail = `noread-${crypto.randomUUID()}@example.com`;
  const mentionedNoRead = await seedUser(mentionedNoReadEmail);

  const [ws] = await sql<{ id: string }[]>`
    INSERT INTO workspaces (owner_id, name, slug) VALUES (${owner!.id}, 'WS', ${`ws-${crypto.randomUUID()}`}) RETURNING id
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
  await sql`
    INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
    VALUES (${ws!.id}, 'user', ${commenter}, ${page!.id}, 'read', 'allow')
  `;
  await sql`
    INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
    VALUES (${ws!.id}, 'user', ${commenter}, ${page!.id}, 'comment', 'allow')
  `;
  // mentionedNoRead deliberately gets no grant at all on this page.

  return {
    workspaceId: ws!.id,
    pageId: page!.id,
    readerCookie: await cookieFor(reader),
    commenterCookie: await cookieFor(commenter),
    commenterUserId: commenter,
    mentionedNoReadUserId: mentionedNoRead,
    mentionedNoReadEmail,
  };
}

function buildApp(mailSender: MailSender = new RecordingMailSender()) {
  return createCommentRoutes({ sql, mailSender, sessionIdleTimeoutMinutes: 30, changesetWindowMinutes: 30 });
}

// comment-overlay: "A subject with read but not comment receives no
// indicator" — the response must be indistinguishable from a page with
// zero comments (same shape, same status).
describe('GET /pages/:id/comments/indicators — non-disclosure', () => {
  test('a subject with read but not comment sees no evidence a comment exists', async () => {
    const fixture = await buildFixture();
    await sql`
      INSERT INTO page_content (node_id, workspace_id, markdown, content_hash)
      VALUES (${fixture.pageId}, ${fixture.workspaceId}, 'Some text. ^blocka\n', 'hash')
    `;
    await sql`
      INSERT INTO page_blocks (page_id, workspace_id, block_id, status, content_hash, excerpt)
      VALUES (${fixture.pageId}, ${fixture.workspaceId}, 'blocka', 'active', 'h', 'excerpt')
    `;
    const [comment] = await sql<{ id: string }[]>`
      INSERT INTO comments (workspace_id, page_id, body, block_id, offset_start, offset_end, quote, quote_hash, status)
      VALUES (${fixture.workspaceId}, ${fixture.pageId}, 'a secret comment body', 'blocka', 0, 4, 'Some', 'h', 'anchored')
      RETURNING id
    `;

    const app = buildApp();
    const res = await app.request(`/pages/${fixture.pageId}/comments/indicators`, { headers: { cookie: fixture.readerCookie } });

    expect(res.status).toBe(200);
    const bodyText = await res.text();
    const body = JSON.parse(bodyText) as unknown;
    expect(body).toEqual({ indicators: [] });
    expectNoDisclosure(body, { id: comment!.id });
    expect(bodyText).not.toContain('blocka');
    expect(bodyText).not.toContain('a secret comment body');
  });

  test('a subject with comment receives real indicators', async () => {
    const fixture = await buildFixture();
    await sql`
      INSERT INTO page_content (node_id, workspace_id, markdown, content_hash)
      VALUES (${fixture.pageId}, ${fixture.workspaceId}, 'Some text. ^blockb\n', 'hash')
    `;
    await sql`
      INSERT INTO page_blocks (page_id, workspace_id, block_id, status, content_hash, excerpt)
      VALUES (${fixture.pageId}, ${fixture.workspaceId}, 'blockb', 'active', 'h', 'excerpt')
    `;
    await sql`
      INSERT INTO comments (workspace_id, page_id, body, block_id, offset_start, offset_end, quote, quote_hash, status)
      VALUES (${fixture.workspaceId}, ${fixture.pageId}, 'visible comment', 'blockb', 0, 4, 'Some', 'h', 'anchored')
    `;

    const app = buildApp();
    const res = await app.request(`/pages/${fixture.pageId}/comments/indicators`, { headers: { cookie: fixture.commenterCookie } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { indicators: { blockId: string; count: number }[] };
    expect(body.indicators).toEqual([{ blockId: 'blockb', count: 1 }]);
  });
});

describe('POST /pages/:id/comments — anchor minting', () => {
  test('a comment on an unanchored block mints and persists a real anchor', async () => {
    const fixture = await buildFixture();
    const markdown = 'A paragraph with no persisted anchor yet.\n';
    await sql`
      INSERT INTO page_content (node_id, workspace_id, markdown, content_hash)
      VALUES (${fixture.pageId}, ${fixture.workspaceId}, ${markdown}, 'hash')
    `;
    const [derivedBlock] = sliceBlocks(parse(markdown), markdown);
    expect(derivedBlock!.anchorId).toBeNull();

    const app = buildApp();
    const res = await app.request(`/pages/${fixture.pageId}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: fixture.commenterCookie },
      body: JSON.stringify({
        blockId: derivedBlock!.id,
        offsetStart: 0,
        offsetEnd: 1,
        quote: 'A',
        body: 'A comment on an unanchored block.',
      }),
    });

    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; blockId: string };
    expect(created.blockId).not.toBe(derivedBlock!.id);

    const [row] = await sql<{ markdown: string }[]>`SELECT markdown FROM page_content WHERE node_id = ${fixture.pageId}`;
    expect(row!.markdown).toContain(`^${created.blockId}`);

    const [commentRow] = await sql<{ block_id: string }[]>`SELECT block_id FROM comments WHERE id = ${created.id}`;
    expect(commentRow!.block_id).toBe(created.blockId);
  });

  test('a subject with read but not comment cannot create a comment', async () => {
    const fixture = await buildFixture();
    await sql`
      INSERT INTO page_content (node_id, workspace_id, markdown, content_hash)
      VALUES (${fixture.pageId}, ${fixture.workspaceId}, 'Some text.\n', 'hash')
    `;

    const app = buildApp();
    const res = await app.request(`/pages/${fixture.pageId}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: fixture.readerCookie },
      body: JSON.stringify({ blockId: 'd:whatever#0', offsetStart: 0, offsetEnd: 4, quote: 'Some', body: 'hi' }),
    });

    expect(res.status).toBe(403);
  });
});

describe('POST /pages/:id/comments — mentions', () => {
  test('a mentioned user without read on the page receives no notification', async () => {
    const fixture = await buildFixture();
    await sql`
      INSERT INTO page_content (node_id, workspace_id, markdown, content_hash)
      VALUES (${fixture.pageId}, ${fixture.workspaceId}, 'Some text. ^blockc\n', 'hash')
    `;
    await sql`
      INSERT INTO page_blocks (page_id, workspace_id, block_id, status, content_hash, excerpt)
      VALUES (${fixture.pageId}, ${fixture.workspaceId}, 'blockc', 'active', 'h', 'excerpt')
    `;
    const mailSender = new RecordingMailSender();
    const app = buildApp(mailSender);

    const canReadBefore = await can(sql, {
      subjectType: 'user',
      subjectId: fixture.mentionedNoReadUserId,
      resourceId: fixture.pageId,
      action: 'read',
    });
    expect(canReadBefore).toBe(false);

    const res = await app.request(`/pages/${fixture.pageId}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: fixture.commenterCookie },
      body: JSON.stringify({
        blockId: 'blockc',
        offsetStart: 0,
        offsetEnd: 4,
        quote: 'Some',
        body: 'hi',
        mentionedUserIds: [fixture.mentionedNoReadUserId],
      }),
    });

    expect(res.status).toBe(201);
    expect(mailSender.sent).toHaveLength(0);
    // No credential/hash/token, and no evidence of the mention's existence,
    // ever reaches the recording sender either — there is nothing sent at all.
    expect(mailSender.sent.map((s) => s.to)).not.toContain(fixture.mentionedNoReadEmail);
  });

  test('a mention sends exactly one notification to a user who can read the page', async () => {
    const fixture = await buildFixture();
    await sql`
      INSERT INTO page_content (node_id, workspace_id, markdown, content_hash)
      VALUES (${fixture.pageId}, ${fixture.workspaceId}, 'Some text. ^blockd\n', 'hash')
    `;
    await sql`
      INSERT INTO page_blocks (page_id, workspace_id, block_id, status, content_hash, excerpt)
      VALUES (${fixture.pageId}, ${fixture.workspaceId}, 'blockd', 'active', 'h', 'excerpt')
    `;
    const mailSender = new RecordingMailSender();
    const app = buildApp(mailSender);

    const res = await app.request(`/pages/${fixture.pageId}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: fixture.commenterCookie },
      body: JSON.stringify({
        blockId: 'blockd',
        offsetStart: 0,
        offsetEnd: 4,
        quote: 'Some',
        body: 'hi',
        mentionedUserIds: [fixture.commenterUserId],
      }),
    });

    expect(res.status).toBe(201);
    expect(mailSender.sent).toHaveLength(1);
  });
});
