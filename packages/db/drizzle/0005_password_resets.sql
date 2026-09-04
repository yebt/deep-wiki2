-- Password reset tokens (design.md — "Authentication"): 256-bit random,
-- SHA-256 hashed at rest, single-use (consumed_at), bounded TTL. Issuing a
-- new token for a user revokes prior unconsumed ones at the application
-- layer (packages/db/src/auth/password-resets.ts), not by a DB constraint.
CREATE TABLE "password_resets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token_hash" text NOT NULL UNIQUE,
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "password_resets_user_id_idx" ON "password_resets" ("user_id");
