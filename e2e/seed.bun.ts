/**
 * Bun-only half of e2e/global-setup.ts's backend provisioning.
 *
 * `packages/db/testing/provision.ts` uses `import.meta.dir` (a Bun-only
 * property) at module load time, so it cannot be `import()`ed from
 * Playwright's own (Node) process — attempting it throws immediately
 * ("path argument must be of type string. Received undefined"). This
 * script runs the provisioning/seeding/teardown that module requires as
 * a `bun` child process instead, spawned by global-setup.ts, and talks
 * back over stdout as newline-delimited JSON.
 *
 * Two modes:
 *   bun run e2e/seed.bun.ts          -> provision + migrate + seed, print
 *                                        { url, dbName, ...fixtures }
 *   bun run e2e/seed.bun.ts --drop <dbName> -> drop that database
 */
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { provisionTestDatabase, resolveAdminUrl, dropTestDatabase, defaultProvisionDeps } from '@deep-wiki/db/testing/provision';
import { createInvitation, createPasswordReset, createSession, insertGrants, savePage } from '@deep-wiki/db';
import { ensureTestServices } from '../apps/api/testing/services';

/**
 * e2e/onboarding.spec.ts signs two people in through the real sign-in
 * screen, so their rows need a hash `Argon2idPasswordHasher` will verify —
 * the same parameters `packages/db/seed.ts` uses.
 */
const ONBOARDING_PASSWORD = 'correct-horse-battery-staple';
async function hashPassword(): Promise<string> {
  return Bun.password.hash(ONBOARDING_PASSWORD, { algorithm: 'argon2id', memoryCost: 19_456, timeCost: 2 });
}

async function seedFixtures(sql: postgres.Sql) {
  const [owner] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name)
    VALUES (${`e2e-owner-${randomUUID()}@example.com`}, 'unused', 'E2E Owner')
    RETURNING id
  `;
  const [ws] = await sql<{ id: string }[]>`
    INSERT INTO workspaces (owner_id, name, slug)
    VALUES (${owner!.id}, 'E2E Workspace', ${`e2e-workspace-${randomUUID()}`})
    RETURNING id
  `;
  const [root] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${ws!.id}, NULL, 'workspace', '', 0, 'root', 'Root')
    RETURNING id
  `;

  const signinEmail = `e2e-signin-${randomUUID()}@example.com`;
  const { token: signinInvitationToken } = await createInvitation(sql, {
    workspaceId: ws!.id,
    email: signinEmail,
    startingGrants: [{ resourceId: root!.id, action: 'read', effect: 'allow' }],
    ttlDays: 7,
    invitedByUserId: owner!.id,
  });

  // A second, independent account for the keyboard-operability test, so
  // it never shares an in-flight login with the serial sign-in flow above
  // when both run concurrently across Playwright's worker processes.
  const keyboardEmail = `e2e-keyboard-${randomUUID()}@example.com`;
  const { token: keyboardInvitationToken } = await createInvitation(sql, {
    workspaceId: ws!.id,
    email: keyboardEmail,
    startingGrants: [{ resourceId: root!.id, action: 'read', effect: 'allow' }],
    ttlDays: 7,
    invitedByUserId: owner!.id,
  });

  const expiredInvitationEmail = `e2e-expired-${randomUUID()}@example.com`;
  const { token: expiredInvitationToken } = await createInvitation(sql, {
    workspaceId: ws!.id,
    email: expiredInvitationEmail,
    startingGrants: [{ resourceId: root!.id, action: 'read', effect: 'allow' }],
    ttlDays: 7,
    invitedByUserId: owner!.id,
  });
  // The token itself is only ever stored hashed, so the just-created row is
  // addressed by its (unique, seed-only) email instead.
  await sql`
    UPDATE invitations SET expires_at = now() - interval '1 minute'
    WHERE email = ${expiredInvitationEmail}
  `;

  // A user who already has a real account (created directly — its
  // password hash is never exercised by any test, only replaced).
  const resetEmail = `e2e-reset-${randomUUID()}@example.com`;
  const [resetUser] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name)
    VALUES (${resetEmail}, 'unused', 'E2E Reset User')
    RETURNING id
  `;
  const { token: resetToken } = await createPasswordReset(sql, resetUser!.id, 30);

  // e2e/read.spec.ts (document-modes: "Read Mode Serves Pre-Rendered HTML
  // Without Reparsing"): a real page with real saved (and therefore
  // rendered) content, a reader who can see it, and an outsider who
  // cannot — sessions are minted directly rather than driven through the
  // sign-in UI, since this suite exercises the read route, not
  // authentication (already e2e/auth.spec.ts's job).
  const [readPage] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${ws!.id}, ${root!.id}, 'page', '', 1, ${`e2e-read-${randomUUID()}`}, 'E2E Read Page')
    RETURNING id
  `;
  // No top-level `#` heading here on purpose: the page's own title (the
  // node's `title` column, rendered as the page's one <h1> by
  // `PageHeading`) already supplies it. A body markdown starting with its
  // own `# ` would render a second, redundant <h1>.
  await savePage(sql, {
    nodeId: readPage!.id,
    workspaceId: ws!.id,
    markdown: '## Overview\n\nRead mode serves this exact content, cached, without reparsing.\n',
    expectedContentHash: null,
  });

  const [readerUser] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name)
    VALUES (${`e2e-reader-${randomUUID()}@example.com`}, 'unused', 'E2E Reader') RETURNING id
  `;
  // insertGrants, not a raw INSERT: packages/db/src/permissions/ is the
  // sole directory allowed to reference `permissions`
  // (scripts/checks/query-boundaries.ts).
  await insertGrants(sql, ws!.id, 'user', readerUser!.id, [{ resourceId: readPage!.id, action: 'read', effect: 'allow' }]);
  const { token: readerSessionToken } = await createSession(sql, {
    userId: readerUser!.id,
    idleTimeoutMinutes: 30,
    absoluteTimeoutDays: 30,
  });

  const [outsiderUser] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name)
    VALUES (${`e2e-outsider-${randomUUID()}@example.com`}, 'unused', 'E2E Outsider') RETURNING id
  `;
  const { token: outsiderSessionToken } = await createSession(sql, {
    userId: outsiderUser!.id,
    idleTimeoutMinutes: 30,
    absoluteTimeoutDays: 30,
  });

  // e2e/history.spec.ts (revision-history spec: "Page History Query
  // Returns Revisions Newest First"): a page saved twice, so the reader
  // sees two revisions authored by "E2E Owner", newest first.
  const [historyPage] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${ws!.id}, ${root!.id}, 'page', '', 2, ${`e2e-history-${randomUUID()}`}, 'E2E History Page')
    RETURNING id
  `;
  // Deliberately four blocks in the first save so the second save can
  // produce all four `diffBlocks()` classifications from one real diff —
  // not just added+modified. Each block's fate:
  //   - heading            -> unchanged
  //   - "as it was..."     -> modified (small in-place edit)
  //   - "apples..."        -> moved (byte-identical text, later slot)
  //   - "bananas..."       -> removed (absent from the second save)
  // and the second save adds one brand-new paragraph ("kiwis...").
  // Verified directly against `diffBlocks()` before trusting this fixture
  // (versioning-and-collaboration tasks.md 10.3's quality-bar note): a
  // full-rewrite edit falls below `matchBlocks()`'s `MATCH_THRESHOLD` and
  // classifies as remove-plus-add rather than modified, and a block that
  // both moves AND changes text classifies `modified` (with `moved: true`)
  // rather than `moved` — the "apples" paragraph below is copied
  // byte-for-byte into its new position for exactly this reason.
  const historyFirstSave = await savePage(sql, {
    nodeId: historyPage!.id,
    workspaceId: ws!.id,
    markdown:
      '## First version\n\n' +
      'The page as it was first saved, with no edits yet.\n\n' +
      'A paragraph about apples that will move down in the next revision.\n\n' +
      'A paragraph about bananas that will be removed entirely.\n',
    expectedContentHash: null,
    updatedBy: owner!.id,
  });
  await savePage(sql, {
    nodeId: historyPage!.id,
    workspaceId: ws!.id,
    markdown:
      '## First version\n\n' +
      'The page as it was first saved, now with one small edit.\n\n' +
      'A brand new paragraph about kiwis, added in this revision.\n\n' +
      'A paragraph about apples that will move down in the next revision.\n',
    expectedContentHash: historyFirstSave.contentHash,
    updatedBy: owner!.id,
  });
  await insertGrants(sql, ws!.id, 'user', readerUser!.id, [{ resourceId: historyPage!.id, action: 'read', effect: 'allow' }]);

  // e2e/diff.spec.ts needs both revision ids directly for its
  // permission-denied case: an outsider cannot reach the history screen
  // at all (it 404s for them), so there is no click path onto the diff
  // screen to prove its OWN non-disclosure guard — that case has to
  // navigate by address, the one place this suite does.
  const historyRevisionRows = await sql<{ id: string }[]>`
    SELECT id FROM page_revision WHERE page_id = ${historyPage!.id} ORDER BY created_at ASC
  `;
  const historyFirstRevisionId = historyRevisionRows[0]!.id;
  const historySecondRevisionId = historyRevisionRows[1]!.id;

  // A page node that exists and is readable but has never been saved —
  // reachable because `savePage()` is the only writer of `page_content`
  // and `page_revision`, so a bare node has zero of both. The screen's
  // real "empty" state, not a hypothetical.
  const [emptyHistoryPage] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${ws!.id}, ${root!.id}, 'page', '', 3, ${`e2e-empty-history-${randomUUID()}`}, 'E2E Empty History Page')
    RETURNING id
  `;
  await insertGrants(sql, ws!.id, 'user', readerUser!.id, [{ resourceId: emptyHistoryPage!.id, action: 'read', effect: 'allow' }]);

  // e2e/book-history.spec.ts (changesets spec: "Book-Level History Is One
  // Query"; block-diff spec: "Book-Level Diff Aggregates Changed Pages
  // Since A Date"; task 10.5): a shelf > book > two pages structure, with
  // TWO changesets by the same author — a fixture with a single changeset
  // would exercise no grouping at all (task 10.5's own quality-bar
  // warning). The tree's "path-visible rule" (apps/api/src/routes/tree.ts)
  // requires every ancestor to be independently readable, not just the
  // leaf pages, so the reader is granted read on the shelf and the book
  // too, not only on the two pages.
  const [bookShelf] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${ws!.id}, ${root!.id}, 'shelf', '', 4, ${`e2e-book-shelf-${randomUUID()}`}, 'E2E Book Shelf')
    RETURNING id
  `;
  const [book] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${ws!.id}, ${bookShelf!.id}, 'book', '', 0, ${`e2e-book-${randomUUID()}`}, 'E2E Book History Handbook')
    RETURNING id
  `;
  const [bookPageA] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${ws!.id}, ${book!.id}, 'page', '', 0, ${`e2e-book-page-a-${randomUUID()}`}, 'E2E Book Page Alpha')
    RETURNING id
  `;
  const [bookPageB] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${ws!.id}, ${book!.id}, 'page', '', 1, ${`e2e-book-page-b-${randomUUID()}`}, 'E2E Book Page Beta')
    RETURNING id
  `;

  // Changeset 1: both pages saved once, close together, same author — the
  // book-history screen's "N pages changed" grouping (changesets spec:
  // "Saves Group Implicitly By Author, Book, And Window"). Page A's edit
  // mirrors historyPage's own proven fixture (heading unchanged, one
  // sentence modified, one paragraph moved, one paragraph removed, one
  // paragraph added) so the book-diff screen's focused page exercises all
  // four `diffBlocks()` classifications; Page B gets a single modified
  // paragraph, deliberately different content, so navigating "Next" from
  // Page A to Page B is provably showing a DIFFERENT page rather than a
  // re-render of the first (the trap named explicitly in tasks.md 10.5).
  const bookPageASave1 = await savePage(sql, {
    nodeId: bookPageA!.id,
    workspaceId: ws!.id,
    markdown:
      '## Book page alpha\n\n' +
      'The page as it was first saved, with no edits yet.\n\n' +
      'A paragraph about oranges that will move down in the next revision.\n\n' +
      'A paragraph about grapefruit that will be removed entirely.\n',
    expectedContentHash: null,
    updatedBy: owner!.id,
  });
  const bookPageBSave1 = await savePage(sql, {
    nodeId: bookPageB!.id,
    workspaceId: ws!.id,
    markdown: '## Book page beta\n\nThe page as it was first saved, with no edits yet.\n',
    expectedContentHash: null,
    updatedBy: owner!.id,
  });

  // The book-diff "since" boundary: captured from the database's own
  // clock, not the JS process's, so it agrees exactly with what
  // `page_revision.created_at` holds — one millisecond after the later of
  // the two round-1 saves, so round 1's own revisions are excluded by the
  // route's strict `created_at > since` (block-diff spec) and round 2's
  // are included.
  const [{ since: bookDiffSinceIso }] = await sql<{ since: string }[]>`
    SELECT (max(created_at) + interval '1 millisecond')::text AS since
      FROM page_revision
     WHERE page_id = ANY(${[bookPageA!.id, bookPageB!.id]})
  `;

  // Force changeset 1 closed so round 2 opens a genuinely SECOND changeset
  // rather than joining the first — directly, the same way
  // `expiredInvitationToken` above backdates a row rather than waiting out
  // a real `CHANGESET_WINDOW_MINUTES`.
  await sql`
    UPDATE changeset SET closed_at = now() - interval '2 hours'
     WHERE workspace_id = ${ws!.id} AND book_id = ${book!.id} AND author_id = ${owner!.id} AND closed_at IS NULL
  `;

  // Changeset 2: both pages saved again, grouped together, distinct from
  // changeset 1.
  await savePage(sql, {
    nodeId: bookPageA!.id,
    workspaceId: ws!.id,
    markdown:
      '## Book page alpha\n\n' +
      'The page as it was first saved, now with one small edit.\n\n' +
      'A brand new paragraph about pineapples, added in this revision.\n\n' +
      'A paragraph about oranges that will move down in the next revision.\n',
    expectedContentHash: bookPageASave1.contentHash,
    updatedBy: owner!.id,
  });
  await savePage(sql, {
    nodeId: bookPageB!.id,
    workspaceId: ws!.id,
    markdown: '## Book page beta\n\nThe page as it was first saved, now with one small edit.\n',
    expectedContentHash: bookPageBSave1.contentHash,
    updatedBy: owner!.id,
  });

  await insertGrants(sql, ws!.id, 'user', readerUser!.id, [
    { resourceId: bookShelf!.id, action: 'read', effect: 'allow' },
    { resourceId: book!.id, action: 'read', effect: 'allow' },
    { resourceId: bookPageA!.id, action: 'read', effect: 'allow' },
    { resourceId: bookPageB!.id, action: 'read', effect: 'allow' },
  ]);

  // e2e/onboarding.spec.ts (the front door): a founder with a plan and no
  // workspace, who creates one by clicking; and a colleague who already has
  // an account and is invited into it. The plan allows exactly one
  // workspace, so the limit the screen renders is a real one.
  const [onboardingPlan] = await sql<{ id: string }[]>`
    INSERT INTO plans (name, max_workspaces, max_seats, max_storage_bytes, max_ai_tokens_monthly)
    VALUES (${`e2e-onboarding-${randomUUID()}`}, 1, 10, '1000000', '1000')
    RETURNING id
  `;
  const passwordHash = await hashPassword();
  const founderEmail = `e2e-founder-${randomUUID()}@example.com`;
  await sql`
    INSERT INTO users (email, password_hash, display_name, plan_id)
    VALUES (${founderEmail}, ${passwordHash}, 'E2E Founder', ${onboardingPlan!.id})
  `;
  const colleagueEmail = `e2e-colleague-${randomUUID()}@example.com`;
  await sql`
    INSERT INTO users (email, password_hash, display_name)
    VALUES (${colleagueEmail}, ${passwordHash}, 'E2E Colleague')
  `;

  // The instance operator, for the registration screen.
  const superRootEmail = `e2e-super-root-${randomUUID()}@example.com`;
  await sql`
    INSERT INTO users (email, password_hash, display_name, is_super_root)
    VALUES (${superRootEmail}, ${passwordHash}, 'E2E Super Root', true)
  `;

  return {
    founderEmail,
    colleagueEmail,
    superRootEmail,
    onboardingPassword: ONBOARDING_PASSWORD,
    signinEmail,
    signinInvitationToken,
    keyboardEmail,
    keyboardInvitationToken,
    expiredInvitationToken,
    resetEmail,
    resetToken,
    readPageId: readPage!.id,
    historyPageId: historyPage!.id,
    historyFirstRevisionId,
    historySecondRevisionId,
    emptyHistoryPageId: emptyHistoryPage!.id,
    workspaceId: ws!.id,
    bookHistoryShelfTitle: 'E2E Book Shelf',
    bookHistoryBookId: book!.id,
    bookHistoryBookTitle: 'E2E Book History Handbook',
    bookHistoryPageAId: bookPageA!.id,
    bookHistoryPageBId: bookPageB!.id,
    bookDiffSinceIso,
    readerSessionToken,
    outsiderSessionToken,
  };
}

async function main(): Promise<void> {
  if (process.argv[2] === '--drop') {
    const name = process.argv[3];
    if (!name) throw new Error('seed.bun.ts --drop requires a database name');
    const adminUrl = await resolveAdminUrl(defaultProvisionDeps);
    await dropTestDatabase(adminUrl, name);
    console.log(`seed.bun.ts: dropped ${name}`);
    return;
  }

  // The invitation e2e reads the accept link out of the real mail the API
  // sends, so the test Mailpit has to be reachable — the same stack the
  // apps/api adapter suites bring up, on this worktree's own ports.
  await ensureTestServices();
  const testDb = await provisionTestDatabase();
  const sql = postgres(testDb.url, { max: 5 });
  try {
    const fixtures = await seedFixtures(sql);
    console.log(JSON.stringify({ url: testDb.url, dbName: testDb.name, ...fixtures }));
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
