/**
 * "Which workspaces may this subject read anything in" — the question
 * `GET /workspaces` asks so a client can be told which `:id` to put in
 * `/workspaces/:id/tree`. It lives here, beside `can-many.ts`, because
 * `scripts/checks/query-boundaries.ts` rule 1 confines every reference to
 * the grant table to this one directory: `decide()` stays the single
 * decision path, and a list endpoint does not get a second one.
 *
 * **Why this needs no ancestor walk, and is still exact.** A workspace is
 * visible when at least one node in it is readable. Write R for a node
 * carrying grants of its own. Then:
 *
 *   - if `decide(direct grants on R)` is `allow`, R is readable — depth 0
 *     is necessarily the minimum depth at which R has any grant, so the
 *     fold at that depth *is* the fold over R's own rows;
 *   - conversely, if some node N is readable, `decide()` resolved it at
 *     the minimum depth where N's ancestor chain carries grants, and the
 *     grants at that depth are exactly the direct grants of that ancestor
 *     R. So `decide(direct grants on R)` is `allow`.
 *
 * "Some node is readable" and "some *granted* node is readable" are
 * therefore the same statement, and the second needs only the grant rows
 * themselves. `canManyResources` recurses because it is asked about named
 * candidate resources, most of which carry no grants; this is asked about
 * the grants.
 *
 * Tenancy: a grant is joined to its resource on **both** `(id,
 * workspace_id)` columns, and a cell membership on both of its own, which
 * is the same composite key the schema enforces
 * (`permissions_resource_fk`, `cell_members_cell_fk`). A cross-tenant row
 * is already unrepresentable — `packages/db/src/schema.test.ts` holds that
 * — and this query does not become the one place that reaches around it.
 */
import { decideMany, impliedAllowActions, impliedDenyActions, type Effect, type ResolvedGrant, type SubjectKind } from '@deep-wiki/core';
import type postgres from 'postgres';

type SqlExecutor = postgres.Sql | postgres.TransactionSql;

interface GrantRow {
  workspace_id: string;
  resource_id: string;
  effect: Effect;
}

export interface ReadableWorkspaceIdsInput {
  readonly subjectType: SubjectKind;
  readonly subjectId: string;
}

/** The workspaces in which this subject can read at least one node. */
export async function readableWorkspaceIds(sql: SqlExecutor, input: ReadableWorkspaceIdsInput): Promise<Set<string>> {
  // The same action lattice `canManyResources` uses: an allow at or above
  // `read` allows reading, a deny at or below it denies it.
  const allowActions = impliedDenyActions('read');
  const denyActions = impliedAllowActions('read');

  const rows = await sql<GrantRow[]>`
    WITH subjects AS (
        SELECT ${input.subjectType}::subject_kind AS subject_type,
               ${input.subjectId}::uuid          AS subject_id,
               NULL::uuid                        AS member_of
        UNION ALL
        SELECT 'cell'::subject_kind, cm.cell_id, cm.workspace_id
          FROM cell_members cm
         WHERE ${input.subjectType}::subject_kind = 'user'
           AND cm.user_id = ${input.subjectId}::uuid
    )
    SELECT DISTINCT p.workspace_id, p.resource_id, p.effect
      FROM permissions p
      JOIN nodes n    ON n.id = p.resource_id
                     AND n.workspace_id = p.workspace_id
      JOIN subjects s ON s.subject_type = p.subject_type
                     AND s.subject_id   = p.subject_id
                     AND (s.member_of IS NULL OR s.member_of = p.workspace_id)
     WHERE (p.effect = 'allow' AND p.action = ANY(${allowActions}::perm_action[]))
        OR (p.effect = 'deny'  AND p.action = ANY(${denyActions}::perm_action[]))
  `;

  // One group per granted resource, keyed by tenant *and* resource so two
  // tenants can never fold into one another's decision.
  const groups = new Map<string, ResolvedGrant[]>();
  const workspaceOf = new Map<string, string>();
  for (const row of rows) {
    const key = `${row.workspace_id}/${row.resource_id}`;
    workspaceOf.set(key, row.workspace_id);
    const grants = groups.get(key);
    if (grants) grants.push({ depth: 0, effect: row.effect });
    else groups.set(key, [{ depth: 0, effect: row.effect }]);
  }

  const readable = new Set<string>();
  for (const [key, effect] of decideMany(groups)) {
    if (effect === 'allow') readable.add(workspaceOf.get(key)!);
  }
  return readable;
}
