/**
 * Password reset token lifecycle (design.md — "Authentication").
 * Tokens are 256-bit random, stored only as a SHA-256 hash, single-use
 * (`consumed_at`), and bounded by a TTL. Issuing a new token for a user
 * revokes prior unconsumed ones, so a stale, still-unused link cannot be
 * replayed once a newer reset has been requested.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type postgres from 'postgres';
import { deleteAllSessionsForUser } from './sessions';
import { updateUserPasswordHash } from './users';

type SqlExecutor = postgres.Sql | postgres.TransactionSql;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export interface CreatedPasswordReset {
  readonly resetId: string;
  readonly token: string;
}

export async function createPasswordReset(sql: postgres.Sql, userId: string, ttlMinutes: number): Promise<CreatedPasswordReset> {
  const token = generateToken();
  const tokenHash = hashToken(token);

  return sql.begin(async (tx) => {
    // Issuing a new token revokes prior unconsumed ones.
    await tx`DELETE FROM password_resets WHERE user_id = ${userId} AND consumed_at IS NULL`;

    const [row] = await tx<{ id: string }[]>`
      INSERT INTO password_resets (user_id, token_hash, expires_at)
      VALUES (${userId}, ${tokenHash}, now() + (${ttlMinutes}::int * interval '1 minute'))
      RETURNING id
    `;

    return { resetId: row!.id, token };
  });
}

const DUMMY_USER_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Pays the same crypto and DB-round-trip cost as `createPasswordReset()`
 * without persisting anything, so the password-reset request route can
 * perform "an equivalent dummy hash" on a miss (design.md — "Account
 * non-disclosure") and keep the two response paths' latency comparable.
 */
export async function simulatePasswordResetWork(sql: postgres.Sql): Promise<void> {
  hashToken(generateToken());
  await sql.begin(async (tx) => {
    await tx`DELETE FROM password_resets WHERE user_id = ${DUMMY_USER_ID} AND consumed_at IS NULL`;
  });
}

export interface PasswordResetRecord {
  readonly id: string;
  readonly userId: string;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
}

interface PasswordResetRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  consumed_at: Date | null;
}

/**
 * Looks up a reset record by the hash of the presented token, then
 * confirms the match with a constant-time comparison of the fetched hash
 * (design.md — "Reset comparison: lookup by hash, then timingSafeEqual on
 * the fetched hash"). A miss performs an equivalent-cost dummy comparison
 * so the two branches do comparable work.
 */
export async function findPasswordResetByToken(sql: SqlExecutor, token: string): Promise<PasswordResetRecord | null> {
  const computedHash = hashToken(token);
  const computedBuf = Buffer.from(computedHash, 'hex');

  const [row] = await sql<PasswordResetRow[]>`
    SELECT id, user_id, token_hash, expires_at, consumed_at
      FROM password_resets
     WHERE token_hash = ${computedHash}
  `;

  if (!row) {
    timingSafeEqual(computedBuf, computedBuf); // dummy comparison, same cost as the match branch
    return null;
  }

  const rowBuf = Buffer.from(row.token_hash, 'hex');
  if (!timingSafeEqual(rowBuf, computedBuf)) {
    return null;
  }

  return { id: row.id, userId: row.user_id, expiresAt: row.expires_at, consumedAt: row.consumed_at };
}

export type ConsumePasswordResetResult = 'ok' | 'invalid' | 'expired' | 'already-consumed';

/**
 * Consumes a reset token: validates it, updates the user's password hash,
 * marks the token consumed, and revokes every session for that user — a
 * password change (via reset) invalidates all existing sessions
 * (design.md — "Invalidation").
 */
export async function consumePasswordReset(
  sql: postgres.Sql,
  token: string,
  newPasswordHash: string,
): Promise<ConsumePasswordResetResult> {
  const computedHash = hashToken(token);

  return sql.begin(async (tx) => {
    const [row] = await tx<PasswordResetRow[]>`
      SELECT id, user_id, token_hash, expires_at, consumed_at
        FROM password_resets
       WHERE token_hash = ${computedHash}
       FOR UPDATE
    `;

    if (!row) {
      return 'invalid';
    }
    if (row.consumed_at) {
      return 'already-consumed';
    }
    if (row.expires_at.getTime() <= Date.now()) {
      return 'expired';
    }

    await tx`UPDATE password_resets SET consumed_at = now() WHERE id = ${row.id}`;
    await updateUserPasswordHash(tx, row.user_id, newPasswordHash);
    await deleteAllSessionsForUser(tx, row.user_id);

    return 'ok';
  });
}
