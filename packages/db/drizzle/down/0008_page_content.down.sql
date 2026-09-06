DROP TABLE IF EXISTS "page_blocks";
DROP TABLE IF EXISTS "page_content";
DROP TYPE IF EXISTS "block_status";
ALTER TABLE "nodes" DROP CONSTRAINT IF EXISTS "nodes_id_workspace_id_type_key";
