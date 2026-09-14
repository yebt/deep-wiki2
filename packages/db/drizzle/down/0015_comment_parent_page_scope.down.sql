ALTER TABLE "comments" DROP CONSTRAINT IF EXISTS "comments_parent_fk";
ALTER TABLE "comments"
  ADD CONSTRAINT "comments_parent_fk" FOREIGN KEY ("parent_id", "workspace_id")
    REFERENCES "comments" ("id", "workspace_id") ON DELETE CASCADE;
ALTER TABLE "comments" DROP CONSTRAINT IF EXISTS "comments_id_page_workspace_unique";
