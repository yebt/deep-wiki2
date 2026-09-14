/**
 * Authentication routes: login (this phase) and password reset (Phase 11
 * — design.md "Authentication"). All authorisation-relevant identity
 * derives from the session issued here; nothing in this file logs or
 * serialises a plaintext password, a password hash, or a raw token.
 *
 * Request and response shapes are validated against `@deep-wiki/contracts`
 * — the single source of truth for this route's wire shape, shared with
 * `apps/web`.
 */
import type { PasswordHasher } from '@deep-wiki/core';
import { normalizeEmail } from '@deep-wiki/core';
import {
  ErrorResponseSchema,
  LoginRequestSchema,
  LoginResponseSchema,
  PasswordResetConfirmRequestSchema,
  PasswordResetConfirmResponseSchema,
  PasswordResetRequestSchema,
  PasswordResetResponseSchema,
} from '@deep-wiki/contracts';
import {
  consumePasswordReset,
  createPasswordReset,
  createSession,
  findUserByEmail,
  simulatePasswordResetWork,
} from '@deep-wiki/db';
import { Hono } from 'hono';
import type postgres from 'postgres';
import type { MailDispatcher } from '../adapters/mail/background-mail-dispatcher';
import { setSessionCookie } from '../middleware/session';

export interface Logger {
  info(event: string, fields: Record<string, unknown>): void;
}

const consoleLogger: Logger = {
  info: (event, fields) => console.log(JSON.stringify({ event, ...fields })),
};

/**
 * A syntactically valid Argon2id hash that never verifies against any
 * plaintext. Used so a login attempt against an unknown email still pays
 * the hashing cost instead of short-circuiting — defense-in-depth against
 * timing-based email enumeration on the login path (the disclosure
 * requirement itself only binds the password-reset path, Phase 11).
 */
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export interface AuthRouteDeps {
  readonly sql: postgres.Sql;
  readonly passwordHasher: PasswordHasher;
  readonly sessionIdleTimeoutMinutes: number;
  readonly sessionAbsoluteTimeoutDays: number;
  /**
   * Deliberately a dispatcher and not a `MailSender`: `dispatch` returns
   * `void`, so this route physically cannot put the SMTP round trip on
   * the critical path of a response whose whole purpose is to disclose
   * nothing (see `background-mail-dispatcher.ts`).
   */
  readonly mailDispatcher: MailDispatcher;
  readonly passwordResetTtlMinutes: number;
  readonly appUrl: string;
  readonly logger?: Logger;
}

/** The one generic acknowledgement — identical for a known and an unknown account. */
const RESET_ACKNOWLEDGEMENT = {
  ok: true,
  message: 'If an account exists for that email, a reset link has been sent.',
} as const;

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Extracts one field as a string per the contract's field type, falling
 * back to `''` on anything else — preserves this route's long-standing
 * "missing/malformed fields fail the attempt, never the request" shape
 * (e.g. an unknown-email login still runs the full dummy-hash comparison
 * and returns 401, rather than a validation 400 that would itself leak a
 * signal) while still validating every field against the shared contract.
 */
function stringField(schema: { safeParse(value: unknown): { success: boolean; data?: unknown } }, value: unknown): string {
  const parsed = schema.safeParse(value);
  return parsed.success && typeof parsed.data === 'string' ? parsed.data : '';
}

export function createAuthRoutes(deps: AuthRouteDeps): Hono {
  const logger = deps.logger ?? consoleLogger;
  const app = new Hono();

  app.post('/auth/login', async (c) => {
    const body = await readJsonBody(c.req.raw);
    const email = normalizeEmail(stringField(LoginRequestSchema.shape.email, body.email));
    const password = stringField(LoginRequestSchema.shape.password, body.password);

    const user = email ? await findUserByEmail(deps.sql, email) : null;
    const hashToVerify = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
    const passwordMatches = await deps.passwordHasher.verify(hashToVerify, password);
    const succeeded = user !== null && passwordMatches;

    // Log the outcome, and on success the user id — never `password`,
    // never `passwordHash`, and deliberately never the submitted address.
    // The address is attacker-controlled on every failure: logging it
    // turns stdout, and whatever aggregator it is shipped to, into an
    // unbounded store of third-party email addresses harvested from a
    // public endpoint, in exchange for telemetry nothing reads. What
    // abuse detection actually needs is a rate limit (a known gap in
    // `docs/TODO.md`), which keys on the caller, not on a retained
    // plaintext address. On success the id is enough to correlate with
    // the session that follows, and it is already the application's own
    // identifier rather than personal data in the clear.
    logger.info('login_attempt', {
      outcome: succeeded ? 'success' : 'failure',
      ...(succeeded && user ? { userId: user.id } : {}),
    });

    if (!succeeded || !user) {
      return c.json(ErrorResponseSchema.parse({ error: 'invalid credentials' }), 401);
    }

    const { token } = await createSession(deps.sql, {
      userId: user.id,
      idleTimeoutMinutes: deps.sessionIdleTimeoutMinutes,
      absoluteTimeoutDays: deps.sessionAbsoluteTimeoutDays,
    });
    setSessionCookie(c, token);

    return c.json(LoginResponseSchema.parse({ ok: true }));
  });

  // Reset link hygiene (design.md): the token unavoidably rides in a URL,
  // so every password-reset response carries Referrer-Policy: no-referrer.
  app.post('/auth/password-reset', async (c) => {
    c.header('Referrer-Policy', 'no-referrer');
    const body = await readJsonBody(c.req.raw);
    const email = normalizeEmail(stringField(PasswordResetRequestSchema.shape.email, body.email));

    const user = email ? await findUserByEmail(deps.sql, email) : null;

    if (user) {
      const { token } = await createPasswordReset(deps.sql, user.id, deps.passwordResetTtlMinutes);
      const resetLink = `${deps.appUrl}/reset-password?token=${token}`;
      // Handed off, never awaited. The send's outcome was already
      // discarded here, but awaiting it put the SMTP round trip inside
      // the request — measured at 13.6 ms against a local Mailpit and up
      // to the transport's 5 s timeout against a dead relay, while the
      // miss branch below costs 0.0898 ms. A failure is not lost: the
      // dispatcher logs `mail_dispatch_failed` for an operator.
      deps.mailDispatcher.dispatch('password_reset', {
        to: email,
        subject: 'Reset your password',
        body: `Use this link to reset your password: ${resetLink}\nThis link expires in ${deps.passwordResetTtlMinutes} minutes.`,
      });
    } else {
      // Account non-disclosure: the same crypto and DB round trip the hit
      // branch pays, so what remains of the difference is one INSERT
      // rather than a network conversation with a mail server.
      await simulatePasswordResetWork(deps.sql);
    }

    // Always the same body, shape, and status — the response never
    // discloses whether `email` corresponds to an existing account.
    return c.json(PasswordResetResponseSchema.parse(RESET_ACKNOWLEDGEMENT), 202);
  });

  app.post('/auth/password-reset/confirm', async (c) => {
    c.header('Referrer-Policy', 'no-referrer');
    const body = await readJsonBody(c.req.raw);
    const token = stringField(PasswordResetConfirmRequestSchema.shape.token, body.token);
    const newPassword = stringField(PasswordResetConfirmRequestSchema.shape.newPassword, body.newPassword);

    if (!token || !newPassword) {
      return c.json(ErrorResponseSchema.parse({ error: 'invalid request' }), 400);
    }

    const newPasswordHash = await deps.passwordHasher.hash(newPassword);
    const result = await consumePasswordReset(deps.sql, token, newPasswordHash);

    if (result !== 'ok') {
      return c.json(ErrorResponseSchema.parse({ error: 'invalid or expired token' }), 400);
    }

    return c.json(PasswordResetConfirmResponseSchema.parse({ ok: true }));
  });

  return app;
}
