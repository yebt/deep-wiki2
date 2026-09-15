/**
 * Reindexing as a tracked job (0021_embedding_reindex_jobs.sql;
 * embedding-index-integrity spec — "Reindexing Is an Explicit Tracked
 * Job"). The workspace's active generation — what any future retrieval
 * read would filter on — is proven not to change until `completeReindex`
 * runs, and to flip atomically once it does.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import postgres from 'postgres';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '../../testing/provision';
import { completeReindex, startReindex } from './reindex';

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

async function seedWorkspaceWithActiveGeneration(): Promise<string> {
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name)
    VALUES (${`owner-${crypto.randomUUID()}@example.com`}, 'hash', 'Owner') RETURNING id
  `;
  const [workspace] = await sql<{ id: string }[]>`
    INSERT INTO workspaces (owner_id, name, slug)
    VALUES (${user!.id}, 'Acme', ${`acme-${crypto.randomUUID()}`})
    RETURNING id
  `;
  await sql`
    INSERT INTO workspace_embedding_indexes (workspace_id, embedding_provider, embedding_model, dimensions, state, activated_at)
    VALUES (${workspace!.id}, 'openai', 'text-embedding-3-small', 1536, 'active', now())
  `;
  return workspace!.id as string;
}

async function activeGenerationModel(workspaceId: string): Promise<string | undefined> {
  const [row] = await sql<{ embedding_model: string }[]>`
    SELECT embedding_model FROM workspace_embedding_indexes WHERE workspace_id = ${workspaceId} AND state = 'active'
  `;
  return row?.embedding_model;
}

describe('startReindex', () => {
  test('creates a job with an initial progress state and a building generation, without changing the active pair', async () => {
    const workspaceId = await seedWorkspaceWithActiveGeneration();

    const started = await startReindex(sql, {
      workspaceId,
      toProvider: 'google',
      toModel: 'text-embedding-004',
      toDimensions: 1536,
    });

    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const [job] = await sql<{ state: string; from_model: string; to_model: string }[]>`
      SELECT state, from_model, to_model FROM embedding_reindex_jobs WHERE id = ${started.value.jobId}
    `;
    expect(job!.state).toBe('queued');
    expect(job!.from_model).toBe('text-embedding-3-small');
    expect(job!.to_model).toBe('text-embedding-004');

    const [building] = await sql<{ state: string }[]>`
      SELECT state FROM workspace_embedding_indexes WHERE id = ${started.value.buildingGenerationId}
    `;
    expect(building!.state).toBe('building');

    // The active pair has not moved — a retrieval-path read during an
    // in-progress job still filters on the prior active pair.
    expect(await activeGenerationModel(workspaceId)).toBe('text-embedding-3-small');
  });

  test('a second concurrent reindex for the same workspace is rejected while one is queued or running', async () => {
    const workspaceId = await seedWorkspaceWithActiveGeneration();
    const first = await startReindex(sql, { workspaceId, toProvider: 'google', toModel: 'text-embedding-004', toDimensions: 1536 });
    expect(first.ok).toBe(true);

    const second = await startReindex(sql, { workspaceId, toProvider: 'openai', toModel: 'text-embedding-3-large', toDimensions: 1536 });
    expect(second.ok).toBe(false);
  });
});

describe('completeReindex', () => {
  test('flips the active generation only on completion, retiring the prior one', async () => {
    const workspaceId = await seedWorkspaceWithActiveGeneration();
    const started = await startReindex(sql, { workspaceId, toProvider: 'google', toModel: 'text-embedding-004', toDimensions: 1536 });
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    // Still the prior pair right up until completion.
    expect(await activeGenerationModel(workspaceId)).toBe('text-embedding-3-small');

    const completed = await completeReindex(sql, started.value.jobId);
    expect(completed.ok).toBe(true);

    expect(await activeGenerationModel(workspaceId)).toBe('text-embedding-004');

    const [job] = await sql<{ state: string; finished_at: Date | null }[]>`
      SELECT state, finished_at FROM embedding_reindex_jobs WHERE id = ${started.value.jobId}
    `;
    expect(job!.state).toBe('completed');
    expect(job!.finished_at).not.toBeNull();

    const [retired] = await sql<{ state: string }[]>`
      SELECT state FROM workspace_embedding_indexes WHERE workspace_id = ${workspaceId} AND embedding_model = 'text-embedding-3-small'
    `;
    expect(retired!.state).toBe('retired');

    // The partial unique index only rejects queued/running jobs — a new
    // reindex is possible again now that the prior one has completed.
    const next = await startReindex(sql, { workspaceId, toProvider: 'openai', toModel: 'text-embedding-3-small', toDimensions: 1536 });
    expect(next.ok).toBe(true);
  });

  test('completing an already-completed job is a no-op, never a double activation', async () => {
    const workspaceId = await seedWorkspaceWithActiveGeneration();
    const started = await startReindex(sql, { workspaceId, toProvider: 'google', toModel: 'text-embedding-004', toDimensions: 1536 });
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    await completeReindex(sql, started.value.jobId);
    const second = await completeReindex(sql, started.value.jobId);

    expect(second.ok).toBe(true);
    expect(await activeGenerationModel(workspaceId)).toBe('text-embedding-004');
  });
});

const DOWN_MIGRATION_PATH = join(import.meta.dir, '..', '..', 'drizzle', 'down', '0021_embedding_reindex_jobs.down.sql');

describe('down migration', () => {
  test('reversing 0021_embedding_reindex_jobs drops the table', async () => {
    await sql.file(DOWN_MIGRATION_PATH);

    const rows = await sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables WHERE table_name = 'embedding_reindex_jobs'
    `;
    expect(rows).toHaveLength(0);
  });
});
