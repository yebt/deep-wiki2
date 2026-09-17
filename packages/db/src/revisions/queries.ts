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
  /** The author's `users.display_name` at read time — `null` when the revision has no author, never an empty-string join artefact. */
  readonly authorDisplayName: string | null;
  readonly createdAt: Date;
  readonly changesetId: string | null;
  /** The sha256 of the revision's stored markdown — what the history screen compares neighbours by to name a revision that stores the same bytes as the one before it. Never the content itself. */
  readonly contentHash: string;
}

interface RevisionSummaryRow {
  id: string;
  author_id: string | null;
  author_display_name: string | null;
  created_at: Date;
  changeset_id: string | null;
  content_hash: string;
}

export interface ListPageRevisionsInput {
  readonly pageId: string;
  readonly workspaceId: string;
}

/**
 * Newest first (revision-history spec: "Page History Query Returns
 * Revisions Newest First"). The page-history screen renders "who changed
 * it" from a display name, not a raw id, so the author's `users` row is
 * joined here — `LEFT JOIN` because a revision's `author_id` is itself
 * nullable (`insert-revision.ts`: a save with no `updatedBy`).
 */
export async function listPageRevisions(sql: SqlExecutor, input: ListPageRevisionsInput): Promise<RevisionSummary[]> {
  const rows = await sql<RevisionSummaryRow[]>`
    SELECT r.id, r.author_id, u.display_name AS author_display_name, r.created_at, r.changeset_id, r.content_hash
      FROM page_revision r
      LEFT JOIN users u ON u.id = r.author_id
     WHERE r.page_id = ${input.pageId} AND r.workspace_id = ${input.workspaceId}
     ORDER BY r.created_at DESC
  `;
  return rows.map((row) => ({
    id: row.id,
    authorId: row.author_id,
    authorDisplayName: row.author_display_name,
    createdAt: row.created_at,
    changesetId: row.changeset_id,
    contentHash: row.content_hash,
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

export interface WorkspaceRevision {
  readonly id: string;
  readonly pageId: string;
  /** The page's current `nodes.title` — what the dashboard names the change by. */
  readonly pageTitle: string;
  readonly authorId: string | null;
  readonly authorDisplayName: string | null;
  readonly createdAt: Date;
  readonly content: string;
  /** The revision this one replaced, `null` for a page's first save. */
  readonly previousContent: string | null;
}

interface WorkspaceRevisionRow {
  id: string;
  page_id: string;
  page_title: string;
  author_id: string | null;
  author_display_name: string | null;
  created_at: Date;
  content: string;
  previous_content: string | null;
}

export interface ListWorkspaceRevisionsInput {
  readonly workspaceId: string;
  readonly limit: number;
  /** Narrow to one person's saves — the dashboard's "what you touched" column. */
  readonly authorId?: string;
}

/**
 * The newest saves across a whole workspace (the dashboard's "what
 * changed"), newest first, each paired with the content it replaced so
 * the caller can diff the two — one `LATERAL` lookup per row rather than
 * a second query per revision. Reads `content` only: `block_index` is an
 * anchor-only subset and must never feed a diff (block-diff spec).
 *
 * Per-page non-disclosure is the route's job, exactly as `listBookHistory`
 * leaves it: every revision in the workspace is returned here, and
 * `apps/api` filters by `readableResourceIds` before shaping a response.
 * The caller is expected to over-fetch by that margin.
 */
export async function listWorkspaceRevisions(sql: SqlExecutor, input: ListWorkspaceRevisionsInput): Promise<WorkspaceRevision[]> {
  const rows = await sql<WorkspaceRevisionRow[]>`
    SELECT r.id, r.page_id, n.title AS page_title, r.author_id, u.display_name AS author_display_name,
           r.created_at, r.content, prev.content AS previous_content
      FROM page_revision r
      JOIN nodes n ON n.id = r.page_id AND n.workspace_id = r.workspace_id
      LEFT JOIN users u ON u.id = r.author_id
      LEFT JOIN LATERAL (
        SELECT p.content
          FROM page_revision p
         WHERE p.page_id = r.page_id AND p.workspace_id = r.workspace_id
           AND (p.created_at, p.id) < (r.created_at, r.id)
         ORDER BY p.created_at DESC, p.id DESC
         LIMIT 1
      ) prev ON true
     WHERE r.workspace_id = ${input.workspaceId}
       ${input.authorId ? sql`AND r.author_id = ${input.authorId}` : sql``}
     ORDER BY r.created_at DESC, r.id DESC
     LIMIT ${input.limit}
  `;
  return rows.map((row) => ({
    id: row.id,
    pageId: row.page_id,
    pageTitle: row.page_title,
    authorId: row.author_id,
    authorDisplayName: row.author_display_name,
    createdAt: row.created_at,
    content: row.content,
    previousContent: row.previous_content,
  }));
}
