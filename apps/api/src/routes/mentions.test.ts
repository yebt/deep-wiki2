/**
 * Mention autocomplete filtered by can() (document-editor spec: Mention
 * Autocomplete Is Filtered By can(); knowledge-graph spec: Link And
 * Mention Autocomplete Never Discloses). Mentioning a user does not
 * silently grant them access (document-editor spec, both scenarios).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createSession } from '@deep-wiki/db';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '@deep-wiki/db/testing/provision';
import postgres from 'postgres';
import { expectNoDisclosure } from '../../testing/expect-no-disclosure';
import { SESSION_COOKIE_NAME } from '../middleware/session';
import { createMentionRoutes } from './mentions';

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

async function insertNode(workspaceId: string, parentId: string | null, type: string, slug: string, title: string) {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${workspaceId}, ${parentId}, ${type}::node_type, '', 0, ${slug}, ${title}) RETURNING id
  `;
  return row!.id as string;
}

async function insertUser(displayName: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name) VALUES (${`${displayName}-${crypto.randomUUID()}@example.com`}, 'hash', ${displayName}) RETURNING id
  `;
  return row!.id as string;
}

async function cookieFor(userId: string): Promise<string> {
  const { token } = await createSession(sql, { userId, idleTimeoutMinutes: 30, absoluteTimeoutDays: 30 });
  return `${SESSION_COOKIE_NAME}=${token}`;
}

function buildApp() {
  return createMentionRoutes({ sql });
}

describe('GET /mentions/pages', () => {
  test('a page matching the query but unreadable by the requester returns nothing, disclosing nothing', async () => {
    const owner = await insertUser('owner');
    const [ws] = await sql<{ id: string }[]>`INSERT INTO workspaces (owner_id, name, slug) VALUES (${owner}, 'WS', ${`ws-${crypto.randomUUID()}`}) RETURNING id`;
    const root = await insertNode(ws!.id, null, 'workspace', 'root', 'Root');
    const hiddenPage = await insertNode(ws!.id, root, 'page', 'hidden', 'Secret Roadmap');
    const requester = await insertUser('requester');

    const app = buildApp();
    const res = await app.request(`/mentions/pages?workspaceId=${ws!.id}&q=Secret`, { headers: { cookie: await cookieFor(requester) } });

    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expectNoDisclosure(body, { id: hiddenPage, slug: 'hidden', title: 'Secret Roadmap' }, res.headers);
    expect((body as { pages: unknown[] }).pages).toEqual([]);
  });

  test('a page matching the query that the requester can read is suggested', async () => {
    const owner = await insertUser('owner2');
    const [ws] = await sql<{ id: string }[]>`INSERT INTO workspaces (owner_id, name, slug) VALUES (${owner}, 'WS2', ${`ws2-${crypto.randomUUID()}`}) RETURNING id`;
    const root = await insertNode(ws!.id, null, 'workspace', 'root2', 'Root');
    const page = await insertNode(ws!.id, root, 'page', 'visible', 'Public Roadmap');
    const requester = await insertUser('requester2');
    await sql`
      INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
      VALUES (${ws!.id}, 'user', ${requester}, ${page}, 'read', 'allow')
    `;

    const app = buildApp();
    const res = await app.request(`/mentions/pages?workspaceId=${ws!.id}&q=Public`, { headers: { cookie: await cookieFor(requester) } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { pages: { id: string }[] };
    expect(body.pages.map((p) => p.id)).toEqual([page]);
  });
});

describe('GET /mentions/subjects', () => {
  test('a workspace member matching the query who cannot read the current page is excluded, disclosing nothing', async () => {
    const owner = await insertUser('owner3');
    const [ws] = await sql<{ id: string }[]>`INSERT INTO workspaces (owner_id, name, slug) VALUES (${owner}, 'WS3', ${`ws3-${crypto.randomUUID()}`}) RETURNING id`;
    const root = await insertNode(ws!.id, null, 'workspace', 'root3', 'Root');
    const page = await insertNode(ws!.id, root, 'page', 'page3', 'Page3');
    const requester = await insertUser('requester3');
    const noAccessCandidate = await insertUser('candidatenoaccess');
    // noAccessCandidate is "known" to the workspace via an unrelated grant, but not on `page`.
    await sql`
      INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
      VALUES (${ws!.id}, 'user', ${noAccessCandidate}, ${root}, 'read', 'deny')
    `;
    await sql`
      INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
      VALUES (${ws!.id}, 'user', ${requester}, ${page}, 'write', 'allow')
    `;

    const app = buildApp();
    const res = await app.request(`/mentions/subjects?workspaceId=${ws!.id}&pageId=${page}&q=candidatenoaccess`, {
      headers: { cookie: await cookieFor(requester) },
    });

    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expectNoDisclosure(body, { id: noAccessCandidate }, res.headers);
    expect((body as { subjects: unknown[] }).subjects).toEqual([]);
  });

  test('a workspace member who can read the current page is suggested', async () => {
    const owner = await insertUser('owner4');
    const [ws] = await sql<{ id: string }[]>`INSERT INTO workspaces (owner_id, name, slug) VALUES (${owner}, 'WS4', ${`ws4-${crypto.randomUUID()}`}) RETURNING id`;
    const root = await insertNode(ws!.id, null, 'workspace', 'root4', 'Root');
    const page = await insertNode(ws!.id, root, 'page', 'page4', 'Page4');
    const requester = await insertUser('requester4');
    const candidate = await insertUser('candidatewithaccess');
    await sql`
      INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
      VALUES (${ws!.id}, 'user', ${candidate}, ${page}, 'read', 'allow')
    `;
    await sql`
      INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
      VALUES (${ws!.id}, 'user', ${requester}, ${page}, 'write', 'allow')
    `;

    const app = buildApp();
    const res = await app.request(`/mentions/subjects?workspaceId=${ws!.id}&pageId=${page}&q=candidatewithaccess`, {
      headers: { cookie: await cookieFor(requester) },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { subjects: { id: string }[] };
    expect(body.subjects.map((s) => s.id)).toEqual([candidate]);
  });
});

// The check endpoint answers about a page. A caller who cannot read that
// page must not learn whether it exists: absence and denial-of-read are the
// same response, as they are on the comment and backlink routes.
describe('GET /pages/:id/mentions/:userId/check — page-existence probing', () => {
  test('a caller with no read grant gets the same answer as for a page that does not exist', async () => {
    const owner = await insertUser('owner-probe');
    const [ws] = await sql<{ id: string }[]>`INSERT INTO workspaces (owner_id, name, slug) VALUES (${owner}, 'WSP', ${`wsp-${crypto.randomUUID()}`}) RETURNING id`;
    const root = await insertNode(ws!.id, null, 'workspace', 'rootp', 'Root');
    const page = await insertNode(ws!.id, root, 'page', 'pagep', 'Secret Page');
    const outsider = await insertUser('outsider-probe');
    const mentioned = await insertUser('mentioned-probe');
    const cookie = await cookieFor(outsider);
    const MISSING_PAGE_ID = '00000000-0000-4000-8000-0000000000fc';

    const app = buildApp();
    const denied = await app.request(`/pages/${page}/mentions/${mentioned}/check`, { headers: { cookie } });
    const missing = await app.request(`/pages/${MISSING_PAGE_ID}/mentions/${mentioned}/check`, { headers: { cookie } });

    const deniedBody = await denied.text();
    const missingBody = await missing.text();

    expect(denied.status).toBe(missing.status);
    expect(deniedBody).toBe(missingBody);
    expect(denied.status).toBe(404);
    expectNoDisclosure(deniedBody, { id: page, slug: 'pagep', title: 'Secret Page' }, denied.headers);
  });
});

// document-editor: Mentioning A User Does Not Silently Grant Them Access, both scenarios.
describe('GET /pages/:id/mentions/:userId/check', () => {
  test('mentioning a user with no read access surfaces the mismatch', async () => {
    const owner = await insertUser('owner5');
    const [ws] = await sql<{ id: string }[]>`INSERT INTO workspaces (owner_id, name, slug) VALUES (${owner}, 'WS5', ${`ws5-${crypto.randomUUID()}`}) RETURNING id`;
    const root = await insertNode(ws!.id, null, 'workspace', 'root5', 'Root');
    const page = await insertNode(ws!.id, root, 'page', 'page5', 'Page5');
    const requester = await insertUser('requester5');
    const mentioned = await insertUser('mentioned-no-access');
    await sql`
      INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
      VALUES (${ws!.id}, 'user', ${requester}, ${page}, 'write', 'allow')
    `;

    const app = buildApp();
    const res = await app.request(`/pages/${page}/mentions/${mentioned}/check`, { headers: { cookie: await cookieFor(requester) } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { canRead: boolean };
    expect(body.canRead).toBe(false);
  });

  test('mentioning a user with access proceeds normally', async () => {
    const owner = await insertUser('owner6');
    const [ws] = await sql<{ id: string }[]>`INSERT INTO workspaces (owner_id, name, slug) VALUES (${owner}, 'WS6', ${`ws6-${crypto.randomUUID()}`}) RETURNING id`;
    const root = await insertNode(ws!.id, null, 'workspace', 'root6', 'Root');
    const page = await insertNode(ws!.id, root, 'page', 'page6', 'Page6');
    const requester = await insertUser('requester6');
    const mentioned = await insertUser('mentioned-with-access');
    await sql`
      INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
      VALUES (${ws!.id}, 'user', ${requester}, ${page}, 'write', 'allow')
    `;
    await sql`
      INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
      VALUES (${ws!.id}, 'user', ${mentioned}, ${page}, 'read', 'allow')
    `;

    const app = buildApp();
    const res = await app.request(`/pages/${page}/mentions/${mentioned}/check`, { headers: { cookie: await cookieFor(requester) } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { canRead: boolean };
    expect(body.canRead).toBe(true);
  });
});

/*
 * ── The *caller's* authorisation ──────────────────────────────────────
 *
 * The two cases above both vary the **candidate's** access while the
 * requester happens to hold a grant on the page, so neither of them can
 * fail if the handler never looks at the requester at all. These two do:
 * the requester is the variable, and the roster is the thing that must not
 * come back. `/mentions/pages` filters by the session subject and
 * `/pages/:id/mentions/:userId/check` read-gates the caller for exactly
 * this reason; this endpoint answers about the same page and owes the
 * same gate.
 */
describe('GET /mentions/subjects — caller authorisation', () => {
  test('a caller with no grant anywhere gets the same answer as for a page that does not exist, and no roster', async () => {
    const owner = await insertUser('owner-roster');
    const [ws] = await sql<{ id: string }[]>`INSERT INTO workspaces (owner_id, name, slug) VALUES (${owner}, 'WSR', ${`wsr-${crypto.randomUUID()}`}) RETURNING id`;
    const root = await insertNode(ws!.id, null, 'workspace', 'root-roster', 'Root');
    const page = await insertNode(ws!.id, root, 'page', 'page-roster', 'Page');
    // A real member who really can read the page: without her the endpoint
    // would return `[]` for the honest reason and prove nothing.
    const member = await insertUser('alicesecret');
    await sql`
      INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
      VALUES (${ws!.id}, 'user', ${member}, ${page}, 'read', 'allow')
    `;
    // Holds nothing: no grant in any workspace, no cell membership, owns
    // no workspace. Only a session.
    const outsider = await insertUser('outsider-roster');
    const cookie = await cookieFor(outsider);
    const MISSING_PAGE_ID = '00000000-0000-4000-8000-0000000000fd';

    const app = buildApp();
    const denied = await app.request(`/mentions/subjects?workspaceId=${ws!.id}&pageId=${page}&q=`, { headers: { cookie } });
    const missing = await app.request(`/mentions/subjects?workspaceId=${ws!.id}&pageId=${MISSING_PAGE_ID}&q=`, { headers: { cookie } });

    const deniedBody = await denied.text();
    const missingBody = await missing.text();

    expect(denied.status).toBe(404);
    expect(missing.status).toBe(denied.status);
    expect(deniedBody).toBe(missingBody);
    expectNoDisclosure(deniedBody, { id: member, values: ['alicesecret'] }, denied.headers);
  });

  test('a workspace member who cannot read the page is refused the list of who can', async () => {
    const owner = await insertUser('owner-roster2');
    const [ws] = await sql<{ id: string }[]>`INSERT INTO workspaces (owner_id, name, slug) VALUES (${owner}, 'WSR2', ${`wsr2-${crypto.randomUUID()}`}) RETURNING id`;
    const root = await insertNode(ws!.id, null, 'workspace', 'root-roster2', 'Root');
    const page = await insertNode(ws!.id, root, 'page', 'page-roster2', 'Page');
    const elsewhere = await insertNode(ws!.id, root, 'page', 'page-elsewhere', 'Elsewhere');
    const member = await insertUser('bobsecret');
    await sql`
      INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
      VALUES (${ws!.id}, 'user', ${member}, ${page}, 'read', 'allow')
    `;
    // A genuine member of this workspace — but of a different page. The
    // gate is per-page, not per-workspace, because the answer is a fact
    // about `page`.
    const stranger = await insertUser('stranger-roster');
    await sql`
      INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
      VALUES (${ws!.id}, 'user', ${stranger}, ${elsewhere}, 'read', 'allow')
    `;

    const app = buildApp();
    const res = await app.request(`/mentions/subjects?workspaceId=${ws!.id}&pageId=${page}&q=`, {
      headers: { cookie: await cookieFor(stranger) },
    });

    const body = await res.text();
    expect(res.status).toBe(404);
    expectNoDisclosure(body, { id: member, values: ['bobsecret'] }, res.headers);
  });
});
