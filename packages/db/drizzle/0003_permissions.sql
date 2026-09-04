-- resource_type is deliberately NOT a column (design.md D10): it is
-- nodes.type of resource_id, and storing it a second time would create a
-- value that can disagree with the tree.
CREATE TABLE "permissions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "subject_type" "subject_kind" NOT NULL,
  "subject_id" uuid NOT NULL,
  "resource_id" uuid NOT NULL,
  "action" "perm_action" NOT NULL,
  "effect" "perm_effect" NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  -- Generated columns exist only to carry a composite FK per subject
  -- kind. MATCH SIMPLE (the default) makes each FK inert for the kinds
  -- it does not apply to, which is exactly the wanted behaviour.
  "subject_cell_id" uuid GENERATED ALWAYS AS
    (CASE WHEN "subject_type" = 'cell' THEN "subject_id" END) STORED,
  "subject_agent_id" uuid GENERATED ALWAYS AS
    (CASE WHEN "subject_type" = 'agent' THEN "subject_id" END) STORED,
  CONSTRAINT "permissions_resource_fk" FOREIGN KEY ("resource_id", "workspace_id")
    REFERENCES "nodes" ("id", "workspace_id") ON DELETE CASCADE,
  CONSTRAINT "permissions_subject_cell_fk" FOREIGN KEY ("subject_cell_id", "workspace_id")
    REFERENCES "cells" ("id", "workspace_id") ON DELETE CASCADE,
  -- subject_agent_id's FK target (the agents table) lands with agent
  -- identities in a later phase; adding that FK then is a one-line
  -- migration rather than a table rewrite.
  CONSTRAINT "permissions_unique_grant" UNIQUE
    ("workspace_id", "subject_type", "subject_id", "resource_id", "action")
);
--> statement-breakpoint
CREATE INDEX "permissions_lookup_idx" ON "permissions"
  ("workspace_id", "resource_id", "subject_type", "subject_id", "action", "effect");
