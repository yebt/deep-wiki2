/**
 * Thin `read`-action convenience over `can-many.ts` (design.md "Listing
 * without disclosure"): every list endpoint this phase adds — backlinks,
 * mentions, tags, tree — filters through `can(read)`. This is what those
 * routes call, so `action: 'read'` is stated once rather than at every
 * call site.
 */
import type postgres from 'postgres';
import { canManyResources, canManySubjects } from './can-many';

type SqlExecutor = postgres.Sql | postgres.TransactionSql;

export interface ReadableResourceIdsInput {
  readonly workspaceId: string;
  readonly subjectType: 'user' | 'cell' | 'role' | 'agent';
  readonly subjectId: string;
  readonly resourceIds: readonly string[];
}

/** "Which of these candidate resources may this subject read" (backlinks, tags, tree). */
export async function readableResourceIds(sql: SqlExecutor, input: ReadableResourceIdsInput): Promise<Set<string>> {
  return canManyResources(sql, { ...input, action: 'read' });
}

export interface ReadableSubjectIdsInput {
  readonly workspaceId: string;
  readonly resourceId: string;
  readonly subjectIds: readonly string[];
}

/** "Which of these candidate subjects may read this resource" (mention autocomplete). */
export async function readableSubjectIds(sql: SqlExecutor, input: ReadableSubjectIdsInput): Promise<Set<string>> {
  return canManySubjects(sql, { ...input, action: 'read' });
}
