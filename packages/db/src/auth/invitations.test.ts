/**
 * Invitation lifecycle (invitations spec): creation stores workspace,
 * target email, and starting grants; an expired invitation is rejected
 * without creating membership; a second acceptance on an accepted
 * invitation is rejected without a duplicate membership; a valid
 * acceptance attaches the user to the workspace and applies the starting
 * grants immediately (proven end-to-end via `can()` at the route level,
 * Phase 14.3 — this file proves the DB layer in isolation).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { can, type PasswordHasher } from '@deep-wiki/core';
import postgres from 'postgres';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '../../testing/provision';
import { createGrantLookup } from '../permissions/queries';
import { acceptInvitation, createInvitation, findInvitationByToken } from './invitations';

// A trivial in-memory hasher — this DB-layer suite only needs
// `acceptInvitation()` to be able to create a new user's password hash;
// the real Argon2id adapter (apps/api) is exercised at the route level.
const stubPasswordHasher: PasswordHasher = {
  hash: async (plaintext) => `stub-hash(${plaintext})`,
  verify: async (hash, plaintext) => hash === `stub-hash(${plaintext})`,
};

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
    VALUES (${`${crypto.randomUUID()}@example.com`}, 'hash', 'Owner')
    RETURNING id
  `;
  return row!.id;
}

async function insertWorkspaceWithBook(): Promise<{ workspaceId: string; bookId: string }> {
  const ownerId = await insertUser();
  const [ws] = await sql<{ id: string }[]>`
    INSERT INTO workspaces (owner_id, name, slug) VALUES (${ownerId}, 'WS', ${`ws-${crypto.randomUUID()}`}) RETURNING id
  `;
  const [root] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${ws!.id}, NULL, 'workspace', '', 0, 'root', 'Root') RETURNING id
  `;
  const [shelf] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${ws!.id}, ${root!.id}, 'shelf', '', 0, 'shelf', 'Shelf') RETURNING id
  `;
  const [book] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${ws!.id}, ${shelf!.id}, 'book', '', 0, 'book', 'Book') RETURNING id
  `;
  return { workspaceId: ws!.id, bookId: book!.id };
}

async function countMembershipGrants(workspaceId: string, userId: string): Promise<number> {
  const rows = await sql<{ count: number }[]>`
    SELECT COUNT(*)::int AS count FROM permissions
     WHERE workspace_id = ${workspaceId} AND subject_type = 'user' AND subject_id = ${userId}
  `;
  return rows[0]!.count;
}

describe('createInvitation / findInvitationByToken', () => {
  test('stores the workspace, target email, and starting grants', async () => {
    const { workspaceId, bookId } = await insertWorkspaceWithBook();
    const email = `invitee-${crypto.randomUUID()}@example.com`;

    const { token } = await createInvitation(sql, {
      workspaceId,
      email,
      startingGrants: [{ resourceId: bookId, action: 'read', effect: 'allow' }],
      ttlDays: 7,
    });

    const found = await findInvitationByToken(sql, token);

    expect(found).not.toBeNull();
    expect(found!.workspaceId).toBe(workspaceId);
    expect(found!.email).toBe(email);
    expect(found!.startingGrants).toEqual([{ resourceId: bookId, action: 'read', effect: 'allow' }]);
    expect(found!.acceptedAt).toBeNull();
  });

  test('an unknown token is not found', async () => {
    expect(await findInvitationByToken(sql, 'never-issued')).toBeNull();
  });
});

describe('acceptInvitation', () => {
  test('a valid acceptance creates the user, applies starting grants, and resolves allow immediately', async () => {
    const { workspaceId, bookId } = await insertWorkspaceWithBook();
    const email = `invitee-${crypto.randomUUID()}@example.com`;
    const { token } = await createInvitation(sql, {
      workspaceId,
      email,
      startingGrants: [{ resourceId: bookId, action: 'read', effect: 'allow' }],
      ttlDays: 7,
    });

    const result = await acceptInvitation(sql, token, { password: 'a-strong-password', displayName: 'New Member' }, stubPasswordHasher);

    expect(result.outcome).toBe('ok');
    if (result.outcome !== 'ok') throw new Error('unreachable');

    const allowed = await can(createGrantLookup(sql), {
      subjectType: 'user',
      subjectId: result.userId,
      resourceId: bookId,
      action: 'read',
    });
    expect(allowed).toBe(true);
  });

  test('an expired invitation is rejected and creates no membership', async () => {
    const { workspaceId, bookId } = await insertWorkspaceWithBook();
    const email = `invitee-${crypto.randomUUID()}@example.com`;
    const { token, invitationId } = await createInvitation(sql, {
      workspaceId,
      email,
      startingGrants: [{ resourceId: bookId, action: 'read', effect: 'allow' }],
      ttlDays: 7,
    });
    await sql`UPDATE invitations SET expires_at = now() - interval '1 minute' WHERE id = ${invitationId}`;

    const result = await acceptInvitation(sql, token, { password: 'a-strong-password', displayName: 'New Member' }, stubPasswordHasher);

    expect(result.outcome).toBe('expired');
    const [user] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${email}`;
    expect(user).toBeUndefined();
  });

  test('a second acceptance on an already-accepted invitation is rejected without a duplicate membership', async () => {
    const { workspaceId, bookId } = await insertWorkspaceWithBook();
    const email = `invitee-${crypto.randomUUID()}@example.com`;
    const { token } = await createInvitation(sql, {
      workspaceId,
      email,
      startingGrants: [{ resourceId: bookId, action: 'read', effect: 'allow' }],
      ttlDays: 7,
    });

    const first = await acceptInvitation(sql, token, { password: 'a-strong-password', displayName: 'New Member' }, stubPasswordHasher);
    expect(first.outcome).toBe('ok');
    if (first.outcome !== 'ok') throw new Error('unreachable');

    const second = await acceptInvitation(sql, token, { password: 'another-password', displayName: 'New Member' }, stubPasswordHasher);

    expect(second.outcome).toBe('already-accepted');
    expect(await countMembershipGrants(workspaceId, first.userId)).toBe(1);
  });

  test('an unknown token is rejected as invalid', async () => {
    const result = await acceptInvitation(sql, 'never-issued', { password: 'x', displayName: 'X' }, stubPasswordHasher);

    expect(result.outcome).toBe('invalid');
  });
});
