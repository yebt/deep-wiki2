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
import { BackgroundMailDispatcher, type MailDispatcher } from '../adapters/mail/background-mail-dispatcher';
import { SESSION_COOKIE_NAME } from '../middleware/session';
import { createAuthRoutes, type Logger } from './auth';

class RecordingMailSender implements MailSender {
  readonly sent: SendMailInput[] = [];

  async send(input: SendMailInput): Promise<Result<void, MailSendError>> {
    this.sent.push(input);
    return ok(undefined);
  }
}

/**
 * The route hands mail off instead of awaiting it, so a test that reads
 * what was sent must wait for the hand-off to settle — `sent()` is that
 * wait, and it is the only place in this file allowed to do it. Nothing
 * in a request handler may.
 */
class TestMail {
  readonly sender = new RecordingMailSender();
  readonly dispatcher = new BackgroundMailDispatcher(this.sender);

  async sent(): Promise<SendMailInput[]> {
    await this.dispatcher.whenIdle();
    return this.sender.sent;
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

function buildApp(logger: Logger, mailDispatcher: MailDispatcher = new TestMail().dispatcher) {
  return createAuthRoutes({
    sql,
    passwordHasher: hasher,
    sessionIdleTimeoutMinutes: 30,
    sessionAbsoluteTimeoutDays: 30,
    passwordResetTtlMinutes: 30,
    appUrl: 'http://localhost:3000',
    mailDispatcher,
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
    const mail = new TestMail();
    const app = buildApp(new CapturingLogger(), mail.dispatcher);

    const res = await app.request('/auth/password-reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });

    expect(res.status).toBe(202);
    const sent = await mail.sent();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe(email);
  });

  test('a nonexistent account receives the byte-identical generic acknowledgement, and sends no mail', async () => {
    const knownEmail = `${crypto.randomUUID()}@example.com`;
    await insertUser(knownEmail, 'correct-horse-battery-staple');

    const knownMail = new TestMail();
    const knownRes = await buildApp(new CapturingLogger(), knownMail.dispatcher).request('/auth/password-reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: knownEmail }),
    });
    const knownBody = await knownRes.text();

    const unknownMail = new TestMail();
    const unknownRes = await buildApp(new CapturingLogger(), unknownMail.dispatcher).request('/auth/password-reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'this-account-does-not-exist@example.com' }),
    });
    const unknownBody = await unknownRes.text();

    // Indistinguishable response: same status, same body shape, no leaked signal.
    expect(unknownRes.status).toBe(knownRes.status);
    expect(unknownBody).toBe(knownBody);
    expect(await unknownMail.sent()).toHaveLength(0);
    expect(await knownMail.sent()).toHaveLength(1);
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

  // The wall-clock test that used to live here measured a `MailSender`
  // that returned instantly, so it compared two ~1 ms numbers and could
  // not observe the very cost it existed to bound. It is replaced by the
  // tests in "timing non-disclosure" below: a structural one that is the
  // guarantee, and a secondary one with the latency actually injected.
});

describe('POST /auth/password-reset/confirm', () => {
  test('a valid token changes the password and future logins use it', async () => {
    const email = `${crypto.randomUUID()}@example.com`;
    await insertUser(email, 'old-password');
    const mail = new TestMail();
    await buildApp(new CapturingLogger(), mail.dispatcher).request('/auth/password-reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const link = (await mail.sent())[0]!.body;
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
    const mail = new TestMail();
    await buildApp(new CapturingLogger(), mail.dispatcher).request('/auth/password-reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const link = (await mail.sent())[0]!.body;
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
    const mail = new TestMail();
    await buildApp(new CapturingLogger(), mail.dispatcher).request('/auth/password-reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const link = (await mail.sent())[0]!.body;
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

// ---------------------------------------------------------------------------
// Timing non-disclosure. The body-identity test above proves the payload says
// nothing. These prove the *work done before the payload* says nothing either
// — structurally first, and only then, as a secondary corroboration, by clock.
// ---------------------------------------------------------------------------

/** A sender whose send stays pending until the test releases it — a stand-in for a slow or dead relay. */
class GatedMailSender implements MailSender {
  readonly sent: SendMailInput[] = [];
  #release!: () => void;
  readonly gate = new Promise<void>((resolve) => {
    this.#release = resolve;
  });

  async send(input: SendMailInput): Promise<Result<void, MailSendError>> {
    this.sent.push(input);
    await this.gate;
    return ok(undefined);
  }

  release(): void {
    this.#release();
  }
}

/** A sender that fails the way a misconfigured relay does — by throwing, not by returning `err`. */
class ThrowingMailSender implements MailSender {
  async send(): Promise<Result<void, MailSendError>> {
    throw new Error('smtp connection refused');
  }
}

/** A sender that costs a fixed, known amount of wall-clock time. */
class SlowMailSender implements MailSender {
  constructor(private readonly delayMs: number) {}

  async send(): Promise<Result<void, MailSendError>> {
    await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    return ok(undefined);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Bounds a request so that a handler which *does* wait on the transport
 * fails with an assertion rather than hanging the suite. The bound plays no
 * part in a pass: a handler that does not wait responds long before it, and
 * one that does can never respond, because the gate is opened only after.
 */
async function respondsBeforeGate(app: ReturnType<typeof buildApp>, email: string): Promise<'responded' | 'blocked-on-mail'> {
  const responded = Promise.resolve(
    app.request('/auth/password-reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    }),
  ).then(() => 'responded' as const);
  return Promise.race([responded, sleep(REGRESSION_BOUND_MS).then(() => 'blocked-on-mail' as const)]);
}

/** Must stay well under the test's own timeout, or a regression reports a hang instead of an assertion. */
const REGRESSION_BOUND_MS = 2_000;

describe('POST /auth/password-reset (timing non-disclosure)', () => {
  /**
   * PRIMARY — structural. Both paths are driven against a transport whose
   * send is never allowed to finish while the requests are in flight. If
   * either path awaited the send, that path could not respond, at any
   * machine speed; if neither does, both respond regardless of what the
   * transport is doing. The assertion is therefore about *what the handler
   * waits on*, not about how long anything took.
   *
   * Proves: the mail transport is not on the causal path of the response
   * for the account that exists, exactly as it is not for the account that
   * does not — the send is started (the message reaches the sender) but its
   * completion is never a precondition of the 202. The difference that was
   * worth seconds is gone.
   *
   * Does NOT prove: constant time. The hit path still runs one INSERT the
   * miss path replaces with a DELETE — sub-millisecond, and closable only
   * by a fixed response deadline, not by any dummy work.
   */
  test('neither the known nor the unknown account waits on the mail transport to respond', async () => {
    const knownEmail = `${crypto.randomUUID()}@example.com`;
    await insertUser(knownEmail, 'correct-horse-battery-staple');
    const mailSender = new GatedMailSender();
    const app = buildApp(new CapturingLogger(), new BackgroundMailDispatcher(mailSender));

    const knownOutcome = await respondsBeforeGate(app, knownEmail);
    const unknownOutcome = await respondsBeforeGate(app, 'this-account-does-not-exist@example.com');
    const sendsStartedBeforeRelease = mailSender.sent.length;
    mailSender.release();

    expect(knownOutcome).toBe('responded');
    expect(unknownOutcome).toBe('responded');
    // The hit path did hand the message off — it was not simply skipped —
    // and the miss path never touched the sender.
    expect(sendsStartedBeforeRelease).toBe(1);
    expect(mailSender.sent[0]!.to).toBe(knownEmail);
  }, 20_000);

  test('a mail transport that fails still returns the same 202, and the failure reaches an operator', async () => {
    const email = `${crypto.randomUUID()}@example.com`;
    await insertUser(email, 'correct-horse-battery-staple');
    const logger = new CapturingLogger();
    const dispatcher = new BackgroundMailDispatcher(new ThrowingMailSender(), logger);
    const app = buildApp(new CapturingLogger(), dispatcher);

    const res = await app.request('/auth/password-reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    await dispatcher.whenIdle();

    expect(res.status).toBe(202);
    expect(logger.calls.map((call) => call.event)).toContain('mail_dispatch_failed');
    expect(logger.calls[0]!.fields.purpose).toBe('password_reset');
  });

  /**
   * SECONDARY — temporal, and not the guarantee. A green here is
   * corroboration of the structural test above, never a substitute for it:
   * a wall-clock test that passes on a fast machine proves nothing, and one
   * that fails on a loaded machine proves only that the machine was loaded
   * (an absolute bound was tried first and failed at 205 ms with the fix in
   * place, under a load average of 59).
   *
   * What it adds: the latency is *injected* into the transport rather than
   * mocked away, so the number under test is at least the number the defect
   * was about. Every bound is relative — the unknown path never sends mail,
   * so it is the host's own baseline under current load — and medians of
   * alternating samples damp a single hiccup. On the pre-fix code the known
   * median exceeds the unknown one by the whole injected latency.
   *
   * Does NOT prove: anything about a real SMTP conversation, anything
   * sub-millisecond, and nothing on a host so loaded that the medians are
   * themselves noise.
   */
  test('secondary: a known account does not pay an injected mail latency the unknown account never pays', async () => {
    const knownEmail = `${crypto.randomUUID()}@example.com`;
    await insertUser(knownEmail, 'correct-horse-battery-staple');
    const INJECTED_MAIL_LATENCY_MS = 250;
    const SAMPLES = 5;

    async function timeRequest(email: string): Promise<number> {
      const app = buildApp(
        new CapturingLogger(),
        new BackgroundMailDispatcher(new SlowMailSender(INJECTED_MAIL_LATENCY_MS)),
      );
      const start = performance.now();
      await app.request('/auth/password-reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      return performance.now() - start;
    }

    const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;

    await timeRequest(knownEmail);
    await timeRequest('warmup-unknown@example.com');

    const knownDurations: number[] = [];
    const unknownDurations: number[] = [];
    for (let sample = 0; sample < SAMPLES; sample += 1) {
      // Alternating, so a drift in machine load lands on both sets.
      knownDurations.push(await timeRequest(knownEmail));
      unknownDurations.push(await timeRequest(`still-unknown-${sample}@example.com`));
    }

    const excess = median(knownDurations) - median(unknownDurations);
    expect(excess).toBeLessThan(INJECTED_MAIL_LATENCY_MS / 2);
  });
});

describe('POST /auth/login (log hygiene)', () => {
  test('a failed attempt against an unknown address does not retain that address in the log', async () => {
    const probedEmail = `probe-${crypto.randomUUID()}@example.com`;
    const logger = new CapturingLogger();
    const app = buildApp(logger);

    await app.request('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: probedEmail, password: 'whatever' }),
    });

    expect(logger.calls).toHaveLength(1);
    expect(JSON.stringify(logger.calls)).not.toContain(probedEmail);
  });

  test('a successful attempt does not retain the address either', async () => {
    const email = `${crypto.randomUUID()}@example.com`;
    await insertUser(email, 'correct-horse-battery-staple');
    const logger = new CapturingLogger();
    const app = buildApp(logger);

    await app.request('/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'correct-horse-battery-staple' }),
    });

    expect(logger.calls[0]!.fields.outcome).toBe('success');
    expect(JSON.stringify(logger.calls)).not.toContain(email);
  });
});
