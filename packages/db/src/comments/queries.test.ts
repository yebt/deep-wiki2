import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '../../testing/provision';
import { savePage } from '../content/save-page';
import { createReply, createRootComment, listCommentIndicators, setThreadResolved } from './queries';

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

async function seedUser(): Promise<string> {
  const [plan] = await sql`
    INSERT INTO plans (name, max_workspaces, max_seats, max_storage_bytes, max_ai_tokens_monthly)
    VALUES (${`plan-${crypto.randomUUID()}`}, 3, 5, '1000000', '1000') RETURNING id
  `;
  const [user] = await sql`
    INSERT INTO users (email, password_hash, display_name, plan_id)
    VALUES (${`author-${crypto.randomUUID()}@example.com`}, 'hash', 'Author', ${plan!.id}) RETURNING id
  `;
  return user!.id as string;
}

describe('comment queries', () => {
  test('listCommentIndicators counts a root plus its replies against the root block', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const pageId = await seedPage(workspaceId, rootId);
    await savePage(sql, { nodeId: pageId, workspaceId, markdown: 'Some text. ^blocka\n', expectedContentHash: null });
    const authorId = await seedUser();

    const root = await createRootComment(sql, {
      workspaceId,
      pageId,
      authorId,
      body: 'first',
      blockId: 'blocka',
      offsetStart: 0,
      offsetEnd: 4,
      quote: 'Some',
      quoteHash: 'h',
    });
    await createReply(sql, { workspaceId, pageId, parentId: root.id, authorId, body: 'a reply' });

    const indicators = await listCommentIndicators(sql, { pageId });
    expect(indicators).toEqual([{ blockId: 'blocka', count: 2 }]);
  });

  test('listCommentIndicators excludes orphaned threads', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const pageId = await seedPage(workspaceId, rootId);
    await savePage(sql, { nodeId: pageId, workspaceId, markdown: 'Some text. ^blockb\n', expectedContentHash: null });
    const authorId = await seedUser();
    const root = await createRootComment(sql, {
      workspaceId,
      pageId,
      authorId,
      body: 'first',
      blockId: 'blockb',
      offsetStart: 0,
      offsetEnd: 4,
      quote: 'Some',
      quoteHash: 'h',
    });
    await sql`UPDATE comments SET status = 'orphaned' WHERE id = ${root.id}`;

    const indicators = await listCommentIndicators(sql, { pageId });
    expect(indicators).toEqual([]);
  });

  test('setThreadResolved marks and unmarks a root thread only', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const pageId = await seedPage(workspaceId, rootId);
    await savePage(sql, { nodeId: pageId, workspaceId, markdown: 'Some text. ^blockc\n', expectedContentHash: null });
    const authorId = await seedUser();
    const root = await createRootComment(sql, {
      workspaceId,
      pageId,
      authorId,
      body: 'first',
      blockId: 'blockc',
      offsetStart: 0,
      offsetEnd: 4,
      quote: 'Some',
      quoteHash: 'h',
    });

    const resolvedOk = await setThreadResolved(sql, { threadId: root.id, workspaceId, resolved: true, resolvedBy: authorId });
    expect(resolvedOk).toBe(true);
    let [row] = await sql<{ resolved_at: Date | null }[]>`SELECT resolved_at FROM comments WHERE id = ${root.id}`;
    expect(row!.resolved_at).not.toBeNull();

    const unresolvedOk = await setThreadResolved(sql, { threadId: root.id, workspaceId, resolved: false, resolvedBy: authorId });
    expect(unresolvedOk).toBe(true);
    [row] = await sql<{ resolved_at: Date | null }[]>`SELECT resolved_at FROM comments WHERE id = ${root.id}`;
    expect(row!.resolved_at).toBeNull();
  });

  test('a resolved thread persists across a later reconciliation-triggering save', async () => {
    const { workspaceId, rootId } = await seedWorkspace();
    const pageId = await seedPage(workspaceId, rootId);
    const first = await savePage(sql, { nodeId: pageId, workspaceId, markdown: 'Some text. ^blockd\n', expectedContentHash: null });
    const authorId = await seedUser();
    const root = await createRootComment(sql, {
      workspaceId,
      pageId,
      authorId,
      body: 'first',
      blockId: 'blockd',
      offsetStart: 0,
      offsetEnd: 4,
      quote: 'Some',
      quoteHash: 'h',
    });
    await setThreadResolved(sql, { threadId: root.id, workspaceId, resolved: true, resolvedBy: authorId });

    // In-place edit, same anchor, same id — reconciliation runs but does not touch resolution.
    await savePage(sql, { nodeId: pageId, workspaceId, markdown: 'Some other text. ^blockd\n', expectedContentHash: first.contentHash });

    const [row] = await sql<{ resolved_at: Date | null }[]>`SELECT resolved_at FROM comments WHERE id = ${root.id}`;
    expect(row!.resolved_at).not.toBeNull();
  });
});
