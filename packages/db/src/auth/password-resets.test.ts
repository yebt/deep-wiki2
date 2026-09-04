/**
 * Password reset token lifecycle (design.md — "Authentication";
 * authentication spec "Password Reset Tokens Are Hashed, Single-Use,
 * Expiring"): an expired token is rejected and the password unchanged; a
 * replayed (already-consumed) token is rejected on the second attempt;
 * issuing a new token revokes prior unconsumed ones.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '../../testing/provision';
import { findUserByEmail } from './users';
import { consumePasswordReset, createPasswordReset, findPasswordResetByToken } from './password-resets';

let db: ProvisionedTestDatabase;
let sql: postgres.Sql;

beforeAll(async () => {
  db = await provisionTestDatabase();
  sql = postgres(db.url, { max: 5 });
});

afterAll(async () => {
  await sql.end({ timeout: 1 }).catch(() => {});
  await db.drop();
});

async function insertUser(passwordHash = 'original-hash'): Promise<{ id: string; email: string }> {
  const email = `${crypto.randomUUID()}@example.com`;
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name)
    VALUES (${email}, ${passwordHash}, 'Test User')
    RETURNING id
  `;
  return { id: row!.id, email };
}

describe('createPasswordReset / findPasswordResetByToken', () => {
  test('stores only the SHA-256 hash of the token', async () => {
    const user = await insertUser();
    const { token } = await createPasswordReset(sql, user.id, 30);

    const rows = await sql<{ token_hash: string }[]>`SELECT token_hash FROM password_resets WHERE user_id = ${user.id}`;

    expect(rows).toHaveLength(1);
    expect(rows[0]!.token_hash).not.toBe(token);
    expect(rows[0]!.token_hash).toHaveLength(64);
  });

  test('a freshly issued token is found and unconsumed', async () => {
    const user = await insertUser();
    const { token } = await createPasswordReset(sql, user.id, 30);

    const found = await findPasswordResetByToken(sql, token);

    expect(found).not.toBeNull();
    expect(found!.userId).toBe(user.id);
    expect(found!.consumedAt).toBeNull();
  });

  test('an unknown token is not found', async () => {
    expect(await findPasswordResetByToken(sql, 'never-issued')).toBeNull();
  });

  test('issuing a new token revokes prior unconsumed ones', async () => {
    const user = await insertUser();
    const first = await createPasswordReset(sql, user.id, 30);
    const second = await createPasswordReset(sql, user.id, 30);

    expect(await findPasswordResetByToken(sql, first.token)).toBeNull();
    expect(await findPasswordResetByToken(sql, second.token)).not.toBeNull();
  });
});

describe('consumePasswordReset', () => {
  test('a valid token changes the password, revokes all sessions, and reports "ok"', async () => {
    const user = await insertUser('old-hash');
    const { token } = await createPasswordReset(sql, user.id, 30);

    const result = await consumePasswordReset(sql, token, 'new-hash');

    expect(result).toBe('ok');
    const found = await findUserByEmail(sql, user.email);
    expect(found!.passwordHash).toBe('new-hash');
  });

  test('an expired token is rejected and the password is unchanged', async () => {
    const user = await insertUser('old-hash');
    const { token, resetId } = await createPasswordReset(sql, user.id, 30);
    await sql`UPDATE password_resets SET expires_at = now() - interval '1 minute' WHERE id = ${resetId}`;

    const result = await consumePasswordReset(sql, token, 'new-hash');

    expect(result).toBe('expired');
    const found = await findUserByEmail(sql, user.email);
    expect(found!.passwordHash).toBe('old-hash');
  });

  test('a replayed (already-consumed) token is rejected on the second attempt', async () => {
    const user = await insertUser('old-hash');
    const { token } = await createPasswordReset(sql, user.id, 30);

    const first = await consumePasswordReset(sql, token, 'new-hash');
    const second = await consumePasswordReset(sql, token, 'another-hash');

    expect(first).toBe('ok');
    expect(second).toBe('already-consumed');
    const found = await findUserByEmail(sql, user.email);
    expect(found!.passwordHash).toBe('new-hash');
  });

  test('an unknown token is rejected as invalid', async () => {
    const result = await consumePasswordReset(sql, 'never-issued', 'new-hash');

    expect(result).toBe('invalid');
  });
});
