/**
 * Authentication routes: login (this phase) and password reset (Phase 11
 * — design.md "Authentication"). All authorisation-relevant identity
 * derives from the session issued here; nothing in this file logs or
 * serialises a plaintext password, a password hash, or a raw token.
 */
import type { MailSender, PasswordHasher } from '@deep-wiki/core';
import { normalizeEmail } from '@deep-wiki/core';
import {
  consumePasswordReset,
  createPasswordReset,
  createSession,
  findUserByEmail,
  simulatePasswordResetWork,
} from '@deep-wiki/db';
import { Hono } from 'hono';
import type postgres from 'postgres';
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
  readonly mailSender: MailSender;
  readonly passwordResetTtlMinutes: number;
  readonly appUrl: string;
  readonly logger?: Logger;
}

interface LoginBody {
  readonly email?: unknown;
  readonly password?: unknown;
}

interface PasswordResetRequestBody {
  readonly email?: unknown;
}

interface PasswordResetConfirmBody {
  readonly token?: unknown;
  readonly newPassword?: unknown;
}

/** The one generic acknowledgement — identical for a known and an unknown account. */
const RESET_ACKNOWLEDGEMENT = {
  ok: true,
  message: 'If an account exists for that email, a reset link has been sent.',
} as const;

async function readJsonBody<T>(request: Request): Promise<T | Record<string, never>> {
  try {
    return (await request.json()) as T;
  } catch {
    return {};
  }
}

export function createAuthRoutes(deps: AuthRouteDeps): Hono {
  const logger = deps.logger ?? consoleLogger;
  const app = new Hono();

  app.post('/auth/login', async (c) => {
    const body = await readJsonBody<LoginBody>(c.req.raw);
    const email = typeof body.email === 'string' ? normalizeEmail(body.email) : '';
    const password = typeof body.password === 'string' ? body.password : '';

    const user = email ? await findUserByEmail(deps.sql, email) : null;
    const hashToVerify = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
    const passwordMatches = await deps.passwordHasher.verify(hashToVerify, password);
    const succeeded = user !== null && passwordMatches;

    // Log only the outcome — never `password` or `passwordHash`.
    logger.info('login_attempt', { email, outcome: succeeded ? 'success' : 'failure' });

    if (!succeeded || !user) {
      return c.json({ error: 'invalid credentials' }, 401);
    }

    const { token } = await createSession(deps.sql, {
      userId: user.id,
      idleTimeoutMinutes: deps.sessionIdleTimeoutMinutes,
      absoluteTimeoutDays: deps.sessionAbsoluteTimeoutDays,
    });
    setSessionCookie(c, token);

    return c.json({ ok: true });
  });

  // Reset link hygiene (design.md): the token unavoidably rides in a URL,
  // so every password-reset response carries Referrer-Policy: no-referrer.
  app.post('/auth/password-reset', async (c) => {
    c.header('Referrer-Policy', 'no-referrer');
    const body = await readJsonBody<PasswordResetRequestBody>(c.req.raw);
    const email = typeof body.email === 'string' ? normalizeEmail(body.email) : '';

    const user = email ? await findUserByEmail(deps.sql, email) : null;

    if (user) {
      const { token } = await createPasswordReset(deps.sql, user.id, deps.passwordResetTtlMinutes);
      const resetLink = `${deps.appUrl}/reset-password?token=${token}`;
      await deps.mailSender.send({
        to: email,
        subject: 'Reset your password',
        body: `Use this link to reset your password: ${resetLink}\nThis link expires in ${deps.passwordResetTtlMinutes} minutes.`,
      });
    } else {
      // Account non-disclosure: an equivalent dummy hash so latency does
      // not become the oracle the response body refuses to be.
      await simulatePasswordResetWork(deps.sql);
    }

    // Always the same body, shape, and status — the response never
    // discloses whether `email` corresponds to an existing account.
    return c.json(RESET_ACKNOWLEDGEMENT, 202);
  });

  app.post('/auth/password-reset/confirm', async (c) => {
    c.header('Referrer-Policy', 'no-referrer');
    const body = await readJsonBody<PasswordResetConfirmBody>(c.req.raw);
    const token = typeof body.token === 'string' ? body.token : '';
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';

    if (!token || !newPassword) {
      return c.json({ error: 'invalid request' }, 400);
    }

    const newPasswordHash = await deps.passwordHasher.hash(newPassword);
    const result = await consumePasswordReset(deps.sql, token, newPasswordHash);

    if (result !== 'ok') {
      return c.json({ error: 'invalid or expired token' }, 400);
    }

    return c.json({ ok: true });
  });

  return app;
}
