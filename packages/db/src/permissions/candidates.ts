/**
 * Candidate gathering for `@`-mention autocomplete
 * (`scripts/checks/query-boundaries.ts` confines every `permissions`
 * table reference to this directory, even a membership-detection query
 * like this one that never itself decides an effect).
 */
import type postgres from 'postgres';

type SqlExecutor = postgres.Sql | postgres.TransactionSql;

export interface UserCandidate {
  readonly id: string;
  readonly displayName: string;
}

export interface ListWorkspaceMemberCandidatesInput {
  readonly workspaceId: string;
  readonly query: string;
  readonly limit: number;
}

/**
 * "Workspace membership" for mention purposes: anyone with a recorded
 * grant in this workspace, a cell member, or the workspace owner — there
 * is no separate membership table yet (design.md "Listing without
 * disclosure" — User / cell mentions row).
 */
export async function listWorkspaceMemberCandidates(
  sql: SqlExecutor,
  input: ListWorkspaceMemberCandidatesInput,
): Promise<UserCandidate[]> {
  const rows = await sql<{ id: string; display_name: string }[]>`
    SELECT DISTINCT u.id, u.display_name
      FROM users u
     WHERE u.display_name ILIKE ${`${input.query}%`}
       AND (
         EXISTS (SELECT 1 FROM permissions p WHERE p.workspace_id = ${input.workspaceId} AND p.subject_type = 'user' AND p.subject_id = u.id)
         OR EXISTS (SELECT 1 FROM cell_members cm WHERE cm.workspace_id = ${input.workspaceId} AND cm.user_id = u.id)
         OR u.id = (SELECT owner_id FROM workspaces WHERE id = ${input.workspaceId})
       )
     LIMIT ${input.limit}
  `;
  return rows.map((row) => ({ id: row.id, displayName: row.display_name }));
}
