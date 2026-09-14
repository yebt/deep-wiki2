-- 0008's comment on `page_blocks` claims "UNIQUE (page_id, block_id) spans
-- every status, including tombstoned, so a tombstoned id can never be
-- reused for a new block". Uniqueness does no such thing: it forbids a
-- second *row*, not a status flip on the existing one, and the save
-- transaction's `ON CONFLICT (page_id, block_id) DO UPDATE SET status =
-- 'active', superseded_by = NULL` is exactly that flip. The composite key
-- turned the insert into a resurrection instead of rejecting it.
--
-- `rebuild-derived.ts` now refuses such a save before writing anything
-- (`DeadAnchorError`), but a guard in one module is not the guarantee the
-- comment above asserts: the next writer of this table — a backfill, an
-- import, a repair script, a second adapter — would inherit none of it.
-- This makes retirement terminal in the storage layer, where the claim was
-- made, so no code path can undo it.
--
-- markdown-pipeline: "Block Delete Tombstones The ID"; docs/SPECS.md §3.3
-- (block ids are the one anchor primitive comments, AI selections, diffs
-- and RAG chunk provenance all resolve through).
CREATE FUNCTION "page_blocks_forbid_resurrection"() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'tombstoned' AND NEW."status" <> 'tombstoned' THEN
    RAISE EXCEPTION 'page_blocks: block % on page % is tombstoned; it cannot be revived as %',
      OLD."block_id", OLD."page_id", NEW."status"
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD."status" = 'superseded' AND NEW."status" = 'active' THEN
    RAISE EXCEPTION 'page_blocks: block % on page % was superseded by %; it cannot be revived as active',
      OLD."block_id", OLD."page_id", OLD."superseded_by"
      USING ERRCODE = 'check_violation';
  END IF;

  -- Severing the chain without changing the status is the same corruption
  -- wearing a different hat: `superseded_by` is the pointer
  -- `reconcile-comments.ts` walks to migrate a thread onto the surviving
  -- block, and orphaning is one-way. `compressChains` only ever rewrites
  -- this to another non-null terminal, so nothing legitimate clears it.
  IF OLD."status" = 'superseded' AND OLD."superseded_by" IS NOT NULL AND NEW."superseded_by" IS NULL THEN
    RAISE EXCEPTION 'page_blocks: block % on page % is superseded; superseded_by cannot be cleared',
      OLD."block_id", OLD."page_id"
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER "page_blocks_forbid_resurrection_trigger"
  BEFORE UPDATE ON "page_blocks"
  FOR EACH ROW EXECUTE FUNCTION "page_blocks_forbid_resurrection"();
