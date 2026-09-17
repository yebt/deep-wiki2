/**
 * The soft lock: acquire, heartbeat, take over, and server-evaluated
 * expiry on read (content-and-editor design.md "The soft lock, coherent
 * without presence"). No expiry column and no sweeper job — a lock is held
 * iff `heartbeat_at > now() - ttl`, which every function here computes at
 * call time. A read never writes: `readLockStatus` issues no `UPDATE`.
 *
 * `heartbeatLock`'s success path is also the ONLY place in this codebase
 * that publishes a `PresenceBroadcaster` event (editing-presence spec:
 * "Presence Has No Write Path Independent Of The Lock Heartbeat" —
 * enforced structurally by `apps/api/src/presence/single-writer.test.ts`).
 * Presence has no write path of its own to have wired anywhere else.
 */
import type { PresenceBroadcaster } from '@deep-wiki/core';
import type postgres from 'postgres';

type SqlExecutor = postgres.Sql | postgres.TransactionSql;

interface LockRow {
  holder_user_id: string;
  acquired_at: Date;
  heartbeat_at: Date;
  taken_over_from: string | null;
  taken_over_at: Date | null;
}

export interface AcquireLockInput {
  readonly nodeId: string;
  readonly workspaceId: string;
  readonly userId: string;
  readonly ttlSeconds: number;
}

export type AcquireLockResult =
  | { readonly outcome: 'acquired'; readonly holderUserId: string; readonly acquiredAt: Date; readonly heartbeatAt: Date }
  | { readonly outcome: 'held_by_other'; readonly holderUserId: string; readonly acquiredAt: Date; readonly heartbeatAt: Date };

/**
 * One atomic `INSERT ... ON CONFLICT ... RETURNING` (design.md
 * "Acquisition is one atomic statement"): the `DO UPDATE`'s `WHERE` guard
 * only fires for the current holder or an expired lock, so a concurrent
 * loser gets zero rows back rather than racing a read-then-write.
 */
export async function acquireLock(sql: SqlExecutor, input: AcquireLockInput): Promise<AcquireLockResult> {
  const rows = await sql<LockRow[]>`
    INSERT INTO page_locks (node_id, workspace_id, holder_user_id, acquired_at, heartbeat_at)
    VALUES (${input.nodeId}, ${input.workspaceId}, ${input.userId}, now(), now())
    ON CONFLICT (node_id) DO UPDATE
       SET holder_user_id = ${input.userId}, acquired_at = now(), heartbeat_at = now(),
           taken_over_from = NULL, taken_over_at = NULL
     WHERE page_locks.holder_user_id = ${input.userId}
        OR page_locks.heartbeat_at < now() - (${input.ttlSeconds} || ' seconds')::interval
    RETURNING holder_user_id, acquired_at, heartbeat_at, taken_over_from, taken_over_at
  `;

  if (rows.length === 1) {
    const row = rows[0]!;
    return { outcome: 'acquired', holderUserId: row.holder_user_id, acquiredAt: row.acquired_at, heartbeatAt: row.heartbeat_at };
  }

  const [current] = await sql<LockRow[]>`
    SELECT holder_user_id, acquired_at, heartbeat_at, taken_over_from, taken_over_at
      FROM page_locks WHERE node_id = ${input.nodeId} AND workspace_id = ${input.workspaceId}
  `;
  return {
    outcome: 'held_by_other',
    holderUserId: current!.holder_user_id,
    acquiredAt: current!.acquired_at,
    heartbeatAt: current!.heartbeat_at,
  };
}

export interface HeartbeatLockInput {
  readonly nodeId: string;
  readonly workspaceId: string;
  readonly userId: string;
  /** Optional so every existing caller keeps working unchanged; production wiring always supplies it. */
  readonly broadcaster?: PresenceBroadcaster;
}

export type HeartbeatLockResult = 'ok' | 'lost';

interface HeartbeatRow {
  node_id: string;
  acquired_at: Date;
}

/**
 * Extends the window for the caller's own held lock. Matches on
 * `holder_user_id`, so a caller displaced by a takeover gets `'lost'`
 * rather than silently reviving a lock that is no longer theirs — and,
 * critically, never publishes for a heartbeat that lost the race: a
 * displaced holder's heartbeat MUST NOT resurrect stale presence for
 * itself.
 */
export async function heartbeatLock(sql: SqlExecutor, input: HeartbeatLockInput): Promise<HeartbeatLockResult> {
  const rows = await sql<HeartbeatRow[]>`
    UPDATE page_locks SET heartbeat_at = now()
     WHERE node_id = ${input.nodeId} AND workspace_id = ${input.workspaceId} AND holder_user_id = ${input.userId}
    RETURNING node_id, acquired_at
  `;
  if (rows.length !== 1) return 'lost';

  input.broadcaster?.publish({
    workspaceId: input.workspaceId,
    pageId: input.nodeId,
    userId: input.userId,
    since: rows[0]!.acquired_at.toISOString(),
  });

  return 'ok';
}

export interface TakeOverLockInput {
  readonly nodeId: string;
  readonly workspaceId: string;
  readonly userId: string;
}

export interface TakeOverLockResult {
  readonly holderUserId: string;
  readonly acquiredAt: Date;
  readonly heartbeatAt: Date;
  readonly takenOverFrom: string | null;
  readonly takenOverAt: Date | null;
}

/**
 * The same atomic upsert as `acquireLock`, without the guard: it always
 * transfers the lock, recording the prior holder for the UI's "you took
 * this over from X" framing (design.md "Take over is explicit").
 */
export async function takeOverLock(sql: SqlExecutor, input: TakeOverLockInput): Promise<TakeOverLockResult> {
  const [row] = await sql<LockRow[]>`
    INSERT INTO page_locks (node_id, workspace_id, holder_user_id, acquired_at, heartbeat_at)
    VALUES (${input.nodeId}, ${input.workspaceId}, ${input.userId}, now(), now())
    ON CONFLICT (node_id) DO UPDATE
       SET holder_user_id = ${input.userId}, acquired_at = now(), heartbeat_at = now(),
           taken_over_from = page_locks.holder_user_id, taken_over_at = now()
    RETURNING holder_user_id, acquired_at, heartbeat_at, taken_over_from, taken_over_at
  `;
  return {
    holderUserId: row!.holder_user_id,
    acquiredAt: row!.acquired_at,
    heartbeatAt: row!.heartbeat_at,
    takenOverFrom: row!.taken_over_from,
    takenOverAt: row!.taken_over_at,
  };
}

export interface ReadLockStatusInput {
  readonly nodeId: string;
  readonly workspaceId: string;
  readonly ttlSeconds: number;
}

export type LockStatus =
  | { readonly held: false }
  | { readonly held: true; readonly holderUserId: string; readonly acquiredAt: Date; readonly heartbeatAt: Date };

/**
 * Expiry is evaluated here, on read, never stored or swept (design D15): a
 * row can physically exist past its TTL and still be reported `held:
 * false`. Issues no `UPDATE` — a read never writes. The `live_nodes` join
 * reports the same `held: false` for a trashed page, identically to no
 * lock row at all — the lock row can still physically exist pending purge,
 * but "locks" is a read surface `trash-non-disclosure` names explicitly.
 */
export async function readLockStatus(sql: SqlExecutor, input: ReadLockStatusInput): Promise<LockStatus> {
  const [row] = await sql<LockRow[]>`
    SELECT pl.holder_user_id, pl.acquired_at, pl.heartbeat_at, pl.taken_over_from, pl.taken_over_at
      FROM page_locks pl
      JOIN live_nodes ln ON ln.id = pl.node_id
     WHERE pl.node_id = ${input.nodeId} AND pl.workspace_id = ${input.workspaceId}
       AND pl.heartbeat_at > now() - (${input.ttlSeconds} || ' seconds')::interval
  `;
  if (!row) return { held: false };
  return { held: true, holderUserId: row.holder_user_id, acquiredAt: row.acquired_at, heartbeatAt: row.heartbeat_at };
}
