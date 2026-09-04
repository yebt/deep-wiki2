-- Workspace invitations (design.md — "Ports and adapters"; invitations
-- spec). `starting_grants` is a JSON array of `{resourceId, action,
-- effect}` applied verbatim to the `permissions` table on acceptance.
CREATE TABLE "invitations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "email" text NOT NULL,
  "token_hash" text NOT NULL UNIQUE,
  "starting_grants" jsonb NOT NULL DEFAULT '[]',
  "invited_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "expires_at" timestamptz NOT NULL,
  "accepted_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "invitations_workspace_id_idx" ON "invitations" ("workspace_id");
