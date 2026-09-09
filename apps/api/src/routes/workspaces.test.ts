/**
 * `GET /workspaces` — the list that tells a client which workspace ids it
 * may open. Authorisation is the point of this endpoint, so the fixture
 * always contains a workspace the subject cannot read: a fixture where
 * everything is readable proves nothing about a list whose whole job is
 * leaving things out.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createSession } from '@deep-wiki/db';
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
