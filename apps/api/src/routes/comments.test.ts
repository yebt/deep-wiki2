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
  readonly commenterEmail: string;
  readonly outsiderCookie: string;
  readonly mentionedReaderUserId: string;
  readonly mentionedReaderEmail: string;
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
  const commenterEmail = `commenter-${crypto.randomUUID()}@example.com`;
  const commenter = await seedUser(commenterEmail);
  const mentionedNoReadEmail = `noread-${crypto.randomUUID()}@example.com`;
  const mentionedNoRead = await seedUser(mentionedNoReadEmail);
  // A mentionable recipient who is neither the comment's author nor the
  // caller: mentioning the author back would let a route that mails the
  // wrong person still look correct.
  const mentionedReaderEmail = `mentioned-${crypto.randomUUID()}@example.com`;
  const mentionedReader = await seedUser(mentionedReaderEmail);
  const outsider = await seedUser(`outsider-${crypto.randomUUID()}@example.com`);

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
  await sql`
    INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
    VALUES (${ws!.id}, 'user', ${mentionedReader}, ${page!.id}, 'read', 'allow')
  `;
  // mentionedNoRead and outsider deliberately get no grant at all on this page.

  return {
    workspaceId: ws!.id,
    pageId: page!.id,
    readerCookie: await cookieFor(reader),
    commenterCookie: await cookieFor(commenter),
    commenterUserId: commenter,
    commenterEmail,
    outsiderCookie: await cookieFor(outsider),
    mentionedReaderUserId: mentionedReader,
    mentionedReaderEmail,
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
    // Body *and* headers: the block id and the comment's text must not
    // reach this subject through either channel.
    expectNoDisclosure(body, { id: comment!.id, values: ['blocka', 'a secret comment body'] }, res.headers);
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

// The same non-disclosure rule the password-reset route already holds and
// that wiki-link rendering holds: absence and denial-of-read must be
// indistinguishable. A caller with no grant at all must not be able to tell
// "this page does not exist" from "this page exists and you cannot see it".
// `can-many.ts`/`readable.ts` express the rule for sets by dropping an
// unreadable id from the result entirely; the singular analogue is the
// not-found response, so `read` is the gate that must answer first.
describe('page-existence probing — absence and denial answer identically', () => {
  const MISSING_PAGE_ID = '00000000-0000-4000-8000-0000000000ff';

  test('GET indicators: a nonexistent page and an unreadable page are byte-identical', async () => {
    const fixture = await buildFixture();
    await sql`
      INSERT INTO page_content (node_id, workspace_id, markdown, content_hash)
      VALUES (${fixture.pageId}, ${fixture.workspaceId}, 'Some text. ^blocke\n', 'hash')
    `;
    const app = buildApp();

    const missing = await app.request(`/pages/${MISSING_PAGE_ID}/comments/indicators`, {
      headers: { cookie: fixture.outsiderCookie },
    });
    const denied = await app.request(`/pages/${fixture.pageId}/comments/indicators`, {
      headers: { cookie: fixture.outsiderCookie },
    });

    const missingBody = await missing.text();
    const deniedBody = await denied.text();

    expect(denied.status).toBe(missing.status);
    expect(deniedBody).toBe(missingBody);
    // Pinned so a future change cannot make them identically *disclosing*.
    expect(missing.status).toBe(404);
    expect(denied.status).toBe(404);
    expectNoDisclosure(deniedBody, { id: fixture.pageId }, denied.headers);
  });

  test('POST a comment: a nonexistent page and an unreadable page are byte-identical', async () => {
    const fixture = await buildFixture();
    await sql`
      INSERT INTO page_content (node_id, workspace_id, markdown, content_hash)
      VALUES (${fixture.pageId}, ${fixture.workspaceId}, 'Some text. ^blockf\n', 'hash')
    `;
    const app = buildApp();
    const body = JSON.stringify({ blockId: 'blockf', offsetStart: 0, offsetEnd: 4, quote: 'Some', body: 'probe' });
    const headers = { 'content-type': 'application/json', cookie: fixture.outsiderCookie };

    const missing = await app.request(`/pages/${MISSING_PAGE_ID}/comments`, { method: 'POST', headers, body });
    const denied = await app.request(`/pages/${fixture.pageId}/comments`, { method: 'POST', headers, body });

    const missingBody = await missing.text();
    const deniedBody = await denied.text();

    expect(denied.status).toBe(missing.status);
    expect(deniedBody).toBe(missingBody);
    expect(missing.status).toBe(404);
    expect(denied.status).toBe(404);

    // The probe must also not have written anything.
    const rows = await sql`SELECT id FROM comments WHERE page_id = ${fixture.pageId}`;
    expect(rows).toHaveLength(0);
  });

  test('PATCH thread resolution: a nonexistent thread and an unreadable one are byte-identical', async () => {
    const fixture = await buildFixture();
    await sql`
      INSERT INTO page_content (node_id, workspace_id, markdown, content_hash)
      VALUES (${fixture.pageId}, ${fixture.workspaceId}, 'Some text. ^blockg\n', 'hash')
    `;
    await sql`
      INSERT INTO page_blocks (page_id, workspace_id, block_id, status, content_hash, excerpt)
      VALUES (${fixture.pageId}, ${fixture.workspaceId}, 'blockg', 'active', 'h', 'excerpt')
    `;
    const [thread] = await sql<{ id: string }[]>`
      INSERT INTO comments (workspace_id, page_id, body, block_id, offset_start, offset_end, quote, quote_hash, status)
      VALUES (${fixture.workspaceId}, ${fixture.pageId}, 'a thread', 'blockg', 0, 4, 'Some', 'h', 'anchored')
      RETURNING id
    `;
    const app = buildApp();
    const body = JSON.stringify({ resolved: true });
    const headers = { 'content-type': 'application/json', cookie: fixture.outsiderCookie };
    const MISSING_THREAD_ID = '00000000-0000-4000-8000-0000000000fe';

    const missing = await app.request(`/comments/${MISSING_THREAD_ID}/resolved`, { method: 'PATCH', headers, body });
    const denied = await app.request(`/comments/${thread!.id}/resolved`, { method: 'PATCH', headers, body });

    const missingBody = await missing.text();
    const deniedBody = await denied.text();

    expect(denied.status).toBe(missing.status);
    expect(deniedBody).toBe(missingBody);
    expect(missing.status).toBe(404);
    expect(denied.status).toBe(404);

    const [row] = await sql<{ resolved_at: Date | null }[]>`SELECT resolved_at FROM comments WHERE id = ${thread!.id}`;
    expect(row!.resolved_at).toBeNull();
  });

  // A caller who already holds `read` learns nothing new from a 403: they
  // can see the page. Denial of the *stronger* action stays distinguishable.
  test('a subject who holds read but not comment still gets 403, not 404', async () => {
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

    // Minting is asserted from storage first, and on its own terms. Every
    // way of breaking it also trips comments_block_fk and turns the route's
    // answer into a 500, so a leading `expect(res.status).toBe(201)` would
    // swallow every distinct failure into one status-code mismatch —
    // "anchor not minted" and "route crashed" would look identical.
    const [row] = await sql<{ markdown: string }[]>`SELECT markdown FROM page_content WHERE node_id = ${fixture.pageId}`;
    const [persistedBlock] = sliceBlocks(parse(row!.markdown), row!.markdown);
    const persistedAnchorId = persistedBlock!.anchorId;
    expect(persistedAnchorId).not.toBeNull();
    expect(row!.markdown).toContain(`^${persistedAnchorId}`);

    // The reconciled block row must name the same anchor the markdown does.
    const [blockRow] = await sql<{ block_id: string }[]>`
      SELECT block_id FROM page_blocks WHERE page_id = ${fixture.pageId} AND status = 'active'
    `;
    expect(blockRow!.block_id).toBe(persistedAnchorId!);

    // Only now the route's own answer, and the comment it wrote.
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; blockId: string };
    expect(created.blockId).toBe(persistedAnchorId!);
    expect(created.blockId).not.toBe(derivedBlock!.id);

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

// A reply's `parentId` arrives in the request body while its page comes
// from the URL, and nothing reconciled the two: the route gated
// `can('comment')` on the URL's page only, and `comments_parent_fk` keyed
// on (parent_id, workspace_id) pinned the tenant, not the page. The parent
// here is rooted on a *second* page in the same workspace that the caller
// has no grant on at all — a same-page parent would exercise nothing.
describe('POST /pages/:id/comments — a reply may not join a thread rooted on another page', () => {
  test('a reply naming a parent rooted on a page the caller cannot read is refused', async () => {
    const fixture = await buildFixture();
    await sql`
      INSERT INTO page_content (node_id, workspace_id, markdown, content_hash)
      VALUES (${fixture.pageId}, ${fixture.workspaceId}, 'Page A text. ^blockp\n', 'hash')
    `;
    await sql`
      INSERT INTO page_blocks (page_id, workspace_id, block_id, status, content_hash, excerpt)
      VALUES (${fixture.pageId}, ${fixture.workspaceId}, 'blockp', 'active', 'h', 'excerpt')
    `;

    const [rootNode] = await sql<{ id: string }[]>`
      SELECT id FROM nodes WHERE workspace_id = ${fixture.workspaceId} AND type = 'workspace'
    `;
    const [otherPage] = await sql<{ id: string }[]>`
      INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
      VALUES (${fixture.workspaceId}, ${rootNode!.id}, 'page', '', 1, ${`other-${crypto.randomUUID()}`}, 'Other Page')
      RETURNING id
    `;
    await sql`
      INSERT INTO page_content (node_id, workspace_id, markdown, content_hash)
      VALUES (${otherPage!.id}, ${fixture.workspaceId}, 'Page B text. ^blockq\n', 'hash-b')
    `;
    await sql`
      INSERT INTO page_blocks (page_id, workspace_id, block_id, status, content_hash, excerpt)
      VALUES (${otherPage!.id}, ${fixture.workspaceId}, 'blockq', 'active', 'h', 'excerpt')
    `;
    const [rootOnOtherPage] = await sql<{ id: string }[]>`
      INSERT INTO comments (workspace_id, page_id, author_id, body, block_id, offset_start, offset_end, quote, quote_hash, status)
      VALUES (${fixture.workspaceId}, ${otherPage!.id}, ${fixture.mentionedReaderUserId}, 'root on B', 'blockq', 0, 4, 'Page', 'h', 'anchored')
      RETURNING id
    `;

    // The caller may comment on page A and has no grant whatsoever on page B.
    const canReadOther = await can(sql, {
      subjectType: 'user',
      subjectId: fixture.commenterUserId,
      resourceId: otherPage!.id,
      action: 'read',
    });
    expect(canReadOther).toBe(false);

    const app = buildApp();
    const res = await app.request(`/pages/${fixture.pageId}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: fixture.commenterCookie },
      body: JSON.stringify({ parentId: rootOnOtherPage!.id, body: 'injected into a thread I cannot see' }),
    });

    // Storage first: nothing may have been written into page B's thread.
    const replies = await sql<{ id: string }[]>`SELECT id FROM comments WHERE parent_id = ${rootOnOtherPage!.id}`;
    expect(replies).toHaveLength(0);

    // Indistinguishable from a parentId that names nothing at all.
    expect(res.status).toBe(404);
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
  });

  // The `not.toContain` above used to sit immediately after a
  // `toHaveLength(0)`, where it could never fail on its own. Here it is the
  // load-bearing assertion: one notification *is* sent, so "the unreadable
  // recipient is not among the addressees" is a real discrimination.
  test('mentioning a readable and an unreadable user in one comment notifies only the readable one', async () => {
    const fixture = await buildFixture();
    await sql`
      INSERT INTO page_content (node_id, workspace_id, markdown, content_hash)
      VALUES (${fixture.pageId}, ${fixture.workspaceId}, 'Some text. ^blockh\n', 'hash')
    `;
    await sql`
      INSERT INTO page_blocks (page_id, workspace_id, block_id, status, content_hash, excerpt)
      VALUES (${fixture.pageId}, ${fixture.workspaceId}, 'blockh', 'active', 'h', 'excerpt')
    `;
    const mailSender = new RecordingMailSender();
    const app = buildApp(mailSender);

    const res = await app.request(`/pages/${fixture.pageId}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: fixture.commenterCookie },
      body: JSON.stringify({
        blockId: 'blockh',
        offsetStart: 0,
        offsetEnd: 4,
        quote: 'Some',
        body: 'hi',
        mentionedUserIds: [fixture.mentionedNoReadUserId, fixture.mentionedReaderUserId],
      }),
    });

    expect(res.status).toBe(201);
    const recipients = mailSender.sent.map((sent) => sent.to);
    expect(recipients).toEqual([fixture.mentionedReaderEmail]);
    expect(recipients).not.toContain(fixture.mentionedNoReadEmail);
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
      // A recipient distinct from the comment's own author: mentioning the
      // author back would let a route that mails the wrong person still
      // look correct.
      body: JSON.stringify({
        blockId: 'blockd',
        offsetStart: 0,
        offsetEnd: 4,
        quote: 'Some',
        body: 'hi',
        mentionedUserIds: [fixture.mentionedReaderUserId],
      }),
    });

    expect(res.status).toBe(201);
    expect(mailSender.sent).toHaveLength(1);
    // "Exactly one notification" is only half the claim; "to the mentioned
    // user" is the other half, and it is the half an attacker cares about.
    expect(mailSender.sent[0]!.to).toBe(fixture.mentionedReaderEmail);
    expect(mailSender.sent[0]!.to).not.toBe(fixture.commenterEmail);
    expect(mailSender.sent[0]!.to).not.toBe(fixture.mentionedNoReadEmail);
  });
});
