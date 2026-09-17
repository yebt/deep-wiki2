import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '../../testing/provision';
import { createNode, DuplicateSiblingSlugError, UnslugifiableTitleError } from './create';
import { NodeNotFoundError, renameNode } from './rename';

let db: ProvisionedTestDatabase;
let sql: postgres.Sql;

beforeAll(async () => {
  db = await provisionTestDatabase();
  sql = postgres(db.url, { max: 5 });
});

afterAll(async () => {
  await sql.end({ timeout: 1 }).catch(() => {});
  await db.drop();
});

async function insertNode(workspaceId: string, parentId: string | null, type: string, slug: string): Promise<{ id: string; path: string }> {
  const [row] = await sql<{ id: string; path: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${workspaceId}, ${parentId}, ${type}::node_type, '', 0, ${slug}, ${slug})
    RETURNING id, path
  `;
  return row!;
}

async function seedTree() {
  const [plan] = await sql`
    INSERT INTO plans (name, max_workspaces, max_seats, max_storage_bytes, max_ai_tokens_monthly)
    VALUES (${`plan-${crypto.randomUUID()}`}, 10, 5, '1000000', '1000') RETURNING id
  `;
  const [user] = await sql`
    INSERT INTO users (email, password_hash, display_name, plan_id)
    VALUES (${`owner-${crypto.randomUUID()}@example.com`}, 'hash', 'Owner', ${plan!.id}) RETURNING id
  `;
  const [workspace] = await sql`
    INSERT INTO workspaces (owner_id, name, slug) VALUES (${user!.id}, 'Acme', ${`acme-${crypto.randomUUID()}`}) RETURNING id
  `;
  const workspaceId = workspace!.id as string;
  const root = await insertNode(workspaceId, null, 'workspace', 'root');
  const shelf = await insertNode(workspaceId, root.id, 'shelf', 'shelf');
  const book = await insertNode(workspaceId, shelf.id, 'book', 'book');
  return { workspaceId, root, shelf, book };
}

describe('renameNode', () => {
  test('rewrites the title and the slug together', async () => {
    const tree = await seedTree();
    const chapter = await createNode(sql, { parentId: tree.book.id, type: 'chapter', title: 'Getting Started' });

    const renamed = await renameNode(sql, { nodeId: chapter.id, title: 'Getting Started, Properly' });

    expect(renamed.title).toBe('Getting Started, Properly');
    expect(renamed.slug).toBe('getting-started-properly');

    const [row] = await sql<{ title: string; slug: string }[]>`SELECT title, slug FROM nodes WHERE id = ${chapter.id}`;
    expect(row!.title).toBe('Getting Started, Properly');
    expect(row!.slug).toBe('getting-started-properly');
  });

  /** `path` is an id chain (design.md D3), so a slug change moves nothing. This is what says so. */
  test('leaves the node’s path and its children untouched', async () => {
    const tree = await seedTree();
    const chapter = await createNode(sql, { parentId: tree.book.id, type: 'chapter', title: 'Chapter' });
    const page = await createNode(sql, { parentId: chapter.id, type: 'page', title: 'Page' });
    const [before] = await sql<{ path: string }[]>`SELECT path FROM nodes WHERE id = ${page.id}`;

    await renameNode(sql, { nodeId: chapter.id, title: 'Renamed chapter' });

    const [after] = await sql<{ path: string; slug: string }[]>`SELECT path, slug FROM nodes WHERE id = ${page.id}`;
    expect(after!.path).toBe(before!.path);
    expect(after!.slug).toBe('page');
  });

  test('renaming a node to the name it already has is a no-op, not a self-collision', async () => {
    const tree = await seedTree();
    const chapter = await createNode(sql, { parentId: tree.book.id, type: 'chapter', title: 'Overview' });

    const renamed = await renameNode(sql, { nodeId: chapter.id, title: 'Overview' });

    expect(renamed.slug).toBe('overview');
  });

  test('renaming onto a sibling’s name is refused by the same rule that refuses creating one', async () => {
    const tree = await seedTree();
    await createNode(sql, { parentId: tree.book.id, type: 'chapter', title: 'Overview' });
    const other = await createNode(sql, { parentId: tree.book.id, type: 'chapter', title: 'Appendix' });

    const error = await renameNode(sql, { nodeId: other.id, title: 'Overview' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DuplicateSiblingSlugError);
    expect((error as DuplicateSiblingSlugError).slug).toBe('overview');

    const [row] = await sql<{ title: string }[]>`SELECT title FROM nodes WHERE id = ${other.id}`;
    expect(row!.title).toBe('Appendix');
  });

  test('a title with nothing sluggable in it is refused', async () => {
    const tree = await seedTree();
    const chapter = await createNode(sql, { parentId: tree.book.id, type: 'chapter', title: 'Overview' });

    const error = await renameNode(sql, { nodeId: chapter.id, title: '###' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UnslugifiableTitleError);
  });

  /** The workspace root has no parent, so `(parent_id, slug)` cannot answer for it; renaming it is not this route's job. */
  test('the workspace root cannot be renamed here', async () => {
    const tree = await seedTree();

    const error = await renameNode(sql, { nodeId: tree.root.id, title: 'New name' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/workspace root/i);
  });

  test('a node that does not exist is refused', async () => {
    const error = await renameNode(sql, { nodeId: crypto.randomUUID(), title: 'Ghost' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NodeNotFoundError);
  });
});

describe('nodes_parent_slug_live_idx — live-only slug uniqueness (tenancy-model spec)', () => {
  /**
   * `renameNode()` itself is not rewritten to filter on `trashed_at` until
   * Phase 3 of the deletion-and-trash change (design.md Decision 9); these
   * two tests state the *storage-layer* invariant the partial index
   * (`0022_trash.sql`) already enforces, independent of the application
   * layer, using raw inserts exactly like `insertNode` above.
   */
  test('a live node may take a trashed sibling’s slug', async () => {
    const tree = await seedTree();
    const chapter = await createNode(sql, { parentId: tree.book.id, type: 'chapter', title: 'Overview' });
    const opId = crypto.randomUUID();
    await sql`UPDATE nodes SET trashed_at = now(), trash_operation_id = ${opId} WHERE id = ${chapter.id}`;

    const recreated = await insertNode(tree.workspaceId, tree.book.id, 'chapter', 'overview');

    expect(recreated.id).not.toBe(chapter.id);
    const rows = await sql<{ id: string }[]>`SELECT id FROM nodes WHERE parent_id = ${tree.book.id} AND slug = 'overview'`;
    expect(rows).toHaveLength(2);
  });

  test('two live siblings still cannot share a slug', async () => {
    const tree = await seedTree();
    await createNode(sql, { parentId: tree.book.id, type: 'chapter', title: 'Overview' });

    const error = await insertNode(tree.workspaceId, tree.book.id, 'chapter', 'overview').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
  });
});

describe('renameNode — a trashed node (node-trash / trash-non-disclosure)', () => {
  /** Phase 3 (design.md Decision 9): the node lookup now goes through `live_nodes`. */
  test('renaming a trashed node is refused identically to an unknown node', async () => {
    const tree = await seedTree();
    const chapter = await createNode(sql, { parentId: tree.book.id, type: 'chapter', title: 'Overview' });
    await sql`UPDATE nodes SET trashed_at = now(), trash_operation_id = ${crypto.randomUUID()} WHERE id = ${chapter.id}`;

    const error = await renameNode(sql, { nodeId: chapter.id, title: 'New Title' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NodeNotFoundError);
    const [row] = await sql<{ title: string }[]>`SELECT title FROM nodes WHERE id = ${chapter.id}`;
    expect(row!.title).toBe('Overview');
  });

  test('renaming to a trashed sibling’s slug succeeds — the collision rule only sees live siblings', async () => {
    const tree = await seedTree();
    const trashed = await createNode(sql, { parentId: tree.book.id, type: 'chapter', title: 'Overview' });
    await sql`UPDATE nodes SET trashed_at = now(), trash_operation_id = ${crypto.randomUUID()} WHERE id = ${trashed.id}`;
    const other = await createNode(sql, { parentId: tree.book.id, type: 'chapter', title: 'Appendix' });

    const renamed = await renameNode(sql, { nodeId: other.id, title: 'Overview' });

    expect(renamed.slug).toBe('overview');
  });
});
