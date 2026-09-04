/**
 * Cookie -> session -> subject resolution (design.md — "Authentication",
 * "Session Issuance and Validation").
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createSession } from '@deep-wiki/db';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '@deep-wiki/db/testing/provision';
import { Hono } from 'hono';
import postgres from 'postgres';
import { SESSION_COOKIE_NAME, sessionMiddleware, type SessionVariables } from './session';

let db: ProvisionedTestDatabase;
let sql: postgres.Sql;

beforeAll(async () => {
  db = await provisionTestDatabase();
  sql = postgres(db.url, { max: 5 });
});

afterAll(async () => {
  await sql.end({ timeout: 1 }).catch(() => {});
  await db.drop();
});

async function insertUser(): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name)
    VALUES (${`${crypto.randomUUID()}@example.com`}, 'hash', 'Test User')
    RETURNING id
  `;
  return row!.id;
}

function buildApp() {
  const app = new Hono<{ Variables: SessionVariables }>();
  app.use('/protected', sessionMiddleware(sql, { idleTimeoutMinutes: 30 }));
  app.get('/protected', (c) => c.json({ subjectId: c.get('session').userId }));
  return app;
}

describe('sessionMiddleware', () => {
  test('a valid session lets the request proceed with the subject derived from it', async () => {
    const userId = await insertUser();
    const { token } = await createSession(sql, { userId, idleTimeoutMinutes: 30, absoluteTimeoutDays: 30 });
    const app = buildApp();

    const res = await app.request('/protected', { headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { subjectId: string };
    expect(body.subjectId).toBe(userId);
  });

  test('a missing session cookie is rejected before any resource access is attempted', async () => {
    const app = buildApp();

    const res = await app.request('/protected');

    expect(res.status).toBe(401);
  });

  test('an unknown session token is rejected', async () => {
    const app = buildApp();

    const res = await app.request('/protected', { headers: { cookie: `${SESSION_COOKIE_NAME}=not-a-real-token` } });

    expect(res.status).toBe(401);
  });

  test('an expired session is rejected', async () => {
    const userId = await insertUser();
    const { token } = await createSession(sql, { userId, idleTimeoutMinutes: 30, absoluteTimeoutDays: 30 });
    // Force the session into the past directly — createSession has no "expired" input.
    await sql`UPDATE sessions SET idle_expires_at = now() - interval '1 minute' WHERE user_id = ${userId}`;
    const app = buildApp();

    const res = await app.request('/protected', { headers: { cookie: `${SESSION_COOKIE_NAME}=${token}` } });

    expect(res.status).toBe(401);
  });
});
