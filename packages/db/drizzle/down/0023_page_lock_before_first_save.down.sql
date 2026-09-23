-- Reverses 0023: the lock is pinned back to `page_content`. Any lock held
-- on a page that has never been saved has no content row to point at, so
-- it is deleted first — the lock is soft, TTL-evaluated and reacquired by
-- the next edit session, so dropping one costs nothing but the round trip.
DELETE FROM "page_locks"
 WHERE NOT EXISTS (
   SELECT 1 FROM "page_content"
    WHERE "page_content"."node_id" = "page_locks"."node_id"
      AND "page_content"."workspace_id" = "page_locks"."workspace_id"
 );
--> statement-breakpoint

ALTER TABLE "page_locks" DROP CONSTRAINT "page_locks_node_fk";
--> statement-breakpoint

ALTER TABLE "page_locks" DROP COLUMN "node_type";
--> statement-breakpoint

ALTER TABLE "page_locks" ADD CONSTRAINT "page_locks_page_fk"
  FOREIGN KEY ("node_id", "workspace_id")
  REFERENCES "page_content" ("node_id", "workspace_id") ON DELETE CASCADE;
