CREATE TYPE "node_type" AS ENUM ('workspace', 'shelf', 'book', 'chapter', 'page');
--> statement-breakpoint
-- 'role' is reserved with no producer in this phase: adding a Postgres enum
-- value later is a cheap ALTER TYPE ... ADD VALUE, removing one is not, so
-- it is committed now rather than deferred (design.md — Open Questions;
-- task 3.8; docs/TODO.md Findings).
CREATE TYPE "subject_kind" AS ENUM ('user', 'cell', 'role', 'agent');
--> statement-breakpoint
CREATE TYPE "perm_action" AS ENUM ('read', 'comment', 'write', 'manage');
--> statement-breakpoint
CREATE TYPE "perm_effect" AS ENUM ('allow', 'deny');
--> statement-breakpoint
CREATE TYPE "registration_mode" AS ENUM ('closed', 'invitation_only', 'open');
--> statement-breakpoint
CREATE TABLE "plans" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL UNIQUE,
  "max_workspaces" integer NOT NULL,
  "max_seats" integer NOT NULL,
  "max_storage_bytes" text NOT NULL,
  "max_ai_tokens_monthly" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "email" text NOT NULL UNIQUE,
  "password_hash" text NOT NULL,
  "display_name" text NOT NULL,
  "avatar_key" text,
  "plan_id" uuid REFERENCES "plans"("id"),
  "is_super_root" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "users_email_lower_chk" CHECK ("email" = lower("email"))
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "owner_id" uuid NOT NULL REFERENCES "users"("id"),
  "name" text NOT NULL,
  "slug" text NOT NULL UNIQUE,
  "settings" jsonb NOT NULL DEFAULT '{}',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "workspaces_owner_id_idx" ON "workspaces" ("owner_id");
--> statement-breakpoint
-- `path` is written only by the nodes_set_path trigger below (design.md
-- D3) — application code never supplies it. Authorisation walks
-- parent_id, never this column (design.md D5); path exists for subtree
-- navigation queries only (packages/db/src/nodes/subtree.ts).
CREATE TABLE "nodes" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "parent_id" uuid,
  "type" "node_type" NOT NULL,
  "path" text NOT NULL,
  "position" integer NOT NULL,
  "slug" text NOT NULL,
  "title" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "nodes_id_workspace_id_unique" UNIQUE ("id", "workspace_id"),
  CONSTRAINT "nodes_parent_fk" FOREIGN KEY ("parent_id", "workspace_id")
    REFERENCES "nodes" ("id", "workspace_id") ON DELETE CASCADE,
  CONSTRAINT "nodes_parent_iff_not_workspace_chk"
    CHECK (("parent_id" IS NULL) = ("type" = 'workspace')),
  CONSTRAINT "nodes_parent_slug_unique" UNIQUE ("parent_id", "slug"),
  -- Shape: lowercase hex UUIDs and '/' only, so ILIKE is never needed and
  -- no LIKE metacharacter can ever be stored (design.md — "The nodes path
  -- encoding").
  CONSTRAINT "nodes_path_shape_chk"
    CHECK ("path" ~ '^(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})+/$'),
  CONSTRAINT "nodes_path_length_chk" CHECK (char_length("path") <= 256)
);
--> statement-breakpoint
-- Exactly one `workspace`-type root per workspace_id (design.md — Schema).
CREATE UNIQUE INDEX "nodes_one_workspace_root_idx" ON "nodes" ("workspace_id")
  WHERE "type" = 'workspace';
--> statement-breakpoint
-- text_pattern_ops is not optional decoration: this database runs a
-- non-C collation, and a plain btree(path) will not serve LIKE 'prefix%'
-- here (design.md — "The nodes path encoding"; tenancy-model spec).
CREATE INDEX "nodes_ws_path_idx" ON "nodes" ("workspace_id", "path" text_pattern_ops);
--> statement-breakpoint
CREATE INDEX "nodes_ws_parent_position_idx" ON "nodes" ("workspace_id", "parent_id", "position");
--> statement-breakpoint
-- The only writer of `path` (design.md D3). Depth 0 (workspace root, no
-- parent) gets '/' || id || '/'; every other row inherits its parent's
-- current path and appends its own id. Fires on INSERT and whenever
-- parent_id is included in an UPDATE's SET list — the reparent algorithm
-- in packages/db/src/nodes/move.ts relies on this to recompute the moved
-- row's own path; rewriting every descendant's path is a separate,
-- explicit uniform-prefix UPDATE (design.md — "Reparent").
CREATE FUNCTION "nodes_set_path"() RETURNS trigger AS $$
DECLARE
  parent_path text;
BEGIN
  IF NEW."parent_id" IS NULL THEN
    NEW."path" := '/' || NEW."id" || '/';
  ELSE
    SELECT "path" INTO parent_path FROM "nodes" WHERE "id" = NEW."parent_id";
    NEW."path" := parent_path || NEW."id" || '/';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER "nodes_set_path_trigger"
  BEFORE INSERT OR UPDATE OF "parent_id" ON "nodes"
  FOR EACH ROW EXECUTE FUNCTION "nodes_set_path"();
