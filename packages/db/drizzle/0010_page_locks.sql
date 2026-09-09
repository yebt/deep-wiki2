-- Content and the Editor (Phase 2), design.md "The soft lock, coherent
-- without presence". No expiry column and no sweeper job: a lock is held
-- iff `heartbeat_at > now() - ttl`, computed at read time by
-- packages/db/src/locks/page-lock.ts. `taken_over_from`/`taken_over_at`
-- record the most recent takeover for the UI's "you took this over from
-- X" framing; they carry no behaviour of their own.
CREATE TABLE "page_locks" (
  "node_id" uuid PRIMARY KEY,
  "workspace_id" uuid NOT NULL,
  "holder_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "acquired_at" timestamptz NOT NULL DEFAULT now(),
  "heartbeat_at" timestamptz NOT NULL DEFAULT now(),
  "taken_over_from" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "taken_over_at" timestamptz,
  CONSTRAINT "page_locks_page_fk" FOREIGN KEY ("node_id", "workspace_id")
    REFERENCES "page_content" ("node_id", "workspace_id") ON DELETE CASCADE
);
