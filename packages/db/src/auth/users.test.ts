/**
 * Minimal user lookup/update queries backing login and password reset
 * (design.md — "Authentication").
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '../../testing/provision';
import { findUserByEmail, updateUserPasswordHash } from './users';

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

async function insertUser(email: string, passwordHash: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name)
    VALUES (${email}, ${passwordHash}, 'Test User')
    RETURNING id
  `;
  return row!.id;
}

describe('findUserByEmail', () => {
  test('finds an existing user by exact email', async () => {
    const email = `${crypto.randomUUID()}@example.com`;
    const userId = await insertUser(email, 'a-hash');

    const found = await findUserByEmail(sql, email);

    expect(found).not.toBeNull();
    expect(found!.id).toBe(userId);
    expect(found!.passwordHash).toBe('a-hash');
  });

  test('returns null for an email with no account', async () => {
    const found = await findUserByEmail(sql, 'nobody-here@example.com');

    expect(found).toBeNull();
  });
});

describe('updateUserPasswordHash', () => {
  test('replaces the stored password hash', async () => {
    const email = `${crypto.randomUUID()}@example.com`;
    const userId = await insertUser(email, 'old-hash');

    await updateUserPasswordHash(sql, userId, 'new-hash');

    const found = await findUserByEmail(sql, email);
    expect(found!.passwordHash).toBe('new-hash');
  });
});
