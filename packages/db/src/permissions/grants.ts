/**
 * The one write path to `permissions` outside the resolver's own read
 * path (`scripts/checks/query-boundaries.ts` enforces this directory as
 * the sole place any code may reference the `permissions` table). Used by
 * invitation acceptance to apply a set of starting grants atomically with
 * everything else the acceptance does.
 */
import type { Action, Effect, SubjectKind } from '@deep-wiki/core';
import type postgres from 'postgres';

export interface GrantInput {
  readonly resourceId: string;
  readonly action: Action;
  readonly effect: Effect;
}

type SqlExecutor = postgres.Sql | postgres.TransactionSql;

export async function insertGrants(
  sql: SqlExecutor,
  workspaceId: string,
  subjectType: SubjectKind,
  subjectId: string,
  grants: readonly GrantInput[],
): Promise<void> {
  for (const grant of grants) {
    await sql`
      INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
      VALUES (${workspaceId}, ${subjectType}::subject_kind, ${subjectId}, ${grant.resourceId}, ${grant.action}::perm_action, ${grant.effect}::perm_effect)
      ON CONFLICT DO NOTHING
    `;
  }
}
