/**
 * `workspace_embedding_indexes` and `chunks`
 * (0020_embedding_indexes_and_chunks.sql; embedding-index-integrity spec).
 * Exercises the raw DDL directly against a real, disposable Postgres —
 * the same idiom as `settings-and-credentials.test.ts`.
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

async function assertRejects(query: Promise<unknown>): Promise<void> {
  let rejected = false;
  try {
    await query;
  } catch {
    rejected = true;
  }
  expect(rejected).toBe(true);
}

interface Fixture {
  readonly workspaceId: string;
  readonly pageId: string;
}

async function seedWorkspaceWithPage(): Promise<Fixture> {
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name)
    VALUES (${`owner-${crypto.randomUUID()}@example.com`}, 'hash', 'Owner') RETURNING id
  `;
  const [workspace] = await sql<{ id: string }[]>`
    INSERT INTO workspaces (owner_id, name, slug)
    VALUES (${user!.id}, 'Acme', ${`acme-${crypto.randomUUID()}`})
    RETURNING id
  `;
  const [root] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${workspace!.id}, NULL, 'workspace', '', 0, 'root', 'Root') RETURNING id
  `;
  const [page] = await sql<{ id: string }[]>`
    INSERT INTO nodes (workspace_id, parent_id, type, path, position, slug, title)
    VALUES (${workspace!.id}, ${root!.id}, 'page', '', 0, 'page', 'Page') RETURNING id
  `;
  return { workspaceId: workspace!.id as string, pageId: page!.id as string };
}

async function seedGeneration(workspaceId: string, model = 'text-embedding-3-small', dimensions = 1536, provider = 'openai') {
  const [row] = await sql<{ id: string }[]>`
    INSERT INTO workspace_embedding_indexes (workspace_id, embedding_provider, embedding_model, dimensions, state)
    VALUES (${workspaceId}, ${provider}, ${model}, ${dimensions}, 'active')
    RETURNING id
  `;
  return row!.id as string;
}

function vectorLiteral(length: number, fill = 0.01): string {
  return `[${Array.from({ length }, () => fill).join(',')}]`;
}

describe('workspace_embedding_indexes', () => {
  test('dimensions must be exactly 1536', async () => {
    const { workspaceId } = await seedWorkspaceWithPage();
    await assertRejects(sql`
      INSERT INTO workspace_embedding_indexes (workspace_id, embedding_provider, embedding_model, dimensions)
      VALUES (${workspaceId}, 'openai', 'text-embedding-3-large', 3072)
    `);
  });

  test('at most one active generation per workspace', async () => {
    const { workspaceId } = await seedWorkspaceWithPage();
    await seedGeneration(workspaceId, 'text-embedding-3-small');

    await assertRejects(sql`
      INSERT INTO workspace_embedding_indexes (workspace_id, embedding_provider, embedding_model, dimensions, state)
      VALUES (${workspaceId}, 'google', 'text-embedding-004', 1536, 'active')
    `);
  });

  test('a building generation for a different model can coexist with the active one', async () => {
    const { workspaceId } = await seedWorkspaceWithPage();
    await seedGeneration(workspaceId, 'text-embedding-3-small');

    const rows = await sql`
      INSERT INTO workspace_embedding_indexes (workspace_id, embedding_provider, embedding_model, dimensions, state)
      VALUES (${workspaceId}, 'google', 'text-embedding-004', 1536, 'building')
      RETURNING id
    `;
    expect(rows).toHaveLength(1);
  });
});

describe('chunks — every write is pinned to a declared generation', () => {
  test('a chunk referencing a foreign workspace generation is rejected', async () => {
    const a = await seedWorkspaceWithPage();
    const b = await seedWorkspaceWithPage();
    // Only workspace B declares this (model, dimensions) pair — workspace
    // A has no generation at all, let alone this one.
    await seedGeneration(b.workspaceId, 'text-embedding-3-small', 1536);

    await assertRejects(sql`
      INSERT INTO chunks (workspace_id, page_id, content, embedding, embedding_model, dimensions)
      VALUES (${a.workspaceId}, ${a.pageId}, 'hello', ${vectorLiteral(1536)}, 'text-embedding-3-small', 1536)
    `);
  });

  test('a chunk whose (embedding_model, dimensions) disagrees with its generation is rejected', async () => {
    const { workspaceId, pageId } = await seedWorkspaceWithPage();
    await seedGeneration(workspaceId, 'text-embedding-3-small', 1536);

    await assertRejects(sql`
      INSERT INTO chunks (workspace_id, page_id, content, embedding, embedding_model, dimensions)
      VALUES (${workspaceId}, ${pageId}, 'hello', ${vectorLiteral(1536)}, 'text-embedding-3-large', 1536)
    `);
  });

  test('a chunk matching its workspace generation is accepted', async () => {
    const { workspaceId, pageId } = await seedWorkspaceWithPage();
    await seedGeneration(workspaceId, 'text-embedding-3-small', 1536);

    const rows = await sql`
      INSERT INTO chunks (workspace_id, page_id, content, embedding, embedding_model, dimensions)
      VALUES (${workspaceId}, ${pageId}, 'hello', ${vectorLiteral(1536)}, 'text-embedding-3-small', 1536)
      RETURNING id
    `;
    expect(rows).toHaveLength(1);
  });

  test('a chunk referencing a page from a foreign workspace is rejected', async () => {
    const a = await seedWorkspaceWithPage();
    const b = await seedWorkspaceWithPage();
    await seedGeneration(a.workspaceId);

    await assertRejects(sql`
      INSERT INTO chunks (workspace_id, page_id, content, embedding, embedding_model, dimensions)
      VALUES (${a.workspaceId}, ${b.pageId}, 'hello', ${vectorLiteral(1536)}, 'text-embedding-3-small', 1536)
    `);
  });

  // This assertion is satisfied by the Postgres type cast on `chunks.embedding
  // vector(1536)`, not by the `chunks_vector_dims_check` CHECK named below —
  // proven directly by `Declared Vector Dimension`'s second test, which reads
  // the rejection's own error text. The CHECK
  // (`vector_dims(embedding) = dimensions`) cannot fail independently in this
  // schema: the column's dimension and `workspace_embedding_indexes.dimensions`
  // are both hard-pinned to 1536
  // (`workspace_embedding_indexes_dimensions_check`), so any row whose type
  // cast succeeds already has `vector_dims(embedding) = 1536 = dimensions`.
  // It stays in the schema as defence in depth against a future migration
  // that makes the dimension configurable per workspace (design.md D14's
  // residual — SPECS §14) — it is not the enforcing mechanism today.
  test('a vector literal disagreeing with the declared column dimension is rejected before the named vector_dims CHECK could run', async () => {
    const { workspaceId, pageId } = await seedWorkspaceWithPage();
    await seedGeneration(workspaceId, 'text-embedding-3-small', 1536);

    await assertRejects(sql`
      INSERT INTO chunks (workspace_id, page_id, content, embedding, embedding_model, dimensions)
      VALUES (${workspaceId}, ${pageId}, 'hello', ${vectorLiteral(1024)}, 'text-embedding-3-small', 1536)
    `);
  });
});

describe('Declared Vector Dimension (embedding-index-integrity spec)', () => {
  test('an HNSW index builds over the declared vector(1536) column, verified in the catalog rather than by absence of a throw', async () => {
    await sql`CREATE INDEX "chunks_embedding_hnsw_test_idx" ON "chunks" USING hnsw ("embedding" vector_cosine_ops)`;

    const [row] = await sql<{ amname: string }[]>`
      SELECT am.amname
      FROM pg_class idx
      JOIN pg_am am ON idx.relam = am.oid
      JOIN pg_index i ON i.indexrelid = idx.oid
      JOIN pg_class tbl ON i.indrelid = tbl.oid
      WHERE tbl.relname = 'chunks' AND idx.relname = 'chunks_embedding_hnsw_test_idx'
    `;

    expect(row?.amname).toBe('hnsw');
  });

  test('the embedding column declares its dimension, so a 1024-length vector is rejected by the type cast on write', async () => {
    const [column] = await sql<{ declared_type: string }[]>`
      SELECT format_type(atttypid, atttypmod) AS declared_type
      FROM pg_attribute
      WHERE attrelid = 'chunks'::regclass AND attname = 'embedding'
    `;
    expect(column?.declared_type).toBe('vector(1536)');

    const { workspaceId, pageId } = await seedWorkspaceWithPage();
    await seedGeneration(workspaceId, 'text-embedding-3-small', 1536);

    let rejectionMessage = '';
    try {
      await sql`
        INSERT INTO chunks (workspace_id, page_id, content, embedding, embedding_model, dimensions)
        VALUES (${workspaceId}, ${pageId}, 'hello', ${vectorLiteral(1024)}, 'text-embedding-3-small', 1536)
      `;
    } catch (error) {
      rejectionMessage = String(error);
    }

    // pgvector's own type-cast error, not the generic "violates check
    // constraint" wording a CHECK-constraint failure would produce — this is
    // what proves the column's declared dimension, not the named CHECK, is
    // what rejected the write.
    expect(rejectionMessage).toMatch(/expected 1536 dimensions, not 1024/);
  });
});

const DOWN_MIGRATION_PATH = join(import.meta.dir, '..', '..', 'drizzle', 'down', '0020_embedding_indexes_and_chunks.down.sql');

describe('down migration', () => {
  test('reversing 0020_embedding_indexes_and_chunks drops both tables in reverse dependency order', async () => {
    const { workspaceId, pageId } = await seedWorkspaceWithPage();
    const generationId = await seedGeneration(workspaceId);
    await sql`
      INSERT INTO chunks (workspace_id, page_id, content, embedding, embedding_model, dimensions)
      VALUES (${workspaceId}, ${pageId}, 'hello', ${vectorLiteral(1536)}, 'text-embedding-3-small', 1536)
    `;
    expect(generationId).toBeDefined();

    await sql.file(DOWN_MIGRATION_PATH);

    const rows = await sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_name IN ('chunks', 'workspace_embedding_indexes')
    `;
    expect(rows).toHaveLength(0);
  });
});
