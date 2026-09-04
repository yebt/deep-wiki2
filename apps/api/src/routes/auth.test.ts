/**
 * Login route (design.md — "Authentication"). Covers:
 *  - a logged login attempt, success or failure, contains no plaintext
 *    password and no password hash (authentication spec, logging scenario)
 *  - the session token appears only in the cookie header, never
 *    duplicated in the JSON body (authentication spec)
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '@deep-wiki/db/testing/provision';
import postgres from 'postgres';
import { Argon2idPasswordHasher } from '../adapters/crypto/argon2id-password-hasher';
import { SESSION_COOKIE_NAME } from '../middleware/session';
import { createAuthRoutes, type Logger } from './auth';

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

async function insertUser(email: string, plaintextPassword: string): Promise<string> {
  const passwordHash = await hasher.hash(plaintextPassword);
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name)
    VALUES (${email}, ${passwordHash}, 'Test User')
    RETURNING id
  `;
  return row!.id;
}

class CapturingLogger implements Logger {
  readonly calls: Array<{ event: string; fields: Record<string, unknown> }> = [];

  info(event: string, fields: Record<string, unknown>): void {
    this.calls.push({ event, fields });
  }
}

function buildApp(logger: Logger) {
  return createAuthRoutes({
    sql,
    passwordHasher: hasher,
    sessionIdleTimeoutMinutes: 30,
    sessionAbsoluteTimeoutDays: 30,
    logger,
  });
}

describe('POST /auth/login', () => {
  test('a successful login issues a session cookie and returns 200 with no token in the body', async () => {
    const email = `${crypto.randomUUID()}@example.com`;
    await insertUser(email, 'correct-horse-battery-staple');
    const logger = new CapturingLogger();
    const app = buildApp(logger);

    const res = await app.request('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'correct-horse-battery-staple' }),
    });

    expect(res.status).toBe(200);
    const setCookieHeader = res.headers.get('set-cookie') ?? '';
    expect(setCookieHeader).toContain(`${SESSION_COOKIE_NAME}=`);

    const bodyText = await res.text();
    expect(bodyText).not.toContain(SESSION_COOKIE_NAME);
    // The session token itself never appears in the JSON body.
    const tokenValue = setCookieHeader.split(`${SESSION_COOKIE_NAME}=`)[1]?.split(';')[0];
    expect(tokenValue).toBeTruthy();
    expect(bodyText).not.toContain(tokenValue!);
  });

  test('logs a successful login attempt without the plaintext password or the password hash', async () => {
    const email = `${crypto.randomUUID()}@example.com`;
    const plaintextPassword = 'correct-horse-battery-staple';
    await insertUser(email, plaintextPassword);
    const logger = new CapturingLogger();
    const app = buildApp(logger);

    await app.request('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: plaintextPassword }),
    });

    expect(logger.calls).toHaveLength(1);
    const serialisedLog = JSON.stringify(logger.calls);
    expect(logger.calls[0]!.fields.outcome).toBe('success');
    expect(serialisedLog).not.toContain(plaintextPassword);
    expect(serialisedLog.toLowerCase()).not.toContain('argon2');
  });

  test('logs a failed login attempt without the plaintext password, and rejects with 401', async () => {
    const email = `${crypto.randomUUID()}@example.com`;
    await insertUser(email, 'correct-horse-battery-staple');
    const logger = new CapturingLogger();
    const app = buildApp(logger);

    const res = await app.request('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'totally-wrong-password' }),
    });

    expect(res.status).toBe(401);
    expect(logger.calls).toHaveLength(1);
    expect(logger.calls[0]!.fields.outcome).toBe('failure');
    const serialisedLog = JSON.stringify(logger.calls);
    expect(serialisedLog).not.toContain('totally-wrong-password');
    expect(serialisedLog).not.toContain('correct-horse-battery-staple');
  });

  test('logs a login attempt against an unknown email without ever creating a session', async () => {
    const logger = new CapturingLogger();
    const app = buildApp(logger);

    const res = await app.request('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'nobody-here@example.com', password: 'whatever' }),
    });

    expect(res.status).toBe(401);
    expect(logger.calls[0]!.fields.outcome).toBe('failure');
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});
