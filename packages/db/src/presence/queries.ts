/**
 * The `presence` view read path (versioning-and-collaboration design.md
 * Decision 5, "Presence is a view, not a table"; editing-presence spec).
 * TTL is evaluated here on every read, exactly as `readLockStatus`
 * evaluates it for the lock itself — a row can physically exist past its
 * TTL and still be reported as no active presence. No separate presence
 * TTL column, constant, or sweeper exists anywhere in this module.
 */
import type postgres from 'postgres';

type SqlExecutor = postgres.Sql | postgres.TransactionSql;

export interface PresenceRow {
  readonly pageId: string;
  readonly workspaceId: string;
  readonly userId: string;
  /** When the underlying lock (and therefore this presence) began — `page_locks.acquired_at`. */
  readonly since: Date;
  readonly heartbeatAt: Date;
}

interface PresenceViewRow {
  page_id: string;
  workspace_id: string;
  user_id: string;
  since: Date;
  heartbeat_at: Date;
}

export interface ListActivePresenceInput {
  readonly workspaceId: string;
  readonly ttlSeconds: number;
}

/** Every currently-active `editing` presence in one workspace, newest heartbeat first is not guaranteed — callers that need an order sort themselves. */
export async function listActivePresence(sql: SqlExecutor, input: ListActivePresenceInput): Promise<PresenceRow[]> {
  const rows = await sql<PresenceViewRow[]>`
    SELECT page_id, workspace_id, user_id, since, heartbeat_at
      FROM presence
     WHERE workspace_id = ${input.workspaceId}
       AND heartbeat_at > now() - (${input.ttlSeconds} || ' seconds')::interval
  `;
  return rows.map((row) => ({
    pageId: row.page_id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    since: row.since,
    heartbeatAt: row.heartbeat_at,
  }));
}
