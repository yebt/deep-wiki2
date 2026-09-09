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
import { SESSION_COOKIE_NAME } from '../middleware/session';
import { createRevisionRoutes } from './revisions';

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
      updatedBy: fixture.authorId,
    });
    await savePage(sql, {
      nodeId: fixture.pageId,
      workspaceId: fixture.workspaceId,
      markdown: '# Two\n',
      expectedContentHash: first.contentHash,
      updatedBy: fixture.authorId,
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

  test('a subject with no read grant receives the same 404 as a nonexistent page', async () => {
    const fixture = await buildFixture();
    await savePage(sql, { nodeId: fixture.pageId, workspaceId: fixture.workspaceId, markdown: '# One\n', expectedContentHash: null, updatedBy: fixture.authorId });

    const app = buildApp();
    const deniedRes = await app.request(`/pages/${fixture.pageId}/history`, { headers: { cookie: fixture.outsiderCookie } });
    const missingRes = await app.request(`/pages/${crypto.randomUUID()}/history`, { headers: { cookie: fixture.outsiderCookie } });

    expect(deniedRes.status).toBe(404);
    expect(missingRes.status).toBe(404);
    expect(await deniedRes.json()).toEqual(await missingRes.json());
  });
});
