/**
 * Set-shaped resolution for list endpoints (content-and-editor design.md
 * "Listing without disclosure"): backlinks, mentions, tags and the tree
 * all need "which of these N may this subject read" — answered here by one
 * recursive CTE per call, folded through `decideMany()`, never by looping
 * Phase 1's singular `can()` over each candidate (which would be N+1).
 *
 * `scripts/checks/query-boundaries.ts`'s single-decision-path rule already
 * confines every `permissions` table reference to this directory; these
 * two functions extend that same directory rather than opening a second one.
 */
import { decideMany, impliedAllowActions, impliedDenyActions, type Action, type Effect, type ResolvedGrant, type SubjectKind } from '@deep-wiki/core';
import type postgres from 'postgres';

type SqlExecutor = postgres.Sql | postgres.TransactionSql;

interface OriginRow {
  origin_id: string;
  effect: Effect;
  depth: number;
}

export interface CanManyResourcesInput {
  readonly workspaceId: string;
  readonly subjectType: SubjectKind;
  readonly subjectId: string;
  readonly action: Action;
  readonly resourceIds: readonly string[];
}

/**
 * "Which of `resourceIds` may this one subject act on" — Phase 1's
 * recursive CTE, its ancestor arm seeded from `unnest($resourceIds)`
 * carrying an `origin_id` through the walk, exactly as design.md
 * describes. Bounded at ≤10 rows per candidate (2 effects × ≤5 depths),
 * the same bound Phase 1 already established for a single resource — one
 * statement, no `ORDER BY`, no `CASE`; `decide()` still decides.
 */
export async function canManyResources(sql: SqlExecutor, input: CanManyResourcesInput): Promise<Set<string>> {
  if (input.resourceIds.length === 0) return new Set();

  const allowActions = impliedDenyActions(input.action);
  const denyActions = impliedAllowActions(input.action);

  const rows = await sql<OriginRow[]>`
    WITH RECURSIVE ancestors AS (
        SELECT n.id, n.workspace_id, n.parent_id, 0 AS depth, n.id AS origin_id
          FROM nodes n
         WHERE n.id = ANY(${input.resourceIds}::uuid[]) AND n.workspace_id = ${input.workspaceId}
        UNION ALL
        SELECT p.id, p.workspace_id, p.parent_id, a.depth + 1, a.origin_id
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
           AND cm.workspace_id = ${input.workspaceId}
    )
    SELECT DISTINCT a.origin_id, p.effect, a.depth
      FROM permissions p
      JOIN ancestors a ON a.id = p.resource_id
                      AND a.workspace_id = p.workspace_id
      JOIN subjects  s ON s.subject_type = p.subject_type
                      AND s.subject_id   = p.subject_id
     WHERE (p.effect = 'allow' AND p.action = ANY(${allowActions}::perm_action[]))
        OR (p.effect = 'deny'  AND p.action = ANY(${denyActions}::perm_action[]))
  `;

  const groups = new Map<string, ResolvedGrant[]>();
  for (const id of input.resourceIds) groups.set(id, []);
  for (const row of rows) {
    groups.get(row.origin_id)?.push({ depth: row.depth, effect: row.effect });
  }

  const decided = decideMany(groups);
  const readable = new Set<string>();
  for (const [id, effect] of decided) {
    if (effect === 'allow') readable.add(id);
  }
  return readable;
}

export interface CanManySubjectsInput {
  readonly workspaceId: string;
  readonly resourceId: string;
  readonly action: Action;
  readonly subjectIds: readonly string[];
}

interface SubjectOriginRow {
  origin_id: string;
  effect: Effect;
  depth: number;
}

/**
 * Inverts `canManyResources`: one resource's own ancestor chain against an
 * expanded candidate-subject set (each candidate plus their own cell
 * memberships within `workspaceId`), used for `@`-mention and cell-mention
 * autocomplete ("which of these candidates may read this page").
 */
export async function canManySubjects(sql: SqlExecutor, input: CanManySubjectsInput): Promise<Set<string>> {
  if (input.subjectIds.length === 0) return new Set();

  const allowActions = impliedDenyActions(input.action);
  const denyActions = impliedAllowActions(input.action);

  const rows = await sql<SubjectOriginRow[]>`
    WITH RECURSIVE ancestors AS (
        SELECT n.id, n.workspace_id, n.parent_id, 0 AS depth
          FROM nodes n
         WHERE n.id = ${input.resourceId} AND n.workspace_id = ${input.workspaceId}
        UNION ALL
        SELECT p.id, p.workspace_id, p.parent_id, a.depth + 1
          FROM nodes p
          JOIN ancestors a ON p.id = a.parent_id
         WHERE p.workspace_id = a.workspace_id
    ),
    subjects AS (
        SELECT u.id AS origin_id, 'user'::subject_kind AS subject_type, u.id AS subject_id
          FROM unnest(${input.subjectIds}::uuid[]) AS u(id)
        UNION ALL
        SELECT cm.user_id AS origin_id, 'cell'::subject_kind AS subject_type, cm.cell_id AS subject_id
          FROM cell_members cm
          JOIN unnest(${input.subjectIds}::uuid[]) AS u(id) ON cm.user_id = u.id
         WHERE cm.workspace_id = ${input.workspaceId}
    )
    SELECT DISTINCT s.origin_id, p.effect, a.depth
      FROM permissions p
      JOIN ancestors a ON a.id = p.resource_id
                      AND a.workspace_id = p.workspace_id
      JOIN subjects  s ON s.subject_type = p.subject_type
                      AND s.subject_id   = p.subject_id
     WHERE (p.effect = 'allow' AND p.action = ANY(${allowActions}::perm_action[]))
        OR (p.effect = 'deny'  AND p.action = ANY(${denyActions}::perm_action[]))
  `;

  const groups = new Map<string, ResolvedGrant[]>();
  for (const id of input.subjectIds) groups.set(id, []);
  for (const row of rows) {
    groups.get(row.origin_id)?.push({ depth: row.depth, effect: row.effect });
  }

  const decided = decideMany(groups);
  const readers = new Set<string>();
  for (const [id, effect] of decided) {
    if (effect === 'allow') readers.add(id);
  }
  return readers;
}
