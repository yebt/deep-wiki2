-- Refuses rather than guessing (design.md Decision 1) when dropping
-- trashed_at would silently make two same-slug siblings both live: once
-- the column is gone, nodes_parent_slug_unique's unconditional
-- (parent_id, slug) uniqueness applies again, and a trashed row sharing a
-- slug with a live sibling would violate it the instant it is restored to
-- existence by this very migration.
DO $$
DECLARE
  collision_count integer;
BEGIN
  SELECT COUNT(*) INTO collision_count
    FROM "nodes" trashed
    JOIN "nodes" live
      ON live."parent_id" IS NOT DISTINCT FROM trashed."parent_id"
     AND live."slug" = trashed."slug"
     AND live."id" <> trashed."id"
   WHERE trashed."trashed_at" IS NOT NULL
     AND live."trashed_at" IS NULL;

  IF collision_count > 0 THEN
    RAISE EXCEPTION 'down migration 0022_trash refused: % trashed row(s) share a (parent_id, slug) with a live sibling; rename or restore-as one of them before rolling back', collision_count;
  END IF;
END $$;
--> statement-breakpoint

DROP INDEX IF EXISTS "trash_purge_runs_workspace_idx";
--> statement-breakpoint
DROP TABLE IF EXISTS "trash_purge_runs";
--> statement-breakpoint
DROP TYPE IF EXISTS "trash_purge_run_state";
--> statement-breakpoint

DROP TRIGGER IF EXISTS "node_deletions_forbid_update_trigger" ON "node_deletions";
--> statement-breakpoint
DROP FUNCTION IF EXISTS "node_deletions_forbid_update"();
--> statement-breakpoint
DROP INDEX IF EXISTS "node_deletions_trash_operation_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "node_deletions_workspace_book_idx";
--> statement-breakpoint
DROP TABLE IF EXISTS "node_deletions";
--> statement-breakpoint

DROP VIEW IF EXISTS "live_page_content";
--> statement-breakpoint
DROP VIEW IF EXISTS "live_nodes";
--> statement-breakpoint

DROP TRIGGER IF EXISTS "nodes_trash_guard_trigger" ON "nodes";
--> statement-breakpoint
DROP FUNCTION IF EXISTS "nodes_trash_guard"();
--> statement-breakpoint

DROP INDEX IF EXISTS "nodes_trash_op_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "nodes_ws_trashed_idx";
--> statement-breakpoint
DROP INDEX IF EXISTS "nodes_parent_slug_live_idx";
--> statement-breakpoint
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_parent_slug_unique" UNIQUE ("parent_id", "slug");
--> statement-breakpoint

ALTER TABLE "nodes" DROP CONSTRAINT "nodes_trash_pair_chk";
--> statement-breakpoint
ALTER TABLE "nodes" DROP COLUMN "trashed_by";
--> statement-breakpoint
ALTER TABLE "nodes" DROP COLUMN "trash_operation_id";
--> statement-breakpoint
ALTER TABLE "nodes" DROP COLUMN "trashed_at";
