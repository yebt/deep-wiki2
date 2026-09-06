/**
 * Set-shaped resolution for list endpoints (content-and-editor design.md
 * "Listing without disclosure"): backlinks, mentions, tags and the tree
 * all need "which of these N may this subject read", answered by one SQL
 * statement folded through `decideMany()` — never N+1 over candidates.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '../../testing/provision';
import { canManyResources, canManySubjects } from './can-many';

let db: ProvisionedTestDatabase;
let sql: postgres.Sql;

beforeAll(async () => {
  db = await provisionTestDatabase();
  sql = postgres(db.url, { max: 10 });
});

afterAll(async () => {
  await sql.end({ timeout: 1 }).catch(() => {});
  await db.drop();
});

interface NodeRow {
  id: string;
  path: string;
}

async function insertNode(workspaceId: string, parentId: string | null, type: string, slug: string, position = 0): Promise<NodeRow> {
  const [row] = await sql<NodeRow[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${workspaceId}, ${parentId}, ${type}::node_type, '', ${position}, ${slug}, ${slug})
    RETURNING id, path
  `;
  return row!;
}

async function insertUser(slug: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name)
    VALUES (${`${slug}-${crypto.randomUUID()}@example.com`}, 'hash', ${slug})
    RETURNING id
  `;
  return row!.id;
}

async function insertWorkspace(ownerId: string, slug: string): Promise<{ workspaceId: string; rootId: string }> {
  const [ws] = await sql<{ id: string }[]>`
    INSERT INTO workspaces (owner_id, name, slug) VALUES (${ownerId}, ${slug}, ${`${slug}-${crypto.randomUUID()}`})
    RETURNING id
  `;
  const root = await insertNode(ws!.id, null, 'workspace', `${slug}-root`);
  return { workspaceId: ws!.id, rootId: root.id };
}

async function grant(workspaceId: string, subjectType: 'user' | 'cell', subjectId: string, resourceId: string, action: string, effect: string) {
  await sql`
    INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
    VALUES (${workspaceId}, ${subjectType}::subject_kind, ${subjectId}, ${resourceId}, ${action}::perm_action, ${effect}::perm_effect)
  `;
}

/** Wraps `sql` in a Proxy counting how many times it is invoked as a template tag, to prove exactly one round trip (no N+1). */
function countCalls(target: postgres.Sql): { proxy: postgres.Sql; count: () => number } {
  let calls = 0;
  const proxy = new Proxy(target as unknown as (...args: unknown[]) => unknown, {
    apply(fn, thisArg, args) {
      calls++;
      return Reflect.apply(fn, thisArg, args);
    },
  });
  return { proxy: proxy as unknown as postgres.Sql, count: () => calls };
}

describe('canManyResources', () => {
  test('returns exactly the candidates the subject can read: direct, inherited, and excluded by no grant', async () => {
    const owner = await insertUser('owner');
    const { workspaceId, rootId } = await insertWorkspace(owner, 'ws');
    const bookDirect = await insertNode(workspaceId, rootId, 'book', 'book-direct');
    const bookInherited = await insertNode(workspaceId, rootId, 'book', 'book-inherited');
    const bookUngranted = await insertNode(workspaceId, rootId, 'book', 'book-ungranted');
    const pageDirect = await insertNode(workspaceId, bookDirect.id, 'page', 'direct');
    const pageInherited = await insertNode(workspaceId, bookInherited.id, 'page', 'inherited');
    const pageNoGrant = await insertNode(workspaceId, bookUngranted.id, 'page', 'no-grant');
    const subject = await insertUser('subject');

    await grant(workspaceId, 'user', subject, pageDirect.id, 'read', 'allow');
    await grant(workspaceId, 'user', subject, bookInherited.id, 'read', 'allow'); // covers pageInherited via ancestry

    const readable = await canManyResources(sql, {
      workspaceId,
      subjectType: 'user',
      subjectId: subject,
      action: 'read',
      resourceIds: [pageDirect.id, pageInherited.id, pageNoGrant.id],
    });

    expect(readable.has(pageDirect.id)).toBe(true);
    expect(readable.has(pageInherited.id)).toBe(true);
    expect(readable.has(pageNoGrant.id)).toBe(false);
  });

  test('a closer deny beats an inherited allow, per candidate', async () => {
    const owner = await insertUser('owner2');
    const { workspaceId, rootId } = await insertWorkspace(owner, 'ws2');
    const subject = await insertUser('subject2');
    const pageDenied = await insertNode(workspaceId, rootId, 'page', 'denied');

    await grant(workspaceId, 'user', subject, rootId, 'read', 'allow');
    await grant(workspaceId, 'user', subject, pageDenied.id, 'read', 'deny');

    const readable = await canManyResources(sql, {
      workspaceId,
      subjectType: 'user',
      subjectId: subject,
      action: 'read',
      resourceIds: [pageDenied.id],
    });

    expect(readable.has(pageDenied.id)).toBe(false);
  });

  test('a subject resolves through cell membership, exactly as the singular resolver does', async () => {
    const owner = await insertUser('owner3');
    const { workspaceId, rootId } = await insertWorkspace(owner, 'ws3');
    const subject = await insertUser('subject3');
    const [cell] = await sql<{ id: string }[]>`INSERT INTO cells (workspace_id, name) VALUES (${workspaceId}, ${`Team-${crypto.randomUUID()}`}) RETURNING id`;
    await sql`INSERT INTO cell_members (cell_id, user_id, workspace_id) VALUES (${cell!.id}, ${subject}, ${workspaceId})`;
    const page = await insertNode(workspaceId, rootId, 'page', 'via-cell');
    await grant(workspaceId, 'cell', cell!.id, page.id, 'read', 'allow');

    const readable = await canManyResources(sql, {
      workspaceId,
      subjectType: 'user',
      subjectId: subject,
      action: 'read',
      resourceIds: [page.id],
    });

    expect(readable.has(page.id)).toBe(true);
  });

  test('returns an empty set for an empty candidate list without issuing a query', async () => {
    const owner = await insertUser('owner-empty');
    const { workspaceId } = await insertWorkspace(owner, 'ws-empty');
    const { proxy, count } = countCalls(sql);

    const readable = await canManyResources(proxy, {
      workspaceId,
      subjectType: 'user',
      subjectId: owner,
      action: 'read',
      resourceIds: [],
    });

    expect(readable.size).toBe(0);
    expect(count()).toBe(0);
  });

  test('issues exactly one SQL statement regardless of candidate count (no N+1)', async () => {
    const owner = await insertUser('owner4');
    const { workspaceId, rootId } = await insertWorkspace(owner, 'ws4');
    const subject = await insertUser('subject4');
    const pages = await Promise.all(
      Array.from({ length: 5 }, (_, i) => insertNode(workspaceId, rootId, 'page', `p${i}`, i)),
    );
    await grant(workspaceId, 'user', subject, rootId, 'read', 'allow');

    const { proxy, count } = countCalls(sql);
    const readable = await canManyResources(proxy, {
      workspaceId,
      subjectType: 'user',
      subjectId: subject,
      action: 'read',
      resourceIds: pages.map((p) => p.id),
    });

    expect(readable.size).toBe(5);
    expect(count()).toBe(1);
  });
});

describe('canManySubjects', () => {
  test('inverts the resolution: returns exactly the candidate subjects who can read the resource', async () => {
    const owner = await insertUser('owner5');
    const { workspaceId, rootId } = await insertWorkspace(owner, 'ws5');
    const page = await insertNode(workspaceId, rootId, 'page', 'target');
    const userAllowed = await insertUser('allowed');
    const userDenied = await insertUser('denied');
    const userNoGrant = await insertUser('no-grant');

    await grant(workspaceId, 'user', userAllowed, page.id, 'read', 'allow');
    await grant(workspaceId, 'user', userDenied, page.id, 'read', 'deny');

    const readers = await canManySubjects(sql, {
      workspaceId,
      resourceId: page.id,
      action: 'read',
      subjectIds: [userAllowed, userDenied, userNoGrant],
    });

    expect(readers.has(userAllowed)).toBe(true);
    expect(readers.has(userDenied)).toBe(false);
    expect(readers.has(userNoGrant)).toBe(false);
  });

  test('a candidate subject resolves through their own cell membership', async () => {
    const owner = await insertUser('owner6');
    const { workspaceId, rootId } = await insertWorkspace(owner, 'ws6');
    const page = await insertNode(workspaceId, rootId, 'page', 'target6');
    const member = await insertUser('member');
    const [cell] = await sql<{ id: string }[]>`INSERT INTO cells (workspace_id, name) VALUES (${workspaceId}, ${`Team-${crypto.randomUUID()}`}) RETURNING id`;
    await sql`INSERT INTO cell_members (cell_id, user_id, workspace_id) VALUES (${cell!.id}, ${member}, ${workspaceId})`;
    await grant(workspaceId, 'cell', cell!.id, page.id, 'read', 'allow');

    const readers = await canManySubjects(sql, {
      workspaceId,
      resourceId: page.id,
      action: 'read',
      subjectIds: [member],
    });

    expect(readers.has(member)).toBe(true);
  });

  test('issues exactly one SQL statement regardless of candidate count (no N+1)', async () => {
    const owner = await insertUser('owner7');
    const { workspaceId, rootId } = await insertWorkspace(owner, 'ws7');
    const page = await insertNode(workspaceId, rootId, 'page', 'target7');
    const users = await Promise.all(Array.from({ length: 5 }, (_, i) => insertUser(`u${i}`)));
    await grant(workspaceId, 'user', users[0]!, page.id, 'read', 'allow');

    const { proxy, count } = countCalls(sql);
    const readers = await canManySubjects(proxy, { workspaceId, resourceId: page.id, action: 'read', subjectIds: users });

    expect(readers.size).toBe(1);
    expect(count()).toBe(1);
  });
});
