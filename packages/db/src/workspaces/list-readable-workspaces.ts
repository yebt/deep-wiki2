/**
 * The workspaces a caller may open, for `GET /workspaces` — the answer to
 * "which `:id` can I put in `/workspaces/:id/tree`", which nothing told a
 * client before.
 *
 * Authorisation is the shape of the query, not a filter applied after it:
 * `readableWorkspaceIds` decides first, and this selects only inside the
 * set it returned. A workspace the caller cannot read is never fetched, so
 * it cannot be leaked by a later mistake in serialisation — the same
 * "listing without disclosure" rule the tree and backlink endpoints follow
 * (content-and-editor design.md). The two halves are separate modules
 * because `scripts/checks/query-boundaries.ts` rule 1 keeps every
 * grant-table reference inside `packages/db/src/permissions/`.
 *
 * Ordering is by name so the list does not reshuffle between requests;
 * `id` breaks the tie for two workspaces sharing a name, which
 * `workspaces.name` (unlike `slug`) does not forbid.
 */
import type postgres from 'postgres';
import type { SubjectKind } from '@deep-wiki/core';
import { readableWorkspaceIds } from '../permissions/readable-workspaces';

type SqlExecutor = postgres.Sql | postgres.TransactionSql;

export interface WorkspaceSummary {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

export interface ListReadableWorkspacesInput {
  readonly subjectType: SubjectKind;
  readonly subjectId: string;
}

export async function listReadableWorkspaces(
  sql: SqlExecutor,
  input: ListReadableWorkspacesInput,
): Promise<WorkspaceSummary[]> {
  const readable = await readableWorkspaceIds(sql, input);
  if (readable.size === 0) return [];

  const rows = await sql<{ id: string; name: string; slug: string }[]>`
    SELECT id, name, slug
      FROM workspaces
     WHERE id = ANY(${[...readable]}::uuid[])
     ORDER BY name ASC, id ASC
  `;

  return rows.map((row) => ({ id: row.id, name: row.name, slug: row.slug }));
}
