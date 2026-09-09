ALTER TABLE "page_blocks" DROP CONSTRAINT IF EXISTS "page_blocks_split_from_fk";
ALTER TABLE "page_blocks" DROP COLUMN IF EXISTS "split_from";
