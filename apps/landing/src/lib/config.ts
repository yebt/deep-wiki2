import { z } from 'zod';

/**
 * apps/landing reads zero environment variables in Phase 0 — the
 * marketing site is fully static, with no backend calls of its own.
 * This schema documents that explicitly (rather than having no schema
 * at all) so a future variable has a fail-fast home to land in,
 * following the same convention as apps/api/src/config.ts and
 * apps/web/src/config.ts. Deliberately not `.strict()`: an empty schema
 * strips unrelated keys rather than rejecting them, so this stays inert
 * regardless of what else happens to be present in `process.env`.
 */
export const landingEnvSchema = z.object({});

export type LandingEnv = z.infer<typeof landingEnvSchema>;

export function loadConfig(raw: Record<string, string | undefined> = process.env): LandingEnv {
  return landingEnvSchema.parse(raw);
}
