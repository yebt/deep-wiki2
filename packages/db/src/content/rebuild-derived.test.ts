import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '../../testing/provision';
import { canonicalise } from '@deep-wiki/markdown';
import { ChainCompressionError, DeadAnchorError } from './rebuild-derived';
import { savePage } from './save-page';

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

async function seedWorkspace() {
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

async function seedPageNode() {
  const { workspaceId, rootId } = await seedWorkspace();
  const [page] = await sql`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${workspaceId}, ${rootId}, 'page', '', 0, ${`page-${crypto.randomUUID()}`}, 'Page') RETURNING id
  `;
  return { workspaceId, nodeId: page!.id as string };
}

// versioning-and-collaboration page-content spec: "Page Blocks Record
// Split Provenance". Reuses the split fixture already proven in
// match-blocks.test.ts's "matchBlocks: split" — one anchored block whose
// text splits into two paragraphs, the second of which shares no anchor
// with any prior block and must mint a fresh id recording its origin.
describe('reconcileDerived — split provenance', () => {
  test('a split fragment records the id of the block it split from', async () => {
    const { workspaceId, nodeId } = await seedPageNode();

    const first = await savePage(sql, {
      nodeId,
      workspaceId,
      markdown: 'Apples and oranges are tasty fruits, and bananas are also delicious. ^abc123\n',
      expectedContentHash: null,
    });

    await savePage(sql, {
      nodeId,
      workspaceId,
      markdown: 'Apples and oranges are tasty fruits.\n\nBananas are also delicious.\n',
      expectedContentHash: first.contentHash,
    });

    const rows = await sql<{ block_id: string; split_from: string | null }[]>`
      SELECT block_id, split_from FROM page_blocks
       WHERE page_id = ${nodeId} AND workspace_id = ${workspaceId} AND status = 'active'
       ORDER BY block_id
    `;
    expect(rows.length).toBeGreaterThanOrEqual(2);

    const original = rows.find((row) => row.block_id === 'abc123');
    expect(original).toBeTruthy();
    expect(original!.split_from).toBeNull();

    const minted = rows.find((row) => row.block_id !== 'abc123');
    expect(minted).toBeTruthy();
    expect(minted!.split_from).toBe('abc123');
  });
});

// versioning-and-collaboration page-content spec: "The Superseded Chain Is
// Walkable And Path-Compressed". These seed page_blocks rows directly
// (bypassing matchBlocks) so the chain shape is fully controlled: a chain
// of length one would exercise no compression at all, so every fixture
// here is at least three hops deep, and one is a genuine cycle.
describe('reconcileDerived — chain compression', () => {
  async function seedPageWithBlocks(): Promise<{ workspaceId: string; nodeId: string }> {
    const { workspaceId, nodeId } = await seedPageNode();
    await savePage(sql, { nodeId, workspaceId, markdown: 'A page with no anchors at all.\n', expectedContentHash: null });
    return { workspaceId, nodeId };
  }

  async function insertBlock(
    nodeId: string,
    workspaceId: string,
    blockId: string,
    status: 'active' | 'superseded' | 'tombstoned',
    supersededBy: string | null,
  ): Promise<void> {
    await sql`
      INSERT INTO page_blocks (page_id, workspace_id, block_id, status, superseded_by, content_hash, excerpt)
      VALUES (${nodeId}, ${workspaceId}, ${blockId}, ${status}, ${supersededBy}, 'hash', 'excerpt')
    `;
  }

  test('a five-hop merge chain resolves and compresses to the terminal survivor in one call', async () => {
    const { workspaceId, nodeId } = await seedPageWithBlocks();
    // Inserted target-first: the composite (page_id, superseded_by) FK
    // requires the referenced row to already exist.
    await insertBlock(nodeId, workspaceId, 'block-5', 'active', null);
    await insertBlock(nodeId, workspaceId, 'block-4', 'superseded', 'block-5');
    await insertBlock(nodeId, workspaceId, 'block-3', 'superseded', 'block-4');
    await insertBlock(nodeId, workspaceId, 'block-2', 'superseded', 'block-3');
    await insertBlock(nodeId, workspaceId, 'block-1', 'superseded', 'block-2');

    // Re-saving with no page_blocks-relevant edit still runs reconcileDerived,
    // and therefore compressChains, at the end of the transaction.
    const [row] = await sql<{ content_hash: string }[]>`SELECT content_hash FROM page_content WHERE node_id = ${nodeId}`;
    await savePage(sql, {
      nodeId,
      workspaceId,
      markdown: 'A page with no anchors at all.\n',
      expectedContentHash: row!.content_hash,
    });

    const rows = await sql<{ block_id: string; superseded_by: string | null }[]>`
      SELECT block_id, superseded_by FROM page_blocks
       WHERE page_id = ${nodeId} AND block_id IN ('block-1', 'block-2', 'block-3', 'block-4')
       ORDER BY block_id
    `;
    expect(rows).toHaveLength(4);
    for (const r of rows) {
      expect(r.superseded_by).toBe('block-5');
    }
  });

  test('a cyclic superseded_by chain fails loudly rather than looping or silently doing nothing', async () => {
    const { workspaceId, nodeId } = await seedPageWithBlocks();
    // Built in two steps because a genuine cycle cannot satisfy the
    // composite FK on first insert: seed cycle-a with no target, chain
    // cycle-b and cycle-c onto already-existing rows, then close the loop
    // with an UPDATE once cycle-c exists.
    await insertBlock(nodeId, workspaceId, 'cycle-a', 'superseded', null);
    await insertBlock(nodeId, workspaceId, 'cycle-b', 'superseded', 'cycle-a');
    await insertBlock(nodeId, workspaceId, 'cycle-c', 'superseded', 'cycle-b');
    await sql`UPDATE page_blocks SET superseded_by = 'cycle-c' WHERE page_id = ${nodeId} AND block_id = 'cycle-a'`;

    const [row] = await sql<{ content_hash: string }[]>`SELECT content_hash FROM page_content WHERE node_id = ${nodeId}`;
    await expect(
      savePage(sql, {
        nodeId,
        workspaceId,
        markdown: 'A page with no anchors at all.\n',
        expectedContentHash: row!.content_hash,
      }),
    ).rejects.toThrow(ChainCompressionError);
  });

  test('a chain deeper than the 64-hop guard fails loudly rather than truncating silently', async () => {
    const { workspaceId, nodeId } = await seedPageWithBlocks();
    const HOP_COUNT = 70;
    // Inserted target-first (highest index down to 0) for the same FK
    // reason as the five-hop fixture above.
    await insertBlock(nodeId, workspaceId, `deep-${HOP_COUNT}`, 'active', null);
    for (let i = HOP_COUNT - 1; i >= 0; i--) {
      await insertBlock(nodeId, workspaceId, `deep-${i}`, 'superseded', `deep-${i + 1}`);
    }

    const [row] = await sql<{ content_hash: string }[]>`SELECT content_hash FROM page_content WHERE node_id = ${nodeId}`;
    await expect(
      savePage(sql, {
        nodeId,
        workspaceId,
        markdown: 'A page with no anchors at all.\n',
        expectedContentHash: row!.content_hash,
      }),
    ).rejects.toThrow(ChainCompressionError);
  });
});


// markdown-pipeline: "Block Delete Tombstones The ID" — "A tombstoned ID
// MUST NOT be reused for a new block". The port-contract test in
// `packages/core/src/content/block-registry.test.ts` asserts this rule
// against a stub that `packages/db` does not implement, so it can never
// observe the real upsert. These fixtures go through `savePage` against a
// real Postgres, and every one of them reintroduces the dead anchor on the
// SAME page: the conflict this rule turns on is `(page_id, block_id)`, so a
// fixture spanning two pages would exercise nothing.
describe('reconcileDerived — a dead anchor reintroduced into the Markdown', () => {
  const WITH_ANCHOR = 'Apples and oranges are tasty fruits, and bananas are also delicious. ^abc1234567\n';
  const FILLER = 'Zebras migrate north through dusty savannah every summer without exception.\n';

  async function currentHash(nodeId: string): Promise<string> {
    const [row] = await sql<{ content_hash: string }[]>`SELECT content_hash FROM page_content WHERE node_id = ${nodeId}`;
    return row!.content_hash;
  }

  async function statusOf(nodeId: string, blockId: string) {
    const [row] = await sql<{ status: string; superseded_by: string | null }[]>`
      SELECT status, superseded_by FROM page_blocks WHERE page_id = ${nodeId} AND block_id = ${blockId}
    `;
    return row;
  }

  test('a tombstoned id stays tombstoned when its anchor is pasted back into the same page', async () => {
    const { workspaceId, nodeId } = await seedPageNode();

    await savePage(sql, { nodeId, workspaceId, markdown: `${WITH_ANCHOR}\n${FILLER}`, expectedContentHash: null });
    // Delete the anchored paragraph: matchBlocks scores it against nothing
    // it recognises, so the id is tombstoned.
    await savePage(sql, { nodeId, workspaceId, markdown: FILLER, expectedContentHash: await currentHash(nodeId) });
    expect((await statusOf(nodeId, 'abc1234567'))!.status).toBe('tombstoned');

    // The author pastes the paragraph back, literal ` ^abc1234567` and all
    // — entirely plausible now that history and diff screens show old
    // revision content verbatim.
    const hashBefore = await currentHash(nodeId);
    const reintroduced = `${FILLER}\n${WITH_ANCHOR}`;
    let refusal: DeadAnchorError | undefined;
    try {
      await savePage(sql, { nodeId, workspaceId, markdown: reintroduced, expectedContentHash: hashBefore });
    } catch (error) {
      refusal = error as DeadAnchorError;
    }

    expect(refusal).toBeInstanceOf(DeadAnchorError);
    expect(refusal!.anchors).toEqual([{ id: 'abc1234567', status: 'tombstoned' }]);

    // Asserting only that the save was refused would prove nothing about
    // the row it exists to protect.
    expect((await statusOf(nodeId, 'abc1234567'))!.status).toBe('tombstoned');
    // `reconcileDerived` runs inside `savePage`'s transaction, so the
    // refusal has to roll the content write back with it.
    expect(await currentHash(nodeId)).toBe(hashBefore);
  });

  test('the refusal hands back a canonical document the author can re-save', async () => {
    const { workspaceId, nodeId } = await seedPageNode();

    await savePage(sql, { nodeId, workspaceId, markdown: `${WITH_ANCHOR}\n${FILLER}`, expectedContentHash: null });
    await savePage(sql, { nodeId, workspaceId, markdown: FILLER, expectedContentHash: await currentHash(nodeId) });

    const reintroduced = `${FILLER}\n${WITH_ANCHOR}`;
    const refusal = (await savePage(sql, {
      nodeId,
      workspaceId,
      markdown: reintroduced,
      expectedContentHash: await currentHash(nodeId),
    }).catch((error: unknown) => error)) as DeadAnchorError;

    // The correction drops the dead anchor and nothing else: the author's
    // prose survives byte for byte, only the retired ` ^id` is gone. Block
    // ids are assigned lazily, so pasted text nothing references yet
    // carries no persisted id at all.
    expect(refusal.corrected).toBe(reintroduced.replace(' ^abc1234567', ''));
    expect(refusal.corrected).toContain('Apples and oranges are tasty fruits');
    // A correction `savePage` would itself reject as non-canonical would be
    // no correction at all.
    expect(canonicalise(refusal.corrected)).toBe(refusal.corrected);

    const accepted = await savePage(sql, {
      nodeId,
      workspaceId,
      markdown: refusal.corrected,
      expectedContentHash: await currentHash(nodeId),
    });
    expect(accepted.contentHash).toBeTruthy();
    expect((await statusOf(nodeId, 'abc1234567'))!.status).toBe('tombstoned');
  });

  test('a superseded id keeps pointing at its survivor when its anchor is pasted back', async () => {
    const { workspaceId, nodeId } = await seedPageNode();

    const separate = 'Apples and oranges are tasty fruits. ^aaa1111111\n\nBananas and mangoes are also delicious. ^bbb2222222\n';
    const merged = 'Apples and oranges are tasty fruits. Bananas and mangoes are also delicious. ^aaa1111111\n';

    await savePage(sql, { nodeId, workspaceId, markdown: separate, expectedContentHash: null });
    await savePage(sql, { nodeId, workspaceId, markdown: merged, expectedContentHash: await currentHash(nodeId) });

    const afterMerge = await statusOf(nodeId, 'bbb2222222');
    expect(afterMerge!.status).toBe('superseded');
    expect(afterMerge!.superseded_by).toBe('aaa1111111');

    // `FILLER` sits between the two so `matchBlocks`' split pass has no
    // adjacent unclaimed slot to mint into — this fixture is about the
    // first-time-registration path and nothing else.
    const refusal = (await savePage(sql, {
      nodeId,
      workspaceId,
      markdown: `${merged}\n${FILLER}\nBananas and mangoes are also delicious. ^bbb2222222\n`,
      expectedContentHash: await currentHash(nodeId),
    }).catch((error: unknown) => error)) as DeadAnchorError;

    expect(refusal).toBeInstanceOf(DeadAnchorError);
    expect(refusal.anchors).toEqual([{ id: 'bbb2222222', status: 'superseded' }]);

    const afterPaste = await statusOf(nodeId, 'bbb2222222');
    // `superseded_by` is exactly the pointer `reconcile-comments.ts` walks
    // to migrate a thread onto the surviving block. Clearing it detaches
    // the thread, and orphaning is one-way.
    expect(afterPaste!.status).toBe('superseded');
    expect(afterPaste!.superseded_by).toBe('aaa1111111');
  });
});

// The application guard above lives in one module. This one asserts the
// storage layer refuses the same thing on its own (migration 0016), so
// deleting every tombstone check in `packages/db` cannot leave the suite
// green — which is exactly what the `BlockRegistry` port-contract test used
// to allow.
describe('page_blocks — retirement is terminal in the database itself', () => {
  async function seedRetiredBlock(status: 'superseded' | 'tombstoned') {
    const { workspaceId, nodeId } = await seedPageNode();
    await savePage(sql, { nodeId, workspaceId, markdown: 'A page with no anchors at all.\n', expectedContentHash: null });
    if (status === 'superseded') {
      await sql`
        INSERT INTO page_blocks (page_id, workspace_id, block_id, status, content_hash, excerpt)
        VALUES (${nodeId}, ${workspaceId}, 'survivor00', 'active', 'hash', 'excerpt')
      `;
    }
    await sql`
      INSERT INTO page_blocks (page_id, workspace_id, block_id, status, superseded_by, content_hash, excerpt)
      VALUES (
        ${nodeId}, ${workspaceId}, 'retired000', ${status},
        ${status === 'superseded' ? 'survivor00' : null}, 'hash', 'excerpt'
      )
    `;
    return { workspaceId, nodeId };
  }

  test('a raw UPDATE cannot flip a tombstoned row back to active', async () => {
    const { nodeId } = await seedRetiredBlock('tombstoned');

    // Wrapped in a native Promise: a bare postgres.js tagged-template query
    // is a lazy thenable, and `expect(query).rejects` spins the runner on it
    // until the timeout instead of executing it (docs/TODO.md, 2026-09-08).
    await expect(
      (async () => {
        await sql`UPDATE page_blocks SET status = 'active' WHERE page_id = ${nodeId} AND block_id = 'retired000'`;
      })(),
    ).rejects.toThrow(/tombstoned/);

    const [row] = await sql<{ status: string }[]>`
      SELECT status FROM page_blocks WHERE page_id = ${nodeId} AND block_id = 'retired000'
    `;
    expect(row!.status).toBe('tombstoned');
  });

  test('a raw UPDATE cannot revive a superseded row or clear its survivor pointer', async () => {
    const { nodeId } = await seedRetiredBlock('superseded');

    await expect(
      (async () => {
        await sql`UPDATE page_blocks SET status = 'active', superseded_by = NULL WHERE page_id = ${nodeId} AND block_id = 'retired000'`;
      })(),
    ).rejects.toThrow(/superseded/);

    await expect(
      (async () => {
        await sql`UPDATE page_blocks SET superseded_by = NULL WHERE page_id = ${nodeId} AND block_id = 'retired000'`;
      })(),
    ).rejects.toThrow(/superseded_by cannot be cleared/);

    const [row] = await sql<{ status: string; superseded_by: string | null }[]>`
      SELECT status, superseded_by FROM page_blocks WHERE page_id = ${nodeId} AND block_id = 'retired000'
    `;
    expect(row!.status).toBe('superseded');
    expect(row!.superseded_by).toBe('survivor00');
  });
});
