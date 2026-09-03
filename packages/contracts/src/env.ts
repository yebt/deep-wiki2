import { err, ok, type Result } from '@deep-wiki/core';
import { z } from 'zod';

/**
 * Single source of truth for server-side environment variables. Every
 * variable declared here MUST also appear in the repository root's
 * `env.example` (enforced by `scripts/checks/env-example.ts`), which is
 * copied to `.env` for local use.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive(),
  DATABASE_URL: z.string().url(),
});

export type Env = z.infer<typeof envSchema>;

export interface EnvIssue {
  readonly variable: string;
  readonly message: string;
}

export function parseEnv(raw: Record<string, string | undefined>): Result<Env, EnvIssue[]> {
  const parsed = envSchema.safeParse(raw);

  if (parsed.success) {
    return ok(parsed.data);
  }

  const issues: EnvIssue[] = parsed.error.issues.map((issue) => ({
    variable: issue.path.join('.') || '(root)',
    message: issue.message,
  }));

  return err(issues);
}
