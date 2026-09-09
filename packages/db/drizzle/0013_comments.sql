-- Versioning and Collaboration (Phase 3), comment-threads and
-- comment-overlay specs; design.md Decision 1 ("The comment anchor
-- mechanism"). One table for both thread roots and replies: a root row
-- (`parent_id IS NULL`) carries the anchor and resolution state; a reply
-- (`parent_id NOT NULL`) carries none of its own — it always inherits the
-- root's anchor. `comments_root_has_anchor` makes that split a mechanism,
-- not a convention callers might violate.
CREATE TABLE "comments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "page_id" uuid NOT NULL,
  "parent_id" uuid,
  "author_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "body" text NOT NULL,
  -- Anchor columns (root rows only — see the CHECK below).
  "block_id" text,
  "offset_start" integer,
  "offset_end" integer,
  -- The excerpt captured at creation, independent of page_blocks.excerpt
  -- and never rewritten (comment-threads spec: "A Comment Captures Its
  -- Own Excerpt At Creation").
  "quote" text,
  "quote_hash" text,
  -- 'anchored' | 'orphaned'. Orphaning is one-way (comment-threads spec).
  "status" text,
  "resolved_at" timestamptz,
  "resolved_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "comments_id_workspace_unique" UNIQUE ("id", "workspace_id"),
  CONSTRAINT "comments_page_fk" FOREIGN KEY ("page_id", "workspace_id")
    REFERENCES "page_content" ("node_id", "workspace_id") ON DELETE CASCADE,
  -- The composite key into page_blocks is what makes a cross-tenant (and
  -- cross-page) block reference structurally unrepresentable: block ids
  -- are only unique within their own page, so naming a page_id from one
  -- tenant and a block_id that only exists under a different page's rows
  -- matches no page_blocks row at all.
  CONSTRAINT "comments_block_fk" FOREIGN KEY ("page_id", "block_id")
    REFERENCES "page_blocks" ("page_id", "block_id"),
  CONSTRAINT "comments_parent_fk" FOREIGN KEY ("parent_id", "workspace_id")
    REFERENCES "comments" ("id", "workspace_id") ON DELETE CASCADE,
  CONSTRAINT "comments_root_has_anchor" CHECK (
    ("parent_id" IS NULL AND "block_id" IS NOT NULL AND "status" IS NOT NULL)
    OR
    ("parent_id" IS NOT NULL AND "block_id" IS NULL AND "offset_start" IS NULL AND "offset_end" IS NULL
      AND "quote" IS NULL AND "quote_hash" IS NULL AND "status" IS NULL)
  )
);
--> statement-breakpoint

-- Comment indicators/counts for a page: every thread root, grouped by
-- block (comment-overlay spec: "Indicators And Counts Come From A
-- Separate Endpoint").
CREATE INDEX "comments_page_roots_idx" ON "comments" ("workspace_id", "page_id", "block_id") WHERE "parent_id" IS NULL;
--> statement-breakpoint

-- Replies of one thread, ordered by creation time (comment-threads spec:
-- "A reply joins the existing thread").
CREATE INDEX "comments_thread_idx" ON "comments" ("parent_id", "created_at");
