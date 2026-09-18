/**
 * `listBookDeletions()` — the `node_deletions` half of `GET
 * /books/:id/history` (changesets spec: "Book-Level History Is One Query";
 * deletion-trace spec: "Book History Surfaces The Trace Line"). Returns
 * every trace row for the book, unfiltered: the `restricted` disclosure
 * rule (design.md Decision 5, "Disclosure") is a permissions concern this
 * function does not own — `apps/api/src/routes/revisions.ts` filters it,
 * exactly as it already filters `changesets`' revisions through
 * `readableResourceIds` rather than this module deciding visibility.
 */
import type { NodeType } from '@deep-wiki/core';
import type postgres from 'postgres';

type SqlExecutor = postgres.Sql | postgres.TransactionSql;

export interface ListBookDeletionsInput {
  readonly bookId: string;
  readonly workspaceId: string;
}

export interface BookDeletionRow {
  readonly id: string;
  readonly nodeId: string;
  readonly nodeType: NodeType;
  readonly title: string;
  readonly event: 'trashed' | 'restored' | 'purged';
  readonly actorId: string | null;
  readonly actorDisplayName: string | null;
  readonly occurredAt: Date;
  readonly restricted: boolean;
}

interface Row {
  id: string;
  node_id: string;
  node_type: NodeType;
  title: string;
  event: 'trashed' | 'restored' | 'purged';
  actor_id: string | null;
  actor_display_name: string | null;
  occurred_at: Date;
  restricted: boolean;
}

/** Newest first, matching `listBookHistory()`'s own ordering for the same screen. */
export async function listBookDeletions(sql: SqlExecutor, input: ListBookDeletionsInput): Promise<readonly BookDeletionRow[]> {
  const rows = await sql<Row[]>`
    SELECT d.id, d.node_id, d.node_type, d.title, d.event, d.actor_id, u.display_name AS actor_display_name, d.occurred_at, d.restricted
      FROM node_deletions d
      LEFT JOIN users u ON u.id = d.actor_id
     WHERE d.workspace_id = ${input.workspaceId} AND d.book_id = ${input.bookId}
     ORDER BY d.occurred_at DESC
  `;

  return rows.map((row) => ({
    id: row.id,
    nodeId: row.node_id,
    nodeType: row.node_type,
    title: row.title,
    event: row.event,
    actorId: row.actor_id,
    actorDisplayName: row.actor_display_name,
    occurredAt: row.occurred_at,
    restricted: row.restricted,
  }));
}
