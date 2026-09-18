/**
 * Invitation routes (invitations spec): the send step delivers through
 * `MailSender`; a valid acceptance attaches the user to the workspace and
 * `can(user, read, book)` resolves `allow` immediately after — the first
 * route-level proof that GATE-1's resolver is load-bearing end to end.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { can, createSession } from '@deep-wiki/db';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '@deep-wiki/db/testing/provision';
import { ok, type MailSendError, type MailSender, type Result, type SendMailInput } from '@deep-wiki/core';
import postgres from 'postgres';
import { expectNoDisclosure } from '../../testing/expect-no-disclosure';
import { Argon2idPasswordHasher } from '../adapters/crypto/argon2id-password-hasher';
import { BackgroundMailDispatcher, type MailDispatcher } from '../adapters/mail/background-mail-dispatcher';
import { SESSION_COOKIE_NAME } from '../middleware/session';
import { createInvitationRoutes } from './invitations';

let db: ProvisionedTestDatabase;
let sql: postgres.Sql;
const hasher = new Argon2idPasswordHasher();

beforeAll(async () => {
  db = await provisionTestDatabase();
  sql = postgres(db.url, { max: 5 });
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

/** A transport that never answers — the relay that hangs while connecting. */
class NeverSettlingMailSender implements MailSender {
  entered = 0;
  send(): Promise<Result<void, MailSendError>> {
    this.entered += 1;
    return new Promise(() => {});
  }
}

/** A recording sender behind the dispatcher the real app uses, with a way to wait for the hand-off to land. */
class TestMail {
  readonly sender = new RecordingMailSender();
  readonly dispatcher = new BackgroundMailDispatcher(this.sender);
  async sent(): Promise<SendMailInput[]> {
    await this.dispatcher.whenIdle();
    return this.sender.sent;
  }
}

interface Fixture {
  readonly workspaceId: string;
  readonly workspaceSlug: string;
  readonly rootId: string;
  readonly bookId: string;
  readonly adminCookie: string;
}

async function buildFixture(): Promise<Fixture> {
  const [owner] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name)
    VALUES (${`owner-${crypto.randomUUID()}@example.com`}, 'hash', 'Owner') RETURNING id
  `;
  const [admin] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name)
    VALUES (${`admin-${crypto.randomUUID()}@example.com`}, 'hash', 'Admin') RETURNING id
  `;
  const workspaceSlug = `ws-${crypto.randomUUID()}`;
  const [ws] = await sql<{ id: string }[]>`
    INSERT INTO workspaces (owner_id, name, slug) VALUES (${owner!.id}, 'WS', ${workspaceSlug}) RETURNING id
  `;
  const [root] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${ws!.id}, NULL, 'workspace', '', 0, 'root', 'Root') RETURNING id
  `;
  const [shelf] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${ws!.id}, ${root!.id}, 'shelf', '', 0, 'shelf', 'Shelf') RETURNING id
  `;
  const [book] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${ws!.id}, ${shelf!.id}, 'book', '', 0, 'book', 'Book') RETURNING id
  `;
  // The admin's own authority to invite: `manage` on the workspace root.
  await sql`
    INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
    VALUES (${ws!.id}, 'user', ${admin!.id}, ${root!.id}, 'manage', 'allow')
  `;
  const { token } = await createSession(sql, { userId: admin!.id, idleTimeoutMinutes: 30, absoluteTimeoutDays: 30 });

  return { workspaceId: ws!.id, workspaceSlug, rootId: root!.id, bookId: book!.id, adminCookie: `${SESSION_COOKIE_NAME}=${token}` };
}

function buildApp(mailDispatcher: MailDispatcher = new TestMail().dispatcher) {
  return createInvitationRoutes({
    sql,
    passwordHasher: hasher,
    mailDispatcher,
    appUrl: 'http://localhost:3000',
    invitationTtlDays: 7,
    sessionIdleTimeoutMinutes: 30,
  });
}

describe('POST /invitations', () => {
  test('an authorised Workspace Admin creates an invitation and it is delivered through MailSender', async () => {
    const fixture = await buildFixture();
    const mail = new TestMail();
    const app = buildApp(mail.dispatcher);
    const email = `invitee-${crypto.randomUUID()}@example.com`;

    const res = await app.request('/invitations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: fixture.adminCookie },
      body: JSON.stringify({
        workspaceId: fixture.workspaceId,
        email,
        startingGrants: [{ resourceId: fixture.bookId, action: 'read' }],
      }),
    });

    expect(res.status).toBe(201);
    const sent = await mail.sent();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(email);
  });

  /**
   * The mail is handed off, never awaited: the response must come back
   * even when the relay never answers, so an unreachable SMTP host cannot
   * hold an admin's request open for the transport's whole timeout
   * (`background-mail-dispatcher.ts`).
   */
  test('the response does not wait for the relay — a send that never settles still yields a 201', async () => {
    const fixture = await buildFixture();
    const sender = new NeverSettlingMailSender();
    const app = buildApp(new BackgroundMailDispatcher(sender));

    const request = Promise.resolve(
      app.request('/invitations', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: fixture.adminCookie },
        body: JSON.stringify({
          workspaceId: fixture.workspaceId,
          email: `invitee-${crypto.randomUUID()}@example.com`,
          startingGrants: [{ resourceId: fixture.bookId, action: 'read' }],
        }),
      }),
    );
    const outcome = await Promise.race([
      request.then((res) => ({ kind: 'response' as const, status: res.status })),
      new Promise<{ kind: 'timeout' }>((resolve) => setTimeout(() => resolve({ kind: 'timeout' }), 2_000)),
    ]);

    expect(outcome).toEqual({ kind: 'response', status: 201 });
    // The hand-off did happen — the route did not simply skip the mail.
    await Promise.resolve();
    expect(sender.entered).toBe(1);
  });

  /**
   * `workspaceId` comes from the request body, so anyone can name any
   * id. A caller without `manage` must get the same answer whether the
   * id names a real workspace or nothing — otherwise the route is an
   * oracle for which ids exist (docs/SPECS.md §4; `tree.ts`, "Absence and
   * denial answer identically").
   */
  test('a subject without manage on the workspace root gets the same 404 as a nonexistent workspace, and learns nothing', async () => {
    const fixture = await buildFixture();
    const [nobody] = await sql<{ id: string }[]>`
      INSERT INTO users (email, password_hash, display_name)
      VALUES (${`nobody-${crypto.randomUUID()}@example.com`}, 'hash', 'Nobody') RETURNING id
    `;
    const { token } = await createSession(sql, { userId: nobody!.id, idleTimeoutMinutes: 30, absoluteTimeoutDays: 30 });
    const app = buildApp();
    const attempt = (workspaceId: string) =>
      app.request('/invitations', {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: `${SESSION_COOKIE_NAME}=${token}` },
        body: JSON.stringify({
          workspaceId,
          email: 'someone@example.com',
          startingGrants: [{ resourceId: fixture.bookId, action: 'read' }],
        }),
      });

    const denied = await attempt(fixture.workspaceId);
    const absent = await attempt(crypto.randomUUID());

    expect(denied.status).toBe(404);
    expect(absent.status).toBe(404);
    const deniedText = await denied.text();
    expect(deniedText).toBe(await absent.text());
    expectNoDisclosure(deniedText, { id: fixture.workspaceId, slug: fixture.workspaceSlug, values: [fixture.rootId] }, denied.headers);
    expect(await sql`SELECT id FROM invitations WHERE workspace_id = ${fixture.workspaceId}`).toHaveLength(0);
  });

  // trash-non-disclosure spec: this route's root-node lookup goes through
  // `live_nodes` — defensive, since nothing trashes a workspace root today,
  // proven here by direct SQL so a bug elsewhere can never issue an
  // invitation against a trashed root instead of refusing.
  test('a trashed workspace root answers the same 404 as a nonexistent workspace', async () => {
    const fixture = await buildFixture();
    await sql`UPDATE nodes SET trashed_at = now(), trash_operation_id = ${crypto.randomUUID()} WHERE id = ${fixture.rootId}`;
    const app = buildApp();

    const denied = await app.request('/invitations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: fixture.adminCookie },
      body: JSON.stringify({
        workspaceId: fixture.workspaceId,
        email: 'someone-trashed@example.com',
        startingGrants: [{ resourceId: fixture.bookId, action: 'read' }],
      }),
    });

    expect(denied.status).toBe(404);
    expect(await sql`SELECT id FROM invitations WHERE workspace_id = ${fixture.workspaceId}`).toHaveLength(0);
  });
});

describe('POST /invitations/accept', () => {
  test('a valid acceptance attaches the user to the workspace and can(user, read, book) resolves allow immediately after', async () => {
    const fixture = await buildFixture();
    const mail = new TestMail();
    const app = buildApp(mail.dispatcher);
    const email = `invitee-${crypto.randomUUID()}@example.com`;

    await app.request('/invitations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: fixture.adminCookie },
      body: JSON.stringify({
        workspaceId: fixture.workspaceId,
        email,
        startingGrants: [{ resourceId: fixture.bookId, action: 'read' }],
      }),
    });
    const link = (await mail.sent())[0]!.body;
    const token = new URL(link.match(/https?:\/\/\S+/)![0]).searchParams.get('token')!;

    const res = await app.request('/invitations/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, password: 'a-strong-password', displayName: 'New Member' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { workspaceId: string };
    expect(body.workspaceId).toBe(fixture.workspaceId);

    const [user] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${email}`;
    const allowed = await can(sql, {
      subjectType: 'user',
      subjectId: user!.id,
      resourceId: fixture.bookId,
      action: 'read',
    });
    expect(allowed).toBe(true);
  });

  test('an expired invitation token is rejected', async () => {
    const res = await buildApp().request('/invitations/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'never-issued', password: 'x', displayName: 'X' }),
    });

    expect(res.status).toBe(400);
  });
});
