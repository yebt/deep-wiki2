/**
 * The append-only book history trace (deletion-trace spec; design.md
 * Decision 5). `node_deletions` has no FK to the node itself — the node is
 * purged and this row stays, which is the entire point of a trace — and a
 * `BEFORE UPDATE` trigger (`0022_trash.sql`) refuses any edit, so this
 * module only ever `INSERT`s.
 *
 * `appendTrace()` is a plain writer: the `trashed` event's `bookId` and
 * `restricted` snapshot are resolved by its caller (`trash-node.ts`, which
 * reuses `resolveBookId()` — the same ancestor walk `insert-revision.ts`
 * already runs — while the node is still live, before propagation clears
 * it from `live_nodes`). `restored`/`purged` events instead copy `bookId`,
 * `restricted`, `title` and `location` from the operation's own `trashed`
 * row via `findTrashedTrace()`, rather than walking ancestors again — by
 * the time a node is restored its ancestry may have changed, and by the
 * time it is purged its row is about to be deleted entirely.
 */
import type { NodeType } from '@deep-wiki/core';
import type postgres from 'postgres';

type SqlExecutor = postgres.Sql | postgres.TransactionSql;

export type TraceEvent = 'trashed' | 'restored' | 'purged';

export interface AppendTraceInput {
  readonly workspaceId: string;
  /** `null` for a shelf (no book ancestor) — the trace still belongs to the workspace, and no screen shows it yet (recorded Finding). */
  readonly bookId: string | null;
  readonly nodeId: string;
  readonly nodeType: NodeType;
  readonly title: string;
  readonly location: string;
  readonly event: TraceEvent;
  readonly trashOperationId: string;
  readonly actorId: string | null;
  readonly pageCount: number;
  readonly restricted: boolean;
}

export async function appendTrace(sql: SqlExecutor, input: AppendTraceInput): Promise<void> {
  await sql`
    INSERT INTO node_deletions (
      workspace_id, book_id, node_id, node_type, title, location,
      event, trash_operation_id, actor_id, page_count, restricted
    )
    VALUES (
      ${input.workspaceId}, ${input.bookId}, ${input.nodeId}, ${input.nodeType}::node_type, ${input.title}, ${input.location},
      ${input.event}, ${input.trashOperationId}, ${input.actorId}, ${input.pageCount}, ${input.restricted}
    )
  `;
}

export interface TrashedTraceRow {
  readonly bookId: string | null;
  readonly nodeType: NodeType;
  readonly title: string;
  readonly location: string;
  readonly pageCount: number;
  readonly restricted: boolean;
}

/**
 * The exact `trashed` row for this node and operation — never "the most
 * recent trashed row for this node", which would silently reuse a stale
 * snapshot if the node had ever been trashed and restored before under a
 * different operation.
 */
export async function findTrashedTrace(sql: SqlExecutor, input: { readonly nodeId: string; readonly trashOperationId: string }): Promise<TrashedTraceRow | null> {
  const [row] = await sql<
    { book_id: string | null; node_type: NodeType; title: string; location: string; page_count: number; restricted: boolean }[]
  >`
    SELECT book_id, node_type, title, location, page_count, restricted
      FROM node_deletions
     WHERE node_id = ${input.nodeId} AND trash_operation_id = ${input.trashOperationId} AND event = 'trashed'
     LIMIT 1
  `;
  if (!row) return null;
  return {
    bookId: row.book_id,
    nodeType: row.node_type,
    title: row.title,
    location: row.location,
    pageCount: row.page_count,
    restricted: row.restricted,
  };
}
