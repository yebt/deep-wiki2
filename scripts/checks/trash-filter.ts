/**
 * Structural check: the trash-non-disclosure mechanism (design.md Decision 2
 * — "The helper is a view, and the check forbids the base table";
 * `trash-non-disclosure` spec — "A Structural Check Enforces The Mechanism
 * With Two Rules"). A trashed node must answer identically to an unknown one
 * for any subject without `manage`, and the only sanctioned way to read a
 * node or its content is the live-view pair `live_nodes`/`live_page_content`.
 * This check fails any file that reads around that helper.
 *
 * Two rules, both in `query-boundaries.ts`'s idiom (regex over source text,
 * `*.test.ts` excluded, a Drizzle-builder twin per rule, self-files exempt,
 * fixtures under `__fixtures__/trash-filter/`):
 *
 *   1. Base table — outside `ALLOW_LIST`, a file naming the base `nodes` or
 *      `page_content` table (`\b(FROM|JOIN)\s+(nodes|page_content)\b`, or the
 *      Drizzle-builder twin `.from(nodes)` / `.innerJoin(pageContent)`)
 *      fails. `\bnodes\b` does not match inside `live_nodes`: the character
 *      before `nodes` there is `_`, a word character, so no word boundary
 *      exists at that position.
 *   2. Page-keyed tables — outside `ALLOW_LIST`, a file that reads
 *      (`FROM`/`JOIN`) any of `page_revision`, `changeset`, `comments`,
 *      `links`, `page_tags`, `chunks`, `page_locks`, `presence` and names
 *      neither live view (nor its builder identifier, `liveNodes` /
 *      `livePageContent`) fails. This is what catches
 *      `packages/db/src/changesets/history.ts`, which lists a trashed
 *      page's revisions without ever naming `nodes`.
 *
 * `ALLOW_LIST` is a `Record<path, reason>`, in `test-coverage.ts`'s idiom: an
 * entry with an empty reason is an error, and so is a *stale* one — a path
 * that no longer exists, or a file entry whose content no longer trips
 * either rule. The list can only shrink without somebody deciding to grow
 * it: a temporarily allow-listed pending read site (Phases 3–4 of the
 * `deletion-and-trash` change) turns into an error, not silence, the moment
 * it is fixed, so nobody forgets to delete the line. Directory entries
 * (trailing `/`) are exempt from both the existence and the staleness
 * check: their justification is structural ("the resolver must walk
 * trashed rows"), not a property of any one file inside them, and one of
 * them — `packages/db/src/trash/` — is declared here ahead of the module it
 * names, which Phase 5 of this change still has to create.
 *
 * Migrations (`packages/db/drizzle/**\/*.sql`) are not `.ts` and are never
 * scanned; `*.test.ts` files are excluded by `TEST_FILE_PATTERN` for the
 * same reason `query-boundaries.ts` excludes them — a test legitimately
 * asserts against the base table's real behaviour.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

export interface TrashFilterResult {
  ok: boolean;
  errors: string[];
}

const SKIP_DIRS = new Set(['node_modules', 'dist', '.nuxt', '.astro', '.output', 'coverage', '__fixtures__']);
const SOURCE_FILE_PATTERN = /\.ts$/;
const TEST_FILE_PATTERN = /\.(test|spec)\.ts$/;

const BASE_TABLE_PATTERN = /\b(FROM|JOIN)\s+(nodes|page_content)\b/i;
/** `db.select().from(nodes)`, `.innerJoin(pageContent, …)`, `.leftJoin(nodes, …)`. */
const BASE_TABLE_BUILDER_PATTERN = /\.(from|join|innerJoin|leftJoin)\s*\(\s*(nodes|pageContent)\s*[,)]/i;

const PAGE_KEYED_TABLES = ['page_revision', 'changeset', 'comments', 'links', 'page_tags', 'chunks', 'page_locks', 'presence'];
const PAGE_KEYED_PATTERN = new RegExp(`\\b(FROM|JOIN)\\s+(${PAGE_KEYED_TABLES.join('|')})\\b`, 'i');

const LIVE_VIEW_PATTERN = /\blive_nodes\b|\blive_page_content\b|\bliveNodes\b|\blivePageContent\b/;

/**
 * X5 (design Decision 2's initial entries). A deliberate, reviewed
 * exemption per path — a file name for a single-file reason, a directory
 * (trailing `/`) for a structural one.
 */
export const ALLOW_LIST: Record<string, string> = {
  'packages/db/src/nodes/subtree.ts':
    'Path-prefix operations over the whole subtree, trashed rows included — the propagation writer that stamps every live descendant at trash time.',
  'packages/db/src/nodes/verify-paths.ts': 'Integrity check reads every row, trashed or live, by design.',
  'packages/db/src/permissions/':
    'The resolver must walk trashed rows so manage on a trashed node still resolves — non-disclosure is a read-site concern, not a permission-model one.',
  'packages/db/src/trash/':
    'The one module family that reads trashed rows on purpose: trash, restore, listing, lookup, trace and purge all operate on rows this check exists to hide from everyone else.',
  'packages/db/src/content/save-page.ts':
    'Write transaction and its reads, entered only after the route already located the node through live_nodes.',
  'packages/db/src/content/rebuild-derived.ts':
    'Write transaction and its reads, entered only after the route already located the node through live_nodes.',
  'packages/db/src/content/backfill-render.ts':
    'Write transaction and its reads, entered only after the route already located the node through live_nodes.',
  'packages/db/seed.ts':
    'Seeds a fresh database with rows that are all live by construction; not an application read path the trash mechanism guards.',
  'e2e/':
    'End-to-end fixtures set up scenarios by writing directly to the base tables; not an application read path.',

  // The "Phase 3/4 pending" block that lived here (design Decision 2:
  // "Everything else … turns red at first and is made green one file at a
  // time") is gone: Phases 3 and 4 closed every site on task 2.4's
  // proof-of-red list, plus the six gap files it found without a task
  // naming them. Only Decision 2's initial, structural exemptions remain
  // above.
};

/**
 * This check's own source and test necessarily contain the exact text
 * patterns it searches for, in doc comments, regex literals and assertion
 * strings describing the violating fixtures. Fixture-based tests already
 * exercise its real behaviour, so self-matches here would be pure noise.
 */
const SELF_FILES = new Set(['trash-filter.ts', 'trash-filter.test.ts']);

function isSelfFile(file: string): boolean {
  return SELF_FILES.has(file.split(sep).pop() ?? '');
}

function findFiles(dir: string, pattern: RegExp): string[] {
  const found: string[] = [];

  function walk(current: string): void {
    for (const entry of readdirSync(current)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(current, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (pattern.test(entry)) {
        found.push(full);
      }
    }
  }

  if (statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
    walk(dir);
  }
  return found;
}

function toPosix(relPath: string): string {
  return relPath.split(sep).join('/');
}

function isAllowListed(relPath: string, allowList: Record<string, string>): boolean {
  for (const entry of Object.keys(allowList)) {
    if (entry.endsWith('/')) {
      if (relPath === entry.slice(0, -1) || relPath.startsWith(entry)) return true;
    } else if (relPath === entry) {
      return true;
    }
  }
  return false;
}

function tripsEitherRule(content: string): boolean {
  const rule1 = BASE_TABLE_PATTERN.test(content) || BASE_TABLE_BUILDER_PATTERN.test(content);
  const rule2 = PAGE_KEYED_PATTERN.test(content) && !LIVE_VIEW_PATTERN.test(content);
  return rule1 || rule2;
}

function checkAllowListValidity(root: string, allowList: Record<string, string>, errors: string[]): void {
  for (const [entry, reason] of Object.entries(allowList)) {
    if (!reason || reason.trim().length === 0) {
      errors.push(`ALLOW_LIST: ${entry} has no reason — an exemption without a reason is an accident`);
      continue;
    }

    const isDir = entry.endsWith('/');
    if (isDir) continue;

    const absPath = join(root, ...entry.split('/').filter(Boolean));
    const stat = statSync(absPath, { throwIfNoEntry: false });

    if (!stat) {
      errors.push(`ALLOW_LIST: ${entry} no longer exists — delete this entry`);
      continue;
    }

    const content = readFileSync(absPath, 'utf8');
    if (!tripsEitherRule(content)) {
      errors.push(`ALLOW_LIST: ${entry} no longer trips rule 1 or rule 2 — delete this entry, the exemption has outlived its reason`);
    }
  }
}

export function checkTrashFilter(rootArg: string, allowList: Record<string, string> = ALLOW_LIST): TrashFilterResult {
  const root = resolve(rootArg);
  const errors: string[] = [];

  checkAllowListValidity(root, allowList, errors);

  const files = findFiles(root, SOURCE_FILE_PATTERN).filter((f) => !TEST_FILE_PATTERN.test(f) && !isSelfFile(f));

  for (const file of files) {
    const rel = toPosix(relative(root, file));
    if (isAllowListed(rel, allowList)) continue;

    const content = readFileSync(file, 'utf8');

    if (BASE_TABLE_PATTERN.test(content) || BASE_TABLE_BUILDER_PATTERN.test(content)) {
      errors.push(
        `${rel}: reads the base nodes/page_content table outside ALLOW_LIST — rule 1 (query live_nodes/live_page_content instead)`,
      );
    }

    if (PAGE_KEYED_PATTERN.test(content) && !LIVE_VIEW_PATTERN.test(content)) {
      errors.push(
        `${rel}: reads a page-keyed table without naming live_nodes/live_page_content — rule 2 (join the live view so a trashed page's row is excluded)`,
      );
    }
  }

  return { ok: errors.length === 0, errors };
}

if (import.meta.main) {
  const target = process.argv[2] ?? process.cwd();
  const result = checkTrashFilter(target);
  if (!result.ok) {
    for (const err of result.errors) {
      console.error(`trash-filter: ${err}`);
    }
    process.exit(1);
  }
  console.log('trash-filter: ok');
}
