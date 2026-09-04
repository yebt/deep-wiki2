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
import { Argon2idPasswordHasher } from '../adapters/crypto/argon2id-password-hasher';
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

interface Fixture {
  readonly workspaceId: string;
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
  const [ws] = await sql<{ id: string }[]>`
    INSERT INTO workspaces (owner_id, name, slug) VALUES (${owner!.id}, 'WS', ${`ws-${crypto.randomUUID()}`}) RETURNING id
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

  return { workspaceId: ws!.id, bookId: book!.id, adminCookie: `${SESSION_COOKIE_NAME}=${token}` };
}

function buildApp(mailSender: MailSender = new RecordingMailSender()) {
  return createInvitationRoutes({
    sql,
    passwordHasher: hasher,
    mailSender,
    appUrl: 'http://localhost:3000',
    invitationTtlDays: 7,
    sessionIdleTimeoutMinutes: 30,
  });
}

describe('POST /invitations', () => {
  test('an authorised Workspace Admin creates an invitation and it is delivered through MailSender', async () => {
    const fixture = await buildFixture();
    const mailSender = new RecordingMailSender();
    const app = buildApp(mailSender);
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
    expect(mailSender.sent).toHaveLength(1);
    expect(mailSender.sent[0]!.to).toBe(email);
  });

  test('a subject without manage on the workspace root cannot create an invitation', async () => {
    const fixture = await buildFixture();
    const [nobody] = await sql<{ id: string }[]>`
      INSERT INTO users (email, password_hash, display_name)
      VALUES (${`nobody-${crypto.randomUUID()}@example.com`}, 'hash', 'Nobody') RETURNING id
    `;
    const { token } = await createSession(sql, { userId: nobody!.id, idleTimeoutMinutes: 30, absoluteTimeoutDays: 30 });
    const app = buildApp();

    const res = await app.request('/invitations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: `${SESSION_COOKIE_NAME}=${token}` },
      body: JSON.stringify({
        workspaceId: fixture.workspaceId,
        email: 'someone@example.com',
        startingGrants: [{ resourceId: fixture.bookId, action: 'read' }],
      }),
    });

    expect(res.status).toBe(403);
  });
});

describe('POST /invitations/accept', () => {
  test('a valid acceptance attaches the user to the workspace and can(user, read, book) resolves allow immediately after', async () => {
    const fixture = await buildFixture();
    const mailSender = new RecordingMailSender();
    const app = buildApp(mailSender);
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
    const link = mailSender.sent[0]!.body;
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
