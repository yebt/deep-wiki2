/**
 * Seeds enough for a person to sign in AND actually look at something:
 * one plan, one Super Root account, one workspace, a `manage` grant at
 * the workspace root, and — new in this batch — a small, realistic
 * content tree so the Phase 2 screens (`/pages/:id`, `/pages/:id/edit`,
 * `/workspaces/:id` with its sidebar tree) have shelves, books, chapters and pages to
 * render instead of their empty states.
 *
 * Idempotent — safe to re-run. It never overwrites an existing account's
 * password (`ON CONFLICT DO NOTHING`), never duplicates a node (each is
 * looked up by `(parent_id, slug)` — the same pair `nodes_parent_slug_unique`
 * enforces — before it is created), and never overwrites a page's content
 * once it has any (`page_content` existing for a node is left untouched, so
 * a developer's in-progress edit is never silently reset).
 *
 * The seed credentials are development-only and deliberately obvious. The
 * password is read from SEED_PASSWORD when set, so a shared environment can
 * avoid the well-known default without editing this file.
 *
 * Node creation below is a plain `INSERT INTO nodes`, the same idiom
 * `createWorkspace` already uses for the workspace root — `path` is never
 * supplied by application code (the `nodes_set_path` trigger is the only
 * writer, design.md D3), so every insert here passes `''` for it exactly as
 * `createWorkspace` does. There is no shared "create node" helper in
 * `packages/db/src` today (`createWorkspace`'s own insert is the only
 * precedent); this file follows that precedent rather than inventing a new
 * abstraction the app itself does not have yet. Page *content* goes through
 * the real `savePage` transaction — never a hand-written insert into
 * `page_content` — so seeded pages get the same block-id assignment,
 * derived links/tags and canonical-form check every real save gets.
 */
import { createWorkspace, insertGrants, savePage } from './src/index';
import { canonicalise } from '@deep-wiki/markdown';
import postgres from 'postgres';

const SEED_EMAIL = process.env.SEED_EMAIL ?? 'owner@deep-wiki.local';
const SEED_PASSWORD = process.env.SEED_PASSWORD ?? 'deep-wiki-dev';
const SEED_NAME = 'Seed Owner';

type ContainerType = 'shelf' | 'book' | 'chapter';

/** A container node (shelf/book/chapter) and its children, or a leaf page. */
type ContentSpec =
  | { readonly kind: 'container'; readonly type: ContainerType; readonly slug: string; readonly title: string; readonly children: readonly ContentSpec[] }
  | { readonly kind: 'page'; readonly slug: string; readonly title: string; readonly markdown: string };

function shelf(slug: string, title: string, children: readonly ContentSpec[]): ContentSpec {
  return { kind: 'container', type: 'shelf', slug, title, children };
}
function book(slug: string, title: string, children: readonly ContentSpec[]): ContentSpec {
  return { kind: 'container', type: 'book', slug, title, children };
}
function chapter(slug: string, title: string, children: readonly ContentSpec[]): ContentSpec {
  return { kind: 'container', type: 'chapter', slug, title, children };
}
function page(slug: string, title: string, markdown: readonly string[]): ContentSpec {
  return { kind: 'page', slug, title, markdown: `${markdown.join('\n')}\n` };
}

// ---------------------------------------------------------------------------
// Page content. Every element `docs/UI-CHECKLIST.md`'s reviewer needs to see
// exercised lives on "Local Development Setup": heading hierarchy below the
// page's own <h1> (its title), nested bullet/ordered lists, a GFM table, a
// fenced code block with a language and one without, inline code, bold,
// italic, a blockquote, a wiki-link, a tag, and a footnote whose reference
// and definition link to each other. It is also the long page: several
// paragraphs, enough to show the 65-80ch measure holding a real column
// rather than a stub. The rest of the tree carries lighter, still-real
// content and cross-links back into it.
// ---------------------------------------------------------------------------

const LOCAL_DEV_SETUP = page('local-development-setup', 'Local Development Setup', [
  '## Prerequisites',
  '',
  'Before touching any code, make sure these are already on the machine:',
  '',
  '1. **Bun 1.4+** — the package manager and the primary test runner.',
  '2. **podman 5.x** with a compose provider (Docker works too, and is what production runs).',
  '3. **Node 22+** — development only. Vitest needs it for `apps/web`\'s component tests; the built runtime never does.',
  '',
  '> If `bun --version` reports anything older than `1.4.0`, upgrade before doing anything else. An older Bun has silently mis-resolved workspace packages before, and chasing that from a stack trace wastes an afternoon a five-second version check would have saved.',
  '',
  '## Cloning and installing',
  '',
  '```bash',
  'git clone git@example.com:deep-wiki/deep-wiki.git',
  'cd deep-wiki',
  'bun install',
  '```',
  '',
  'Then copy the environment template — never edit `env.example` itself, it is committed and must stay secret-free:',
  '',
  '```',
  'cp env.example .env',
  '```',
  '',
  'See [[Coding Standards]] for the full reasoning behind that split.',
  '',
  '## Starting the local stack',
  '',
  'Three commands, in this order:',
  '',
  '1. `podman compose up -d --wait`',
  '2. `bun run db:migrate`',
  '3. `bun run db:seed`',
  '',
  '### What each one actually starts',
  '',
  '- Postgres, with the `pgvector` extension enabled',
  '  - Used today for the tenancy schema',
  '  - Reserved for embeddings once the RAG surface lands',
  '- Mailpit — development SMTP capture',
  '  1. SMTP on port `1025`',
  '  2. A web UI on port `8025` for reading what a feature "sent"',
  '- MinIO — S3-compatible object storage',
  '- Kroki, with its Mermaid sidecar, for server-side diagram rendering',
  '',
  '## Everyday commands',
  '',
  '| Command | What it does | Runs in CI |',
  '| --- | --- | --- |',
  '| `bun run typecheck` | Type-checks every workspace member | yes |',
  '| `bun run lint` | ESLint across the whole repository | yes |',
  '| `bun run test` | The full test suite, package by package | yes |',
  '| `bun run check` | The structural guard rail — the same one `.githooks/pre-commit` runs | yes |',
  '',
  '## A few habits worth keeping',
  '',
  'Always run a package\'s script through the workspace filter — `bun run -F <package> <script>` — rather than `cd`-ing into it directly; Bun\'s workspace resolution gets confused about which lockfile it is honouring otherwise. **Never** commit a changed `.env`, and *always* re-run `bun run env:check` after touching a port in it.',
  '',
  'A line worth pinning above the monitor:',
  '',
  '> "Works on my machine" is not a deployment strategy. — every incident review, eventually',
  '',
  '## Troubleshooting',
  '',
  'If `bun run test` hangs waiting on a database connection, check whether another checkout already owns this worktree\'s test Postgres port before assuming Postgres itself is broken.[^slot-collision] The harness is written to fail with an actionable message rather than a bare timeout — read it before opening an issue.',
  '',
  'Anything you figure out that is not written down here yet, write it down here and tag it #onboarding so the next new hire finds it in one search instead of one Slack thread.',
  '',
  '[^slot-collision]: Two worktrees only collide when their derived slot hashes to the same eight-port block — rare on a normal day, and `DEEPWIKI_TEST_SLOT` moves a whole worktree out of the way with a single environment variable.',
]);

const CODING_STANDARDS = page('coding-standards', 'Coding Standards', [
  '## Formatting and linting',
  '',
  'Formatting is not a matter of taste here — `bun run lint` runs ESLint across the repository and is part of `bun run check`, the same gate `.githooks/pre-commit` enforces. Fix what it reports before opening a review; do not argue with it in the pull request instead.',
  '',
  '## Commit messages',
  '',
  'We use Conventional Commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:` and `chore:` cover almost everything. No AI attribution of any kind belongs in a commit message — no `Co-Authored-By` trailers, no "Generated with" lines, no tool names.',
  '',
  '## The one rule that is machine-enforced',
  '',
  '`packages/core` holds domain entities, use cases and ports, and **nothing else**. It has zero framework imports — not Nuxt, not Hono, not even a Node built-in. `scripts/checks/core-purity.ts` checks this with an AST-accurate import scan; there is no ESLint-disable comment that gets around it, so do not go looking for one.',
  '',
  '## Testing expectations',
  '',
  '- Every workspace member needs at least one real, executing test.',
  '- A test file that declares a test with no assertion inside it counts as *no* coverage, not as green — `scripts/checks/test-coverage.ts` treats it exactly that way.',
  '- Prefer testing behaviour over implementation detail; see [[Local Development Setup]] for how to bring up a real database locally when a suite needs one.',
  '',
  'Questions that are not answered here belong in a #onboarding thread, not in a comment on someone else\'s pull request.',
]);

const NEW_HIRE_CHECKLIST = page('new-hire-checklist', 'New Hire Checklist', [
  '## Before day one',
  '',
  '- Laptop provisioned and enrolled in MDM',
  '- GitHub organisation invitation accepted',
  '- Access to the team calendar confirmed',
  '',
  '## Day one',
  '',
  '1. Clone the repository and follow [[Local Development Setup]] end to end.',
  '2. Read [[Coding Standards]] before writing the first line of code.',
  '3. Introduce yourself in the team channel — one paragraph, no template needed.',
  '',
  '## First week',
  '',
  '- Pair on at least one real ticket, not a toy one.',
  '- Open one pull request, however small, before Friday.',
  '- Ask about anything marked #onboarding — it exists so you do not have to guess.',
]);

const DATABASE_SCHEMA_OVERVIEW = page('database-schema-overview', 'Database Schema Overview', [
  '## The `nodes` table',
  '',
  'Every shelf, book, chapter and page is one row in a single `nodes` table, distinguished by a `type` column (`workspace | shelf | book | chapter | page`). A node\'s `path` column is a materialised ancestor chain of UUIDs, written only by a database trigger — application code never supplies it, and authorisation never reads it either.',
  '',
  '## Why authorisation walks `parent_id`, not `path`',
  '',
  '`path` exists purely for subtree navigation queries. The permission resolver walks `parent_id` through a recursive CTE instead, bounded at a handful of hops, because authorisation must never depend on a denormalised cache that could drift from the real parent chain.',
  '',
  '## Grants',
  '',
  'The resolver\'s recursive CTE walks `parent_id` up from the requested node, collecting every ancestor:',
  '',
  '```sql',
  'WITH RECURSIVE ancestors AS (',
  '  SELECT id, parent_id, 0 AS depth FROM nodes WHERE id = $1',
  '  UNION ALL',
  '  SELECT n.id, n.parent_id, a.depth + 1',
  '    FROM nodes n',
  '    JOIN ancestors a ON n.id = a.parent_id',
  ')',
  '```',
  '',
  'Every grant on every ancestor is gathered in one pass, and a small, total function in `packages/core` decides the outcome: smallest depth wins, and a `deny` at the winning depth beats an `allow` at that same depth regardless of which subject carried it.',
  '',
  '## Open questions',
  '',
  'Track anything unresolved in `docs/TODO.md` rather than in a comment thread — it is the one place a finding does not get silently lost between reviewers.',
]);

const COMPONENT_LIBRARY_GUIDELINES = page(
  'component-library-guidelines',
  'Component Library Guidelines, Naming Conventions, and Long-Term Ownership for the Design System Team',
  [
    '## Naming',
    '',
    'Component file names are PascalCase and match their default export exactly — `PageHeading.vue` exports `PageHeading`, never `pageHeading` or `page-heading`. A component that wraps a single Nuxt UI primitive keeps that primitive\'s name as a suffix, so `SaveButton.vue` rather than `Button.vue`, which would collide with the library\'s own import.',
    '',
    '## Container/presentational split',
    '',
    'A page-level component fetches data and owns state; everything under `apps/web/app/components/` stays presentational — props in, events out, no direct API calls. This mirrors the same boundary `packages/core` enforces at the domain layer, just one level up the stack.',
    '',
    '## Ownership',
    '',
    'The design system has no dedicated team yet — every contributor who touches a shared component owns the consequences of that change repository-wide, which is why `docs/DESIGN-SYSTEM.md` and `docs/UI-CHECKLIST.md` are mandatory reading before the first line of markup, not optional background.',
    '',
    '*Small* inconsistencies compound fast in a design system; a single unreviewed spacing value can spread through a dozen screens before anyone notices it was never a token.',
  ],
);

const Q3_PLANNING_NOTES = page('q3-2026-planning-notes', 'Q3 2026 Planning Notes', [
  '## Themes for the quarter',
  '',
  '1. Ship the navigation tree and both page routes end to end.',
  '2. Close the gap between read mode\'s cache and per-viewer permissions.',
  '3. Start the AI interrogation loop that turns a raw idea into a well-declared design document.',
  '',
  '## Out of scope this quarter',
  '',
  '- Real-time collaborative editing — the soft lock stays as the concurrency model for now.',
  '- Anything touching billing; the plan/seat model is stable and untouched.',
  '',
  '## Dependencies',
  '',
  'The AI layer depends on the knowledge graph (`links`, `tags`, `page_blocks`) being reliable, which in turn depends on the block-matching threshold in `packages/markdown` holding up against real edit traffic rather than synthetic fixtures.',
]);

const WEEKLY_SYNC_TEMPLATE = page('weekly-sync-template', 'Weekly Sync Template', [
  '## Attendees',
  '',
  '- _Add names here before the meeting starts._',
  '',
  '## Agenda',
  '',
  '1. Blockers',
  '2. What shipped since last sync',
  '3. What is next',
  '',
  '## Action items',
  '',
  '- _Add action items as they come up._',
  '',
  '## Notes',
  '',
  'Duplicate this page for each week\'s actual sync rather than editing it in place, so the history of past syncs stays intact. See [[Q3 2026 Planning Notes]] for the themes this quarter\'s syncs should track.',
]);

const CONTENT_TREE: readonly ContentSpec[] = [
  shelf('engineering', 'Engineering', [
    book('onboarding', 'Onboarding', [
      chapter('getting-started', 'Getting Started', [LOCAL_DEV_SETUP, CODING_STANDARDS]),
      NEW_HIRE_CHECKLIST, // a page directly under a book, no chapter
    ]),
    book('architecture', 'Architecture', [
      chapter('backend-services', 'Backend Services', [DATABASE_SCHEMA_OVERVIEW]),
      chapter('frontend', 'Frontend', [COMPONENT_LIBRARY_GUIDELINES]),
    ]),
  ]),
  shelf('product', 'Product', [
    book('roadmap', 'Roadmap', [chapter('q3-2026', 'Q3 2026', [Q3_PLANNING_NOTES])]),
    book('meeting-notes', 'Meeting Notes', [
      WEEKLY_SYNC_TEMPLATE, // a page directly under a book, no chapter
    ]),
  ]),
];

interface SeededPage {
  readonly nodeId: string;
  readonly title: string;
  readonly markdown: string;
}

/** Looks a node up by its (parent, slug) pair — the same pair `nodes_parent_slug_unique` enforces — before creating it, so re-seeding never duplicates the tree. */
async function ensureNode(
  sql: postgres.Sql,
  input: { readonly workspaceId: string; readonly parentId: string; readonly type: ContainerType | 'page'; readonly slug: string; readonly title: string; readonly position: number },
): Promise<string> {
  const [existing] = await sql<{ id: string }[]>`
    SELECT id FROM nodes WHERE parent_id = ${input.parentId} AND slug = ${input.slug}
  `;
  if (existing) return existing.id;

  const [row] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${input.workspaceId}, ${input.parentId}, ${input.type}, '', ${input.position}, ${input.slug}, ${input.title})
    RETURNING id
  `;
  return row!.id;
}

/**
 * Creates every shelf/book/chapter/page node in `specs` under `parentId`.
 * Deliberately two-pass: this function only ever creates nodes and
 * collects the pages it finds into `pages` — it never calls `savePage`
 * itself. Content is saved afterwards, once the whole tree exists, so a
 * wiki-link from a page created early (e.g. "Local Development Setup"
 * linking to "Coding Standards") resolves correctly regardless of which
 * page in the tree it points at.
 */
async function createTree(
  sql: postgres.Sql,
  workspaceId: string,
  parentId: string,
  specs: readonly ContentSpec[],
  pages: SeededPage[],
): Promise<void> {
  let position = 0;
  for (const spec of specs) {
    if (spec.kind === 'page') {
      const nodeId = await ensureNode(sql, { workspaceId, parentId, type: 'page', slug: spec.slug, title: spec.title, position });
      pages.push({ nodeId, title: spec.title, markdown: spec.markdown });
    } else {
      const nodeId = await ensureNode(sql, { workspaceId, parentId, type: spec.type, slug: spec.slug, title: spec.title, position });
      await createTree(sql, workspaceId, nodeId, spec.children, pages);
    }
    position += 1;
  }
}

/** Saves a page's content only if it has none yet — re-seeding must never reset a page a developer has since edited, the same policy the seed already applies to the user's password. */
async function ensurePageContent(
  sql: postgres.Sql,
  workspaceId: string,
  updatedBy: string,
  seeded: SeededPage,
  changesetWindowMinutes: number,
): Promise<void> {
  const [existing] = await sql<{ node_id: string }[]>`SELECT node_id FROM page_content WHERE node_id = ${seeded.nodeId}`;
  if (existing) return;

  await savePage(sql, {
    nodeId: seeded.nodeId,
    workspaceId,
    markdown: canonicalise(seeded.markdown),
    expectedContentHash: null,
    updatedBy,
    changesetWindowMinutes,
  });
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('seed: DATABASE_URL is not set. Copy env.example to .env first.');
    process.exit(1);
  }

  // `SavePageInput.changesetWindowMinutes` is required — `packages/db`
  // never reads env, so this script threads the same `CHANGESET_WINDOW_MINUTES`
  // env var `apps/api`'s `loadConfig()` reads, rather than a second
  // hardcoded copy of `env.example`'s value.
  const changesetWindowMinutesRaw = process.env.CHANGESET_WINDOW_MINUTES;
  const changesetWindowMinutes = Number(changesetWindowMinutesRaw);
  if (!changesetWindowMinutesRaw || !Number.isFinite(changesetWindowMinutes) || changesetWindowMinutes <= 0) {
    console.error('seed: CHANGESET_WINDOW_MINUTES is not set. Copy env.example to .env first.');
    process.exit(1);
  }

  const sql = postgres(url);

  try {
    const [plan] = await sql<{ id: string }[]>`
      INSERT INTO plans (name, max_workspaces, max_seats, max_storage_bytes, max_ai_tokens_monthly)
           VALUES ('development', 10, 50, '10737418240', '10000000')
      ON CONFLICT (name) DO UPDATE SET updated_at = now()
        RETURNING id
    `;

    const passwordHash = await Bun.password.hash(SEED_PASSWORD, {
      algorithm: 'argon2id',
      memoryCost: 19_456,
      timeCost: 2,
    });

    // DO NOTHING rather than DO UPDATE: re-seeding must not reset a password
    // the developer changed on purpose.
    await sql`
      INSERT INTO users (email, password_hash, display_name, plan_id, is_super_root)
           VALUES (${SEED_EMAIL}, ${passwordHash}, ${SEED_NAME}, ${plan!.id}, true)
      ON CONFLICT (email) DO NOTHING
    `;

    const [user] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${SEED_EMAIL}`;

    const [existing] = await sql<{ id: string; root: string }[]>`
      SELECT w.id, n.id AS root
        FROM workspaces w
        JOIN nodes n ON n.workspace_id = w.id AND n.type = 'workspace'
       WHERE w.slug = 'demo'
    `;

    const workspace = existing
      ? { workspaceId: existing.id, rootNodeId: existing.root }
      : await createWorkspace(sql, { ownerId: user!.id, name: 'Demo workspace', slug: 'demo' });

    await insertGrants(sql, workspace.workspaceId, 'user', user!.id, [
      { resourceId: workspace.rootNodeId, action: 'manage', effect: 'allow' },
    ]);

    // The content tree. `manage` on the workspace root inherits to every
    // descendant node the permission resolver walks up to (`can()`'s
    // ancestor CTE), so no additional grant is needed for anything below.
    const pages: SeededPage[] = [];
    await createTree(sql, workspace.workspaceId, workspace.rootNodeId, CONTENT_TREE, pages);
    for (const seeded of pages) {
      await ensurePageContent(sql, workspace.workspaceId, user!.id, seeded, changesetWindowMinutes);
    }

    const featured = pages.find((seeded) => seeded.title === 'Local Development Setup')!;

    console.log('seed: ready');
    console.log(`  sign in at /login with  ${SEED_EMAIL}  /  ${SEED_PASSWORD}`);
    console.log(`  workspace "Demo workspace" (${workspace.workspaceId}), manage granted at its root`);
    console.log(`  open:  /workspaces/${workspace.workspaceId}`);
    console.log(`  page "${featured.title}" (${featured.nodeId}):`);
    console.log(`    read:  /pages/${featured.nodeId}`);
    console.log(`    edit:  /pages/${featured.nodeId}/edit`);
  } finally {
    await sql.end();
  }
}

if (import.meta.main) {
  await main();
}
