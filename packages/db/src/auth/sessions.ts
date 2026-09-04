/**
 * Server-side session lifecycle (design.md — "Authentication"; D14).
 * A session token is 256-bit random, returned to the caller exactly once
 * (to be set as an `HttpOnly` cookie by `apps/api/src/middleware/session.ts`)
 * and stored only as its SHA-256 hash. Revocation is a `DELETE`, which is
 * the whole reason this is a server-side session rather than a JWT.
 */
import { createHash, randomBytes } from 'node:crypto';
import type postgres from 'postgres';

type SqlExecutor = postgres.Sql | postgres.TransactionSql;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function generateToken(): string {
  return randomBytes(32).toString('base64url'); // 256 bits
}

export interface CreateSessionInput {
  readonly userId: string;
  readonly idleTimeoutMinutes: number;
  readonly absoluteTimeoutDays: number;
}

export interface CreatedSession {
  readonly sessionId: string;
  /** The raw token. Exists only here and in the client's cookie — never persisted. */
  readonly token: string;
}

export async function createSession(sql: SqlExecutor, input: CreateSessionInput): Promise<CreatedSession> {
  const token = generateToken();
  const tokenHash = hashToken(token);

  const [row] = await sql<{ id: string }[]>`
    INSERT INTO sessions (user_id, token_hash, idle_expires_at, absolute_expires_at)
    VALUES (
      ${input.userId},
      ${tokenHash},
      now() + (${input.idleTimeoutMinutes}::int * interval '1 minute'),
      now() + (${input.absoluteTimeoutDays}::int * interval '1 day')
    )
    RETURNING id
  `;

  return { sessionId: row!.id, token };
}

export interface SessionRecord {
  readonly id: string;
  readonly userId: string;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
}

export async function findSessionByToken(sql: SqlExecutor, token: string): Promise<SessionRecord | null> {
  const tokenHash = hashToken(token);

  const [row] = await sql<{ id: string; user_id: string; idle_expires_at: Date; absolute_expires_at: Date }[]>`
    SELECT id, user_id, idle_expires_at, absolute_expires_at
      FROM sessions
     WHERE token_hash = ${tokenHash}
  `;

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    userId: row.user_id,
    idleExpiresAt: row.idle_expires_at,
    absoluteExpiresAt: row.absolute_expires_at,
  };
}

/** Slides `idle_expires_at` forward on activity; `absolute_expires_at` never moves. */
export async function touchSession(sql: SqlExecutor, sessionId: string, idleTimeoutMinutes: number): Promise<void> {
  await sql`
    UPDATE sessions
       SET idle_expires_at = now() + (${idleTimeoutMinutes}::int * interval '1 minute')
     WHERE id = ${sessionId}
  `;
}

/** Logout: deletes exactly one session row. */
export async function deleteSession(sql: SqlExecutor, sessionId: string): Promise<void> {
  await sql`DELETE FROM sessions WHERE id = ${sessionId}`;
}

/** "Sign out everywhere": a password change or a consumed reset deletes every session for the user. */
export async function deleteAllSessionsForUser(sql: SqlExecutor, userId: string): Promise<void> {
  await sql`DELETE FROM sessions WHERE user_id = ${userId}`;
}
