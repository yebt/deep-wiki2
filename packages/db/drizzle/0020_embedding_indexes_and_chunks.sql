-- Embedding index generations and the chunk table pinned to one
-- (design.md — "Index generations are rows, and chunks are foreign-keyed
-- to one"; D14, D15; embedding-index-integrity spec). A chunk carrying a
-- model the workspace never declared is unrepresentable: the composite
-- FK `(workspace_id, embedding_model, dimensions)` targets
-- `workspace_embedding_indexes`' own `UNIQUE (workspace_id,
-- embedding_model, dimensions)`, so a mismatched write is rejected by the
-- database, not solely by application code.
--
-- `chunks` ships here with no writer and no query (D15) — the integrity
-- contract has to exist before rows do.
CREATE TYPE "embedding_index_state" AS ENUM ('building', 'active', 'retired');

--> statement-breakpoint
CREATE TABLE "workspace_embedding_indexes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "embedding_provider" "ai_provider" NOT NULL,
  "embedding_model" text NOT NULL,
  "dimensions" integer NOT NULL,
  "state" "embedding_index_state" NOT NULL DEFAULT 'building',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "activated_at" timestamptz,
  CONSTRAINT "workspace_embedding_indexes_dimensions_check" CHECK ("dimensions" = 1536),
  CONSTRAINT "workspace_embedding_indexes_model_dimensions_unique" UNIQUE ("workspace_id", "embedding_model", "dimensions")
);
--> statement-breakpoint
-- At most one active generation per workspace — the row the retrieval
-- slice's read filter resolves against (design.md — "The residual
-- obligation, stated").
CREATE UNIQUE INDEX "workspace_embedding_indexes_one_active_idx" ON "workspace_embedding_indexes" ("workspace_id") WHERE "state" = 'active';

--> statement-breakpoint
CREATE TABLE "chunks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "page_id" uuid NOT NULL,
  "block_ids" text[] NOT NULL DEFAULT '{}',
  "content" text NOT NULL,
  "embedding" vector(1536) NOT NULL,
  "embedding_model" text NOT NULL,
  "dimensions" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "chunks_vector_dims_check" CHECK (vector_dims("embedding") = "dimensions"),
  CONSTRAINT "chunks_page_workspace_fk" FOREIGN KEY ("page_id", "workspace_id")
    REFERENCES "nodes" ("id", "workspace_id") ON DELETE CASCADE,
  CONSTRAINT "chunks_index_generation_fk" FOREIGN KEY ("workspace_id", "embedding_model", "dimensions")
    REFERENCES "workspace_embedding_indexes" ("workspace_id", "embedding_model", "dimensions")
);
--> statement-breakpoint
CREATE INDEX "chunks_page_id_idx" ON "chunks" ("page_id");
