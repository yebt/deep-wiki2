/**
 * Integrity check, not a security dependency (design.md — "Reparent",
 * closing paragraph): recomputes every `path` from the authoritative
 * `parent_id` edge via a recursive CTE and returns any row where the
 * stored cache disagrees. Authorisation never reads this — it walks
 * `parent_id` directly — so this function exists purely to catch a
 * corrupted or stale cache before it misleads a subtree navigation query.
 */
import type postgres from 'postgres';

type SqlExecutor = postgres.Sql | postgres.TransactionSql;

export interface PathMismatch {
  readonly id: string;
  readonly workspaceId: string;
  readonly storedPath: string;
  readonly computedPath: string;
}

export async function verifyPaths(sql: SqlExecutor): Promise<readonly PathMismatch[]> {
  const rows = await sql<{ id: string; workspace_id: string; stored_path: string; computed_path: string }[]>`
    WITH RECURSIVE computed AS (
      SELECT id, workspace_id, '/' || id || '/' AS computed_path
        FROM nodes
       WHERE parent_id IS NULL
      UNION ALL
      SELECT n.id, n.workspace_id, c.computed_path || n.id || '/'
        FROM nodes n
        JOIN computed c ON n.parent_id = c.id AND n.workspace_id = c.workspace_id
    )
    SELECT nodes.id, nodes.workspace_id, nodes.path AS stored_path, computed.computed_path
      FROM nodes
      JOIN computed ON computed.id = nodes.id
     WHERE nodes.path <> computed.computed_path
  `;

  return rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    storedPath: row.stored_path,
    computedPath: row.computed_path,
  }));
}
