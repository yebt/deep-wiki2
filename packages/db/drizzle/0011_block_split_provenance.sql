-- Versioning and Collaboration (Phase 3), design.md Decision 1 ("Split
-- provenance"). `page_blocks` gains one nullable column recording, for a
-- fragment minted by a split, the id of the block it split from. Written
-- only on first insert (upsertActiveBlock) — a block's origin is a fact
-- about its birth, never touched again by `ON CONFLICT DO UPDATE`.
ALTER TABLE "page_blocks" ADD COLUMN "split_from" text;
--> statement-breakpoint

ALTER TABLE "page_blocks" ADD CONSTRAINT "page_blocks_split_from_fk"
  FOREIGN KEY ("page_id", "split_from") REFERENCES "page_blocks" ("page_id", "block_id");
