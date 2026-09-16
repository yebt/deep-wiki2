/**
 * Fixtures for `e2e/tree-writes.spec.ts`: a writer who may reorder inside
 * one book — `write` on the book and on its two pages — with the shelf
 * above them readable, because the tree shows a node only when every
 * ancestor is independently readable (`apps/api/src/routes/tree.ts`, the
 * path-visible rule). Minted into the database `e2e/global-setup.ts`
 * already seeded, the same way and for the same reason
 * `e2e/editor-fixtures.bun.ts` is a second script rather than more rows in
 * `seed.bun.ts` — see that file's own doc comment.
 *
 * Usage: `bun run e2e/tree-fixtures.bun.ts <workspaceId>` — the workspace
 * id from `.auth-fixtures.json`. Prints one JSON line. The minting itself
 * is `mintTreeFixtures()`, exported so
 * `scripts/checks/__tests__/e2e-tree-fixtures.test.ts` can run it against
 * a provisioned database; only the argv shell below is the script.
 */
import postgres from 'postgres';
import { createSession, insertGrants } from '@deep-wiki/db';
import { findSeededDatabase } from './comments-fixtures.bun';

export interface TreeFixtures {
  readonly writerSessionToken: string;
  readonly shelfTitle: string;
  readonly bookId: string;
  readonly bookTitle: string;
  /** The two pages under the book, in their seeded order. */
  readonly firstPageId: string;
  readonly firstPageTitle: string;
  readonly secondPageId: string;
  readonly secondPageTitle: string;
}

/** Mints a writer and a shelf › book › two pages they may reorder, under `workspaceId`'s root, into `sql`'s database. */
export async function mintTreeFixtures(sql: postgres.Sql, workspaceId: string): Promise<TreeFixtures> {
  const [root] = await sql<{ id: string }[]>`SELECT id FROM nodes WHERE workspace_id = ${workspaceId} AND parent_id IS NULL`;
  if (!root) throw new Error('tree-fixtures: the seeded workspace has no root node');

  const run = crypto.randomUUID().slice(0, 8);
  const [writer] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name)
    VALUES (${`e2e-tree-writer-${run}@example.com`}, 'unused', 'E2E Tree Writer') RETURNING id
  `;
  const { token: writerSessionToken } = await createSession(sql, { userId: writer!.id, idleTimeoutMinutes: 30, absoluteTimeoutDays: 30 });

  const shelfTitle = `E2E Tree Shelf ${run}`;
  const bookTitle = `E2E Tree Book ${run}`;
  const firstPageTitle = `E2E Tree Page One ${run}`;
  const secondPageTitle = `E2E Tree Page Two ${run}`;
  const [shelf] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${workspaceId}, ${root!.id}, 'shelf', '', 40, ${`e2e-tree-shelf-${run}`}, ${shelfTitle}) RETURNING id
  `;
  const [book] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${workspaceId}, ${shelf!.id}, 'book', '', 0, ${`e2e-tree-book-${run}`}, ${bookTitle}) RETURNING id
  `;
  const [first] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${workspaceId}, ${book!.id}, 'page', '', 0, ${`e2e-tree-page-one-${run}`}, ${firstPageTitle}) RETURNING id
  `;
  const [second] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${workspaceId}, ${book!.id}, 'page', '', 1, ${`e2e-tree-page-two-${run}`}, ${secondPageTitle}) RETURNING id
  `;
  await insertGrants(sql, workspaceId, 'user', writer!.id, [
    { resourceId: shelf!.id, action: 'read', effect: 'allow' },
    { resourceId: book!.id, action: 'write', effect: 'allow' },
    { resourceId: first!.id, action: 'write', effect: 'allow' },
    { resourceId: second!.id, action: 'write', effect: 'allow' },
  ]);

  return {
    writerSessionToken,
    shelfTitle,
    bookId: book!.id,
    bookTitle,
    firstPageId: first!.id,
    firstPageTitle,
    secondPageId: second!.id,
    secondPageTitle,
  };
}

async function main(): Promise<void> {
  const workspaceId = process.argv[2];
  if (!workspaceId) throw new Error('tree-fixtures: pass the seeded workspace id');

  const sql = postgres(await findSeededDatabase(workspaceId), { max: 3 });
  try {
    console.log(JSON.stringify(await mintTreeFixtures(sql, workspaceId)));
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
