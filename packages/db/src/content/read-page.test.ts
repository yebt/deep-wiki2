import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import postgres from 'postgres';
import { provisionTestDatabase, TEST_CHANGESET_WINDOW_MINUTES, type ProvisionedTestDatabase } from '../../testing/provision';
import { readPageHtml, readPageMarkdown } from './read-page';
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

async function seedSavedPage(markdown: string) {
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
  const [page] = await sql`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${workspace!.id}, ${root!.id}, 'page', '', 0, ${`page-${crypto.randomUUID()}`}, 'A Page') RETURNING id
  `;
  const ref = { workspaceId: workspace!.id as string, nodeId: page!.id as string };
  await savePage(sql, { ...ref, markdown, expectedContentHash: null, changesetWindowMinutes: TEST_CHANGESET_WINDOW_MINUTES });
  return ref;
}

// content-and-editor page-content spec: Read Mode And Edit Mode Read
// Different Representations.
describe('readPageHtml (read mode)', () => {
  test('returns the cached rendered html', async () => {
    const ref = await seedSavedPage('# Hello\n');

    const result = await readPageHtml(sql, ref);

    expect(result?.renderedHtml).toMatch(/<h1[ >]/);
    expect(result?.renderedHtml).toContain('Hello');
  });

  test('does not invoke the markdown parser: it never returns the raw markdown text', async () => {
    const ref = await seedSavedPage('# Hello\n');

    const result = await readPageHtml(sql, ref);

    expect(result).not.toHaveProperty('markdown');
  });

  test('a page with no content row returns undefined', async () => {
    const result = await readPageHtml(sql, { workspaceId: crypto.randomUUID(), nodeId: crypto.randomUUID() });

    expect(result).toBeUndefined();
  });
});

describe('readPageMarkdown (edit mode)', () => {
  test('returns the canonical markdown', async () => {
    const ref = await seedSavedPage('# Hello\n\nBody text.\n');

    const result = await readPageMarkdown(sql, ref);

    expect(result?.markdown).toBe('# Hello\n\nBody text.\n');
  });

  // The edit-session route's only source for the content_hash it must hand
  // back to the browser (page-content spec, D16) — without it, the first
  // Save on an already-saved page has no real hash to send.
  test('returns the row’s content_hash alongside the markdown', async () => {
    const ref = await seedSavedPage('# Hello\n\nBody text.\n');

    const result = await readPageMarkdown(sql, ref);

    expect(result?.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test('does not return the rendered html', async () => {
    const ref = await seedSavedPage('# Hello\n');

    const result = await readPageMarkdown(sql, ref);

    expect(result).not.toHaveProperty('renderedHtml');
  });
});
