-- Deletion and Trash (design.md Decision 1). A trashed node is a live row
-- with trashed_at, trash_operation_id and trashed_by set on it and on
-- every live descendant in one transaction — never a separate tombstone
-- table, so the cascade the purge job relies on stays the ordinary FK
-- cascade off "nodes" (exploration Approach 1, chosen over a
-- trashed_nodes table).
ALTER TABLE "nodes" ADD COLUMN "trashed_at" timestamptz;
--> statement-breakpoint
ALTER TABLE "nodes" ADD COLUMN "trash_operation_id" uuid;
--> statement-breakpoint
ALTER TABLE "nodes" ADD COLUMN "trashed_by" uuid REFERENCES "users"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_trash_pair_chk" CHECK (("trashed_at" IS NULL) = ("trash_operation_id" IS NULL));
--> statement-breakpoint

-- Live siblings stay unique; a trashed row frees its name so a later
-- creation is not blocked forever by a name someone deleted
-- (tenancy-model spec — "Sibling Slug Uniqueness Holds Among Live Siblings
-- Only"). seed.ts looks nodes up with a SELECT, not ON CONFLICT, so
-- nothing else names the dropped constraint.
ALTER TABLE "nodes" DROP CONSTRAINT "nodes_parent_slug_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX "nodes_parent_slug_live_idx" ON "nodes" ("parent_id", "slug") WHERE "trashed_at" IS NULL;
--> statement-breakpoint

-- Listing, purge and restore predicates.
CREATE INDEX "nodes_ws_trashed_idx" ON "nodes" ("workspace_id", "trashed_at") WHERE "trashed_at" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "nodes_trash_op_idx" ON "nodes" ("trash_operation_id") WHERE "trash_operation_id" IS NOT NULL;
--> statement-breakpoint

-- Storage-layer enforcement of the invariant "live ⇒ parent live" (the
-- 0016_page_blocks_no_resurrection idiom): a live row can never be
-- inserted or moved under a trashed parent. The one exception is a
-- restore in progress — `restoreOperation()` clears an entire
-- trash_operation_id with one UPDATE, and Postgres visits that
-- statement's rows in no guaranteed order, so a child can be made live a
-- moment before its own parent is. That is allowed exactly when the
-- parent is still marked with the operation the child is leaving (OLD's,
-- since the child's own trash_operation_id is being cleared by this same
-- statement); every other case is refused.
CREATE FUNCTION "nodes_trash_guard"() RETURNS trigger AS $$
DECLARE
  parent_trashed boolean;
  parent_op uuid;
  own_op uuid;
BEGIN
  -- Only a *live* row under a parent can be misplaced; a row being
  -- trashed itself (NEW.trashed_at IS NOT NULL) needs no check here —
  -- subtree.ts stamps every descendant with trashed_at in the same
  -- transaction, so propagation never sees this guard at all.
  IF NEW."trashed_at" IS NOT NULL OR NEW."parent_id" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT "trashed_at" IS NOT NULL, "trash_operation_id" INTO parent_trashed, parent_op
    FROM "nodes" WHERE "id" = NEW."parent_id";

  IF NOT COALESCE(parent_trashed, false) THEN
    RETURN NEW;
  END IF;

  own_op := CASE WHEN TG_OP = 'UPDATE' THEN OLD."trash_operation_id" ELSE NULL END;
  IF own_op IS NOT NULL AND parent_op IS NOT DISTINCT FROM own_op THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'nodes: node % cannot be live under trashed parent % (trash_operation_id %)',
    NEW."id", NEW."parent_id", parent_op
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER "nodes_trash_guard_trigger"
  BEFORE INSERT OR UPDATE OF "parent_id", "trashed_at" ON "nodes"
  FOR EACH ROW EXECUTE FUNCTION "nodes_trash_guard"();
--> statement-breakpoint

-- The one spelling of "nodes"/"page_content" a read site may use outside a
-- reasoned allow-list (trash-non-disclosure spec; scripts/checks/trash-filter.ts,
-- Phase 2 of this change). Simple views are inlined by the planner, so
-- nodes_ws_path_idx / nodes_ws_parent_position_idx still serve every query
-- written against these views.
CREATE VIEW "live_nodes" AS
  SELECT * FROM "nodes" WHERE "trashed_at" IS NULL;
--> statement-breakpoint

CREATE VIEW "live_page_content" AS
  SELECT "page_content".*
    FROM "page_content"
    JOIN "nodes" ON "nodes"."id" = "page_content"."node_id" AND "nodes"."workspace_id" = "page_content"."workspace_id"
   WHERE "nodes"."trashed_at" IS NULL;
--> statement-breakpoint

-- The trace: one append-only row per trash/restore/purge event, keyed to
-- the nearest book ancestor (design.md Decision 5). No FK to the node —
-- the node is purged and this row stays, which is the entire point of a
-- trace. A shelf has no book: book_id is null and the row still belongs
-- to the workspace.
CREATE TABLE "node_deletions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "book_id" uuid,
  "book_node_type" "node_type" NOT NULL DEFAULT 'book' CHECK ("book_node_type" = 'book'),
  "node_id" uuid NOT NULL,
  "node_type" "node_type" NOT NULL,
  "title" text NOT NULL,
  "location" text NOT NULL,
  "event" text NOT NULL CHECK ("event" IN ('trashed', 'restored', 'purged')),
  "trash_operation_id" uuid NOT NULL,
  "actor_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "page_count" integer NOT NULL DEFAULT 0,
  "restricted" boolean NOT NULL DEFAULT false,
  "occurred_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "node_deletions_book_fk" FOREIGN KEY ("book_id", "workspace_id", "book_node_type")
    REFERENCES "nodes" ("id", "workspace_id", "type") ON DELETE CASCADE
);
--> statement-breakpoint

-- Book history's `deletions[]` (changesets spec) and the purge/restore
-- lookups by operation id.
CREATE INDEX "node_deletions_workspace_book_idx" ON "node_deletions" ("workspace_id", "book_id");
--> statement-breakpoint
CREATE INDEX "node_deletions_trash_operation_idx" ON "node_deletions" ("trash_operation_id");
--> statement-breakpoint

-- Append-only, the 0012_page_revisions_and_changesets idiom: an UPDATE on
-- a trace row is corruption, not an edit.
CREATE FUNCTION "node_deletions_forbid_update"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'node_deletions rows are immutable and cannot be updated (id=%)', OLD."id";
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER "node_deletions_forbid_update_trigger"
  BEFORE UPDATE ON "node_deletions"
  FOR EACH ROW EXECUTE FUNCTION "node_deletions_forbid_update"();
--> statement-breakpoint

-- One tracked purge run per workspace sweep (design.md Decision 6) — the
-- ai_reindex_jobs idiom applied to purge instead of reindexing.
CREATE TYPE "trash_purge_run_state" AS ENUM ('queued', 'running', 'completed', 'failed');
--> statement-breakpoint
CREATE TABLE "trash_purge_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "state" "trash_purge_run_state" NOT NULL DEFAULT 'queued',
  "cutoff" timestamptz NOT NULL,
  "purged_nodes" integer NOT NULL DEFAULT 0,
  "started_at" timestamptz,
  "finished_at" timestamptz,
  "error_code" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "trash_purge_runs_workspace_idx" ON "trash_purge_runs" ("workspace_id");
