/**
 * `UsageLedger` adapter over `ai_usage_events` and
 * `workspace_ai_budget_periods` (design.md — "Cost enforcement, in the
 * same path that builds the call"; ai-usage-accounting spec). Admission
 * is the single conditional `UPDATE` from `design.md`, run inside a
 * transaction together with the `ai_usage_events` insert it gates —
 * `RETURNING` zero rows means over budget, with no read-then-write race
 * to lose (concurrent admissions serialize on the budget-period row).
 *
 * The outstanding sum is recomputed from live rows on every admission
 * (`state = 'reserved' AND expires_at > now()`), never from the
 * aggregate `reserved_micro_usd` column alone — that column is a report
 * convenience, adjusted only by `settle`/`void`, and a crashed
 * reservation that reaches neither is excluded from enforcement purely
 * by its own `expires_at` (D4 — no sweeper).
 *
 * `settle(id, usage)` receives only `ChatUsage` (design.md's port
 * signature carries no pricing), so the actual cost is computed here:
 * the event row already recorded which `provider`/`model` it belongs to
 * at admission time, and `capabilitiesOf` supplies that model's price
 * table — the same registry the gateway consulted before the call.
 */
import {
  capabilitiesOf,
  computeCostMicroUsd,
  err,
  ok,
  type BudgetRefusal,
  type ChatUsage,
  type LedgerAdmissionInput,
  type LedgerError,
  type ProviderId,
  type Reservation,
  type Result,
  type UsageLedger,
  type VoidReason,
} from '@deep-wiki/core';
import type postgres from 'postgres';

// Unlike `permissions/queries.ts`'s read-only `SqlExecutor`, this adapter
// runs `sql.begin()` transactions of its own — a capability
// `postgres.TransactionSql` does not expose (Postgres has no nested
// transactions) — so it is typed against the top-level connection only.
type SqlExecutor = postgres.Sql;

/**
 * Seeds a workspace's budget-period row from its owner's plan the first
 * time that period is admitted against (task 11.5). A plan limit that
 * does not parse as a non-negative integer seeds `0` (cost) or `NULL`
 * (unlimited tokens) rather than failing the insert — a malformed plan
 * value is a data problem to fix in `plans`, not a reason to crash
 * admission for the whole workspace.
 */
async function ensureBudgetPeriod(sql: SqlExecutor, workspaceId: string, periodStart: string): Promise<void> {
  await sql`
    INSERT INTO workspace_ai_budget_periods (workspace_id, period_start, limit_micro_usd, token_limit)
    SELECT w.id, ${periodStart}::date,
           CASE WHEN p.max_ai_cost_micro_usd_monthly ~ '^[0-9]+$' THEN p.max_ai_cost_micro_usd_monthly::bigint ELSE 0 END,
           CASE WHEN p.max_ai_tokens_monthly ~ '^[0-9]+$' THEN p.max_ai_tokens_monthly::bigint ELSE NULL END
    FROM workspaces w
    LEFT JOIN users u ON u.id = w.owner_id
    LEFT JOIN plans p ON p.id = u.plan_id
    WHERE w.id = ${workspaceId}
    ON CONFLICT (workspace_id, period_start) DO NOTHING
  `;
}

interface ReservedEventRow {
  readonly reserved_micro_usd: number;
  readonly workspace_id: string;
  readonly period_start: string;
  readonly provider: ProviderId;
  readonly model: string;
}

async function findReservedEvent(sql: SqlExecutor, id: string): Promise<ReservedEventRow | undefined> {
  const [row] = await sql<ReservedEventRow[]>`
    SELECT reserved_micro_usd, workspace_id, period_start, provider, model
    FROM ai_usage_events WHERE id = ${id} AND state = 'reserved'
  `;
  return row;
}

export function createPostgresUsageLedger(sql: SqlExecutor): UsageLedger {
  return {
    async admit(input: LedgerAdmissionInput): Promise<Result<Reservation, BudgetRefusal>> {
      await ensureBudgetPeriod(sql, input.workspaceId, input.periodStart);

      return sql.begin(async (tx) => {
        const [updated] = await tx<{ limit_micro_usd: number }[]>`
          UPDATE workspace_ai_budget_periods
             SET reserved_micro_usd = reserved_micro_usd + ${input.reserveMicroUsd}
           WHERE workspace_id = ${input.workspaceId} AND period_start = ${input.periodStart}::date
             AND settled_micro_usd + ${input.reserveMicroUsd}
               + (SELECT coalesce(sum(reserved_micro_usd), 0) FROM ai_usage_events
                   WHERE workspace_id = ${input.workspaceId} AND period_start = ${input.periodStart}::date
                     AND state = 'reserved' AND expires_at > now())
               <= limit_micro_usd
          RETURNING limit_micro_usd
        `;

        if (!updated) {
          const [period] = await tx<{ limit_micro_usd: number }[]>`
            SELECT limit_micro_usd FROM workspace_ai_budget_periods
            WHERE workspace_id = ${input.workspaceId} AND period_start = ${input.periodStart}::date
          `;
          const [outstandingRow] = await tx<{ outstanding: number }[]>`
            SELECT coalesce(sum(reserved_micro_usd), 0) AS outstanding FROM ai_usage_events
            WHERE workspace_id = ${input.workspaceId} AND period_start = ${input.periodStart}::date
              AND state = 'reserved' AND expires_at > now()
          `;
          return err({
            reason: 'over-budget',
            limitMicroUsd: Number(period?.limit_micro_usd ?? 0),
            outstandingMicroUsd: Number(outstandingRow?.outstanding ?? 0),
          });
        }

        const [event] = await tx<{ id: string }[]>`
          INSERT INTO ai_usage_events
            (workspace_id, period_start, subject_type, subject_id, provider, model, operation, state,
             reserved_micro_usd, prefix_hash, expires_at)
          VALUES
            (${input.workspaceId}, ${input.periodStart}::date, ${input.subjectType}, ${input.subjectId}, ${input.provider},
             ${input.model}, ${input.operation}, 'reserved', ${input.reserveMicroUsd}, ${input.prefixHash ?? null}, ${input.expiresAtIso})
          RETURNING id
        `;

        return ok({ id: event!.id, state: 'reserved', reservedMicroUsd: input.reserveMicroUsd, expiresAt: input.expiresAtIso });
      });
    },

    async settle(id: string, usage: ChatUsage): Promise<Result<void, LedgerError>> {
      // Idempotence guard (`WHERE state = 'reserved'`): nothing to do for
      // an already-settled/voided row or an unknown id — a duplicate
      // onFinish must never overwrite a recorded actual cost.
      const row = await findReservedEvent(sql, id);
      if (!row) {
        return ok(undefined);
      }

      const capabilities = capabilitiesOf({ provider: row.provider, slug: row.model });
      if (!capabilities.ok) {
        return err({ reason: `cannot settle: ${row.provider}:${row.model} is no longer in the capability registry` });
      }
      const actualMicroUsd = computeCostMicroUsd(usage, capabilities.value.pricing);

      return sql.begin(async (tx) => {
        await tx`
          UPDATE ai_usage_events
             SET state = 'settled', settled_at = now(),
                 input_tokens = ${usage.inputTokens}, output_tokens = ${usage.outputTokens},
                 cached_input_tokens = ${usage.cachedInputTokens}, actual_micro_usd = ${actualMicroUsd}
           WHERE id = ${id} AND state = 'reserved'
        `;
        await tx`
          UPDATE workspace_ai_budget_periods
             SET reserved_micro_usd = reserved_micro_usd - ${row.reserved_micro_usd},
                 settled_micro_usd = settled_micro_usd + ${actualMicroUsd},
                 settled_tokens = settled_tokens + ${usage.inputTokens + usage.outputTokens}
           WHERE workspace_id = ${row.workspace_id} AND period_start = ${row.period_start}
        `;
        return ok(undefined);
      });
    },

    async void(id: string, _reason: VoidReason): Promise<Result<void, LedgerError>> {
      const row = await findReservedEvent(sql, id);
      if (!row) {
        return ok(undefined);
      }

      return sql.begin(async (tx) => {
        await tx`UPDATE ai_usage_events SET state = 'voided' WHERE id = ${id} AND state = 'reserved'`;
        await tx`
          UPDATE workspace_ai_budget_periods
             SET reserved_micro_usd = reserved_micro_usd - ${row.reserved_micro_usd}
           WHERE workspace_id = ${row.workspace_id} AND period_start = ${row.period_start}
        `;
        return ok(undefined);
      });
    },
  };
}
