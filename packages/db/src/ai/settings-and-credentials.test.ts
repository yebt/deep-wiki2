/**
 * `workspace_ai_settings` and `workspace_ai_credentials`
 * (0008_ai_settings_and_credentials.sql; design.md — "Schema";
 * workspace-ai-credentials spec). Exercises the raw DDL directly against
 * a real, disposable Postgres — the same idiom as
 * `packages/db/src/schema.test.ts`.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '../../testing/provision';

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

async function assertRejects(query: Promise<unknown>): Promise<void> {
  let rejected = false;
  try {
    await query;
  } catch {
    rejected = true;
  }
  expect(rejected).toBe(true);
}

async function seedWorkspace() {
  const [plan] = await sql`
    INSERT INTO plans (name, max_workspaces, max_seats, max_storage_bytes, max_ai_tokens_monthly)
    VALUES (${`plan-${crypto.randomUUID()}`}, 3, 5, '1000000', '1000')
    RETURNING id
  `;
  const [user] = await sql`
    INSERT INTO users (email, password_hash, display_name, plan_id)
    VALUES (${`owner-${crypto.randomUUID()}@example.com`}, 'hash', 'Owner', ${plan!.id})
    RETURNING id
  `;
  const [workspace] = await sql`
    INSERT INTO workspaces (owner_id, name, slug)
    VALUES (${user!.id}, 'Acme', ${`acme-${crypto.randomUUID()}`})
    RETURNING id
  `;
  return { workspaceId: workspace!.id as string };
}

async function insertCredential(workspaceId: string, provider = 'anthropic') {
  const [row] = await sql`
    INSERT INTO workspace_ai_credentials
      (workspace_id, provider, ciphertext, iv, auth_tag, wrapped_dek, key_id, last_four)
    VALUES
      (${workspaceId}, ${provider}, decode('aa', 'hex'), decode('bb', 'hex'), decode('cc', 'hex'), decode('dd', 'hex'), 'k1', '1234')
    RETURNING id, workspace_id
  `;
  return { id: row!.id as string, workspaceId: row!.workspace_id as string };
}

describe('both tables exist after migrate()', () => {
  test('workspace_ai_settings exists', async () => {
    const rows = await sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables WHERE table_name = 'workspace_ai_settings'
    `;
    expect(rows).toHaveLength(1);
  });

  test('workspace_ai_credentials exists', async () => {
    const rows = await sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables WHERE table_name = 'workspace_ai_credentials'
    `;
    expect(rows).toHaveLength(1);
  });

  test('no plaintext column exists on workspace_ai_credentials', async () => {
    const rows = await sql<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'workspace_ai_credentials'
    `;
    const names = rows.map((r) => r.column_name);
    expect(names).not.toContain('plaintext');
    expect(names).not.toContain('api_key');
    expect(names).toContain('ciphertext');
    expect(names).toContain('wrapped_dek');
  });
});

describe('workspace_id is required and tenant-scoped', () => {
  test('insert into workspace_ai_credentials with workspace_id = NULL is rejected', async () => {
    await assertRejects(sql`
      INSERT INTO workspace_ai_credentials
        (workspace_id, provider, ciphertext, iv, auth_tag, wrapped_dek, key_id, last_four)
      VALUES
        (NULL, 'anthropic', decode('aa', 'hex'), decode('bb', 'hex'), decode('cc', 'hex'), decode('dd', 'hex'), 'k1', '1234')
    `);
  });

  test('insert into workspace_ai_credentials under a nonexistent workspace is rejected', async () => {
    await assertRejects(sql`
      INSERT INTO workspace_ai_credentials
        (workspace_id, provider, ciphertext, iv, auth_tag, wrapped_dek, key_id, last_four)
      VALUES
        (${crypto.randomUUID()}, 'anthropic', decode('aa', 'hex'), decode('bb', 'hex'), decode('cc', 'hex'), decode('dd', 'hex'), 'k1', '1234')
    `);
  });

  test('insert into workspace_ai_settings under a nonexistent workspace is rejected', async () => {
    await assertRejects(sql`
      INSERT INTO workspace_ai_settings (workspace_id) VALUES (${crypto.randomUUID()})
    `);
  });

  test('UNIQUE (workspace_id, provider) rejects a second credential for the same provider', async () => {
    const { workspaceId } = await seedWorkspace();
    await insertCredential(workspaceId, 'anthropic');

    await assertRejects(
      sql`
        INSERT INTO workspace_ai_credentials
          (workspace_id, provider, ciphertext, iv, auth_tag, wrapped_dek, key_id, last_four)
        VALUES
          (${workspaceId}, 'anthropic', decode('ee', 'hex'), decode('ff', 'hex'), decode('00', 'hex'), decode('11', 'hex'), 'k1', '5678')
      `,
    );
  });
});

describe('composite (id, workspace_id) pins a credential to its own workspace', () => {
  test('a referencing row naming a mismatched (id, workspace_id) pair is rejected at the database', async () => {
    const { workspaceId: workspaceA } = await seedWorkspace();
    const { workspaceId: workspaceB } = await seedWorkspace();
    const credential = await insertCredential(workspaceA, 'anthropic');

    // A throwaway companion table, foreign-keyed to the exact composite
    // shape workspace_ai_credentials exposes (UNIQUE (id, workspace_id)).
    // This is how the constraint is meant to be consumed by a future
    // referencing table; proving it here is a real database-level
    // assertion, not a stand-in for one.
    await sql`
      CREATE TABLE ai_credential_reference_probe (
        credential_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        FOREIGN KEY (credential_id, workspace_id)
          REFERENCES workspace_ai_credentials (id, workspace_id)
      )
    `;

    try {
      // The credential genuinely exists, and workspaceB genuinely exists —
      // but the pairing (credential.id, workspaceB) does not, because the
      // credential belongs to workspaceA. The database must refuse this
      // exactly as it would refuse a relocated row.
      await assertRejects(sql`
        INSERT INTO ai_credential_reference_probe (credential_id, workspace_id)
        VALUES (${credential.id}, ${workspaceB})
      `);

      // The true pairing is accepted, proving the rejection above was
      // about tenant mismatch, not a malformed query.
      await sql`
        INSERT INTO ai_credential_reference_probe (credential_id, workspace_id)
        VALUES (${credential.id}, ${workspaceA})
      `;
    } finally {
      await sql`DROP TABLE ai_credential_reference_probe`;
    }
  });
});

const DOWN_MIGRATION_PATH = join(import.meta.dir, '..', '..', 'drizzle', 'down', '0008_ai_settings_and_credentials.down.sql');

describe('down migration', () => {
  test('reversing 0008_ai_settings_and_credentials drops both tables, including ciphertext rows', async () => {
    const { workspaceId } = await seedWorkspace();
    await insertCredential(workspaceId, 'openai');

    await sql.file(DOWN_MIGRATION_PATH);

    const rows = await sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_name IN ('workspace_ai_settings', 'workspace_ai_credentials')
    `;
    expect(rows).toHaveLength(0);
  });
});
