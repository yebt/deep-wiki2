/**
 * The `presence` view read path (editing-presence spec: "Presence
 * Surfaces Who And Since When"; "Stale Presence Expires Visibly, Tied To
 * The Lock TTL"). TTL is evaluated on read, exactly as `readLockStatus`
 * does for the lock itself — no separate presence TTL column or constant
 * exists anywhere in this module.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '../../testing/provision';
import { acquireLock } from '../locks/page-lock';
import { listActivePresence } from './queries';

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

const TTL_SECONDS = 120;

async function seedPage(): Promise<{ workspaceId: string; pageId: string; userId: string }> {
  const [owner] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name) VALUES (${`owner-${crypto.randomUUID()}@example.com`}, 'hash', 'Owner') RETURNING id
  `;
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name) VALUES (${`editor-${crypto.randomUUID()}@example.com`}, 'hash', 'Editor') RETURNING id
  `;
  const [ws] = await sql<{ id: string }[]>`
    INSERT INTO workspaces (owner_id, name, slug) VALUES (${owner!.id}, 'WS', ${`ws-${crypto.randomUUID()}`}) RETURNING id
  `;
  const [root] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${ws!.id}, NULL, 'workspace', '', 0, 'root', 'Root') RETURNING id
  `;
  const [page] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${ws!.id}, ${root!.id}, 'page', '', 0, ${`page-${crypto.randomUUID()}`}, 'A Page') RETURNING id
  `;
  await sql`
    INSERT INTO page_content (node_id, workspace_id, markdown, content_hash)
    VALUES (${page!.id}, ${ws!.id}, '# Hello', 'hash-1')
  `;
  return { workspaceId: ws!.id as string, pageId: page!.id as string, userId: user!.id as string };
}

describe('listActivePresence', () => {
  test('surfaces the editor and since-when for an active lock', async () => {
    const { workspaceId, pageId, userId } = await seedPage();
    const lock = await acquireLock(sql, { nodeId: pageId, workspaceId, userId, ttlSeconds: TTL_SECONDS });

    const rows = await listActivePresence(sql, { workspaceId, ttlSeconds: TTL_SECONDS });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.pageId).toBe(pageId);
    expect(rows[0]?.userId).toBe(userId);
    expect(rows[0]?.since.getTime()).toBe(lock.acquiredAt.getTime());
  });

  test('an expired lock reports no active presence, evaluated against the same TTL the lock itself uses', async () => {
    const { workspaceId, pageId, userId } = await seedPage();
    await acquireLock(sql, { nodeId: pageId, workspaceId, userId, ttlSeconds: TTL_SECONDS });
    // Simulate a heartbeat old enough to have expired under a short TTL —
    // no separate presence TTL exists to fake here, only the lock's own
    // heartbeat_at, which is exactly what the view (and this query) reads.
    await sql`UPDATE page_locks SET heartbeat_at = now() - interval '1000 seconds' WHERE node_id = ${pageId}`;

    const rows = await listActivePresence(sql, { workspaceId, ttlSeconds: TTL_SECONDS });

    expect(rows).toHaveLength(0);
  });

  test('presence for one workspace never includes another workspace\'s page', async () => {
    const a = await seedPage();
    const b = await seedPage();
    await acquireLock(sql, { nodeId: a.pageId, workspaceId: a.workspaceId, userId: a.userId, ttlSeconds: TTL_SECONDS });
    await acquireLock(sql, { nodeId: b.pageId, workspaceId: b.workspaceId, userId: b.userId, ttlSeconds: TTL_SECONDS });

    const rows = await listActivePresence(sql, { workspaceId: a.workspaceId, ttlSeconds: TTL_SECONDS });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.pageId).toBe(a.pageId);
  });

  // trash-non-disclosure spec: "presence" is a named read surface — a
  // trashed page's presence row is absent, identically to no active lock.
  test('excludes presence for a now-trashed page', async () => {
    const { workspaceId, pageId, userId } = await seedPage();
    await acquireLock(sql, { nodeId: pageId, workspaceId, userId, ttlSeconds: TTL_SECONDS });
    await sql`UPDATE nodes SET trashed_at = now(), trash_operation_id = ${crypto.randomUUID()} WHERE id = ${pageId}`;

    const rows = await listActivePresence(sql, { workspaceId, ttlSeconds: TTL_SECONDS });

    expect(rows).toHaveLength(0);
  });
});
