/**
 * Minimal user lookup/update queries backing login and password reset
 * (design.md — "Authentication"). Deliberately narrow: callers get only
 * the fields login/reset actually need, never the full `users` row.
 */
import type postgres from 'postgres';

type SqlExecutor = postgres.Sql | postgres.TransactionSql;

export interface UserCredentials {
  readonly id: string;
  readonly passwordHash: string;
}

export async function findUserByEmail(sql: SqlExecutor, email: string): Promise<UserCredentials | null> {
  const [row] = await sql<{ id: string; password_hash: string }[]>`
    SELECT id, password_hash FROM users WHERE email = ${email}
  `;

  if (!row) {
    return null;
  }

  return { id: row.id, passwordHash: row.password_hash };
}

export async function updateUserPasswordHash(sql: SqlExecutor, userId: string, passwordHash: string): Promise<void> {
  await sql`UPDATE users SET password_hash = ${passwordHash}, updated_at = now() WHERE id = ${userId}`;
}
