-- Records when a provider contradicts its declared registry capability
-- at runtime (design.md — "Drift detection", "Capability registry and
-- structured-output degradation"; D11, D20). Instance-scoped by design:
-- this table records the correctness of OUR registry, not tenant
-- content, and therefore carries no workspace_id to isolate.
CREATE TABLE "ai_capability_observations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "provider" "ai_provider" NOT NULL,
  "model" text NOT NULL,
  "declared_level" "ai_structured_output_level" NOT NULL,
  "observed_level" "ai_structured_output_level" NOT NULL,
  "error_code" text,
  "observed_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "ai_capability_observations_provider_model_idx" ON "ai_capability_observations" ("provider", "model");
