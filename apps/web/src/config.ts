import { z } from 'zod';

/**
 * apps/web reads zero required environment variables in Phase 0. Its one
 * runtime setting (`apiBaseUrl`, used by `useApiHealth`) is an optional,
 * Nuxt-native `runtimeConfig.public` override with a working default —
 * see nuxt.config.ts — not a fail-fast requirement, so it is intentionally
 * absent from this schema. This mirrors apps/api/src/config.ts and
 * apps/landing/src/lib/config.ts so all three apps document their
 * environment surface the same way, even when it is empty.
 */
export const webEnvSchema = z.object({});

export type WebEnv = z.infer<typeof webEnvSchema>;

export function loadConfig(raw: Record<string, string | undefined> = process.env): WebEnv {
  return webEnvSchema.parse(raw);
}
