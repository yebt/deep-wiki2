-- Instance-wide registration policy (design.md — "Registration mode";
-- registration-policy spec). A singleton row: the `id = 1` CHECK plus a
-- fixed default makes a second row structurally impossible.
CREATE TABLE "instance_settings" (
  "id" integer PRIMARY KEY DEFAULT 1,
  "registration_mode" "registration_mode" NOT NULL DEFAULT 'invitation_only',
  "open_registration_domains" text[] NOT NULL DEFAULT '{}',
  "smtp_verified_at" timestamptz,
  "smtp_config_hash" text,
  CONSTRAINT "instance_settings_singleton_chk" CHECK ("id" = 1)
);
--> statement-breakpoint
INSERT INTO "instance_settings" ("id") VALUES (1);
