-- Reindexing as an explicit, tracked, resumable job — never an implicit
-- side effect of a settings change (design.md — "Index generations are
-- rows"; embedding-index-integrity spec — "Reindexing Is an Explicit
-- Tracked Job"). The partial unique index rejects a second concurrent
-- job for the same workspace while one is still queued or running.
CREATE TYPE "embedding_reindex_job_state" AS ENUM ('queued', 'running', 'completed', 'failed');

--> statement-breakpoint
CREATE TABLE "embedding_reindex_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "from_model" text,
  "to_model" text NOT NULL,
  "state" "embedding_reindex_job_state" NOT NULL DEFAULT 'queued',
  "total_chunks" integer NOT NULL DEFAULT 0,
  "completed_chunks" integer NOT NULL DEFAULT 0,
  "started_at" timestamptz,
  "finished_at" timestamptz,
  "error_code" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "embedding_reindex_jobs_one_active_idx" ON "embedding_reindex_jobs" ("workspace_id") WHERE "state" IN ('queued', 'running');
