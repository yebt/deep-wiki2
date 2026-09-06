ALTER TABLE "plans" DROP COLUMN IF EXISTS "max_ai_cost_micro_usd_monthly";
--> statement-breakpoint
DROP TABLE IF EXISTS "workspace_ai_budget_periods";
--> statement-breakpoint
DROP INDEX IF EXISTS "ai_usage_events_reserved_idx";
--> statement-breakpoint
DROP TABLE IF EXISTS "ai_usage_events";
--> statement-breakpoint
DROP TYPE IF EXISTS "ai_reservation_state";
--> statement-breakpoint
DROP TYPE IF EXISTS "ai_usage_operation";
