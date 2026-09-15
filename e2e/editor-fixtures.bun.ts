/**
 * Fixtures for e2e/editor.spec.ts's one real-backend test: a writer with
 * `write` on a page that already has saved content — the fixture the
 * mocked-API defect (docs/TODO.md Finding, this task) needed and none of
 * this file's mocked tests exercise. Minted into the database
 * `e2e/global-setup.ts` already seeded, the same way and for the same
 * reason `e2e/comments-fixtures.bun.ts` is a second script rather than more
 * rows in `seed.bun.ts` — see that file's own doc comment.
 *
 * Usage: `bun run e2e/editor-fixtures.bun.ts <workspaceId>` — the
 * workspace id from `.auth-fixtures.json`. Prints one JSON line. The
 * minting itself is `mintEditorFixtures()`, exported so
 * `scripts/checks/__tests__/e2e-editor-fixtures.test.ts` can run it against
 * a provisioned database; only the argv shell below is the script.
 */
import postgres from 'postgres';
import { createSession, insertGrants, savePage } from '@deep-wiki/db';
import { TEST_CHANGESET_WINDOW_MINUTES } from '@deep-wiki/db/testing/provision';
import { findSeededDatabase } from './comments-fixtures.bun';

export interface EditorFixtures {
  readonly writerSessionToken: string;
  readonly editablePageId: string;
  readonly editablePageTitle: string;
  /** The markdown already saved on the page before the browser ever opens it for editing. */
  readonly editablePageMarkdown: string;
}

/** Mints a writer and one already-saved page, under `workspaceId`'s root, into `sql`'s database. */
export async function mintEditorFixtures(sql: postgres.Sql, workspaceId: string): Promise<EditorFixtures> {
  const [root] = await sql<{ id: string }[]>`SELECT id FROM nodes WHERE workspace_id = ${workspaceId} AND parent_id IS NULL`;
  if (!root) throw new Error('editor-fixtures: the seeded workspace has no root node');

  const run = crypto.randomUUID().slice(0, 8);
  const [writer] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name)
    VALUES (${`e2e-editor-writer-${run}@example.com`}, 'unused', 'E2E Editor Writer') RETURNING id
  `;
  const { token: writerSessionToken } = await createSession(sql, { userId: writer!.id, idleTimeoutMinutes: 30, absoluteTimeoutDays: 30 });

  const editablePageTitle = 'E2E Editable Page';
  const editablePageMarkdown = 'This page already has content before the browser ever opens it for editing.\n';
  const [node] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${workspaceId}, ${root!.id}, 'page', '', 30, ${`e2e-editable-${run}`}, ${editablePageTitle})
    RETURNING id
  `;
  await savePage(sql, {
    nodeId: node!.id,
    workspaceId,
    markdown: editablePageMarkdown,
    expectedContentHash: null,
    updatedBy: writer!.id,
    changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES,
  });
  await insertGrants(sql, workspaceId, 'user', writer!.id, [{ resourceId: node!.id, action: 'write', effect: 'allow' }]);

  return { writerSessionToken, editablePageId: node!.id, editablePageTitle, editablePageMarkdown };
}

async function main(): Promise<void> {
  const workspaceId = process.argv[2];
  if (!workspaceId) throw new Error('editor-fixtures: pass the seeded workspace id');

  const sql = postgres(await findSeededDatabase(workspaceId), { max: 3 });
  try {
    console.log(JSON.stringify(await mintEditorFixtures(sql, workspaceId)));
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
