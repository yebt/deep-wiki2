/**
 * The only module allowed to write a `path` prefix predicate
 * (`scripts/checks/query-boundaries.ts` enforces this — design.md
 * "Preventing the non-sargable `text` path"). Every subtree navigation
 * query and the reparent algorithm's uniform prefix rewrite go through
 * here, so `text_pattern_ops` sargability lives in exactly one place.
 */
import type postgres from 'postgres';

type SqlExecutor = postgres.Sql | postgres.TransactionSql;

export interface DescendantQuery {
  readonly workspaceId: string;
  readonly ancestorPath: string;
  /** Excludes the ancestor's own row (self-inclusive by default). */
  readonly excludeSelf?: boolean;
}

/** `descendants(n) = path LIKE n.path || '%'` (self-inclusive by default). */
export async function queryDescendantIds(sql: SqlExecutor, query: DescendantQuery): Promise<readonly string[]> {
  const pattern = `${query.ancestorPath}%`;
  const rows = query.excludeSelf
    ? await sql<{ id: string }[]>`
        SELECT id FROM nodes
         WHERE workspace_id = ${query.workspaceId} AND path LIKE ${pattern} AND path <> ${query.ancestorPath}
      `
    : await sql<{ id: string }[]>`
        SELECT id FROM nodes WHERE workspace_id = ${query.workspaceId} AND path LIKE ${pattern}
      `;
  return rows.map((row) => row.id);
}

export interface RewriteDescendantPathsInput {
  readonly workspaceId: string;
  readonly oldPrefix: string;
  readonly newPrefix: string;
  /** The moved row itself — its own path was already rewritten by the trigger. */
  readonly excludeId: string;
}

/**
 * Uniform prefix substitution (design.md — "Reparent"): every descendant
 * still carries the whole old prefix at the moment this statement runs,
 * so row-visit order is irrelevant.
 */
export async function rewriteDescendantPaths(sql: SqlExecutor, input: RewriteDescendantPathsInput): Promise<void> {
  const pattern = `${input.oldPrefix}%`;
  // The explicit ::int cast is load-bearing: an untyped numeric bind
  // parameter here resolves to substring's TEXT/regex overload
  // (`substring(text FROM pattern)`) instead of the integer-position
  // overload, silently returning NULL whenever the position number does
  // not also happen to appear as a literal substring of `path` (verified
  // directly against this postgres.js version and this Postgres).
  const fromPosition = input.oldPrefix.length + 1;
  await sql`
    UPDATE nodes
       SET path = ${input.newPrefix} || substring(path FROM ${fromPosition}::int),
           updated_at = now()
     WHERE workspace_id = ${input.workspaceId}
       AND path LIKE ${pattern}
       AND id <> ${input.excludeId}
  `;
}
