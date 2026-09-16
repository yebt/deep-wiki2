/**
 * Fixtures for `e2e/comments.spec.ts`, minted into the database
 * `e2e/global-setup.ts` already seeded — run by that spec's `beforeAll`
 * as a `bun` child process, for the same reason `e2e/seed.bun.ts` is one
 * (`packages/db`'s testing helpers use Bun-only APIs at module load and
 * cannot be imported from Playwright's Node process).
 *
 * Why a second script rather than more rows in `seed.bun.ts`: the seed
 * mints no subject who may *comment*. The reader holds `read` alone; the
 * founder and colleague belong to `e2e/onboarding.spec.ts`, whose plan
 * limit of one workspace makes any other file that creates content as
 * them order-dependent; and registration is invitation-only. Comments
 * need a commenter and — for the orphan case, which is a real save with
 * real reconciliation — an editor, on pages nothing else touches. Those
 * belong beside the spec that needs them, and they are added to the seeded
 * database rather than a second one so the API process global-setup
 * started already serves them.
 *
 * Usage: `bun run e2e/comments-fixtures.bun.ts <workspaceId>` — the
 * workspace id from `.auth-fixtures.json` is how the seeded database is
 * found among this worktree's `dw_test_*` databases (every seed mints a
 * fresh random id, so it is unique). Prints one JSON line. The minting
 * itself is `mintCommentFixtures()`, exported so
 * `scripts/checks/__tests__/e2e-comments-fixtures.test.ts` can run it
 * against a provisioned database; only the argv shell below is the
 * script.
 */
import { createHash } from 'node:crypto';
import postgres from 'postgres';
import { createReply, createRootComment, createSession, insertGrants, savePage } from '@deep-wiki/db';
import { localTestUrl, TEST_DB_PREFIX, TEST_CHANGESET_WINDOW_MINUTES } from '@deep-wiki/db/testing/provision';
import { harnessIdentity } from '@deep-wiki/db/testing/worktree';

/** The same 12-hex-character digest `apps/api/src/routes/comments.ts` stores. */
function quoteHashOf(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}

export async function findSeededDatabase(workspaceId: string): Promise<string> {
  const adminUrl = localTestUrl(harnessIdentity());
  const admin = postgres(adminUrl, { max: 1 });
  try {
    const rows = await admin<{ datname: string }[]>`SELECT datname FROM pg_database WHERE datname LIKE ${`${TEST_DB_PREFIX}%`}`;
    for (const { datname } of rows) {
      const url = adminUrl.replace(/\/postgres$/, `/${datname}`);
      const candidate = postgres(url, { max: 1 });
      try {
        const [hit] = await candidate<{ id: string }[]>`SELECT id FROM workspaces WHERE id = ${workspaceId}`;
        if (hit) return url;
      } catch {
        // A database this role cannot open, or one mid-drop: not ours.
      } finally {
        await candidate.end({ timeout: 1 }).catch(() => {});
      }
    }
  } finally {
    await admin.end({ timeout: 1 }).catch(() => {});
  }
  throw new Error(`comments-fixtures: no ${TEST_DB_PREFIX}* database holds workspace ${workspaceId}`);
}

interface Page {
  readonly id: string;
  readonly title: string;
  readonly contentHash: string;
}

export interface CommentFixtures {
  readonly commenterSessionToken: string;
  readonly editorSessionToken: string;
  readonly commentsPageId: string;
  readonly commentsPageTitle: string;
  readonly commentedQuote: string;
  readonly orphanPageId: string;
  readonly orphanPageTitle: string;
  readonly orphanQuote: string;
  /** The orphan page's markdown with the commented paragraph removed, and the hash a save of it must expect. */
  readonly orphanPageWithoutQuote: string;
  readonly orphanPageContentHash: string;
  readonly legacyPageId: string;
  readonly legacyPageTitle: string;
  readonly legacyQuote: string;
  /** A page saved with no persisted anchor at all — the mint path a thread started from read mode exercises. */
  readonly freshPageId: string;
  readonly freshPageTitle: string;
  readonly freshFirstParagraph: string;
  readonly freshSecondParagraph: string;
}

/** Mints the commenter, the editor, the three pages and their threads into `sql`'s database, under `workspaceId`'s root. */
export async function mintCommentFixtures(sql: postgres.Sql, workspaceId: string): Promise<CommentFixtures> {
  const [root] = await sql<{ id: string }[]>`SELECT id FROM nodes WHERE workspace_id = ${workspaceId} AND parent_id IS NULL`;
  const [reader] = await sql<{ id: string }[]>`SELECT id FROM users WHERE display_name = 'E2E Reader' LIMIT 1`;
  if (!root || !reader) throw new Error('comments-fixtures: the seeded workspace has no root node or no reader');

  const run = crypto.randomUUID().slice(0, 8);
  const [commenter] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name)
    VALUES (${`e2e-commenter-${run}@example.com`}, 'unused', 'E2E Commenter') RETURNING id
  `;
  const [editor] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name)
    VALUES (${`e2e-editor-${run}@example.com`}, 'unused', 'E2E Editor') RETURNING id
  `;
  const session = { idleTimeoutMinutes: 30, absoluteTimeoutDays: 30 } as const;
  const { token: commenterSessionToken } = await createSession(sql, { userId: commenter!.id, ...session });
  const { token: editorSessionToken } = await createSession(sql, { userId: editor!.id, ...session });

  async function makePage(title: string, position: number, markdown: string): Promise<Page> {
    const [node] = await sql<{ id: string }[]>`
      INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
      VALUES (${workspaceId}, ${root!.id}, 'page', '', ${position}, ${`e2e-comments-${run}-${position}`}, ${title})
      RETURNING id
    `;
    const saved = await savePage(sql, {
      nodeId: node!.id,
      workspaceId,
      markdown,
      expectedContentHash: null,
      updatedBy: editor!.id,
      changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES,
    });
    await insertGrants(sql, workspaceId, 'user', commenter!.id, [{ resourceId: node!.id, action: 'comment', effect: 'allow' }]);
    await insertGrants(sql, workspaceId, 'user', editor!.id, [{ resourceId: node!.id, action: 'write', effect: 'allow' }]);
    await insertGrants(sql, workspaceId, 'user', reader!.id, [{ resourceId: node!.id, action: 'read', effect: 'allow' }]);
    return { id: node!.id, title, contentHash: saved.contentHash };
  }

  async function thread(page: Page, blockId: string, quote: string, body: string, reply?: string): Promise<string> {
    const created = await createRootComment(sql, {
      workspaceId,
      pageId: page.id,
      authorId: commenter!.id,
      body,
      blockId,
      offsetStart: 0,
      offsetEnd: quote.length,
      quote,
      quoteHash: quoteHashOf(quote),
    });
    if (reply) {
      await createReply(sql, { workspaceId, pageId: page.id, parentId: created.id, authorId: editor!.id, body: reply });
    }
    return created.id;
  }

  // The happy path: three anchored paragraphs, a thread with one reply
  // on the middle one. Anchors are written into the markdown as the
  // persisted ` ^id` form `mintAnchorAtBlock` would produce, so the
  // cached render carries `data-block-id` on each.
  const commentedQuote = 'The second paragraph carries the thread this suite opens.';
  const commentsPage = await makePage(
    'E2E Comments Page',
    20,
    '## Overview\n\n' +
      'The first paragraph, which nobody has commented on. ^E2ECMTONE\n\n' +
      `${commentedQuote} ^E2ECMTTWO\n\n` +
      'The third paragraph is here so the gutter has something below the mark. ^E2ECMTTHREE\n',
  );
  await thread(commentsPage, 'E2ECMTTWO', commentedQuote, 'Is this paragraph still accurate after the migration?', 'I believe so, but the date needs checking.');

  // The orphan path: the spec's editor saves the page without the
  // commented paragraph, and save-time reconciliation orphans the thread
  // (comment-threads spec: "Tombstoned block always orphans"). The
  // markdown-without-it and the hash that save must expect are handed to
  // the spec, since no route exposes a page's current hash.
  const orphanQuote = 'This paragraph will be deleted, and its comment will outlive it.';
  const orphanPageWithoutQuote = 'The paragraph that stays. ^E2EORPHONE\n';
  const orphanPage = await makePage('E2E Orphan Page', 21, `${orphanPageWithoutQuote}\n${orphanQuote} ^E2EORPHTWO\n`);
  await thread(orphanPage, 'E2EORPHTWO', orphanQuote, 'Keep this note even if the paragraph goes.');

  // The "no anchors known" path (design.md Decision 6): a cached render
  // that predates `data-block-id`, exactly as every pre-backfill row
  // looks — the attribute stripped and the pipeline version behind.
  const legacyQuote = 'A paragraph whose cached render predates block anchors.';
  const legacyPage = await makePage('E2E Legacy Render Page', 22, `${legacyQuote} ^E2ELEGACY1\n`);
  await thread(legacyPage, 'E2ELEGACY1', legacyQuote, 'This comment exists before the backfill has run.');
  await sql`
    UPDATE page_content
       SET rendered_html = regexp_replace(rendered_html, '\\s*data-block-id="[^"]*"', '', 'g'),
           pipeline_version = 1
     WHERE node_id = ${legacyPage.id} AND workspace_id = ${workspaceId}
  `;

  // The new-thread path (2026-09-16): a page with no persisted anchor at
  // all, so that starting a thread from read mode drives the real mint —
  // `data-derived-block-id` on the cached render, the server's
  // `mintAnchorAtBlock` and re-render, and the reload that proves it.
  const freshFirstParagraph = 'A fresh paragraph that has never been commented on.';
  const freshSecondParagraph = 'A second fresh paragraph, with a few words worth selecting.';
  const freshPage = await makePage('E2E Fresh Page', 23, `${freshFirstParagraph}\n\n${freshSecondParagraph}\n`);

  return {
    commenterSessionToken,
    editorSessionToken,
    commentsPageId: commentsPage.id,
    commentsPageTitle: commentsPage.title,
    commentedQuote,
    orphanPageId: orphanPage.id,
    orphanPageTitle: orphanPage.title,
    orphanQuote,
    orphanPageWithoutQuote,
    orphanPageContentHash: orphanPage.contentHash,
    legacyPageId: legacyPage.id,
    legacyPageTitle: legacyPage.title,
    legacyQuote,
    freshPageId: freshPage.id,
    freshPageTitle: freshPage.title,
    freshFirstParagraph,
    freshSecondParagraph,
  };
}

async function main(): Promise<void> {
  const workspaceId = process.argv[2];
  if (!workspaceId) throw new Error('comments-fixtures: pass the seeded workspace id');

  const sql = postgres(await findSeededDatabase(workspaceId), { max: 3 });
  try {
    console.log(JSON.stringify(await mintCommentFixtures(sql, workspaceId)));
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
