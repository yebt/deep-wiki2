/**
 * `ai_capability_observations` (0019_ai_capability_observations.sql;
 * design.md — "Drift detection"). Instance-scoped: no `workspace_id`
 * column exists, so there is no tenant-isolation FK to prove — only that
 * the table and its columns exist, and that the down migration reverses
 * cleanly.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '../../testing/provision';

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

describe('ai_capability_observations exists after migrate()', () => {
  test('the table and its columns exist, with no workspace_id column', async () => {
    const columns = await sql<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'ai_capability_observations'
    `;
    const names = columns.map((c) => c.column_name);
    expect(names).toContain('provider');
    expect(names).toContain('declared_level');
    expect(names).toContain('observed_level');
    expect(names).not.toContain('workspace_id');
  });

  test('a row records a contradiction', async () => {
    const [row] = await sql<{ id: string }[]>`
      INSERT INTO ai_capability_observations (provider, model, declared_level, observed_level, error_code)
      VALUES ('anthropic', 'claude-3-5-sonnet-20241022', 'tool-call', 'prompted', 'validation_failed')
      RETURNING id
    `;
    expect(row).toBeDefined();
  });
});

const DOWN_MIGRATION_PATH = join(import.meta.dir, '..', '..', 'drizzle', 'down', '0019_ai_capability_observations.down.sql');

describe('down migration', () => {
  test('reversing 0019_ai_capability_observations drops the table', async () => {
    await sql.file(DOWN_MIGRATION_PATH);

    const rows = await sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables WHERE table_name = 'ai_capability_observations'
    `;
    expect(rows).toHaveLength(0);
  });
});
