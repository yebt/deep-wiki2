import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { PresenceBroadcaster, PresenceEvent } from '@deep-wiki/core';
import postgres from 'postgres';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '../../testing/provision';
import { acquireLock, heartbeatLock, readLockStatus, takeOverLock } from './page-lock';

class RecordingBroadcaster implements PresenceBroadcaster {
  readonly published: PresenceEvent[] = [];
  publish(event: PresenceEvent): void {
    this.published.push(event);
  }
  subscribe(): () => void {
    return () => {};
  }
}

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

async function seedPageWithContent(): Promise<{ workspaceId: string; nodeId: string; userA: string; userB: string }> {
  const [plan] = await sql`
    INSERT INTO plans (name, max_workspaces, max_seats, max_storage_bytes, max_ai_tokens_monthly)
    VALUES (${`plan-${crypto.randomUUID()}`}, 3, 5, '1000000', '1000') RETURNING id
  `;
  const [owner] = await sql`
    INSERT INTO users (email, password_hash, display_name, plan_id)
    VALUES (${`owner-${crypto.randomUUID()}@example.com`}, 'hash', 'Owner', ${plan!.id}) RETURNING id
  `;
  const [userA] = await sql`
    INSERT INTO users (email, password_hash, display_name) VALUES (${`a-${crypto.randomUUID()}@example.com`}, 'hash', 'A') RETURNING id
  `;
  const [userB] = await sql`
    INSERT INTO users (email, password_hash, display_name) VALUES (${`b-${crypto.randomUUID()}@example.com`}, 'hash', 'B') RETURNING id
  `;
  const [workspace] = await sql`
    INSERT INTO workspaces (owner_id, name, slug) VALUES (${owner!.id}, 'Acme', ${`acme-${crypto.randomUUID()}`}) RETURNING id
  `;
  const [root] = await sql`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${workspace!.id}, NULL, 'workspace', '', 0, 'root', 'Root') RETURNING id
  `;
  const [page] = await sql`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${workspace!.id}, ${root!.id}, 'page', '', 0, ${`page-${crypto.randomUUID()}`}, 'A Page') RETURNING id
  `;
  await sql`
    INSERT INTO page_content (node_id, workspace_id, markdown, content_hash)
    VALUES (${page!.id}, ${workspace!.id}, '# Hello', 'hash-1')
  `;
  return { workspaceId: workspace!.id as string, nodeId: page!.id as string, userA: userA!.id as string, userB: userB!.id as string };
}

/**
 * The same tree with no `page_content` row at all — a page the navigation
 * tree has created and nobody has saved yet. `page_locks` pointed its
 * composite foreign key at `page_content` until 0023, so seeding this shape
 * and taking a lock on it raised a foreign-key violation; no fixture in
 * this file could produce it, which is why the coupling survived until the
 * read route stopped answering 404 for a never-saved page (docs/TODO.md
 * Findings, 2026-09-23).
 */
async function seedPageNeverSaved(): Promise<{ workspaceId: string; nodeId: string; userA: string; userB: string }> {
  const seeded = await seedPageWithContent();
  await sql`DELETE FROM page_content WHERE node_id = ${seeded.nodeId}`;
  return seeded;
}

// document-modes: Edit Mode Acquires A Soft Lock On Entry; Heartbeat Keeps
// The Lock Alive; Lock Expiry Is Evaluated Server-Side On Read.
describe('acquireLock', () => {
  test('the first entry with no active lock creates one naming the holder', async () => {
    const { workspaceId, nodeId, userA } = await seedPageWithContent();

    const result = await acquireLock(sql, { nodeId, workspaceId, userId: userA, ttlSeconds: TTL_SECONDS });

    expect(result.outcome).toBe('acquired');
    if (result.outcome === 'acquired') {
      expect(result.holderUserId).toBe(userA);
    }
  });

  test('a page that has never been saved can still be locked', async () => {
    const { workspaceId, nodeId, userA } = await seedPageNeverSaved();

    const result = await acquireLock(sql, { nodeId, workspaceId, userId: userA, ttlSeconds: TTL_SECONDS });

    expect(result.outcome).toBe('acquired');
    const [row] = await sql<{ holder_user_id: string }[]>`SELECT holder_user_id FROM page_locks WHERE node_id = ${nodeId}`;
    expect(row!.holder_user_id).toBe(userA);
  });

  // The lock is on the node, but only on a node that may hold content: the
  // key 0023 moved to still pins the node's type, so a chapter cannot be
  // locked even though it is a perfectly good node.
  test('a node that is not a page cannot be locked', async () => {
    const { workspaceId, nodeId, userA } = await seedPageNeverSaved();
    const [chapter] = await sql<{ id: string }[]>`
      INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
      SELECT ${workspaceId}, parent_id, 'chapter', '', 1, ${`chapter-${crypto.randomUUID()}`}, 'A Chapter'
        FROM nodes WHERE id = ${nodeId}
      RETURNING id
    `;

    await expect(acquireLock(sql, { nodeId: chapter!.id, workspaceId, userId: userA, ttlSeconds: TTL_SECONDS })).rejects.toThrow();
  });

  test('a second user cannot silently seize an active lock', async () => {
    const { workspaceId, nodeId, userA, userB } = await seedPageWithContent();
    await acquireLock(sql, { nodeId, workspaceId, userId: userA, ttlSeconds: TTL_SECONDS });

    const result = await acquireLock(sql, { nodeId, workspaceId, userId: userB, ttlSeconds: TTL_SECONDS });

    expect(result.outcome).toBe('held_by_other');
    if (result.outcome === 'held_by_other') {
      expect(result.holderUserId).toBe(userA);
    }
  });

  test('acquiring again as the current holder refreshes the lock rather than being rejected', async () => {
    const { workspaceId, nodeId, userA } = await seedPageWithContent();
    await acquireLock(sql, { nodeId, workspaceId, userId: userA, ttlSeconds: TTL_SECONDS });

    const result = await acquireLock(sql, { nodeId, workspaceId, userId: userA, ttlSeconds: TTL_SECONDS });

    expect(result.outcome).toBe('acquired');
  });

  test('an expired lock (heartbeat past TTL) is silently reacquirable by a new holder', async () => {
    const { workspaceId, nodeId, userA, userB } = await seedPageWithContent();
    await acquireLock(sql, { nodeId, workspaceId, userId: userA, ttlSeconds: TTL_SECONDS });
    // Simulate a lock left behind by a closed laptop: heartbeat well in the past.
    await sql`UPDATE page_locks SET heartbeat_at = now() - interval '1 hour' WHERE node_id = ${nodeId}`;

    const result = await acquireLock(sql, { nodeId, workspaceId, userId: userB, ttlSeconds: TTL_SECONDS });

    expect(result.outcome).toBe('acquired');
    if (result.outcome === 'acquired') {
      expect(result.holderUserId).toBe(userB);
    }
  });

  test('two concurrent acquisitions: the atomic guard returns zero rows for the loser', async () => {
    const { workspaceId, nodeId, userA, userB } = await seedPageWithContent();

    const [resultA, resultB] = await Promise.all([
      acquireLock(sql, { nodeId, workspaceId, userId: userA, ttlSeconds: TTL_SECONDS }),
      acquireLock(sql, { nodeId, workspaceId, userId: userB, ttlSeconds: TTL_SECONDS }),
    ]);

    const outcomes = [resultA.outcome, resultB.outcome].sort();
    expect(outcomes).toEqual(['acquired', 'held_by_other']);
  });
});

describe('heartbeatLock', () => {
  test('a heartbeat before expiry extends the window', async () => {
    const { workspaceId, nodeId, userA } = await seedPageWithContent();
    await acquireLock(sql, { nodeId, workspaceId, userId: userA, ttlSeconds: TTL_SECONDS });

    const result = await heartbeatLock(sql, { nodeId, workspaceId, userId: userA });

    expect(result).toBe('ok');
    const status = await readLockStatus(sql, { nodeId, workspaceId, ttlSeconds: TTL_SECONDS });
    expect(status.held).toBe(true);
  });

  test("the prior holder's next heartbeat returns lost after a takeover", async () => {
    const { workspaceId, nodeId, userA, userB } = await seedPageWithContent();
    await acquireLock(sql, { nodeId, workspaceId, userId: userA, ttlSeconds: TTL_SECONDS });
    await takeOverLock(sql, { nodeId, workspaceId, userId: userB });

    const result = await heartbeatLock(sql, { nodeId, workspaceId, userId: userA });

    expect(result).toBe('lost');
  });

  // editing-presence spec: "Presence Has No Write Path Independent Of The
  // Lock Heartbeat" — every presence refresh originates from this exact
  // request, in the same operation as the heartbeat itself.
  test('a successful heartbeat publishes a presence event in the same operation', async () => {
    const { workspaceId, nodeId, userA } = await seedPageWithContent();
    const lock = await acquireLock(sql, { nodeId, workspaceId, userId: userA, ttlSeconds: TTL_SECONDS });
    const broadcaster = new RecordingBroadcaster();

    const result = await heartbeatLock(sql, { nodeId, workspaceId, userId: userA, broadcaster });

    expect(result).toBe('ok');
    expect(broadcaster.published).toHaveLength(1);
    expect(broadcaster.published[0]).toEqual({
      workspaceId,
      pageId: nodeId,
      userId: userA,
      since: lock.acquiredAt.toISOString(),
    });
  });

  test('a heartbeat that loses the lock (displaced by a takeover) never publishes', async () => {
    const { workspaceId, nodeId, userA, userB } = await seedPageWithContent();
    await acquireLock(sql, { nodeId, workspaceId, userId: userA, ttlSeconds: TTL_SECONDS });
    await takeOverLock(sql, { nodeId, workspaceId, userId: userB });
    const broadcaster = new RecordingBroadcaster();

    const result = await heartbeatLock(sql, { nodeId, workspaceId, userId: userA, broadcaster });

    expect(result).toBe('lost');
    expect(broadcaster.published).toHaveLength(0);
  });

  test('omitting the broadcaster is safe — heartbeating still succeeds with no publish attempted', async () => {
    const { workspaceId, nodeId, userA } = await seedPageWithContent();
    await acquireLock(sql, { nodeId, workspaceId, userId: userA, ttlSeconds: TTL_SECONDS });

    const result = await heartbeatLock(sql, { nodeId, workspaceId, userId: userA });

    expect(result).toBe('ok');
  });
});

// document-modes: "Take Over" transfers the lock; Read-Only Entry Takes No
// Lock.
describe('takeOverLock', () => {
  test('take-over transfers the holder unconditionally, recording who it came from', async () => {
    const { workspaceId, nodeId, userA, userB } = await seedPageWithContent();
    await acquireLock(sql, { nodeId, workspaceId, userId: userA, ttlSeconds: TTL_SECONDS });

    const result = await takeOverLock(sql, { nodeId, workspaceId, userId: userB });

    expect(result.holderUserId).toBe(userB);
    expect(result.takenOverFrom).toBe(userA);
  });
});

describe('readLockStatus', () => {
  test('read-only entry takes no lock and leaves an existing lock unchanged', async () => {
    const { workspaceId, nodeId, userA } = await seedPageWithContent();
    const acquired = await acquireLock(sql, { nodeId, workspaceId, userId: userA, ttlSeconds: TTL_SECONDS });
    if (acquired.outcome !== 'acquired') throw new Error('expected acquisition to succeed');

    const before = await readLockStatus(sql, { nodeId, workspaceId, ttlSeconds: TTL_SECONDS });
    const after = await readLockStatus(sql, { nodeId, workspaceId, ttlSeconds: TTL_SECONDS });

    expect(before).toEqual(after);
    if (before.held) {
      expect(before.holderUserId).toBe(userA);
    }
  });

  test('a lock heartbeated past TTL is reported expired on read, with no sweeper job', async () => {
    const { workspaceId, nodeId, userA } = await seedPageWithContent();
    await acquireLock(sql, { nodeId, workspaceId, userId: userA, ttlSeconds: TTL_SECONDS });
    await sql`UPDATE page_locks SET heartbeat_at = now() - interval '1 hour' WHERE node_id = ${nodeId}`;

    const status = await readLockStatus(sql, { nodeId, workspaceId, ttlSeconds: TTL_SECONDS });

    expect(status.held).toBe(false);
  });

  test('no lock row at all is reported not held', async () => {
    const { workspaceId, nodeId } = await seedPageWithContent();

    const status = await readLockStatus(sql, { nodeId, workspaceId, ttlSeconds: TTL_SECONDS });

    expect(status.held).toBe(false);
  });

  // trash-non-disclosure spec: "locks" is a named read surface — a trashed
  // page's lock reports not held, identically to no lock at all, even
  // though the row itself is still physically present pending purge.
  test('a trashed page reports not held, identically to no lock at all', async () => {
    const { workspaceId, nodeId, userA } = await seedPageWithContent();
    await acquireLock(sql, { nodeId, workspaceId, userId: userA, ttlSeconds: TTL_SECONDS });
    await sql`UPDATE nodes SET trashed_at = now(), trash_operation_id = ${crypto.randomUUID()} WHERE id = ${nodeId}`;

    const status = await readLockStatus(sql, { nodeId, workspaceId, ttlSeconds: TTL_SECONDS });

    expect(status.held).toBe(false);
  });
});
