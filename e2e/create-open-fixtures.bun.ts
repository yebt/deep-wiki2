/**
 * Fixtures for `e2e/create-and-open.spec.ts`: one member who may build a
 * whole branch from the navigation tree — `read`, `write` and `manage` on
 * the seeded workspace's **root**, so every node they create beneath it
 * inherits all three (the resolver walks Workspace → Shelf → Book →
 * Chapter → Page, `docs/SPECS.md` §4).
 *
 * The other fixture scripts mint the nodes too; this one deliberately does
 * not. The journey under test is the owner's own — create a shelf, a book,
 * a chapter and a page *through the tree*, then open the page — and a
 * seeded node would be a node the UI did not make. Nothing here exists
 * except the person and their grants.
 *
 * A second script rather than more rows in `seed.bun.ts`, for the reason
 * `e2e/editor-fixtures.bun.ts` gives: a grant on the root is broad, and the
 * suites that assert non-disclosure run against the same seeded workspace.
 *
 * Usage: `bun run e2e/create-open-fixtures.bun.ts <workspaceId>` — the
 * workspace id from `.auth-fixtures.json`. Prints one JSON line. The
 * minting itself is `mintCreateOpenFixtures()`, exported so a check test
 * can run it against a provisioned database; only the argv shell below is
 * the script.
 */
import postgres from 'postgres';
import { createSession, insertGrants } from '@deep-wiki/db';
import { findSeededDatabase } from './comments-fixtures.bun';

export interface CreateOpenFixtures {
  readonly builderSessionToken: string;
  /** A per-run suffix, so two runs' shelves do not collide on `(parent_id, slug)`. */
  readonly run: string;
}

/** Mints a member with read/write/manage on `workspaceId`'s root, and nothing else. */
export async function mintCreateOpenFixtures(sql: postgres.Sql, workspaceId: string): Promise<CreateOpenFixtures> {
  const [root] = await sql<{ id: string }[]>`SELECT id FROM nodes WHERE workspace_id = ${workspaceId} AND parent_id IS NULL`;
  if (!root) throw new Error('create-open-fixtures: the seeded workspace has no root node');

  const run = crypto.randomUUID().slice(0, 8);
  const [builder] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name)
    VALUES (${`e2e-create-open-${run}@example.com`}, 'unused', 'E2E Builder') RETURNING id
  `;
  const { token: builderSessionToken } = await createSession(sql, {
    userId: builder!.id,
    idleTimeoutMinutes: 30,
    absoluteTimeoutDays: 30,
  });
  await insertGrants(sql, workspaceId, 'user', builder!.id, [
    { resourceId: root!.id, action: 'read', effect: 'allow' },
    { resourceId: root!.id, action: 'write', effect: 'allow' },
    { resourceId: root!.id, action: 'manage', effect: 'allow' },
  ]);

  return { builderSessionToken, run };
}

async function main(): Promise<void> {
  const workspaceId = process.argv[2];
  if (!workspaceId) throw new Error('create-open-fixtures: pass the seeded workspace id');

  const sql = postgres(await findSeededDatabase(workspaceId), { max: 2 });
  try {
    console.log(JSON.stringify(await mintCreateOpenFixtures(sql, workspaceId)));
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
