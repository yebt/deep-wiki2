import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '@deep-wiki/db/testing/provision';
import postgres from 'postgres';
import { resolveWorkspaceId } from './workspace-ref';

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

async function insertWorkspace(slug: string): Promise<string> {
  const [owner] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name) VALUES (${`owner-${crypto.randomUUID()}@example.com`}, 'hash', 'Owner') RETURNING id
  `;
  const [ws] = await sql<{ id: string }[]>`
    INSERT INTO workspaces (owner_id, name, slug) VALUES (${owner!.id}, 'WS', ${slug}) RETURNING id
  `;
  return ws!.id;
}

describe('resolveWorkspaceId', () => {
  test('a slug resolves to the id of the workspace that carries it', async () => {
    const slug = `acme-${crypto.randomUUID()}`;
    const id = await insertWorkspace(slug);
    expect(await resolveWorkspaceId(sql, slug)).toBe(id);
  });

  test('an id is returned as itself, whether or not any workspace carries it — access is the caller’s question', async () => {
    const id = await insertWorkspace(`acme-${crypto.randomUUID()}`);
    const unknown = crypto.randomUUID();
    expect(await resolveWorkspaceId(sql, id)).toBe(id);
    expect(await resolveWorkspaceId(sql, unknown)).toBe(unknown);
  });

  /**
   * A UUID is also a legal slug. When a team chose one, the slug wins:
   * the address bar carries slugs, and the workspace that owns the name
   * outranks the coincidence of another one's id.
   */
  test('a uuid-shaped slug is found as a slug before it is read as an id', async () => {
    const uuidShaped = crypto.randomUUID();
    const id = await insertWorkspace(uuidShaped);
    expect(id).not.toBe(uuidShaped);
    expect(await resolveWorkspaceId(sql, uuidShaped)).toBe(id);
  });

  test('a ref that is neither a slug nor an id names nothing', async () => {
    expect(await resolveWorkspaceId(sql, 'Not A Slug')).toBeNull();
    expect(await resolveWorkspaceId(sql, '../admin')).toBeNull();
    expect(await resolveWorkspaceId(sql, '')).toBeNull();
  });
});
