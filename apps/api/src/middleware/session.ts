/**
 * Cookie -> session -> subject resolution (design.md — "Authentication",
 * "Session Issuance and Validation"). Every subsequent request MUST
 * validate its session before deriving the tenant scope used by
 * `permission-resolver` — this middleware is that validation step.
 */
import { findSessionByToken, touchSession } from '@deep-wiki/db';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Context, MiddlewareHandler } from 'hono';
import type postgres from 'postgres';

export const SESSION_COOKIE_NAME = 'session';

export interface SessionVariables {
  session: {
    readonly userId: string;
    readonly sessionId: string;
  };
}

export interface SessionMiddlewareOptions {
  readonly idleTimeoutMinutes: number;
}

export function setSessionCookie(c: Context, token: string): void {
  setCookie(c, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE_NAME, { path: '/' });
}

function isExpired(session: { idleExpiresAt: Date; absoluteExpiresAt: Date }): boolean {
  const now = Date.now();
  return session.idleExpiresAt.getTime() <= now || session.absoluteExpiresAt.getTime() <= now;
}

export function sessionMiddleware(
  sql: postgres.Sql | postgres.TransactionSql,
  options: SessionMiddlewareOptions,
): MiddlewareHandler<{ Variables: SessionVariables }> {
  return async (c, next) => {
    const token = getCookie(c, SESSION_COOKIE_NAME);
    if (!token) {
      return c.json({ error: 'unauthorized' }, 401);
    }

    const session = await findSessionByToken(sql, token);
    if (!session || isExpired(session)) {
      return c.json({ error: 'unauthorized' }, 401);
    }

    await touchSession(sql, session.id, options.idleTimeoutMinutes);
    c.set('session', { userId: session.userId, sessionId: session.id });

    await next();
  };
}
