/**
 * Thin `read`-action convenience over `can-many.ts` (design.md "Listing
 * without disclosure" file table): every list endpoint this phase adds —
 * backlinks, mentions, tags, tree — is a `read` visibility filter, so this
 * is what those routes actually call rather than repeating `action: 'read'`
 * at every call site.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '../../testing/provision';
import { readableResourceIds, readableSubjectIds } from './readable';

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

async function insertNode(workspaceId: string, parentId: string | null, type: string, slug: string) {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${workspaceId}, ${parentId}, ${type}::node_type, '', 0, ${slug}, ${slug})
    RETURNING id
  `;
  return row!.id as string;
}

async function insertUser(slug: string): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name)
    VALUES (${`${slug}-${crypto.randomUUID()}@example.com`}, 'hash', ${slug})
    RETURNING id
  `;
  return row!.id as string;
}

async function insertWorkspace(ownerId: string, slug: string): Promise<{ workspaceId: string; rootId: string }> {
  const [ws] = await sql<{ id: string }[]>`
    INSERT INTO workspaces (owner_id, name, slug) VALUES (${ownerId}, ${slug}, ${`${slug}-${crypto.randomUUID()}`}) RETURNING id
  `;
  const rootId = await insertNode(ws!.id, null, 'workspace', `${slug}-root`);
  return { workspaceId: ws!.id, rootId };
}

describe('readableResourceIds', () => {
  test('filters candidates down to those readable by the subject', async () => {
    const owner = await insertUser('owner');
    const { workspaceId, rootId } = await insertWorkspace(owner, 'ws');
    const readablePage = await insertNode(workspaceId, rootId, 'page', 'readable');
    const hiddenPage = await insertNode(workspaceId, rootId, 'page', 'hidden');
    const subject = await insertUser('subject');
    await sql`
      INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
      VALUES (${workspaceId}, 'user', ${subject}, ${readablePage}, 'read', 'allow')
    `;

    const readable = await readableResourceIds(sql, {
      workspaceId,
      subjectType: 'user',
      subjectId: subject,
      resourceIds: [readablePage, hiddenPage],
    });

    expect(readable.has(readablePage)).toBe(true);
    expect(readable.has(hiddenPage)).toBe(false);
  });
});

describe('readableSubjectIds', () => {
  test('filters candidate subjects down to those who can read the resource', async () => {
    const owner = await insertUser('owner2');
    const { workspaceId, rootId } = await insertWorkspace(owner, 'ws2');
    const page = await insertNode(workspaceId, rootId, 'page', 'target');
    const allowed = await insertUser('allowed');
    const notAllowed = await insertUser('not-allowed');
    await sql`
      INSERT INTO permissions (workspace_id, subject_type, subject_id, resource_id, action, effect)
      VALUES (${workspaceId}, 'user', ${allowed}, ${page}, 'read', 'allow')
    `;

    const readers = await readableSubjectIds(sql, { workspaceId, resourceId: page, subjectIds: [allowed, notAllowed] });

    expect(readers.has(allowed)).toBe(true);
    expect(readers.has(notAllowed)).toBe(false);
  });
});
