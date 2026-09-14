-- A reply carries both `page_id` (from the URL it was posted to) and
-- `parent_id` (from the request body), and 0013's `comments_parent_fk`
-- keyed on `(parent_id, workspace_id)` — which pins the *tenant* and says
-- nothing about the *page*. Every reader of a thread, starting with
-- `listCommentIndicators`, joins `reply.parent_id = root.id` and then
-- attributes the reply to the *root's* page, so a reply written with
-- `page_id = A` and a parent rooted on page B counted against page B and
-- would be listed to page B's readers by any thread-read endpoint
-- (`comments_thread_idx` is already built for exactly that query).
--
-- The narrower scope the application depends on is now the key itself:
-- `(parent_id, page_id, workspace_id)` into `(id, page_id, workspace_id)`
-- leaves a cross-page reply with no referenced row to match, exactly as
-- `comments_block_fk` already makes a cross-page block reference
-- unrepresentable rather than merely unqueried. It subsumes the tenant
-- guarantee the old two-column key gave: page_id still travels with
-- workspace_id.
DELETE FROM "comments" child
  USING "comments" parent
 WHERE child."parent_id" = parent."id"
   AND child."page_id" <> parent."page_id";
--> statement-breakpoint

ALTER TABLE "comments"
  ADD CONSTRAINT "comments_id_page_workspace_unique" UNIQUE ("id", "page_id", "workspace_id");
--> statement-breakpoint

ALTER TABLE "comments" DROP CONSTRAINT "comments_parent_fk";
--> statement-breakpoint

ALTER TABLE "comments"
  ADD CONSTRAINT "comments_parent_fk" FOREIGN KEY ("parent_id", "page_id", "workspace_id")
    REFERENCES "comments" ("id", "page_id", "workspace_id") ON DELETE CASCADE;
