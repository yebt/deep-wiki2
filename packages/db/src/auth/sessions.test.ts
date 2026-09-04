/**
 * Server-side session lifecycle (design.md — "Authentication"; D14):
 * token stored SHA-256 hashed and looked up by hash; sliding
 * `idle_expires_at` and hard `absolute_expires_at`; logout deletes the
 * row; a password change or a consumed reset deletes all sessions for
 * that user.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '../../testing/provision';
import {
  createSession,
  deleteAllSessionsForUser,
  deleteSession,
  findSessionByToken,
  touchSession,
} from './sessions';

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

async function insertUser(): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name)
    VALUES (${`${crypto.randomUUID()}@example.com`}, 'hash', 'Test User')
    RETURNING id
  `;
  return row!.id;
}

describe('createSession / findSessionByToken', () => {
  test('stores only the SHA-256 hash of the token, never the raw token', async () => {
    const userId = await insertUser();
    const { token } = await createSession(sql, { userId, idleTimeoutMinutes: 30, absoluteTimeoutDays: 30 });

    const rows = await sql<{ token_hash: string }[]>`SELECT token_hash FROM sessions WHERE user_id = ${userId}`;

    expect(rows).toHaveLength(1);
    expect(rows[0]!.token_hash).not.toBe(token);
    expect(rows[0]!.token_hash).toHaveLength(64); // hex-encoded SHA-256
  });

  test('a session is found by presenting the raw token', async () => {
    const userId = await insertUser();
    const { token } = await createSession(sql, { userId, idleTimeoutMinutes: 30, absoluteTimeoutDays: 30 });

    const found = await findSessionByToken(sql, token);

    expect(found).not.toBeNull();
    expect(found!.userId).toBe(userId);
  });

  test('an unknown token is not found', async () => {
    const found = await findSessionByToken(sql, 'a-token-that-was-never-issued');

    expect(found).toBeNull();
  });

  test('two sessions for the same user receive different tokens', async () => {
    const userId = await insertUser();
    const a = await createSession(sql, { userId, idleTimeoutMinutes: 30, absoluteTimeoutDays: 30 });
    const b = await createSession(sql, { userId, idleTimeoutMinutes: 30, absoluteTimeoutDays: 30 });

    expect(a.token).not.toBe(b.token);
  });
});

describe('touchSession (sliding idle expiry)', () => {
  test('extends idle_expires_at without changing absolute_expires_at', async () => {
    const userId = await insertUser();
    const { token, sessionId } = await createSession(sql, { userId, idleTimeoutMinutes: 30, absoluteTimeoutDays: 30 });
    const before = await findSessionByToken(sql, token);

    await new Promise((resolve) => setTimeout(resolve, 10));
    await touchSession(sql, sessionId, 60);

    const after = await findSessionByToken(sql, token);

    expect(after!.idleExpiresAt.getTime()).toBeGreaterThan(before!.idleExpiresAt.getTime());
    expect(after!.absoluteExpiresAt.getTime()).toBe(before!.absoluteExpiresAt.getTime());
  });
});

describe('deleteSession (logout)', () => {
  test('removes the session row so the token no longer resolves', async () => {
    const userId = await insertUser();
    const { token, sessionId } = await createSession(sql, { userId, idleTimeoutMinutes: 30, absoluteTimeoutDays: 30 });

    await deleteSession(sql, sessionId);

    expect(await findSessionByToken(sql, token)).toBeNull();
  });
});

describe('deleteAllSessionsForUser (password change / consumed reset)', () => {
  test('removes every session belonging to the user, leaving other users untouched', async () => {
    const userId = await insertUser();
    const otherUserId = await insertUser();
    const a = await createSession(sql, { userId, idleTimeoutMinutes: 30, absoluteTimeoutDays: 30 });
    const b = await createSession(sql, { userId, idleTimeoutMinutes: 30, absoluteTimeoutDays: 30 });
    const other = await createSession(sql, { userId: otherUserId, idleTimeoutMinutes: 30, absoluteTimeoutDays: 30 });

    await deleteAllSessionsForUser(sql, userId);

    expect(await findSessionByToken(sql, a.token)).toBeNull();
    expect(await findSessionByToken(sql, b.token)).toBeNull();
    expect(await findSessionByToken(sql, other.token)).not.toBeNull();
  });
});
