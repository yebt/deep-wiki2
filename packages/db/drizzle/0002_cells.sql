CREATE TABLE "cells" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "cells_id_workspace_id_unique" UNIQUE ("id", "workspace_id"),
  CONSTRAINT "cells_workspace_id_name_unique" UNIQUE ("workspace_id", "name")
);
--> statement-breakpoint
-- Cell membership is workspace-scoped (tenancy-model: Cells as Group
-- Subjects): a membership row's workspace_id must match its cell's own
-- workspace_id, enforced structurally by the composite FK below rather
-- than by a WHERE clause.
CREATE TABLE "cell_members" (
  "cell_id" uuid NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "workspace_id" uuid NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("cell_id", "user_id"),
  CONSTRAINT "cell_members_cell_fk" FOREIGN KEY ("cell_id", "workspace_id")
    REFERENCES "cells" ("id", "workspace_id") ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX "cell_members_ws_user_idx" ON "cell_members" ("workspace_id", "user_id") INCLUDE ("cell_id");
