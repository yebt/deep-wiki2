import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import type { BlockSlice } from '@deep-wiki/markdown';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '../../testing/provision';
import { reconcileComments } from './reconcile-comments';

let db: ProvisionedTestDatabase;
let sql: postgres.Sql;

beforeAll(async () => {
  db = await provisionTestDatabase();
  sql = postgres(db.url, { max: 1 });
});

afterAll(async () => {
  await sql.end({ timeout: 1 }).catch(() => {});
  await db.drop();
});

async function seedWorkspace(): Promise<{ workspaceId: string; rootId: string }> {
  const [plan] = await sql`
    INSERT INTO plans (name, max_workspaces, max_seats, max_storage_bytes, max_ai_tokens_monthly)
    VALUES (${`plan-${crypto.randomUUID()}`}, 3, 5, '1000000', '1000') RETURNING id
  `;
  const [user] = await sql`
    INSERT INTO users (email, password_hash, display_name, plan_id)
    VALUES (${`owner-${crypto.randomUUID()}@example.com`}, 'hash', 'Owner', ${plan!.id}) RETURNING id
  `;
  const [workspace] = await sql`
    INSERT INTO workspaces (owner_id, name, slug)
    VALUES (${user!.id}, 'Acme', ${`acme-${crypto.randomUUID()}`}) RETURNING id
  `;
  const [root] = await sql`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${workspace!.id}, NULL, 'workspace', '', 0, 'root', 'Root') RETURNING id
  `;
  return { workspaceId: workspace!.id as string, rootId: root!.id as string };
}

async function seedPage(workspaceId: string, rootId: string): Promise<string> {
  const [page] = await sql`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${workspaceId}, ${rootId}, 'page', '', 0, ${`page-${crypto.randomUUID()}`}, 'Page') RETURNING id
  `;
  return page!.id as string;
}

async function seedPageContent(nodeId: string, workspaceId: string, markdown: string): Promise<void> {
  await sql`
    INSERT INTO page_content (node_id, workspace_id, markdown, content_hash)
    VALUES (${nodeId}, ${workspaceId}, ${markdown}, 'hash')
  `;
}

async function seedBlock(
  nodeId: string,
  workspaceId: string,
  blockId: string,
  status: 'active' | 'superseded' | 'tombstoned',
  supersededBy: string | null = null,
  splitFrom: string | null = null,
): Promise<void> {
  await sql`
    INSERT INTO page_blocks (page_id, workspace_id, block_id, status, superseded_by, split_from, content_hash, excerpt)
    VALUES (${nodeId}, ${workspaceId}, ${blockId}, ${status}, ${supersededBy}, ${splitFrom}, 'hash', 'excerpt')
  `;
}

async function seedComment(
  workspaceId: string,
  pageId: string,
  blockId: string,
  quote: string,
  offsetStart: number,
  offsetEnd: number,
): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO comments (workspace_id, page_id, body, block_id, offset_start, offset_end, quote, quote_hash, status)
    VALUES (${workspaceId}, ${pageId}, 'a comment', ${blockId}, ${offsetStart}, ${offsetEnd}, ${quote}, 'h', 'anchored')
    RETURNING id
  `;
  return row!.id;
}

function slice(id: string, text: string): BlockSlice {
  return { id, anchorId: id, text };
}

async function readComment(id: string): Promise<{ block_id: string; offset_start: number; offset_end: number; status: string }> {
  const [row] = await sql<{ block_id: string; offset_start: number; offset_end: number; status: string }[]>`
    SELECT block_id, offset_start, offset_end, status FROM comments WHERE id = ${id}
  `;
  return row!;
}

// comment-threads spec: "Save-Time Reconciliation Resolves Every Anchor Per
// Block Transition" — one fixture per row of design.md's confidence table,
// deterministic (page_blocks seeded directly, not derived through
// matchBlocks' own fuzzy scoring) so each transition is exercised for the
// exact reason named, not incidentally.
describe('reconcileComments — confidence table', () => {
  test('unchanged block keeps its anchor at the exact same offsets', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const pageId = await seedPage(workspaceId, rootId);
    await seedPageContent(pageId, workspaceId, 'irrelevant');
    await seedBlock(pageId, workspaceId, 'block-a', 'active');
    const text = 'This paragraph never changes at all between saves.';
    const quote = 'never changes';
    const offsetStart = text.indexOf(quote);
    const commentId = await seedComment(workspaceId, pageId, 'block-a', quote, offsetStart, offsetStart + quote.length);

    await reconcileComments(sql, {
      nodeId: pageId,
      assignments: [],
      mintedIds: [],
      nextBlocks: [slice('block-a', text)],
    });

    const after = await readComment(commentId);
    expect(after.status).toBe('anchored');
    expect(after.block_id).toBe('block-a');
    expect(after.offset_start).toBe(offsetStart);
    expect(after.offset_end).toBe(offsetStart + quote.length);
  });

  test('in-place edit keeps the same block id and recomputes shifted offsets', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const pageId = await seedPage(workspaceId, rootId);
    await seedPageContent(pageId, workspaceId, 'irrelevant');
    await seedBlock(pageId, workspaceId, 'block-b', 'active');
    // Quote captured against the original text at offsets [4, 9): "quick".
    const commentId = await seedComment(workspaceId, pageId, 'block-b', 'quick', 4, 9);
    // The current text prepends a word, shifting "quick" forward — same id, new offsets.
    const editedText = 'The very quick fox jumps.';

    await reconcileComments(sql, {
      nodeId: pageId,
      assignments: [],
      mintedIds: [],
      nextBlocks: [slice('block-b', editedText)],
    });

    const after = await readComment(commentId);
    expect(after.status).toBe('anchored');
    expect(after.block_id).toBe('block-b');
    expect(after.offset_start).toBe(editedText.indexOf('quick'));
    expect(after.offset_end).toBe(editedText.indexOf('quick') + 'quick'.length);
    expect(after.offset_start).not.toBe(4);
  });

  test('high-confidence merge follows the superseded chain to the surviving block', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const pageId = await seedPage(workspaceId, rootId);
    await seedPageContent(pageId, workspaceId, 'irrelevant');
    await seedBlock(pageId, workspaceId, 'survivor', 'active');
    await seedBlock(pageId, workspaceId, 'loser', 'superseded', 'survivor');
    const quote = 'Apples and oranges are tasty fruits';
    const commentId = await seedComment(workspaceId, pageId, 'loser', quote, 0, quote.length);
    const survivorText = `${quote}, sweet and juicy, bananas are also delicious.`;

    await reconcileComments(sql, {
      nodeId: pageId,
      assignments: [],
      mintedIds: [],
      nextBlocks: [slice('survivor', survivorText)],
    });

    const after = await readComment(commentId);
    expect(after.status).toBe('anchored');
    expect(after.block_id).toBe('survivor');
    expect(after.offset_start).toBe(0);
    expect(after.offset_end).toBe(quote.length);
  });

  // Quality-bar flag: the best-scoring candidate is deliberately built to
  // land BELOW 0.8 (not merely below some arbitrary bar) — a fixture whose
  // top score happens to clear 0.8 would take the migrate path for the
  // right reason but prove nothing about the orphan branch specifically.
  test('low-confidence merge orphans rather than guessing', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const pageId = await seedPage(workspaceId, rootId);
    await seedPageContent(pageId, workspaceId, 'irrelevant');
    await seedBlock(pageId, workspaceId, 'survivor', 'active');
    await seedBlock(pageId, workspaceId, 'loser', 'superseded', 'survivor');
    const quote = 'the quarterly budget report revealed several urgent errors';
    const commentId = await seedComment(workspaceId, pageId, 'loser', quote, 0, quote.length);
    // Deliberately shares almost no trigrams with the quote (score well under 0.8).
    const survivorText = 'The committee will reconvene next month to discuss unrelated matters entirely.';

    await reconcileComments(sql, {
      nodeId: pageId,
      assignments: [],
      mintedIds: [],
      nextBlocks: [slice('survivor', survivorText)],
    });

    const after = await readComment(commentId);
    expect(after.status).toBe('orphaned');
  });

  // A second fixture confirming a score just above 0.8 migrates — proving
  // the orphan fixture above lands on the correct side of the boundary
  // rather than the containment function simply never finding anything.
  test('a high-but-not-exact containment score above 0.8 migrates to the split fragment', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const pageId = await seedPage(workspaceId, rootId);
    await seedPageContent(pageId, workspaceId, 'irrelevant');
    await seedBlock(pageId, workspaceId, 'original', 'active');
    await seedBlock(pageId, workspaceId, 'fragment', 'active', null, 'original');
    const quote = 'the annual harvest festival draws visitors from every neighbouring town during the entire month of october each year';
    const commentId = await seedComment(workspaceId, pageId, 'original', quote, 0, quote.length);
    const originalText = 'This paragraph is now about something else entirely, unrelated to the quote.';
    // One word changed ("neighbouring" -> "nearby") near the middle of a
    // long shared phrase — high containment (0.8125), not exact.
    const fragmentText = 'the annual harvest festival draws visitors from every nearby town during the entire month of october each year';

    await reconcileComments(sql, {
      nodeId: pageId,
      assignments: [],
      mintedIds: [],
      nextBlocks: [slice('original', originalText), slice('fragment', fragmentText)],
    });

    const after = await readComment(commentId);
    expect(after.status).toBe('anchored');
    expect(after.block_id).toBe('fragment');
  });

  test('a tie at the top score orphans rather than picking either candidate', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const pageId = await seedPage(workspaceId, rootId);
    await seedPageContent(pageId, workspaceId, 'irrelevant');
    await seedBlock(pageId, workspaceId, 'original', 'active');
    await seedBlock(pageId, workspaceId, 'fragment-a', 'active', null, 'original');
    await seedBlock(pageId, workspaceId, 'fragment-b', 'active', null, 'original');
    const quote = 'completely unrelated wording matching nothing here';
    const commentId = await seedComment(workspaceId, pageId, 'original', quote, 0, quote.length);
    // Identical (and equally poor) candidate text on both sides — a genuine tie.
    const sharedText = 'Nothing in this paragraph resembles the original quote whatsoever.';

    await reconcileComments(sql, {
      nodeId: pageId,
      assignments: [],
      mintedIds: [],
      nextBlocks: [slice('original', sharedText), slice('fragment-a', sharedText), slice('fragment-b', sharedText)],
    });

    const after = await readComment(commentId);
    expect(after.status).toBe('orphaned');
  });

  test('a tombstoned block orphans unconditionally, even if its old text still exists elsewhere', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const pageId = await seedPage(workspaceId, rootId);
    await seedPageContent(pageId, workspaceId, 'irrelevant');
    await seedBlock(pageId, workspaceId, 'gone', 'tombstoned');
    const quote = 'this text is gone';
    const commentId = await seedComment(workspaceId, pageId, 'gone', quote, 0, quote.length);

    await reconcileComments(sql, { nodeId: pageId, assignments: [], mintedIds: [], nextBlocks: [] });

    const after = await readComment(commentId);
    expect(after.status).toBe('orphaned');
  });

  test('an orphaned comment is never re-anchored by a later save, even at a perfect-match offset', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const pageId = await seedPage(workspaceId, rootId);
    await seedPageContent(pageId, workspaceId, 'irrelevant');
    await seedBlock(pageId, workspaceId, 'block-c', 'active');
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO comments (workspace_id, page_id, body, block_id, offset_start, offset_end, quote, quote_hash, status)
      VALUES (${workspaceId}, ${pageId}, 'a comment', 'block-c', 0, 5, 'exact', 'h', 'orphaned')
      RETURNING id
    `;

    await reconcileComments(sql, {
      nodeId: pageId,
      assignments: [],
      mintedIds: [],
      nextBlocks: [slice('block-c', 'exact match text right here')],
    });

    const after = await readComment(row!.id);
    expect(after.status).toBe('orphaned');
  });

  // trash-non-disclosure spec: this function only ever runs inside the save
  // transaction on the page currently being saved (`rebuild-derived.ts`,
  // entered after the route already located it through `live_nodes`), but
  // reconciliation itself must be a no-op for a trashed id, identically to
  // an id with no anchored comments at all — never touching a comment row
  // that belongs to a page nobody should be able to write to anymore.
  test('is a no-op for a trashed page, identically to a page with no anchored comments', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const pageId = await seedPage(workspaceId, rootId);
    await seedPageContent(pageId, workspaceId, 'irrelevant');
    await seedBlock(pageId, workspaceId, 'block-a', 'active');
    const text = 'This paragraph never changes at all between saves.';
    const quote = 'never changes';
    const offsetStart = text.indexOf(quote);
    const commentId = await seedComment(workspaceId, pageId, 'block-a', quote, offsetStart, offsetStart + quote.length);
    await sql`UPDATE nodes SET trashed_at = now(), trash_operation_id = ${crypto.randomUUID()} WHERE id = ${pageId}`;

    await reconcileComments(sql, {
      nodeId: pageId,
      assignments: [],
      mintedIds: [],
      // A shape that would otherwise orphan the comment (no block named
      // 'block-a' survives) — proving the no-op comes from the trashed
      // guard, not from a matching confidence-table row.
      nextBlocks: [],
    });

    const after = await readComment(commentId);
    expect(after.status).toBe('anchored');
    expect(after.block_id).toBe('block-a');
  });
});
