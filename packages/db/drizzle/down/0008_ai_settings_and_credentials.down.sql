-- Drops the ciphertext rows rather than orphaning blobs whose wrapping
-- key is about to disappear (design.md — "Rollback — key material, not
-- just tables").
DROP INDEX IF EXISTS "workspace_ai_credentials_key_id_idx";
--> statement-breakpoint
DROP TABLE IF EXISTS "workspace_ai_credentials";
--> statement-breakpoint
DROP TABLE IF EXISTS "workspace_ai_settings";
--> statement-breakpoint
DROP TYPE IF EXISTS "ai_credential_validation_error_code";
--> statement-breakpoint
DROP TYPE IF EXISTS "ai_structured_output_level";
--> statement-breakpoint
DROP TYPE IF EXISTS "ai_provider";
