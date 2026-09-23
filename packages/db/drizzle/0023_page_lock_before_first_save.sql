-- The soft lock belongs to the page NODE, not to the page's content row
-- (content-and-editor design.md "The soft lock, coherent without
-- presence"). 0010 pinned `page_locks` to `page_content (node_id,
-- workspace_id)` because that was the composite key on hand, and the
-- coupling it smuggled in — "a lock may only exist where content already
-- exists" — stayed invisible for as long as no caller could reach a page
-- with no content row: `GET /pages/:id/edit-session` answered 404 before it
-- ever tried to take one.
--
-- A page that has never been saved is an empty document, not an absent one
-- (docs/TODO.md Findings, 2026-09-23), so the first thing its author does
-- is take a lock on a node that has no `page_content` row — which
-- `page_locks_page_fk` refuses, turning the fixed read into a constraint
-- violation one hop later.
--
-- The foreign key therefore moves to `nodes (id, workspace_id, type)`,
-- exactly the key `page_content_node_fk` itself uses (0008): tenancy and
-- node type stay structurally pinned, so a lock on a chapter is still
-- unrepresentable, and "content exists" stops being a precondition for
-- holding one. `node_type` is CHECK-pinned to 'page' for the same reason
-- and in the same shape `page_content` already carries it. The purge
-- cascade still fires, one hop earlier: deleting the node took the content
-- row (and with it the lock) before, and takes the lock directly now.
ALTER TABLE "page_locks" DROP CONSTRAINT "page_locks_page_fk";
--> statement-breakpoint

ALTER TABLE "page_locks"
  ADD COLUMN "node_type" "node_type" NOT NULL DEFAULT 'page'
    CONSTRAINT "page_locks_node_type_chk" CHECK ("node_type" = 'page');
--> statement-breakpoint

ALTER TABLE "page_locks" ADD CONSTRAINT "page_locks_node_fk"
  FOREIGN KEY ("node_id", "workspace_id", "node_type")
  REFERENCES "nodes" ("id", "workspace_id", "type") ON DELETE CASCADE;
