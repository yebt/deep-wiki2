/**
 * Login route (design.md — "Authentication"). Covers:
 *  - a logged login attempt, success or failure, contains no plaintext
 *    password and no password hash (authentication spec, logging scenario)
 *  - the session token appears only in the cookie header, never
 *    duplicated in the JSON body (authentication spec)
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { ok, type MailSendError, type MailSender, type Result, type SendMailInput } from '@deep-wiki/core';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '@deep-wiki/db/testing/provision';
import postgres from 'postgres';
import { Argon2idPasswordHasher } from '../adapters/crypto/argon2id-password-hasher';
import { SESSION_COOKIE_NAME } from '../middleware/session';
import { createAuthRoutes, type Logger } from './auth';

class RecordingMailSender implements MailSender {
  readonly sent: SendMailInput[] = [];

  async send(input: SendMailInput): Promise<Result<void, MailSendError>> {
    this.sent.push(input);
    return ok(undefined);
  }
}

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

function buildApp(logger: Logger, mailSender: MailSender = new RecordingMailSender()) {
  return createAuthRoutes({
    sql,
    passwordHasher: hasher,
    sessionIdleTimeoutMinutes: 30,
    sessionAbsoluteTimeoutDays: 30,
    passwordResetTtlMinutes: 30,
    appUrl: 'http://localhost:3000',
    mailSender,
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

describe('POST /auth/password-reset (account non-disclosure)', () => {
  test('an existing account receives the generic 202 acknowledgement', async () => {
    const email = `${crypto.randomUUID()}@example.com`;
    await insertUser(email, 'correct-horse-battery-staple');
    const mailSender = new RecordingMailSender();
    const app = buildApp(new CapturingLogger(), mailSender);

    const res = await app.request('/auth/password-reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });

    expect(res.status).toBe(202);
    expect(mailSender.sent).toHaveLength(1);
    expect(mailSender.sent[0]!.to).toBe(email);
  });

  test('a nonexistent account receives the byte-identical generic acknowledgement, and sends no mail', async () => {
    const knownEmail = `${crypto.randomUUID()}@example.com`;
    await insertUser(knownEmail, 'correct-horse-battery-staple');

    const knownMailSender = new RecordingMailSender();
    const knownRes = await buildApp(new CapturingLogger(), knownMailSender).request('/auth/password-reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: knownEmail }),
    });
    const knownBody = await knownRes.text();

    const unknownMailSender = new RecordingMailSender();
    const unknownRes = await buildApp(new CapturingLogger(), unknownMailSender).request('/auth/password-reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'this-account-does-not-exist@example.com' }),
    });
    const unknownBody = await unknownRes.text();

    // Indistinguishable response: same status, same body shape, no leaked signal.
    expect(unknownRes.status).toBe(knownRes.status);
    expect(unknownBody).toBe(knownBody);
    expect(unknownMailSender.sent).toHaveLength(0);
  });

  test('the response carries Referrer-Policy: no-referrer (reset link hygiene)', async () => {
    const app = buildApp(new CapturingLogger());

    const res = await app.request('/auth/password-reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'anyone@example.com' }),
    });

    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });

  test('timing is comparable between a known and an unknown account (best-effort, generous tolerance)', async () => {
    const knownEmail = `${crypto.randomUUID()}@example.com`;
    await insertUser(knownEmail, 'correct-horse-battery-staple');

    async function timeRequest(email: string): Promise<number> {
      const app = buildApp(new CapturingLogger());
      const start = performance.now();
      await app.request('/auth/password-reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      return performance.now() - start;
    }

    // Warm up (JIT / connection setup) before measuring.
    await timeRequest(knownEmail);
    await timeRequest('warmup-unknown@example.com');

    const knownDurations = [await timeRequest(knownEmail), await timeRequest(knownEmail)];
    const unknownDurations = [
      await timeRequest('still-unknown-1@example.com'),
      await timeRequest('still-unknown-2@example.com'),
    ];

    const avg = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
    const knownAvg = avg(knownDurations);
    const unknownAvg = avg(unknownDurations);

    // Best-effort, not a hard cryptographic guarantee: the handler performs
    // an equivalent dummy hash on a miss precisely so this ratio stays
    // bounded rather than exact (design.md — "Account non-disclosure").
    const ratio = Math.max(knownAvg, unknownAvg) / Math.max(1, Math.min(knownAvg, unknownAvg));
    expect(ratio).toBeLessThan(5);
  });
});

describe('POST /auth/password-reset/confirm', () => {
  test('a valid token changes the password and future logins use it', async () => {
    const email = `${crypto.randomUUID()}@example.com`;
    await insertUser(email, 'old-password');
    const mailSender = new RecordingMailSender();
    await buildApp(new CapturingLogger(), mailSender).request('/auth/password-reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const link = mailSender.sent[0]!.body;
    const token = new URL(link.match(/https?:\/\/\S+/)![0]).searchParams.get('token')!;

    const app = buildApp(new CapturingLogger());
    const confirmRes = await app.request('/auth/password-reset/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, newPassword: 'brand-new-password' }),
    });

    expect(confirmRes.status).toBe(200);

    const loginRes = await app.request('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'brand-new-password' }),
    });
    expect(loginRes.status).toBe(200);
  });

  test('an expired token is rejected and the password is unchanged', async () => {
    const email = `${crypto.randomUUID()}@example.com`;
    await insertUser(email, 'old-password');
    const mailSender = new RecordingMailSender();
    await buildApp(new CapturingLogger(), mailSender).request('/auth/password-reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const link = mailSender.sent[0]!.body;
    const token = new URL(link.match(/https?:\/\/\S+/)![0]).searchParams.get('token')!;
    await sql`UPDATE password_resets SET expires_at = now() - interval '1 minute'`;

    const app = buildApp(new CapturingLogger());
    const confirmRes = await app.request('/auth/password-reset/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, newPassword: 'brand-new-password' }),
    });

    expect(confirmRes.status).toBe(400);

    const loginRes = await app.request('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'old-password' }),
    });
    expect(loginRes.status).toBe(200);
  });

  test('a replayed token is rejected on the second attempt', async () => {
    const email = `${crypto.randomUUID()}@example.com`;
    await insertUser(email, 'old-password');
    const mailSender = new RecordingMailSender();
    await buildApp(new CapturingLogger(), mailSender).request('/auth/password-reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const link = mailSender.sent[0]!.body;
    const token = new URL(link.match(/https?:\/\/\S+/)![0]).searchParams.get('token')!;

    const app = buildApp(new CapturingLogger());
    const first = await app.request('/auth/password-reset/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, newPassword: 'brand-new-password' }),
    });
    const second = await app.request('/auth/password-reset/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, newPassword: 'yet-another-password' }),
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(400);
  });
});
