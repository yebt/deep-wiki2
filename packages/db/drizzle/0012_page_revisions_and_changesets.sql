-- Versioning and Collaboration (Phase 3), design.md Decision 3 ("The save
-- transaction" / "The changeset race"), Decision 4 (the window constant)
-- and Decision 7 ("Storage shape of page_revision"); changesets and
-- revision-history specs.
--
-- `changeset`'s book_node_type CHECK mirrors page_content's node_type
-- pattern (0008_page_content.sql): the composite FK pins both tenant AND
-- node type at once, so a changeset attaching to a chapter is structurally
-- unrepresentable rather than merely unqueried.
CREATE TABLE "changeset" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "book_id" uuid NOT NULL,
  "book_node_type" "node_type" NOT NULL DEFAULT 'book' CHECK ("book_node_type" = 'book'),
  "author_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "message" text,
  "last_activity_at" timestamptz NOT NULL DEFAULT now(),
  "closed_at" timestamptz,
  CONSTRAINT "changeset_book_fk" FOREIGN KEY ("book_id", "workspace_id", "book_node_type")
    REFERENCES "nodes" ("id", "workspace_id", "type") ON DELETE CASCADE,
  CONSTRAINT "changeset_id_workspace_unique" UNIQUE ("id", "workspace_id")
);
--> statement-breakpoint

-- At most one open changeset per (workspace, book, author) at a time — the
-- constraint `resolveChangeset` (Phase 5) arbitrates two concurrent saves
-- against, rather than a retry loop or lock ordering.
CREATE UNIQUE INDEX "changeset_open_per_author_idx"
  ON "changeset" ("workspace_id", "book_id", "author_id") WHERE "closed_at" IS NULL;
--> statement-breakpoint

-- Full markdown snapshot per save. No rendered_html: a historical revision
-- is rendered on demand (Decision 7 — "Numbers, not adjectives"). Deletion
-- stays permitted for cascade and future pruning; the trigger below only
-- forbids UPDATE.
CREATE TABLE "page_revision" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "page_id" uuid NOT NULL,
  "author_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "content" text NOT NULL,
  "content_hash" text NOT NULL,
  "block_index" jsonb NOT NULL DEFAULT '{}',
  "changeset_id" uuid,
  CONSTRAINT "page_revision_page_fk" FOREIGN KEY ("page_id", "workspace_id")
    REFERENCES "page_content" ("node_id", "workspace_id") ON DELETE CASCADE,
  CONSTRAINT "page_revision_changeset_fk" FOREIGN KEY ("changeset_id", "workspace_id")
    REFERENCES "changeset" ("id", "workspace_id")
);
--> statement-breakpoint

-- Page history: newest-first per page (revision-history spec).
CREATE INDEX "page_revision_workspace_page_created_idx"
  ON "page_revision" ("workspace_id", "page_id", "created_at" DESC);
--> statement-breakpoint

-- Book diff: every revision belonging to a changeset (changesets spec).
CREATE INDEX "page_revision_workspace_changeset_idx"
  ON "page_revision" ("workspace_id", "changeset_id");
--> statement-breakpoint

-- Immutability is a mechanism, not a comment (Decision 7). DELETE stays
-- permitted for cascade and future pruning; only UPDATE is forbidden.
CREATE FUNCTION "page_revision_forbid_update"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'page_revision rows are immutable and cannot be updated (id=%)', OLD."id";
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER "page_revision_forbid_update_trigger"
  BEFORE UPDATE ON "page_revision"
  FOR EACH ROW EXECUTE FUNCTION "page_revision_forbid_update"();
