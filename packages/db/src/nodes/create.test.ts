import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { IllegalParentTypeError } from '@deep-wiki/core';
import postgres from 'postgres';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '../../testing/provision';
import { createNode, DuplicateSiblingSlugError, ParentNodeNotFoundError, UnslugifiableTitleError } from './create';

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

interface Row {
  id: string;
  path: string;
}

async function insertNode(workspaceId: string, parentId: string | null, type: string, slug: string, position = 0): Promise<Row> {
  const [row] = await sql<Row[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${workspaceId}, ${parentId}, ${type}::node_type, '', ${position}, ${slug}, ${slug})
    RETURNING id, path
  `;
  return row!;
}

async function seedWorkspace(): Promise<string> {
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
  return workspace!.id as string;
}

/** Shelf -> Book -> Chapter, so nothing here is created directly under the workspace root. */
async function seedTree() {
  const workspaceId = await seedWorkspace();
  const root = await insertNode(workspaceId, null, 'workspace', 'root');
  const shelf = await insertNode(workspaceId, root.id, 'shelf', 'shelf');
  const book = await insertNode(workspaceId, shelf.id, 'book', 'book');
  const chapter = await insertNode(workspaceId, book.id, 'chapter', 'chapter');
  const page = await insertNode(workspaceId, chapter.id, 'page', 'page');
  return { workspaceId, root, shelf, book, chapter, page };
}

describe('createNode — legal nesting', () => {
  /**
   * Deliberately NOT under the workspace root. A creation test whose
   * parent is always the root exercises `LEGAL_PARENT_TYPES` not at all:
   * `shelf` is the only legal child of `workspace`, so every such test
   * passes for the wrong reason.
   */
  test('a page under a chapter is created, positioned last, and carries the parent’s workspace', async () => {
    const tree = await seedTree();

    const created = await createNode(sql, { parentId: tree.chapter.id, type: 'page', title: 'Local Development Setup' });

    expect(created.slug).toBe('local-development-setup');
    expect(created.type).toBe('page');
    expect(created.parentId).toBe(tree.chapter.id);
    // The chapter already holds one page at position 0.
    expect(created.position).toBe(1);

    const [row] = await sql<{ workspace_id: string; path: string; title: string; slug: string }[]>`
      SELECT workspace_id, path, title, slug FROM nodes WHERE id = ${created.id}
    `;
    // The tenant comes from the parent row, never from the caller — the
    // composite (id, workspace_id) foreign key makes a cross-tenant child
    // unrepresentable, and this is the code path that has to honour it.
    expect(row!.workspace_id).toBe(tree.workspaceId);
    expect(row!.title).toBe('Local Development Setup');
    expect(row!.slug).toBe('local-development-setup');
    // The nodes_set_path trigger wrote the path from the parent's.
    expect(row!.path.startsWith(tree.chapter.path)).toBe(true);
    expect(row!.path).toBe(`${tree.chapter.path}${created.id}/`);
  });

  test('a chapter under a book, and a book under a shelf, are both legal', async () => {
    const tree = await seedTree();

    const chapter = await createNode(sql, { parentId: tree.book.id, type: 'chapter', title: 'Second chapter' });
    const book = await createNode(sql, { parentId: tree.shelf.id, type: 'book', title: 'Second book' });

    expect(chapter.type).toBe('chapter');
    expect(book.type).toBe('book');
  });
});

describe('createNode — illegal nesting is refused by the same table that refuses a move', () => {
  test('a book under a page is refused, and the refusal names both types', async () => {
    const tree = await seedTree();

    const error = await createNode(sql, { parentId: tree.page.id, type: 'book', title: 'Handbook' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(IllegalParentTypeError);
    expect((error as IllegalParentTypeError).message).toContain('"book"');
    expect((error as IllegalParentTypeError).message).toContain('"page"');
    expect((error as IllegalParentTypeError).childType).toBe('book');
    expect((error as IllegalParentTypeError).parentType).toBe('page');

    const rows = await sql<{ id: string }[]>`SELECT id FROM nodes WHERE parent_id = ${tree.page.id}`;
    expect(rows).toHaveLength(0);
  });

  test('a shelf under a book is refused — only the workspace root may parent a shelf', async () => {
    const tree = await seedTree();

    const error = await createNode(sql, { parentId: tree.book.id, type: 'shelf', title: 'Design' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(IllegalParentTypeError);
    expect((error as IllegalParentTypeError).parentType).toBe('book');
  });

  test('a second workspace root cannot be created under anything', async () => {
    const tree = await seedTree();

    const error = await createNode(sql, { parentId: tree.root.id, type: 'workspace', title: 'Another root' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(IllegalParentTypeError);
  });
});

describe('createNode — two siblings named the same thing', () => {
  /**
   * A collision test that never actually collides passes trivially, so
   * this one creates the first node through `createNode` itself and then
   * asks for the *same title again*, which is exactly what a user does.
   * `nodes_parent_slug_unique (parent_id, slug)` would otherwise surface
   * as a raw Postgres 23505 on the screen.
   */
  test('the second one is refused by name, before the unique constraint is reached', async () => {
    const tree = await seedTree();

    const first = await createNode(sql, { parentId: tree.book.id, type: 'chapter', title: 'Getting Started' });
    const error = await createNode(sql, { parentId: tree.book.id, type: 'chapter', title: 'Getting Started' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(DuplicateSiblingSlugError);
    expect((error as DuplicateSiblingSlugError).slug).toBe('getting-started');
    expect((error as DuplicateSiblingSlugError).title).toBe('Getting Started');
    // Not a constraint violation surfacing as one: a Postgres unique
    // violation carries code 23505 and no `title` at all.
    expect((error as { code?: string }).code).toBeUndefined();

    const rows = await sql<{ id: string }[]>`SELECT id FROM nodes WHERE parent_id = ${tree.book.id} AND slug = 'getting-started'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(first.id);
  });

  test('two titles that differ only in punctuation collide, because the slug is what is unique', async () => {
    const tree = await seedTree();

    await createNode(sql, { parentId: tree.book.id, type: 'chapter', title: 'Auth & Sessions' });
    const error = await createNode(sql, { parentId: tree.book.id, type: 'chapter', title: 'Auth (& Sessions)!' }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(DuplicateSiblingSlugError);
    expect((error as DuplicateSiblingSlugError).slug).toBe('auth-sessions');
  });

  test('the same name under a different parent is not a collision', async () => {
    const tree = await seedTree();

    await createNode(sql, { parentId: tree.book.id, type: 'chapter', title: 'Overview' });
    const second = await createNode(sql, { parentId: tree.chapter.id, type: 'page', title: 'Overview' });

    expect(second.slug).toBe('overview');
  });

  test('a title with nothing sluggable in it is refused with its own reason', async () => {
    const tree = await seedTree();

    const error = await createNode(sql, { parentId: tree.book.id, type: 'page', title: '###' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UnslugifiableTitleError);
    expect((error as UnslugifiableTitleError).message).toMatch(/letter or number/i);
  });
});

describe('nodes_parent_slug_live_idx — live-only slug uniqueness (tenancy-model spec)', () => {
  /**
   * `createNode()` itself is not rewritten to filter on `trashed_at` until
   * Phase 3 of the deletion-and-trash change (design.md Decision 9); these
   * two tests state the *storage-layer* invariant the partial index
   * (`0022_trash.sql`) already enforces, independent of the application
   * layer, using raw inserts exactly like `insertNode` above.
   */
  test('a live node may take a trashed sibling’s slug', async () => {
    const tree = await seedTree();
    const opId = crypto.randomUUID();
    await sql`UPDATE nodes SET trashed_at = now(), trash_operation_id = ${opId} WHERE id = ${tree.page.id}`;

    const created = await insertNode(tree.workspaceId, tree.chapter.id, 'page', 'page', 1);

    expect(created.id).not.toBe(tree.page.id);
    const rows = await sql<{ id: string; trashed_at: Date | null }[]>`
      SELECT id, trashed_at FROM nodes WHERE parent_id = ${tree.chapter.id} AND slug = 'page' ORDER BY trashed_at NULLS LAST
    `;
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === created.id)?.trashed_at).toBeNull();
  });

  test('two live siblings still cannot share a slug', async () => {
    const tree = await seedTree();

    const error = await insertNode(tree.workspaceId, tree.chapter.id, 'page', 'page', 1).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    const rows = await sql<{ id: string }[]>`SELECT id FROM nodes WHERE parent_id = ${tree.chapter.id} AND slug = 'page'`;
    expect(rows).toHaveLength(1);
  });
});

describe('createNode — a missing parent', () => {
  test('is refused, and nothing is written', async () => {
    const before = await sql<{ count: number }[]>`SELECT COUNT(*)::int AS count FROM nodes`;

    const error = await createNode(sql, { parentId: crypto.randomUUID(), type: 'page', title: 'Orphan' }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(Error);
    const after = await sql<{ count: number }[]>`SELECT COUNT(*)::int AS count FROM nodes`;
    expect(after[0]!.count).toBe(before[0]!.count);
  });
});

describe('createNode — a trashed parent (node-trash / trash-non-disclosure)', () => {
  /**
   * Phase 3 (design.md Decision 9): `createNode()` now looks its parent up
   * through `live_nodes`, so a trashed parent answers exactly like a
   * missing one — never the raw `nodes_trash_guard` check-violation the
   * database would otherwise raise on the INSERT.
   */
  test('creating under a trashed parent is refused identically to a missing parent', async () => {
    const tree = await seedTree();
    const opId = crypto.randomUUID();
    await sql`UPDATE nodes SET trashed_at = now(), trash_operation_id = ${opId} WHERE id = ${tree.chapter.id}`;

    const error = await createNode(sql, { parentId: tree.chapter.id, type: 'page', title: 'Ghost Page' }).catch(
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(ParentNodeNotFoundError);
    const rows = await sql<{ id: string }[]>`SELECT id FROM nodes WHERE parent_id = ${tree.chapter.id} AND title = 'Ghost Page'`;
    expect(rows).toHaveLength(0);
  });

  test('creating with a trashed sibling’s slug succeeds — the collision rule only sees live siblings', async () => {
    const tree = await seedTree();
    const first = await createNode(sql, { parentId: tree.book.id, type: 'chapter', title: 'Overview' });
    await sql`UPDATE nodes SET trashed_at = now(), trash_operation_id = ${crypto.randomUUID()} WHERE id = ${first.id}`;

    const second = await createNode(sql, { parentId: tree.book.id, type: 'chapter', title: 'Overview' });

    expect(second.slug).toBe('overview');
    expect(second.id).not.toBe(first.id);
  });
});
