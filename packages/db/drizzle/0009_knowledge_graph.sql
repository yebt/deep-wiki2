-- Content and the Editor (Phase 2), design.md "Schema" — the derived
-- knowledge graph. Every row here is produced only by the save transaction
-- (packages/db/src/content/rebuild-derived.ts) and replaced wholesale on
-- every save, never patched directly (knowledge-graph spec: Links Are
-- Rebuilt, Not Patched, On Every Save; Links Are Never User-Editable
-- Directly — scripts/checks/query-boundaries.ts's links/page_tags
-- write-boundary rule is the structural half of that).
--
-- `links.source_page_id` is pinned to `page_content(node_id, workspace_id)`
-- rather than `nodes` directly: a link can only ever come FROM a page that
-- has content, and `page_content`'s own three-column FK (0008) already
-- pins that row to a 'page'-typed node — this is stricter than a plain
-- `nodes` reference and needs no second `node_type` column of its own.
CREATE TABLE "links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "source_page_id" uuid NOT NULL,
  "target_page_id" uuid,
  "target_raw" text NOT NULL,
  "source_block_id" text,
  "anchor" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "links_source_fk" FOREIGN KEY ("source_page_id", "workspace_id")
    REFERENCES "page_content" ("node_id", "workspace_id") ON DELETE CASCADE,
  -- Nullable, MATCH SIMPLE (Postgres's default): a NULL target_page_id
  -- passes the FK with no lookup at all, which is exactly "unresolved"
  -- (design D18 — an unresolved link is inert, never a broken reference).
  CONSTRAINT "links_target_fk" FOREIGN KEY ("target_page_id", "workspace_id")
    REFERENCES "nodes" ("id", "workspace_id") ON DELETE SET NULL
);
--> statement-breakpoint

-- Backlinks resolve by target (docs/SPECS.md §3.2); replacement on save
-- resolves by source.
CREATE INDEX "links_target_idx" ON "links" ("workspace_id", "target_page_id");
--> statement-breakpoint
CREATE INDEX "links_source_idx" ON "links" ("workspace_id", "source_page_id");
--> statement-breakpoint

CREATE TABLE "tags" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "tags_workspace_name_unique" UNIQUE ("workspace_id", "name"),
  CONSTRAINT "tags_id_workspace_unique" UNIQUE ("id", "workspace_id")
);
--> statement-breakpoint

CREATE TABLE "page_tags" (
  "page_id" uuid NOT NULL,
  "tag_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("page_id", "tag_id"),
  CONSTRAINT "page_tags_page_fk" FOREIGN KEY ("page_id", "workspace_id")
    REFERENCES "page_content" ("node_id", "workspace_id") ON DELETE CASCADE,
  CONSTRAINT "page_tags_tag_fk" FOREIGN KEY ("tag_id", "workspace_id")
    REFERENCES "tags" ("id", "workspace_id") ON DELETE CASCADE
);
--> statement-breakpoint

CREATE INDEX "page_tags_workspace_tag_idx" ON "page_tags" ("workspace_id", "tag_id");
