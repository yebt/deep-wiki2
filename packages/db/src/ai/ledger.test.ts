/**
 * `PostgresUsageLedger` (ai-usage-accounting spec; design.md — "Cost
 * enforcement, in the same path that builds the call"). Exercises the
 * real conditional `UPDATE` against a disposable Postgres — the
 * concurrency and expiry guarantees are exactly the kind of claim that
 * cannot be proven by a pure-function test alone (that proof already
 * exists in `packages/core/src/ai/budget.test.ts`; this proves the SQL
 * that mirrors it).
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import type { LedgerAdmissionInput } from '@deep-wiki/core';
import postgres from 'postgres';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '../../testing/provision';
import { createPostgresUsageLedger } from './ledger';

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

const PERIOD_START = '2026-01-01';

async function seedWorkspace(limitMicroUsd: string): Promise<string> {
  const [plan] = await sql<{ id: string }[]>`
    INSERT INTO plans (name, max_workspaces, max_seats, max_storage_bytes, max_ai_tokens_monthly, max_ai_cost_micro_usd_monthly)
    VALUES (${`plan-${crypto.randomUUID()}`}, 3, 5, '1000000', '100000', ${limitMicroUsd})
    RETURNING id
  `;
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name, plan_id)
    VALUES (${`owner-${crypto.randomUUID()}@example.com`}, 'hash', 'Owner', ${plan!.id})
    RETURNING id
  `;
  const [workspace] = await sql<{ id: string }[]>`
    INSERT INTO workspaces (owner_id, name, slug)
    VALUES (${user!.id}, 'Acme', ${`acme-${crypto.randomUUID()}`})
    RETURNING id
  `;
  return workspace!.id as string;
}

function admissionFor(workspaceId: string, reserveMicroUsd: number, overrides: Partial<LedgerAdmissionInput> = {}): LedgerAdmissionInput {
  return {
    workspaceId,
    periodStart: PERIOD_START,
    subjectType: 'user',
    subjectId: crypto.randomUUID(),
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    operation: 'chat',
    reserveMicroUsd,
    nowIso: new Date().toISOString(),
    expiresAtIso: new Date(Date.now() + 15 * 60_000).toISOString(),
    ...overrides,
  };
}

describe('admission — the single conditional UPDATE', () => {
  test('exactly one of two concurrent admissions succeeds when the second would exceed the limit', async () => {
    const workspaceId = await seedWorkspace('1000');
    const ledger = createPostgresUsageLedger(sql);

    const [first, second] = await Promise.all([
      ledger.admit(admissionFor(workspaceId, 600)),
      ledger.admit(admissionFor(workspaceId, 600)),
    ]);

    const oks = [first, second].filter((r) => r.ok);
    const refusals = [first, second].filter((r) => !r.ok);
    expect(oks).toHaveLength(1);
    expect(refusals).toHaveLength(1);
    if (!refusals[0]!.ok) {
      expect(refusals[0]!.error.reason).toBe('over-budget');
    }
  });

  test('an expired reservation is excluded from the outstanding sum', async () => {
    const workspaceId = await seedWorkspace('1000');
    const ledger = createPostgresUsageLedger(sql);

    const expired = await ledger.admit(
      admissionFor(workspaceId, 600, { expiresAtIso: new Date(Date.now() - 60_000).toISOString() }),
    );
    expect(expired.ok).toBe(true);

    // The first reservation already expired — a second admission for the
    // same near-full amount must succeed because the first is excluded
    // from the live outstanding sum, not because the limit was raised.
    const second = await ledger.admit(admissionFor(workspaceId, 600));
    expect(second.ok).toBe(true);
  });

  test('a workspace with no budget-period row gets one seeded from its plan on first admission', async () => {
    const workspaceId = await seedWorkspace('4200');
    const ledger = createPostgresUsageLedger(sql);

    const rowsBefore = await sql`SELECT 1 FROM workspace_ai_budget_periods WHERE workspace_id = ${workspaceId}`;
    expect(rowsBefore).toHaveLength(0);

    await ledger.admit(admissionFor(workspaceId, 100));

    const [period] = await sql<{ limit_micro_usd: number }[]>`
      SELECT limit_micro_usd FROM workspace_ai_budget_periods WHERE workspace_id = ${workspaceId} AND period_start = ${PERIOD_START}
    `;
    expect(period).toBeDefined();
    expect(Number(period!.limit_micro_usd)).toBe(4200);
  });
});

describe('settle and void — idempotent under WHERE state = reserved', () => {
  test('settle records the actual cost and releases the reservation; a second settle is a no-op', async () => {
    const workspaceId = await seedWorkspace('1_000_000'.replace(/_/g, ''));
    const ledger = createPostgresUsageLedger(sql);

    const admitted = await ledger.admit(admissionFor(workspaceId, 900));
    expect(admitted.ok).toBe(true);
    if (!admitted.ok) return;

    const settled = await ledger.settle(admitted.value.id, { inputTokens: 1000, cachedInputTokens: 0, outputTokens: 500 });
    expect(settled.ok).toBe(true);

    const [row] = await sql<{ state: string; actual_micro_usd: number }[]>`
      SELECT state, actual_micro_usd FROM ai_usage_events WHERE id = ${admitted.value.id}
    `;
    expect(row!.state).toBe('settled');
    const firstActual = Number(row!.actual_micro_usd);
    expect(firstActual).toBeGreaterThan(0);

    // A duplicate onFinish must never overwrite the recorded actual cost.
    await ledger.settle(admitted.value.id, { inputTokens: 999_999, cachedInputTokens: 0, outputTokens: 999_999 });
    const [rowAfter] = await sql<{ actual_micro_usd: number }[]>`
      SELECT actual_micro_usd FROM ai_usage_events WHERE id = ${admitted.value.id}
    `;
    expect(Number(rowAfter!.actual_micro_usd)).toBe(firstActual);
  });

  test('void releases the reservation with no settlement; voiding an already-settled row is a no-op', async () => {
    const workspaceId = await seedWorkspace('1000000');
    const ledger = createPostgresUsageLedger(sql);

    const admitted = await ledger.admit(admissionFor(workspaceId, 900));
    expect(admitted.ok).toBe(true);
    if (!admitted.ok) return;

    await ledger.settle(admitted.value.id, { inputTokens: 10, cachedInputTokens: 0, outputTokens: 10 });
    await ledger.void(admitted.value.id, 'aborted');

    const [row] = await sql<{ state: string }[]>`SELECT state FROM ai_usage_events WHERE id = ${admitted.value.id}`;
    expect(row!.state).toBe('settled');
  });

  test('an aborted reservation is voided and its reserved amount is released from the budget-period aggregate', async () => {
    const workspaceId = await seedWorkspace('1000000');
    const ledger = createPostgresUsageLedger(sql);

    const admitted = await ledger.admit(admissionFor(workspaceId, 900));
    expect(admitted.ok).toBe(true);
    if (!admitted.ok) return;

    const [before] = await sql<{ reserved_micro_usd: number }[]>`
      SELECT reserved_micro_usd FROM workspace_ai_budget_periods WHERE workspace_id = ${workspaceId} AND period_start = ${PERIOD_START}
    `;
    expect(Number(before!.reserved_micro_usd)).toBe(900);

    await ledger.void(admitted.value.id, 'aborted');

    const [after] = await sql<{ reserved_micro_usd: number }[]>`
      SELECT reserved_micro_usd FROM workspace_ai_budget_periods WHERE workspace_id = ${workspaceId} AND period_start = ${PERIOD_START}
    `;
    expect(Number(after!.reserved_micro_usd)).toBe(0);
    const [row] = await sql<{ state: string; actual_micro_usd: number | null }[]>`
      SELECT state, actual_micro_usd FROM ai_usage_events WHERE id = ${admitted.value.id}
    `;
    expect(row!.state).toBe('voided');
    expect(row!.actual_micro_usd).toBeNull();
  });
});

const DOWN_MIGRATION_PATH = join(import.meta.dir, '..', '..', 'drizzle', 'down', '0009_ai_usage_ledger.down.sql');

describe('down migration', () => {
  test('reversing 0009_ai_usage_ledger drops both tables and the plans column', async () => {
    const workspaceId = await seedWorkspace('1000');
    const ledger = createPostgresUsageLedger(sql);
    await ledger.admit(admissionFor(workspaceId, 100));

    await sql.file(DOWN_MIGRATION_PATH);

    const rows = await sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables
      WHERE table_name IN ('ai_usage_events', 'workspace_ai_budget_periods')
    `;
    expect(rows).toHaveLength(0);

    const columns = await sql<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'plans'
    `;
    expect(columns.map((c) => c.column_name)).not.toContain('max_ai_cost_micro_usd_monthly');
  });
});
