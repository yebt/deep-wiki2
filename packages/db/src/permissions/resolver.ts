/**
 * The recursive-CTE grant lookup (GATE-1) — design.md "The permission
 * resolver", SQL half. `can()` is the single decision point
 * (`scripts/checks/query-boundaries.ts` enforces that no file outside
 * this directory may reference the `permissions` table).
 *
 * Ancestors are walked through `parent_id`, never through `path` (D5):
 * authorisation must not depend on a denormalised cache. Depth is bounded
 * at five and each step is a primary-key lookup. `subjects` expands the
 * cell-membership union arm inside the RESOURCE's own workspace, which is
 * what keeps a foreign-workspace cell membership from ever resolving.
 *
 * Bounded output: 2 effects x <=5 depths = at most 10 rows, so
 * `packages/core`'s `decide()` fold is free. There is no ORDER BY, LIMIT,
 * or CASE here — SQL gathers, `decide()` decides (D7).
 */
import type { Action, Effect, ResolvedGrant, SubjectKind } from '@deep-wiki/core';
import type postgres from 'postgres';

type SqlExecutor = postgres.Sql | postgres.TransactionSql;

export interface ResolveGrantsInput {
  readonly resourceId: string;
  readonly subjectType: SubjectKind;
  readonly subjectId: string;
  readonly allowActions: readonly Action[];
  readonly denyActions: readonly Action[];
}

export async function resolveGrants(sql: SqlExecutor, input: ResolveGrantsInput): Promise<readonly ResolvedGrant[]> {
  const rows = await sql<{ effect: Effect; depth: number }[]>`
    WITH RECURSIVE ancestors AS (
        SELECT n.id, n.workspace_id, n.parent_id, 0 AS depth
          FROM nodes n
         WHERE n.id = ${input.resourceId}
        UNION ALL
        SELECT p.id, p.workspace_id, p.parent_id, a.depth + 1
          FROM nodes p
          JOIN ancestors a ON p.id = a.parent_id
         WHERE p.workspace_id = a.workspace_id
    ),
    subjects AS (
        SELECT ${input.subjectType}::subject_kind AS subject_type, ${input.subjectId}::uuid AS subject_id
        UNION ALL
        SELECT 'cell'::subject_kind, cm.cell_id
          FROM cell_members cm
         WHERE ${input.subjectType}::subject_kind = 'user'
           AND cm.user_id = ${input.subjectId}::uuid
           AND cm.workspace_id = (SELECT workspace_id FROM nodes WHERE id = ${input.resourceId})
    )
    SELECT DISTINCT p.effect, a.depth
      FROM permissions p
      JOIN ancestors a ON a.id = p.resource_id
                      AND a.workspace_id = p.workspace_id
      JOIN subjects  s ON s.subject_type = p.subject_type
                      AND s.subject_id   = p.subject_id
     WHERE (p.effect = 'allow' AND p.action = ANY(${input.allowActions}::perm_action[]))
        OR (p.effect = 'deny'  AND p.action = ANY(${input.denyActions}::perm_action[]))
  `;

  return rows.map((row) => ({ depth: row.depth, effect: row.effect }));
}
