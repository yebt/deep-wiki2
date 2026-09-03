import { parseEnv, type Env } from '@deep-wiki/contracts';

/**
 * Fail-fast typed configuration loader (composition root — `process.env`
 * is read only here, never inside `packages/*`). Throws synchronously with
 * every offending variable named before the app starts serving requests.
 */
export function loadConfig(raw: Record<string, string | undefined> = process.env): Env {
  const result = parseEnv(raw);

  if (!result.ok) {
    const details = result.error.map((issue) => `  - ${issue.variable}: ${issue.message}`).join('\n');
    throw new Error(`apps/api: invalid configuration\n${details}`);
  }

  return result.value;
}
