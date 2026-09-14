/**
 * The people who belong to a workspace, for its members screen.
 *
 * There is no membership table (design.md "Listing without disclosure"):
 * membership is the owner, anyone holding a grant in the workspace, and
 * anyone in one of its cells — the predicate
 * `listWorkspaceMemberCandidates` already owns for `@`-mentions. It is
 * reused rather than restated because `scripts/checks/query-boundaries.ts`
 * rule 1 keeps every `permissions` reference inside
 * `packages/db/src/permissions/`, and because two spellings of "who is a
 * member" would be two answers the moment one of them changed.
 *
 * This module adds only what a members screen needs on top of an
 * autocomplete candidate: the email that tells two "Alex"es apart, and a
 * stable order. The candidate query has no ordering and a limit; the ids
 * it returns are re-selected here in name order.
 */
import type postgres from 'postgres';
import { listWorkspaceMemberCandidates } from '../permissions/candidates';

type SqlExecutor = postgres.Sql | postgres.TransactionSql;

/**
 * Past this many members the listing is cut off. A screen that shows a
 * list this long needs search and paging, which the members screen does
 * not have yet; the bound is stated here so the cut is deliberate rather
 * than a query that happens to stop.
 */
export const WORKSPACE_MEMBERS_LIMIT = 500;

export interface WorkspaceMember {
  readonly id: string;
  readonly displayName: string;
  readonly email: string;
}

export async function listWorkspaceMembers(sql: SqlExecutor, workspaceId: string): Promise<WorkspaceMember[]> {
  const candidates = await listWorkspaceMemberCandidates(sql, { workspaceId, query: '', limit: WORKSPACE_MEMBERS_LIMIT });
  if (candidates.length === 0) return [];

  const rows = await sql<{ id: string; display_name: string; email: string }[]>`
    SELECT id, display_name, email
      FROM users
     WHERE id = ANY(${candidates.map((c) => c.id)}::uuid[])
     ORDER BY display_name ASC, id ASC
  `;
  return rows.map((row) => ({ id: row.id, displayName: row.display_name, email: row.email }));
}
