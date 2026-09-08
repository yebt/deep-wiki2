/**
 * The revision read path (revision-history spec: "Page History Query
 * Returns Revisions Newest First"). Deliberately reads only `content`/
 * metadata columns — never `block_index` — because the only consumer
 * that needs a revision's content, `diffBlocks()`, MUST re-parse it fresh
 * rather than trust the stored, anchor-only block index (block-diff spec:
 * "The Diff Re-Parses Both Sides Fresh"; enforced structurally by
 * `scripts/checks/diff-input-purity.ts`).
 */
import type postgres from 'postgres';

type SqlExecutor = postgres.Sql | postgres.TransactionSql;

export interface RevisionSummary {
  readonly id: string;
  readonly authorId: string | null;
  readonly createdAt: Date;
  readonly changesetId: string | null;
}

interface RevisionSummaryRow {
  id: string;
  author_id: string | null;
  created_at: Date;
  changeset_id: string | null;
}

export interface ListPageRevisionsInput {
  readonly pageId: string;
  readonly workspaceId: string;
}

/** Newest first (revision-history spec: "Page History Query Returns Revisions Newest First"). */
export async function listPageRevisions(sql: SqlExecutor, input: ListPageRevisionsInput): Promise<RevisionSummary[]> {
  const rows = await sql<RevisionSummaryRow[]>`
    SELECT id, author_id, created_at, changeset_id
      FROM page_revision
     WHERE page_id = ${input.pageId} AND workspace_id = ${input.workspaceId}
     ORDER BY created_at DESC
  `;
  return rows.map((row) => ({
    id: row.id,
    authorId: row.author_id,
    createdAt: row.created_at,
    changesetId: row.changeset_id,
  }));
}

export interface RevisionContent {
  readonly id: string;
  readonly pageId: string;
  readonly content: string;
  readonly createdAt: Date;
}

interface RevisionContentRow {
  id: string;
  page_id: string;
  content: string;
  created_at: Date;
}

export interface GetRevisionsByIdsInput {
  readonly workspaceId: string;
  readonly ids: readonly string[];
}

/** Fetches exactly the requested revisions' own content — the diff's `before`/`after` inputs. */
export async function getRevisionsByIds(sql: SqlExecutor, input: GetRevisionsByIdsInput): Promise<RevisionContent[]> {
  if (input.ids.length === 0) return [];
  const rows = await sql<RevisionContentRow[]>`
    SELECT id, page_id, content, created_at
      FROM page_revision
     WHERE workspace_id = ${input.workspaceId} AND id = ANY(${input.ids})
  `;
  return rows.map((row) => ({ id: row.id, pageId: row.page_id, content: row.content, createdAt: row.created_at }));
}
