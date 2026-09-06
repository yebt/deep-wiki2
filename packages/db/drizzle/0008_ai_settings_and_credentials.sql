-- Workspace AI settings and BYOK provider credentials (design.md —
-- "Schema"; workspace-ai-credentials spec). `workspace_ai_settings` holds
-- chat configuration only — the embedding pair lives in its own table
-- (Phase 15) because it is FK-referenced by `chunks`, and a three-column
-- foreign key needs a unique target `workspace_ai_settings` cannot offer
-- without an `ON UPDATE RESTRICT` that would make a model switch
-- impossible while any chunk exists.
--
-- `workspace_ai_credentials` has no plaintext column: `ciphertext`/`iv`/
-- `auth_tag` are the AES-256-GCM output, `wrapped_dek`/`key_id` are the
-- envelope (design.md — "Credentials: envelope encryption a self-hoster
-- can operate"). `UNIQUE (id, workspace_id)` lets a future composite
-- foreign key pin a row to its workspace, in the same idiom as
-- `nodes_id_workspace_id_unique` (0001_tenancy.sql).
CREATE TYPE "ai_provider" AS ENUM ('anthropic', 'openai', 'google', 'deepseek', 'openrouter', 'local');
--> statement-breakpoint
CREATE TYPE "ai_structured_output_level" AS ENUM ('schema', 'tool-call', 'prompted', 'none');
--> statement-breakpoint
-- Mapped from a provider SDK error before it ever reaches a logger
-- (design.md — "Validation probe"; workspace-ai-credentials spec —
-- "Credentials Never Exposed"). Closed set, never the raw payload.
CREATE TYPE "ai_credential_validation_error_code" AS ENUM ('invalid_key', 'insufficient_quota', 'network', 'unknown');
--> statement-breakpoint
CREATE TABLE "workspace_ai_settings" (
  "workspace_id" uuid PRIMARY KEY REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "chat_provider" "ai_provider",
  "chat_model" text,
  "structured_output_floor" "ai_structured_output_level",
  "updated_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "workspace_ai_credentials" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "provider" "ai_provider" NOT NULL,
  "ciphertext" bytea NOT NULL,
  "iv" bytea NOT NULL,
  "auth_tag" bytea NOT NULL,
  "wrapped_dek" bytea NOT NULL,
  "key_id" text NOT NULL,
  "alg" text NOT NULL DEFAULT 'aes-256-gcm',
  "last_four" char(4) NOT NULL,
  "validated_at" timestamptz,
  "validation_error_code" "ai_credential_validation_error_code",
  "compromised_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("id"),
  CONSTRAINT "workspace_ai_credentials_id_workspace_id_unique" UNIQUE ("id", "workspace_id"),
  CONSTRAINT "workspace_ai_credentials_workspace_provider_unique" UNIQUE ("workspace_id", "provider")
);
--> statement-breakpoint
-- Every rekey run scans by key_id (design.md — "Rotation"; `ai:rekey`).
CREATE INDEX "workspace_ai_credentials_key_id_idx" ON "workspace_ai_credentials" ("key_id");
