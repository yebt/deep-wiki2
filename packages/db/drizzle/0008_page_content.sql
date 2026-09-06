-- Content and the Editor (Phase 2), design.md "Schema". Content is its own
-- table rather than columns on nodes: nodes is on the authorisation hot
-- path (the resolver's recursive walk, every sidebar query), and widening
-- its rows with a text blob and a jsonb taxes queries that never want them.
--
-- The three-column unique key extends Phase 1's D6 (id, workspace_id)
-- instead of adding a WHERE: it is what lets page_content's FK pin BOTH
-- tenant AND node type at once, making content on a chapter structurally
-- unrepresentable rather than merely unqueried (design D10).
ALTER TABLE "nodes" ADD CONSTRAINT "nodes_id_workspace_id_type_key" UNIQUE ("id", "workspace_id", "type");
--> statement-breakpoint

CREATE TYPE "block_status" AS ENUM ('active', 'superseded', 'tombstoned');
--> statement-breakpoint

-- node_type is CHECK-pinned to 'page': the only node type content can ever
-- attach to. Widening this to another node type later is one CHECK edit,
-- not a schema redesign.
CREATE TABLE "page_content" (
  "node_id" uuid PRIMARY KEY,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "node_type" "node_type" NOT NULL DEFAULT 'page' CHECK ("node_type" = 'page'),
  "markdown" text NOT NULL,
  "rendered_html" text NOT NULL DEFAULT '',
  "block_index" jsonb NOT NULL DEFAULT '{}',
  "content_hash" text NOT NULL,
  "pipeline_version" integer NOT NULL DEFAULT 1,
  "updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "page_content_node_fk" FOREIGN KEY ("node_id", "workspace_id", "node_type")
    REFERENCES "nodes" ("id", "workspace_id", "type") ON DELETE CASCADE,
  CONSTRAINT "page_content_node_workspace_unique" UNIQUE ("node_id", "workspace_id")
);
--> statement-breakpoint

-- The durable record of persisted block ids (design.md "Block identity" —
-- Registry). UNIQUE (page_id, block_id) spans every status, including
-- tombstoned, so a tombstoned id can never be reused for a new block.
CREATE TABLE "page_blocks" (
  "page_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "block_id" text NOT NULL,
  "status" "block_status" NOT NULL,
  "superseded_by" text,
  "content_hash" text NOT NULL,
  "excerpt" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("page_id", "block_id"),
  CONSTRAINT "page_blocks_page_fk" FOREIGN KEY ("page_id", "workspace_id")
    REFERENCES "page_content" ("node_id", "workspace_id") ON DELETE CASCADE,
  CONSTRAINT "page_blocks_superseded_by_fk" FOREIGN KEY ("page_id", "superseded_by")
    REFERENCES "page_blocks" ("page_id", "block_id")
);
--> statement-breakpoint

CREATE INDEX "page_blocks_workspace_page_status_idx" ON "page_blocks" ("workspace_id", "page_id", "status");
