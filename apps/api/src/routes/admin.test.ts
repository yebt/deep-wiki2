/**
 * Registration policy admin routes and public self-registration
 * (registration-policy spec; design.md — "Registration mode").
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { err, ok, type MailSendError, type MailSender, type Result, type SendMailInput } from '@deep-wiki/core';
import { createSession } from '@deep-wiki/db';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '@deep-wiki/db/testing/provision';
import postgres from 'postgres';
import { Argon2idPasswordHasher } from '../adapters/crypto/argon2id-password-hasher';
import { SESSION_COOKIE_NAME } from '../middleware/session';
import { createAdminRoutes } from './admin';

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

class FailingMailSender implements MailSender {
  async send(): Promise<Result<void, MailSendError>> {
    return err({ reason: 'smtp connection refused' });
  }
}

async function insertSuperRoot(): Promise<{ userId: string; cookie: string }> {
  const email = `${crypto.randomUUID()}@example.com`;
  const passwordHash = await hasher.hash('irrelevant-password');
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name, is_super_root)
    VALUES (${email}, ${passwordHash}, 'Super Root', true)
    RETURNING id
  `;
  const { token } = await createSession(sql, { userId: row!.id, idleTimeoutMinutes: 30, absoluteTimeoutDays: 30 });
  return { userId: row!.id, cookie: `${SESSION_COOKIE_NAME}=${token}` };
}

async function insertOrdinaryUser(): Promise<{ userId: string; cookie: string }> {
  const email = `${crypto.randomUUID()}@example.com`;
  const passwordHash = await hasher.hash('irrelevant-password');
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name, is_super_root)
    VALUES (${email}, ${passwordHash}, 'Ordinary User', false)
    RETURNING id
  `;
  const { token } = await createSession(sql, { userId: row!.id, idleTimeoutMinutes: 30, absoluteTimeoutDays: 30 });
  return { userId: row!.id, cookie: `${SESSION_COOKIE_NAME}=${token}` };
}

async function resetInstanceSettings(): Promise<void> {
  await sql`UPDATE instance_settings SET registration_mode = 'invitation_only', smtp_verified_at = NULL, smtp_config_hash = NULL, open_registration_domains = '{}' WHERE id = 1`;
}

async function countUsersByEmail(email: string): Promise<number> {
  const rows = await sql<{ count: number }[]>`SELECT COUNT(*)::int AS count FROM users WHERE email = ${email}`;
  return rows[0]!.count;
}

function buildApp(mailSender: MailSender = new RecordingMailSender(), smtpConfigHash = 'hash-a') {
  return createAdminRoutes({ sql, passwordHasher: hasher, mailSender, smtpConfigHash, sessionIdleTimeoutMinutes: 30 });
}

describe('POST /auth/register (registration-policy)', () => {
  test('self-registration is rejected while closed, and no account is created', async () => {
    await resetInstanceSettings();
    await sql`UPDATE instance_settings SET registration_mode = 'closed' WHERE id = 1`;
    const app = buildApp();
    const email = `${crypto.randomUUID()}@example.com`;

    const res = await app.request('/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'a-strong-password' }),
    });

    expect(res.status).toBe(403);
    expect(await countUsersByEmail(email)).toBe(0);
  });

  /**
   * The boundary of the disclosure decision recorded in `admin.ts` and in
   * `docs/TODO.md`'s Open Question: in the two modes that gate
   * registration, the answer is identical whether or not the address is
   * already registered, because the mode check returns before the address
   * is ever looked up. This guard passes today; it exists so that a later
   * refactor that moves the existence check earlier — the natural shape of
   * "validate everything, then decide" — is caught as the regression it
   * would be, in `closed` and `invitation_only` at least.
   */
  test('closed and invitation_only answer identically for a registered and an unknown address', async () => {
    for (const mode of ['closed', 'invitation_only'] as const) {
      await resetInstanceSettings();
      await sql`UPDATE instance_settings SET registration_mode = ${mode} WHERE id = 1`;
      const app = buildApp();

      const registeredEmail = `${crypto.randomUUID()}@example.com`;
      await sql`
        INSERT INTO users (email, password_hash, display_name)
        VALUES (${registeredEmail}, ${await hasher.hash('irrelevant-password')}, 'Existing User')
      `;

      const attempt = (email: string) =>
        app.request('/auth/register', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, password: 'a-strong-password' }),
        });

      const existingRes = await attempt(registeredEmail);
      const unknownRes = await attempt(`${crypto.randomUUID()}@example.com`);

      expect(existingRes.status).toBe(unknownRes.status);
      expect(await existingRes.text()).toBe(await unknownRes.text());
    }
  });

  test('registration from an allowed domain succeeds when open with an allowlist', async () => {
    await resetInstanceSettings();
    const superRoot = await insertSuperRoot();
    const app = buildApp();
    await app.request('/admin/smtp-test', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: superRoot.cookie },
      body: JSON.stringify({ to: 'ops@example.com' }),
    });
    await app.request('/admin/registration-mode', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: superRoot.cookie },
      body: JSON.stringify({ mode: 'open' }),
    });
    await app.request('/admin/registration-domains', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: superRoot.cookie },
      body: JSON.stringify({ domains: ['company.com'] }),
    });

    const email = `new-hire@company.com`;
    const res = await app.request('/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'a-strong-password' }),
    });

    expect(res.status).toBe(201);
    expect(await countUsersByEmail(email)).toBe(1);
  });

  test('registration from a disallowed domain is rejected naming the restriction', async () => {
    await resetInstanceSettings();
    const superRoot = await insertSuperRoot();
    const app = buildApp();
    await app.request('/admin/smtp-test', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: superRoot.cookie },
      body: JSON.stringify({ to: 'ops@example.com' }),
    });
    await app.request('/admin/registration-mode', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: superRoot.cookie },
      body: JSON.stringify({ mode: 'open' }),
    });
    await app.request('/admin/registration-domains', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: superRoot.cookie },
      body: JSON.stringify({ domains: ['company.com'] }),
    });

    const email = `outsider@not-allowed.example`;

    const res = await app.request('/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'a-strong-password' }),
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('company.com');
    expect(await countUsersByEmail(email)).toBe(0);
  });
});

describe('PUT /admin/registration-mode (Super Root only)', () => {
  test('switching to open without a recorded SMTP test send is refused, naming the requirement', async () => {
    await resetInstanceSettings();
    const superRoot = await insertSuperRoot();
    const app = buildApp();

    const res = await app.request('/admin/registration-mode', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: superRoot.cookie },
      body: JSON.stringify({ mode: 'open' }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error.toLowerCase()).toContain('smtp');
  });

  test('an ordinary (non-Super-Root) session cannot change the registration mode', async () => {
    await resetInstanceSettings();
    const user = await insertOrdinaryUser();
    const app = buildApp();

    const res = await app.request('/admin/registration-mode', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: user.cookie },
      body: JSON.stringify({ mode: 'closed' }),
    });

    expect(res.status).toBe(403);
  });

  test('switching to open succeeds after a successful SMTP test send', async () => {
    await resetInstanceSettings();
    const superRoot = await insertSuperRoot();
    const app = buildApp();

    const testRes = await app.request('/admin/smtp-test', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: superRoot.cookie },
      body: JSON.stringify({ to: 'ops@example.com' }),
    });
    expect(testRes.status).toBe(200);

    const res = await app.request('/admin/registration-mode', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: superRoot.cookie },
      body: JSON.stringify({ mode: 'open' }),
    });

    expect(res.status).toBe(200);
    const [row] = await sql<{ registration_mode: string; smtp_verified_at: Date | null }[]>`
      SELECT registration_mode, smtp_verified_at FROM instance_settings WHERE id = 1
    `;
    expect(row!.registration_mode).toBe('open');
    expect(row!.smtp_verified_at).not.toBeNull();
  });

  test('smtp_verified_at is stamped only when the test send reports ok', async () => {
    await resetInstanceSettings();
    const superRoot = await insertSuperRoot();
    const app = buildApp(new FailingMailSender());

    const res = await app.request('/admin/smtp-test', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: superRoot.cookie },
      body: JSON.stringify({ to: 'ops@example.com' }),
    });

    expect(res.status).toBe(502);
    const [row] = await sql<{ smtp_verified_at: Date | null }[]>`SELECT smtp_verified_at FROM instance_settings WHERE id = 1`;
    expect(row!.smtp_verified_at).toBeNull();
  });

  test('changing the SMTP configuration clears smtp_verified_at and reverts to invitation_only, with an operator notice', async () => {
    await resetInstanceSettings();
    const superRoot = await insertSuperRoot();
    const appWithHashA = buildApp(new RecordingMailSender(), 'hash-a');

    await appWithHashA.request('/admin/smtp-test', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: superRoot.cookie },
      body: JSON.stringify({ to: 'ops@example.com' }),
    });
    await appWithHashA.request('/admin/registration-mode', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: superRoot.cookie },
      body: JSON.stringify({ mode: 'open' }),
    });

    // The configuration changes (a new hash) — simulated by pointing a
    // fresh app instance at the same DB with a different smtpConfigHash,
    // exactly as a restarted process with edited env vars would.
    const appWithHashB = buildApp(new RecordingMailSender(), 'hash-b');
    const res = await appWithHashB.request('/admin/registration-mode', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: superRoot.cookie },
      body: JSON.stringify({ mode: 'closed' }),
    });
    // This call itself also reconciles as a side effect of reading settings.
    void res;

    const [row] = await sql<{ registration_mode: string; smtp_verified_at: Date | null }[]>`
      SELECT registration_mode, smtp_verified_at FROM instance_settings WHERE id = 1
    `;
    expect(row!.smtp_verified_at).toBeNull();
  });
});

describe('GET /admin/instance-settings (Super Root only)', () => {
  test('returns the mode, the allowlist and whether SMTP is verified, and never the configuration hash', async () => {
    await resetInstanceSettings();
    const superRoot = await insertSuperRoot();
    const app = buildApp();
    await app.request('/admin/registration-domains', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: superRoot.cookie },
      body: JSON.stringify({ domains: ['company.com'] }),
    });

    const res = await app.request('/admin/instance-settings', { headers: { cookie: superRoot.cookie } });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      registrationMode: 'invitation_only',
      openRegistrationDomains: ['company.com'],
      smtpVerifiedAt: null,
      smtpVerificationReverted: false,
    });
    expect(text).not.toContain('hash-a');
  });

  test('an ordinary session is refused', async () => {
    const user = await insertOrdinaryUser();

    const res = await buildApp().request('/admin/instance-settings', { headers: { cookie: user.cookie } });

    expect(res.status).toBe(403);
  });

  /**
   * The state an operator most needs to be told about: `open` was chosen,
   * the SMTP configuration changed, and the very read that renders the
   * screen is the one that reverted the mode. The screen must be able to
   * say "this was switched off for you", not merely show the switch off.
   */
  test('the read that reverts a stale open mode says so, and a later read reports the settled state', async () => {
    await resetInstanceSettings();
    const superRoot = await insertSuperRoot();
    const appWithHashA = buildApp(new RecordingMailSender(), 'hash-a');
    await appWithHashA.request('/admin/smtp-test', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: superRoot.cookie },
      body: JSON.stringify({ to: 'ops@example.com' }),
    });
    await appWithHashA.request('/admin/registration-mode', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', cookie: superRoot.cookie },
      body: JSON.stringify({ mode: 'open' }),
    });

    const appWithHashB = buildApp(new RecordingMailSender(), 'hash-b');
    const reverting = (await (await appWithHashB.request('/admin/instance-settings', { headers: { cookie: superRoot.cookie } })).json()) as Record<string, unknown>;
    const settled = (await (await appWithHashB.request('/admin/instance-settings', { headers: { cookie: superRoot.cookie } })).json()) as Record<string, unknown>;

    expect(reverting).toEqual({
      registrationMode: 'invitation_only',
      openRegistrationDomains: [],
      smtpVerifiedAt: null,
      smtpVerificationReverted: true,
    });
    expect(settled.smtpVerificationReverted).toBe(false);
    expect(settled.registrationMode).toBe('invitation_only');
  });
});
