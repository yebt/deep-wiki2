-- Usage ledger and plan quota (design.md — "Cost enforcement, in the same
-- path that builds the call"; "Schema"; ai-usage-accounting spec).
--
-- `workspace_ai_budget_periods` is the per-(workspace, month) aggregate a
-- settings/report page reads; it is NOT the enforcement mechanism by
-- itself. Admission (`packages/db/src/ai/ledger.ts`) recomputes the live
-- outstanding total straight from `ai_usage_events` on every call
-- (`state = 'reserved' AND expires_at > now()`), so a crashed
-- reservation that never reaches `settle`/`void` self-heals the moment
-- it expires — no sweeper, per D4 — even though the aggregate columns on
-- this table are only ever adjusted by `settle`/`void` and would
-- otherwise stay inflated forever for that one row.
--
-- `plans.max_ai_cost_micro_usd_monthly` mirrors the existing
-- `max_ai_tokens_monthly` column's `text` type (a self-hoster's plan
-- limits are not assumed to fit signed 32-bit arithmetic, and a future
-- "unlimited" sentinel is a text value, not a magic number).
CREATE TYPE "ai_usage_operation" AS ENUM ('chat', 'embed');
--> statement-breakpoint
CREATE TYPE "ai_reservation_state" AS ENUM ('reserved', 'settled', 'voided');
--> statement-breakpoint
CREATE TABLE "ai_usage_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "period_start" date NOT NULL,
  "subject_type" "subject_kind" NOT NULL,
  "subject_id" uuid NOT NULL,
  "provider" "ai_provider" NOT NULL,
  "model" text NOT NULL,
  "operation" "ai_usage_operation" NOT NULL,
  "state" "ai_reservation_state" NOT NULL DEFAULT 'reserved',
  "input_tokens" integer,
  "output_tokens" integer,
  "cached_input_tokens" integer,
  "reserved_micro_usd" bigint NOT NULL,
  "actual_micro_usd" bigint,
  "prefix_hash" text,
  "degradation_level" "ai_structured_output_level",
  "expires_at" timestamptz NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "settled_at" timestamptz,
  CONSTRAINT "ai_usage_events_settled_has_actual" CHECK ("state" <> 'settled' OR "actual_micro_usd" IS NOT NULL)
);
--> statement-breakpoint
-- The admission query's live outstanding-sum scan (design.md's conditional UPDATE).
CREATE INDEX "ai_usage_events_reserved_idx" ON "ai_usage_events" ("workspace_id", "period_start") WHERE "state" = 'reserved';
--> statement-breakpoint
CREATE TABLE "workspace_ai_budget_periods" (
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "period_start" date NOT NULL,
  "reserved_micro_usd" bigint NOT NULL DEFAULT 0,
  "settled_micro_usd" bigint NOT NULL DEFAULT 0,
  "settled_tokens" bigint NOT NULL DEFAULT 0,
  "limit_micro_usd" bigint NOT NULL,
  "token_limit" bigint,
  PRIMARY KEY ("workspace_id", "period_start"),
  CONSTRAINT "workspace_ai_budget_periods_nonnegative" CHECK ("reserved_micro_usd" >= 0 AND "settled_micro_usd" >= 0)
);
--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN "max_ai_cost_micro_usd_monthly" text NOT NULL DEFAULT '0';
