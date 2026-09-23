/**
 * Comment routes (comment-threads, comment-overlay specs): the indicator
 * endpoint must never disclose comment existence to a subject without
 * `comment`; creation mints a persisted anchor for an unanchored block;
 * mentions notify only a recipient who can already read the page.
 */
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { can, createSession, savePage } from '@deep-wiki/db';
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

// trash-non-disclosure / comment-threads specs: a former reader/commenter
// must not learn a page was trashed, and its comment data must be as
// absent as a page with zero comments. tasks.md 4.20-4.21 (gap file — not
// named by design Decision 7's route table).
describe('trash-non-disclosure', () => {
  async function trash(nodeId: string): Promise<void> {
    await sql`UPDATE nodes SET trashed_at = now(), trash_operation_id = ${crypto.randomUUID()} WHERE id = ${nodeId}`;
  }

  test('GET indicators on a trashed page answers identically to an unknown page', async () => {
    const fixture = await buildFixture();
    await sql`
      INSERT INTO page_content (node_id, workspace_id, markdown, content_hash)
      VALUES (${fixture.pageId}, ${fixture.workspaceId}, 'Some text. ^blockh\n', 'hash')
    `;
    await trash(fixture.pageId);
    const app = buildApp();

    const denied = await app.request(`/pages/${fixture.pageId}/comments/indicators`, { headers: { cookie: fixture.commenterCookie } });
    const missing = await app.request(`/pages/${crypto.randomUUID()}/comments/indicators`, { headers: { cookie: fixture.commenterCookie } });

    expect(denied.status).toBe(404);
    expect(await denied.text()).toBe(await missing.text());
  });

  test('GET /pages/:id/comments on a trashed page answers identically to an unknown page, with no thread data disclosed', async () => {
    const fixture = await buildFixture();
    await sql`
      INSERT INTO page_content (node_id, workspace_id, markdown, content_hash)
      VALUES (${fixture.pageId}, ${fixture.workspaceId}, 'Some text. ^blocki\n', 'hash')
    `;
    await sql`
      INSERT INTO page_blocks (page_id, workspace_id, block_id, status, content_hash, excerpt)
      VALUES (${fixture.pageId}, ${fixture.workspaceId}, 'blocki', 'active', 'h', 'excerpt')
    `;
    const [thread] = await sql<{ id: string }[]>`
      INSERT INTO comments (workspace_id, page_id, body, block_id, offset_start, offset_end, quote, quote_hash, status)
      VALUES (${fixture.workspaceId}, ${fixture.pageId}, 'Confidential thread body', 'blocki', 0, 4, 'Some', 'h', 'anchored')
      RETURNING id
    `;
    await trash(fixture.pageId);
    const app = buildApp();

    const denied = await app.request(`/pages/${fixture.pageId}/comments`, { headers: { cookie: fixture.commenterCookie } });
    const missing = await app.request(`/pages/${crypto.randomUUID()}/comments`, { headers: { cookie: fixture.commenterCookie } });

    expect(denied.status).toBe(404);
    const deniedBody = await denied.text();
    expect(deniedBody).toBe(await missing.text());
    expectNoDisclosure(deniedBody, { id: thread!.id, values: ['Confidential thread body'] }, denied.headers);
  });

  test('POST /pages/:id/comments on a trashed page answers identically to an unknown page, and writes nothing', async () => {
    const fixture = await buildFixture();
    await sql`
      INSERT INTO page_content (node_id, workspace_id, markdown, content_hash)
      VALUES (${fixture.pageId}, ${fixture.workspaceId}, 'Some text. ^blockj\n', 'hash')
    `;
    await trash(fixture.pageId);
    const app = buildApp();
    const body = JSON.stringify({ blockId: 'blockj', offsetStart: 0, offsetEnd: 4, quote: 'Some', body: 'probe' });
    const headers = { 'content-type': 'application/json', cookie: fixture.commenterCookie };

    const denied = await app.request(`/pages/${fixture.pageId}/comments`, { method: 'POST', headers, body });
    const missing = await app.request(`/pages/${crypto.randomUUID()}/comments`, { method: 'POST', headers, body });

    expect(denied.status).toBe(404);
    expect(await denied.text()).toBe(await missing.text());
    const rows = await sql`SELECT id FROM comments WHERE page_id = ${fixture.pageId}`;
    expect(rows).toHaveLength(0);
  });

  test('PATCH /comments/:threadId/resolved on a trashed page\'s thread answers identically to an unknown thread', async () => {
    const fixture = await buildFixture();
    await sql`
      INSERT INTO page_content (node_id, workspace_id, markdown, content_hash)
      VALUES (${fixture.pageId}, ${fixture.workspaceId}, 'Some text. ^blockk\n', 'hash')
    `;
    await sql`
      INSERT INTO page_blocks (page_id, workspace_id, block_id, status, content_hash, excerpt)
      VALUES (${fixture.pageId}, ${fixture.workspaceId}, 'blockk', 'active', 'h', 'excerpt')
    `;
    const [thread] = await sql<{ id: string }[]>`
      INSERT INTO comments (workspace_id, page_id, body, block_id, offset_start, offset_end, quote, quote_hash, status)
      VALUES (${fixture.workspaceId}, ${fixture.pageId}, 'a thread', 'blockk', 0, 4, 'Some', 'h', 'anchored')
      RETURNING id
    `;
    await trash(fixture.pageId);
    const app = buildApp();
    const body = JSON.stringify({ resolved: true });
    const headers = { 'content-type': 'application/json', cookie: fixture.commenterCookie };

    const denied = await app.request(`/comments/${thread!.id}/resolved`, { method: 'PATCH', headers, body });
    const missing = await app.request(`/comments/${crypto.randomUUID()}/resolved`, { method: 'PATCH', headers, body });

    expect(denied.status).toBe(404);
    expect(await denied.text()).toBe(await missing.text());
    const [row] = await sql<{ resolved_at: Date | null }[]>`SELECT resolved_at FROM comments WHERE id = ${thread!.id}`;
    expect(row!.resolved_at).toBeNull();
  });

  // The reply path never calls readPageMarkdown() (only a new root
  // comment mints an anchor), so this route's own node lookup is the only
  // gate — it must answer identically to an unknown page too.
  test('a reply on a trashed page answers identically to an unknown page, and writes nothing', async () => {
    const fixture = await buildFixture();
    await sql`
      INSERT INTO page_content (node_id, workspace_id, markdown, content_hash)
      VALUES (${fixture.pageId}, ${fixture.workspaceId}, 'Some text. ^blockl\n', 'hash')
    `;
    await sql`
      INSERT INTO page_blocks (page_id, workspace_id, block_id, status, content_hash, excerpt)
      VALUES (${fixture.pageId}, ${fixture.workspaceId}, 'blockl', 'active', 'h', 'excerpt')
    `;
    const [rootThread] = await sql<{ id: string }[]>`
      INSERT INTO comments (workspace_id, page_id, body, block_id, offset_start, offset_end, quote, quote_hash, status)
      VALUES (${fixture.workspaceId}, ${fixture.pageId}, 'a root thread', 'blockl', 0, 4, 'Some', 'h', 'anchored')
      RETURNING id
    `;
    await trash(fixture.pageId);
    const app = buildApp();
    const body = JSON.stringify({ parentId: rootThread!.id, body: 'a reply' });
    const headers = { 'content-type': 'application/json', cookie: fixture.commenterCookie };

    const denied = await app.request(`/pages/${fixture.pageId}/comments`, { method: 'POST', headers, body });
    const missing = await app.request(`/pages/${crypto.randomUUID()}/comments`, { method: 'POST', headers, body });

    expect(denied.status).toBe(404);
    expect(await denied.text()).toBe(await missing.text());
    const replies = await sql`SELECT id FROM comments WHERE parent_id = ${rootThread!.id}`;
    expect(replies).toHaveLength(0);
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

  /**
   * The bytes a real page of the project owner's carried when commenting on
   * a selection answered 500 (docs/TODO.md, 2026-09-23). The paragraph ends
   * in a space, whose canonical spelling is the escape `&#x20;` — unescaped
   * trailing whitespace does not survive a reparse. The page is canonical:
   * it was written by the editor through `savePage()` like any other. But
   * appending ` ^id` at the block's end offset makes the space non-trailing,
   * so canonical form spells it literally, and the mint's spliced bytes were
   * no longer their own fixed point — which `savePage()` refuses.
   */
  test('a comment on a block whose trailing space is escaped opens a thread instead of failing the save', async () => {
    const fixture = await buildFixture();
    const markdown = 'This is a content @Seed Owner&#x20;\n';
    await savePage(sql, {
      nodeId: fixture.pageId,
      workspaceId: fixture.workspaceId,
      markdown,
      expectedContentHash: null,
      updatedBy: fixture.commenterUserId,
      changesetWindowMinutes: 30,
    });
    const [derivedBlock] = sliceBlocks(parse(markdown), markdown);
    expect(derivedBlock!.anchorId).toBeNull();

    const app = buildApp();
    const res = await app.request(`/pages/${fixture.pageId}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: fixture.commenterCookie },
      body: JSON.stringify({
        blockId: derivedBlock!.id,
        offsetStart: 0,
        offsetEnd: 17,
        quote: 'This is a content',
        body: 'Commenting on a selection of this paragraph.',
      }),
    });

    // Storage first, and on its own terms — the save either happened or the
    // route refused it, and a status assertion alone cannot say which.
    const [row] = await sql<{ markdown: string }[]>`SELECT markdown FROM page_content WHERE node_id = ${fixture.pageId}`;
    const [savedBlock] = sliceBlocks(parse(row!.markdown), row!.markdown);
    expect(savedBlock!.anchorId).not.toBeNull();
    expect(row!.markdown).toBe(`This is a content @Seed Owner  ^${savedBlock!.anchorId}\n`);

    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; blockId: string };
    expect(created.blockId).toBe(savedBlock!.anchorId!);

    // The excerpt's offsets index the bytes that were actually stored, not
    // the pre-mint spelling they were located against.
    const [commentRow] = await sql<{ offset_start: number; offset_end: number; quote: string }[]>`
      SELECT offset_start, offset_end, quote FROM comments WHERE id = ${created.id}
    `;
    expect(commentRow!.quote).toBe('This is a content');
    expect(savedBlock!.text.slice(commentRow!.offset_start, commentRow!.offset_end)).toBe(commentRow!.quote);
  });

  /**
   * Stored page Markdown is canonical *by construction* (design.md D1) —
   * `savePage()` refuses anything else — but "by construction" is a claim
   * about one write path, and a row written around it (a direct INSERT, a
   * backfill, a seed) does not honour it. A commenter holds `comment`, not
   * `write`: they cannot repair such a page and must not be the one who is
   * told about it. So the mint normalises, which is the save path's own
   * documented remedy for a non-canonical document, and the thread opens.
   */
  test('a comment on a page whose stored markdown was never canonical still opens a thread, and normalises the page', async () => {
    const fixture = await buildFixture();
    // `*emphasis*` is not this pipeline's spelling (`PINNED_OPTIONS.emphasis`
    // is `_`), so this row could not have come from `savePage()`.
    const stored = 'A paragraph with *emphasis*.\n';
    await sql`
      INSERT INTO page_content (node_id, workspace_id, markdown, content_hash)
      VALUES (${fixture.pageId}, ${fixture.workspaceId}, ${stored}, 'hash')
    `;
    const [derivedBlock] = sliceBlocks(parse(stored), stored);

    const app = buildApp();
    const res = await app.request(`/pages/${fixture.pageId}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: fixture.commenterCookie },
      body: JSON.stringify({ blockId: derivedBlock!.id, quote: 'A paragraph', body: 'A note on a page nobody normalised.' }),
    });

    const [row] = await sql<{ markdown: string }[]>`SELECT markdown FROM page_content WHERE node_id = ${fixture.pageId}`;
    const [savedBlock] = sliceBlocks(parse(row!.markdown), row!.markdown);
    expect(row!.markdown).toBe(`A paragraph with _emphasis_. ^${savedBlock!.anchorId}\n`);

    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; blockId: string };
    expect(created.blockId).toBe(savedBlock!.anchorId!);
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

/**
 * `mintBlockId` fills ten bytes from `crypto.getRandomValues`; filling every
 * byte with `n` yields `ALPHABET[n % 32]` ten times over
 * (`packages/markdown/src/mint-anchor.test.ts` drives it the same way).
 * Deterministic minting is the only way to assert the exclusion set is a
 * mechanism rather than a bet on the 32^10 id space.
 */
const REAL_GET_RANDOM_VALUES = crypto.getRandomValues.bind(crypto);

function stubMintSequence(fillBytes: readonly number[]): void {
  let call = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (crypto as any).getRandomValues = (bytes: Uint8Array) => {
    bytes.fill(fillBytes[Math.min(call, fillBytes.length - 1)]!);
    call++;
    return bytes;
  };
}

afterEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (crypto as any).getRandomValues = REAL_GET_RANDOM_VALUES;
});

// docs/TODO.md (2026-09-13, "Still open"): the comment route's mint did not
// receive the page's known ids, so a fresh anchor could collide with a
// tombstoned or superseded one by chance and the save inside the same
// request would refuse it as a dead anchor — a 500 for a legitimate
// comment. The reserved set is the page's full registry, every status.
describe('POST /pages/:id/comments — the mint avoids the page\'s retired ids', () => {
  test('a fresh anchor never takes a tombstoned id, and the request succeeds', async () => {
    const fixture = await buildFixture();
    const markdown = 'A paragraph with no persisted anchor yet.\n';
    await sql`
      INSERT INTO page_content (node_id, workspace_id, markdown, content_hash)
      VALUES (${fixture.pageId}, ${fixture.workspaceId}, ${markdown}, 'hash')
    `;
    // A retired id nothing in the current markdown mentions: byte 1 → '1'.
    await sql`
      INSERT INTO page_blocks (page_id, workspace_id, block_id, excerpt, status, content_hash)
      VALUES (${fixture.pageId}, ${fixture.workspaceId}, '1111111111', 'gone', 'tombstoned', 'deadhash')
    `;
    // First draw collides with the tombstone; the second ('2222222222') is free.
    stubMintSequence([1, 2]);
    const [derivedBlock] = sliceBlocks(parse(markdown), markdown);

    const app = buildApp();
    const res = await app.request(`/pages/${fixture.pageId}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: fixture.commenterCookie },
      body: JSON.stringify({ blockId: derivedBlock!.id, quote: 'A paragraph', body: 'On a fresh block.' }),
    });

    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; blockId: string };
    expect(created.blockId).toBe('2222222222');
    const [row] = await sql<{ markdown: string }[]>`SELECT markdown FROM page_content WHERE node_id = ${fixture.pageId}`;
    expect(row!.markdown).toContain('^2222222222');
    expect(row!.markdown).not.toContain('^1111111111');
  });
});

// The client reads the block id off the cached HTML it was served. A page
// saved since then has re-rendered, and a derived id — a hash of the
// block's text — no longer resolves. That used to fall through to
// `createRootComment` with the unresolved id and trip `comments_block_fk`:
// a 500 for what is an ordinary stale-page conflict.
describe('POST /pages/:id/comments — a block id that no longer resolves', () => {
  test('answers 409 in the caller\'s terms, and writes nothing', async () => {
    const fixture = await buildFixture();
    await sql`
      INSERT INTO page_content (node_id, workspace_id, markdown, content_hash)
      VALUES (${fixture.pageId}, ${fixture.workspaceId}, 'The text the reader was served has since changed.\n', 'hash')
    `;

    const app = buildApp();
    const res = await app.request(`/pages/${fixture.pageId}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: fixture.commenterCookie },
      body: JSON.stringify({ blockId: 'd:000000000000#0', quote: 'The text', body: 'Too late.' }),
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/changed since/i);
    const [count] = await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM comments WHERE page_id = ${fixture.pageId}`;
    expect(count!.n).toBe('0');
  });
});

// The anchor is the server\'s to compute: the client selects *visible* text
// off cached HTML and has no offsets into the canonical source to offer.
// The stored quote must be a substring of the block\'s source, or save-time
// reconciliation\'s exact rows never apply to it (`locateQuoteInBlock`).
describe('POST /pages/:id/comments — the anchor is located in the block\'s source', () => {
  async function seedAndPost(markdown: string, body: Record<string, unknown>) {
    const fixture = await buildFixture();
    // A real save, so an anchor already in the markdown has its
    // `page_blocks` row — `comments_block_fk` names it.
    await savePage(sql, {
      nodeId: fixture.pageId,
      workspaceId: fixture.workspaceId,
      markdown,
      expectedContentHash: null,
      updatedBy: fixture.commenterUserId,
      changesetWindowMinutes: 30,
    });
    const [block] = sliceBlocks(parse(markdown), markdown);
    const app = buildApp();
    const res = await app.request(`/pages/${fixture.pageId}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: fixture.commenterCookie },
      body: JSON.stringify({ blockId: block!.id, body: 'A note.', ...body }),
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string; blockId: string };
    const [row] = await sql<{ offset_start: number; offset_end: number; quote: string }[]>`
      SELECT offset_start, offset_end, quote FROM comments WHERE id = ${created.id}
    `;
    const [saved] = await sql<{ markdown: string }[]>`SELECT markdown FROM page_content WHERE node_id = ${fixture.pageId}`;
    const [savedBlock] = sliceBlocks(parse(saved!.markdown), saved!.markdown);
    return { row: row!, blockText: savedBlock!.text, created };
  }

  test('a selection of visible text that spans inline markup is stored as the source window it covers, without offsets from the client', async () => {
    const { row, blockText } = await seedAndPost('Hello __world__, and more. ^anch01\n', { quote: 'Hello world' });
    expect(row.quote).toBe('Hello __world');
    expect(blockText.slice(row.offset_start, row.offset_end)).toBe(row.quote);
  });

  test('a comment on the block as a whole stores the block\'s source without its anchor, on a block minted in the same request', async () => {
    const { row, blockText, created } = await seedAndPost('A fresh paragraph, _emphasised_.\n', {});
    expect(row.quote).toBe('A fresh paragraph, _emphasised_.');
    expect(row.offset_start).toBe(0);
    expect(row.offset_end).toBe(row.quote.length);
    // The mint appended ` ^id` after the excerpt; the excerpt excludes it
    // and the offsets still index the saved source.
    expect(blockText).toBe(`A fresh paragraph, _emphasised_. ^${created.blockId}`);
    expect(blockText.slice(row.offset_start, row.offset_end)).toBe(row.quote);
  });

  /**
   * The mint does not only append: on a block whose canonical spelling
   * depends on what follows its last byte it also *respells* it — the
   * escaped trailing space `&#x20;` becomes a literal space once ` ^id`
   * follows (docs/TODO.md, 2026-09-23). An excerpt located against the
   * pre-mint source therefore named bytes that were never stored, and a
   * stored quote that is not a substring of its block's source skips
   * reconciliation's exact rows on every later save — orphaning a comment on
   * a block nobody touched, which is the whole point of `locateQuoteInBlock`.
   */
  test('an excerpt on a block the mint respells indexes the bytes that were stored, not the ones it was located against', async () => {
    const { row, blockText, created } = await seedAndPost('This is a content @Seed Owner&#x20;\n', {});

    expect(blockText).toBe(`This is a content @Seed Owner  ^${created.blockId}`);
    expect(row.quote).toBe('This is a content @Seed Owner ');
    expect(blockText.slice(row.offset_start, row.offset_end)).toBe(row.quote);
  });

  test('offsets the client does send are a hint between repeated occurrences, never the stored truth', async () => {
    const { row } = await seedAndPost('one two one two one ^rep001\n', { quote: 'one', offsetStart: 9, offsetEnd: 12 });
    expect(row.offset_start).toBe(8);
    expect(row.offset_end).toBe(11);
    expect(row.quote).toBe('one');
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

// comment-threads spec: "Threads And Resolution State" / comment-overlay's
// thread panel. Gated by can('comment') — the same gate the indicators
// endpoint uses — so the two must agree about what a read-but-not-comment
// subject sees.
describe('GET /pages/:id/comments', () => {
  /**
   * A page node exists from the moment the tree creates it; its
   * `page_content` row exists only from its first save, and `comments`'
   * own FK into `page_content` means a never-saved page can hold no thread
   * at all. Both list endpoints must still answer — the read screen loads
   * them beside the article — rather than reporting the page absent, which
   * is what the sibling read route did until 2026-09-23 (docs/TODO.md
   * Findings, 2026-09-23). `buildFixture()` creates the page node and no
   * content row, so this is the never-saved case by simply not inserting one.
   */
  test('a page that has never been saved answers an empty thread list, not 404', async () => {
    const fixture = await buildFixture();
    const app = buildApp();

    const threads = await app.request(`/pages/${fixture.pageId}/comments`, { headers: { cookie: fixture.commenterCookie } });
    const indicators = await app.request(`/pages/${fixture.pageId}/comments/indicators`, { headers: { cookie: fixture.commenterCookie } });

    expect(threads.status).toBe(200);
    expect(((await threads.json()) as { threads: unknown[] }).threads).toEqual([]);
    expect(indicators.status).toBe(200);
    expect(((await indicators.json()) as { indicators: unknown[] }).indicators).toEqual([]);
  });

  /**
   * The page has no blocks, so there is nothing to anchor a thread to —
   * but the page itself is perfectly readable (2026-09-23: `GET /pages/:id`
   * renders it as an empty document). Answering "not found" here would say
   * the page is gone to a caller the read route just served, so the answer
   * is the same stale-block 409 a block that no longer resolves gets.
   */
  test('starting a thread on a page that has never been saved is a block conflict, not a missing page', async () => {
    const fixture = await buildFixture();
    const app = buildApp();

    const res = await app.request(`/pages/${fixture.pageId}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: fixture.commenterCookie },
      body: JSON.stringify({ blockId: 'd:whatever#1', offsetStart: 0, offsetEnd: 1, quote: 'x', body: 'first' }),
    });

    expect(res.status).toBe(409);
    expect((await res.json()) as { error: string }).toEqual({ error: 'that block has changed since this page was loaded' });
  });

  test('a subject with comment sees a root thread with its nested replies, ordered by creation', async () => {
    const fixture = await buildFixture();
    await sql`
      INSERT INTO page_content (node_id, workspace_id, markdown, content_hash)
      VALUES (${fixture.pageId}, ${fixture.workspaceId}, 'Some text. ^blocki\n', 'hash')
    `;
    await sql`
      INSERT INTO page_blocks (page_id, workspace_id, block_id, status, content_hash, excerpt)
      VALUES (${fixture.pageId}, ${fixture.workspaceId}, 'blocki', 'active', 'h', 'excerpt')
    `;
    const app = buildApp();

    const createRes = await app.request(`/pages/${fixture.pageId}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: fixture.commenterCookie },
      body: JSON.stringify({ blockId: 'blocki', offsetStart: 0, offsetEnd: 4, quote: 'Some', body: 'root body' }),
    });
    const created = (await createRes.json()) as { id: string };

    await app.request(`/pages/${fixture.pageId}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: fixture.commenterCookie },
      body: JSON.stringify({ parentId: created.id, body: 'a reply' }),
    });

    const res = await app.request(`/pages/${fixture.pageId}/comments`, { headers: { cookie: fixture.commenterCookie } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      threads: {
        id: string;
        body: string;
        anchor: { blockId: string; offsetStart: number; offsetEnd: number; quote: string; orphaned: boolean };
        resolved: boolean;
        replies: { body: string }[];
      }[];
    };
    expect(body.threads).toHaveLength(1);
    expect(body.threads[0]!.id).toBe(created.id);
    expect(body.threads[0]!.body).toBe('root body');
    expect(body.threads[0]!.anchor).toEqual({ blockId: 'blocki', quote: 'Some', orphaned: false, offsetStart: 0, offsetEnd: 4 });
    expect(body.threads[0]!.resolved).toBe(false);
    expect(body.threads[0]!.replies).toHaveLength(1);
    expect(body.threads[0]!.replies[0]!.body).toBe('a reply');
  });

  // The trap: a thread with no replies must still surface, and its
  // `replies` array must be empty rather than absent or the thread dropped.
  test('a root thread with no replies is returned with an empty replies array', async () => {
    const fixture = await buildFixture();
    await sql`
      INSERT INTO page_content (node_id, workspace_id, markdown, content_hash)
      VALUES (${fixture.pageId}, ${fixture.workspaceId}, 'Some text. ^blockj\n', 'hash')
    `;
    await sql`
      INSERT INTO page_blocks (page_id, workspace_id, block_id, status, content_hash, excerpt)
      VALUES (${fixture.pageId}, ${fixture.workspaceId}, 'blockj', 'active', 'h', 'excerpt')
    `;
    await sql`
      INSERT INTO comments (workspace_id, page_id, body, block_id, offset_start, offset_end, quote, quote_hash, status)
      VALUES (${fixture.workspaceId}, ${fixture.pageId}, 'lonely', 'blockj', 0, 4, 'Some', 'h', 'anchored')
    `;
    const app = buildApp();

    const res = await app.request(`/pages/${fixture.pageId}/comments`, { headers: { cookie: fixture.commenterCookie } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { threads: { replies: unknown[] }[] };
    expect(body.threads).toHaveLength(1);
    expect(body.threads[0]!.replies).toEqual([]);
  });

  // read-but-not-comment must agree with the indicators endpoint: both
  // answer `{ ...: [] }`, never a read-only view of real thread data.
  test('a subject with read but not comment sees the same empty shape as a page with zero threads', async () => {
    const fixture = await buildFixture();
    await sql`
      INSERT INTO page_content (node_id, workspace_id, markdown, content_hash)
      VALUES (${fixture.pageId}, ${fixture.workspaceId}, 'Some text. ^blockk\n', 'hash')
    `;
    await sql`
      INSERT INTO page_blocks (page_id, workspace_id, block_id, status, content_hash, excerpt)
      VALUES (${fixture.pageId}, ${fixture.workspaceId}, 'blockk', 'active', 'h', 'excerpt')
    `;
    const [comment] = await sql<{ id: string }[]>`
      INSERT INTO comments (workspace_id, page_id, body, block_id, offset_start, offset_end, quote, quote_hash, status)
      VALUES (${fixture.workspaceId}, ${fixture.pageId}, 'a secret comment body', 'blockk', 0, 4, 'Some', 'h', 'anchored')
      RETURNING id
    `;
    const app = buildApp();

    const res = await app.request(`/pages/${fixture.pageId}/comments`, { headers: { cookie: fixture.readerCookie } });

    expect(res.status).toBe(200);
    const bodyText = await res.text();
    expect(JSON.parse(bodyText)).toEqual({ threads: [], canComment: false });
    expectNoDisclosure(JSON.parse(bodyText), { id: comment!.id, values: ['blockk', 'a secret comment body'] }, res.headers);
  });

  // `canComment` is the caller's *own* grant, which they can learn anyway
  // by trying to post (403). What the non-disclosure guarantee protects is
  // the page's comments: for a read-only caller a page with threads and a
  // page with none answer byte-identically. Without the flag the read
  // screen could not tell a commenter on a page with no threads yet from a
  // reader, and the first thread on any page could never be started.
  test('canComment reports the caller\'s own grant and reveals nothing about the page\'s threads', async () => {
    const withThreads = await buildFixture();
    await sql`
      INSERT INTO page_content (node_id, workspace_id, markdown, content_hash)
      VALUES (${withThreads.pageId}, ${withThreads.workspaceId}, 'Some text. ^blockk\n', 'hash')
    `;
    await sql`
      INSERT INTO page_blocks (page_id, workspace_id, block_id, status, content_hash, excerpt)
      VALUES (${withThreads.pageId}, ${withThreads.workspaceId}, 'blockk', 'active', 'h', 'excerpt')
    `;
    await sql`
      INSERT INTO comments (workspace_id, page_id, body, block_id, offset_start, offset_end, quote, quote_hash, status)
      VALUES (${withThreads.workspaceId}, ${withThreads.pageId}, 'a secret comment body', 'blockk', 0, 4, 'Some', 'h', 'anchored')
    `;
    const withoutThreads = await buildFixture();
    await sql`
      INSERT INTO page_content (node_id, workspace_id, markdown, content_hash)
      VALUES (${withoutThreads.pageId}, ${withoutThreads.workspaceId}, 'Some text.\n', 'hash')
    `;
    const app = buildApp();

    const readerOnThreads = await (await app.request(`/pages/${withThreads.pageId}/comments`, { headers: { cookie: withThreads.readerCookie } })).text();
    const readerOnEmpty = await (await app.request(`/pages/${withoutThreads.pageId}/comments`, { headers: { cookie: withoutThreads.readerCookie } })).text();
    expect(readerOnThreads).toBe(readerOnEmpty);
    expect(JSON.parse(readerOnEmpty)).toEqual({ threads: [], canComment: false });

    const commenterOnEmpty = await app.request(`/pages/${withoutThreads.pageId}/comments`, { headers: { cookie: withoutThreads.commenterCookie } });
    expect(await commenterOnEmpty.json()).toEqual({ threads: [], canComment: true });
  });

  test('a subject with no read grant receives the same 404 as a nonexistent page', async () => {
    const fixture = await buildFixture();
    await sql`
      INSERT INTO page_content (node_id, workspace_id, markdown, content_hash)
      VALUES (${fixture.pageId}, ${fixture.workspaceId}, 'Some text.\n', 'hash')
    `;
    const app = buildApp();

    const missing = await app.request(`/pages/${crypto.randomUUID()}/comments`, { headers: { cookie: fixture.outsiderCookie } });
    const denied = await app.request(`/pages/${fixture.pageId}/comments`, { headers: { cookie: fixture.outsiderCookie } });

    expect(denied.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(await denied.json()).toEqual(await missing.json());
  });

  test('a resolved thread reports resolved:true and a non-null resolvedAt', async () => {
    const fixture = await buildFixture();
    await sql`
      INSERT INTO page_content (node_id, workspace_id, markdown, content_hash)
      VALUES (${fixture.pageId}, ${fixture.workspaceId}, 'Some text. ^blockm\n', 'hash')
    `;
    await sql`
      INSERT INTO page_blocks (page_id, workspace_id, block_id, status, content_hash, excerpt)
      VALUES (${fixture.pageId}, ${fixture.workspaceId}, 'blockm', 'active', 'h', 'excerpt')
    `;
    const [thread] = await sql<{ id: string }[]>`
      INSERT INTO comments (workspace_id, page_id, body, block_id, offset_start, offset_end, quote, quote_hash, status)
      VALUES (${fixture.workspaceId}, ${fixture.pageId}, 'root', 'blockm', 0, 4, 'Some', 'h', 'anchored')
      RETURNING id
    `;
    await sql`UPDATE comments SET resolved_at = now() WHERE id = ${thread!.id}`;
    const app = buildApp();

    const res = await app.request(`/pages/${fixture.pageId}/comments`, { headers: { cookie: fixture.commenterCookie } });

    const body = (await res.json()) as { threads: { resolved: boolean; resolvedAt: string | null }[] };
    expect(body.threads[0]!.resolved).toBe(true);
    expect(body.threads[0]!.resolvedAt).not.toBeNull();
  });

  test('an orphaned thread reports its anchor.orphaned as true and still carries its captured quote', async () => {
    const fixture = await buildFixture();
    await sql`
      INSERT INTO page_content (node_id, workspace_id, markdown, content_hash)
      VALUES (${fixture.pageId}, ${fixture.workspaceId}, 'Some text. ^blockn\n', 'hash')
    `;
    await sql`
      INSERT INTO page_blocks (page_id, workspace_id, block_id, status, content_hash, excerpt)
      VALUES (${fixture.pageId}, ${fixture.workspaceId}, 'blockn', 'active', 'h', 'excerpt')
    `;
    const [thread] = await sql<{ id: string }[]>`
      INSERT INTO comments (workspace_id, page_id, body, block_id, offset_start, offset_end, quote, quote_hash, status)
      VALUES (${fixture.workspaceId}, ${fixture.pageId}, 'root', 'blockn', 0, 4, 'Some', 'h', 'orphaned')
      RETURNING id
    `;
    void thread;
    const app = buildApp();

    const res = await app.request(`/pages/${fixture.pageId}/comments`, { headers: { cookie: fixture.commenterCookie } });

    const body = (await res.json()) as { threads: { anchor: { orphaned: boolean; quote: string } }[] };
    expect(body.threads[0]!.anchor.orphaned).toBe(true);
    expect(body.threads[0]!.anchor.quote).toBe('Some');
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
