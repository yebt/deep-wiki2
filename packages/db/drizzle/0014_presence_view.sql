-- Versioning and Collaboration (Phase 3), design.md Decision 5 ("Presence
-- is a view, not a table"): presence derives entirely from the soft
-- lock's own heartbeat, so it needs no rows, no expiry column and no
-- sweeper of its own. TTL is evaluated on read, exactly as
-- `readLockStatus` already does for the lock itself.
--
-- This closes the proposal's own recorded spec defect — a `presence`
-- table with `workspace_id` but no composite foreign key into
-- `page_content` — in the strongest available form: a view has no rows to
-- be cross-tenant, and it inherits `page_locks_page_fk (node_id,
-- workspace_id) -> page_content (node_id, workspace_id)` from
-- `0010_page_locks.sql` structurally.
CREATE VIEW "presence" AS
  SELECT node_id AS page_id, workspace_id, holder_user_id AS user_id,
         acquired_at AS since, heartbeat_at, 'editing'::text AS mode
    FROM page_locks;
