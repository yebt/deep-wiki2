/**
 * `GET /workspaces` — the list that tells a client which workspace ids it
 * may open. Authorisation is the point of this endpoint, so the fixture
 * always contains a workspace the subject cannot read: a fixture where
 * everything is readable proves nothing about a list whose whole job is
 * leaving things out.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { can, createInvitation, createSession, insertGrants } from '@deep-wiki/db';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '@deep-wiki/db/testing/provision';
import postgres from 'postgres';
import { expectNoDisclosure } from '../../testing/expect-no-disclosure';
import { SESSION_COOKIE_NAME } from '../middleware/session';
import { createWorkspaceRoutes } from './workspaces';

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

async function cookieFor(userId: string): Promise<string> {
  const { token } = await createSession(sql, { userId, idleTimeoutMinutes: 30, absoluteTimeoutDays: 30 });
  return `${SESSION_COOKIE_NAME}=${token}`;
}

async function insertUser(label: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name)
    VALUES (${`${label}-${crypto.randomUUID()}@example.com`}, 'hash', ${label})
    RETURNING id
  `;
  return row!.id;
}

interface Workspace {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly rootId: string;
}

async function insertWorkspace(ownerId: string, name: string): Promise<Workspace> {
  const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${crypto.randomUUID()}`;
  const [ws] = await sql<{ id: string }[]>`
    INSERT INTO workspaces (owner_id, name, slug) VALUES (${ownerId}, ${name}, ${slug}) RETURNING id
  `;
  const [root] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${ws!.id}, NULL, 'workspace', '', 0, ${slug}, ${name})
    RETURNING id
  `;
  return { id: ws!.id, name, slug, rootId: root!.id };
}

async function allowRead(workspaceId: string, userId: string, resourceId: string): Promise<void> {
  await sql`
    INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
    VALUES (${workspaceId}, 'user', ${userId}, ${resourceId}, 'read', 'allow')
  `;
}

function buildApp() {
  return createWorkspaceRoutes({ sql, sessionIdleTimeoutMinutes: 30 });
}

interface Fixture {
  readonly readable: Workspace;
  readonly hidden: Workspace;
  readonly subjectCookie: string;
  readonly strangerCookie: string;
}

/**
 * Two workspaces and two callers. The hidden workspace is real, populated
 * and readable *by somebody else* — the case a list endpoint has to leave
 * out, rather than an absence that would be missing anyway.
 */
async function buildFixture(): Promise<Fixture> {
  const owner = await insertUser('owner');
  const subject = await insertUser('subject');
  const stranger = await insertUser('stranger');

  const readable = await insertWorkspace(owner, 'Readable Handbook');
  const hidden = await insertWorkspace(owner, 'Secret Acquisition Plans');

  await allowRead(readable.id, subject, readable.rootId);
  await allowRead(hidden.id, owner, hidden.rootId);

  return {
    readable,
    hidden,
    subjectCookie: await cookieFor(subject),
    strangerCookie: await cookieFor(stranger),
  };
}

describe('GET /workspaces', () => {
  test('lists the workspaces the caller can read', async () => {
    const fixture = await buildFixture();

    const res = await buildApp().request('/workspaces', { headers: { cookie: fixture.subjectCookie } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { workspaces: { id: string; name: string; slug: string }[] };
    expect(body.workspaces).toEqual([{ id: fixture.readable.id, name: fixture.readable.name, slug: fixture.readable.slug }]);
  });

  test('a workspace the caller cannot read is absent from the response, headers included', async () => {
    const fixture = await buildFixture();

    const res = await buildApp().request('/workspaces', { headers: { cookie: fixture.subjectCookie } });
    const body = (await res.json()) as { workspaces: { id: string }[] };

    // The response is not vacuously clean: the readable workspace really
    // is in it, so "the hidden one is absent" is a statement about the
    // filter and not about an endpoint that answered with nothing.
    expect(body.workspaces.map((w) => w.id)).toEqual([fixture.readable.id]);

    // Not "its title is absent": every value that identifies it, scanned
    // across the serialised body and every header name and value.
    expectNoDisclosure(
      body,
      { id: fixture.hidden.id, slug: fixture.hidden.slug, title: fixture.hidden.name, values: [fixture.hidden.rootId] },
      res.headers,
    );
  });

  test('a caller who can read nothing gets an empty list and a 200, not an error', async () => {
    const fixture = await buildFixture();

    const res = await buildApp().request('/workspaces', { headers: { cookie: fixture.strangerCookie } });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ workspaces: [] });
  });

  test('a request with no session is unauthorized', async () => {
    const res = await buildApp().request('/workspaces');

    expect(res.status).toBe(401);
  });
});

async function insertPlan(maxWorkspaces: number): Promise<string> {
  const [plan] = await sql<{ id: string }[]>`
    INSERT INTO plans (name, max_workspaces, max_seats, max_storage_bytes, max_ai_tokens_monthly)
    VALUES (${`plan-${crypto.randomUUID()}`}, ${maxWorkspaces}, 5, '1000000', '1000')
    RETURNING id
  `;
  return plan!.id;
}

async function insertUserWithPlan(label: string, maxWorkspaces: number): Promise<string> {
  const planId = await insertPlan(maxWorkspaces);
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name, plan_id)
    VALUES (${`${label}-${crypto.randomUUID()}@example.com`}, 'hash', ${label}, ${planId})
    RETURNING id
  `;
  return row!.id;
}

function postWorkspace(cookie: string, body: unknown) {
  return buildApp().request('/workspaces', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  });
}

describe('POST /workspaces', () => {
  test('any signed-in user within their plan creates a workspace and can manage its root at once', async () => {
    const userId = await insertUserWithPlan('creator', 2);
    const cookie = await cookieFor(userId);
    const slug = `acme-${crypto.randomUUID()}`;

    const res = await postWorkspace(cookie, { name: 'Acme Handbook', slug });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { workspaceId: string; rootNodeId: string };
    expect(body.workspaceId).toBeTruthy();
    expect(await can(sql, { subjectType: 'user', subjectId: userId, resourceId: body.rootNodeId, action: 'manage' })).toBe(true);

    // And it is now a workspace the creator can open — the list endpoint
    // and the create endpoint agree about what a workspace id is worth.
    const list = await buildApp().request('/workspaces', { headers: { cookie } });
    const listed = (await list.json()) as { workspaces: { id: string; slug: string }[] };
    expect(listed.workspaces.map((w) => w.id)).toContain(body.workspaceId);
  });

  /**
   * The limit is genuinely reached first: a plan of one, one workspace
   * already owned. A test whose plan limit is never reached would pass
   * against a route that ignores the plan entirely.
   */
  test('a creation past the plan limit is refused naming the plan and its limit, and creates nothing', async () => {
    const userId = await insertUserWithPlan('limited', 1);
    const cookie = await cookieFor(userId);
    const first = await postWorkspace(cookie, { name: 'First', slug: `first-${crypto.randomUUID()}` });
    expect(first.status).toBe(201);

    const res = await postWorkspace(cookie, { name: 'Second', slug: `second-${crypto.randomUUID()}` });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { reason: string; planName: string; maxWorkspaces: number; error: string };
    expect(body.reason).toBe('plan_limit');
    expect(body.maxWorkspaces).toBe(1);
    expect(body.planName).toMatch(/^plan-/);
    const owned = await sql`SELECT id FROM workspaces WHERE owner_id = ${userId}`;
    expect(owned).toHaveLength(1);
  });

  test('a user with no plan assigned is refused with its own reason, not a 500', async () => {
    const userId = await insertUser('planless');
    const cookie = await cookieFor(userId);

    const res = await postWorkspace(cookie, { name: 'Acme', slug: `acme-${crypto.randomUUID()}` });

    expect(res.status).toBe(403);
    expect(((await res.json()) as { reason: string }).reason).toBe('no_plan');
  });

  test('a slug that is already taken is a 409 with its own reason', async () => {
    const userId = await insertUserWithPlan('slugger', 5);
    const cookie = await cookieFor(userId);
    const slug = `taken-${crypto.randomUUID()}`;
    await postWorkspace(cookie, { name: 'One', slug });

    const res = await postWorkspace(cookie, { name: 'Two', slug });

    expect(res.status).toBe(409);
    expect(((await res.json()) as { reason: string }).reason).toBe('slug_taken');
  });

  test('a malformed body is a 400', async () => {
    const userId = await insertUserWithPlan('sloppy', 5);
    const cookie = await cookieFor(userId);

    const res = await postWorkspace(cookie, { name: 'Acme', slug: 'Not A Slug' });

    expect(res.status).toBe(400);
  });

  test('a request with no session is unauthorized and creates nothing', async () => {
    const slug = `nobody-${crypto.randomUUID()}`;
    const res = await buildApp().request('/workspaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Acme', slug }),
    });

    expect(res.status).toBe(401);
    expect(await sql`SELECT id FROM workspaces WHERE slug = ${slug}`).toHaveLength(0);
  });
});

interface MembersFixture {
  readonly workspace: Workspace;
  readonly managerCookie: string;
  readonly readerCookie: string;
  readonly readerId: string;
  readonly pendingEmail: string;
  readonly acceptedEmail: string;
}

/**
 * A workspace with a manager, a reader who is a member but may not manage,
 * one pending invitation and one already-accepted invitation. The
 * pending one is what the screen exists to show; the accepted one is what
 * it must leave out; the reader is the caller the route must refuse
 * without disclosing.
 */
async function buildMembersFixture(): Promise<MembersFixture> {
  const owner = await insertUser('owner');
  const manager = await insertUser('manager');
  const reader = await insertUser('reader');
  const workspace = await insertWorkspace(owner, 'Members Handbook');
  await insertGrants(sql, workspace.id, 'user', manager, [{ resourceId: workspace.rootId, action: 'manage', effect: 'allow' }]);
  await allowRead(workspace.id, reader, workspace.rootId);

  const pendingEmail = `pending-${crypto.randomUUID()}@example.com`;
  await createInvitation(sql, {
    workspaceId: workspace.id,
    email: pendingEmail,
    startingGrants: [{ resourceId: workspace.rootId, action: 'read', effect: 'allow' }],
    ttlDays: 7,
    invitedByUserId: manager,
  });
  const acceptedEmail = `accepted-${crypto.randomUUID()}@example.com`;
  await createInvitation(sql, {
    workspaceId: workspace.id,
    email: acceptedEmail,
    startingGrants: [{ resourceId: workspace.rootId, action: 'read', effect: 'allow' }],
    ttlDays: 7,
  });
  await sql`UPDATE invitations SET accepted_at = now() WHERE email = ${acceptedEmail}`;

  return {
    workspace,
    managerCookie: await cookieFor(manager),
    readerCookie: await cookieFor(reader),
    readerId: reader,
    pendingEmail,
    acceptedEmail,
  };
}

describe('GET /workspaces/:id/members', () => {
  test('a manager sees the members and the pending invitations, and not the accepted one', async () => {
    const fixture = await buildMembersFixture();

    const res = await buildApp().request(`/workspaces/${fixture.workspace.id}/members`, { headers: { cookie: fixture.managerCookie } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      workspace: { id: string; name: string; slug: string };
      rootNodeId: string;
      members: { id: string; displayName: string; email: string }[];
      invitations: { email: string; startingGrants: unknown[] }[];
      truncated: boolean;
    };
    expect(body.workspace).toEqual({ id: fixture.workspace.id, name: fixture.workspace.name, slug: fixture.workspace.slug });
    expect(body.rootNodeId).toBe(fixture.workspace.rootId);
    expect(body.members.map((m) => m.id)).toContain(fixture.readerId);
    expect(body.invitations.map((i) => i.email)).toEqual([fixture.pendingEmail]);
    expect(body.invitations[0]!.startingGrants).toEqual([{ resourceId: fixture.workspace.rootId, action: 'read' }]);
    expect(body.truncated).toBe(false);
  });

  /**
   * The members screen stands at `/w/<slug>/members` and asks by the slug
   * the address bar carries; the API stays keyed by id underneath.
   */
  test('the workspace may be named by its slug, and answers the same as by id', async () => {
    const fixture = await buildMembersFixture();

    const bySlug = await buildApp().request(`/workspaces/${fixture.workspace.slug}/members`, { headers: { cookie: fixture.managerCookie } });
    const byId = await buildApp().request(`/workspaces/${fixture.workspace.id}/members`, { headers: { cookie: fixture.managerCookie } });

    expect(bySlug.status).toBe(200);
    expect(await bySlug.json()).toEqual(await byId.json());
  });

  test('a slug nobody owns, and the slug of a workspace the caller may not manage, are the same 404', async () => {
    const fixture = await buildMembersFixture();

    const denied = await buildApp().request(`/workspaces/${fixture.workspace.slug}/members`, { headers: { cookie: fixture.readerCookie } });
    const absent = await buildApp().request(`/workspaces/never-minted-${crypto.randomUUID()}/members`, { headers: { cookie: fixture.readerCookie } });

    expect(denied.status).toBe(404);
    expect(absent.status).toBe(404);
    const deniedText = await denied.text();
    expect(deniedText).toBe(await absent.text());
    expectNoDisclosure(deniedText, { id: fixture.workspace.id, slug: fixture.workspace.slug, title: fixture.workspace.name }, denied.headers);
  });

  test('a member without manage gets the same 404 as a workspace that does not exist, and learns nothing', async () => {
    const fixture = await buildMembersFixture();

    const denied = await buildApp().request(`/workspaces/${fixture.workspace.id}/members`, { headers: { cookie: fixture.readerCookie } });
    const absent = await buildApp().request(`/workspaces/${crypto.randomUUID()}/members`, { headers: { cookie: fixture.readerCookie } });

    expect(denied.status).toBe(404);
    expect(absent.status).toBe(404);
    const deniedText = await denied.text();
    expect(deniedText).toBe(await absent.text());
    expectNoDisclosure(
      deniedText,
      { id: fixture.workspace.id, slug: fixture.workspace.slug, title: fixture.workspace.name, values: [fixture.workspace.rootId, fixture.pendingEmail] },
      denied.headers,
    );
  });

  test('a request with no session is unauthorized', async () => {
    const fixture = await buildMembersFixture();

    const res = await buildApp().request(`/workspaces/${fixture.workspace.id}/members`);

    expect(res.status).toBe(401);
  });

  // trash-non-disclosure spec: this route's root-node lookup goes through
  // `live_nodes` like every other node read in this file — a defensive
  // check with no route to trigger it today (nothing trashes a workspace
  // root), proven here by direct SQL so a bug elsewhere can never surface
  // this route's members list against a trashed root instead of refusing.
  test('a trashed workspace root answers the same 404 as one that never existed', async () => {
    const fixture = await buildMembersFixture();
    await sql`UPDATE nodes SET trashed_at = now(), trash_operation_id = ${crypto.randomUUID()} WHERE id = ${fixture.workspace.rootId}`;

    const denied = await buildApp().request(`/workspaces/${fixture.workspace.id}/members`, { headers: { cookie: fixture.managerCookie } });
    const absent = await buildApp().request(`/workspaces/${crypto.randomUUID()}/members`, { headers: { cookie: fixture.managerCookie } });

    expect(denied.status).toBe(404);
    expect(await denied.text()).toBe(await absent.text());
  });
});
