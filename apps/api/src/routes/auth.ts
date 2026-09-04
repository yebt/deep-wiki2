/**
 * Authentication routes: login (this phase) and password reset (Phase 11
 * — design.md "Authentication"). All authorisation-relevant identity
 * derives from the session issued here; nothing in this file logs or
 * serialises a plaintext password, a password hash, or a raw token.
 */
import type { PasswordHasher } from '@deep-wiki/core';
import { createSession, findUserByEmail } from '@deep-wiki/db';
import { Hono } from 'hono';
import type postgres from 'postgres';
import { normalizeEmail } from '@deep-wiki/core';
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
  readonly logger?: Logger;
}

interface LoginBody {
  readonly email?: unknown;
  readonly password?: unknown;
}

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

  return app;
}
