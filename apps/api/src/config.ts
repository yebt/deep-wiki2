import { parseEnv, parseKeyring, type Env } from '@deep-wiki/contracts';
import type postgres from 'postgres';

/**
 * Fail-fast typed configuration loader (composition root — `process.env`
 * is read only here, never inside `packages/*`). Throws synchronously with
 * every offending variable named before the app starts serving requests.
 */
export function loadConfig(raw: Record<string, string | undefined> = process.env): Env {
  const result = parseEnv(raw);

  if (!result.ok) {
    const details = result.error.map((issue) => `  - ${issue.message}`).join('\n');
    throw new Error(`apps/api: invalid configuration\n${details}`);
  }

  return result.value;
}

/**
 * Boot-time keyring completeness (design.md — "Credentials: envelope
 * encryption a self-hoster can operate" — "Keyring completeness";
 * environment-config delta — "Envelope Master Key Validated at
 * Startup"). `refineEnv()` already guarantees the *configured* keyring
 * itself parses; it cannot see whether a previously-stored credential
 * references a `key_id` since retired from `AI_KEK_KEYRING`. Discovering
 * that mid-request, per tenant, is the worst possible moment to learn it
 * — this runs once at startup instead, alongside `refineEnv()`.
 *
 * A `kms` driver has no notion of "the configured keyring" the way `env`
 * does — its `key_id`s are validated by the KMS itself on first use, not
 * enumerable here — so this check only applies when `AI_KEK_DRIVER=env`.
 */
export async function assertKeyringComplete(
  sql: postgres.Sql,
  config: Pick<Env, 'AI_KEK_DRIVER' | 'AI_KEK_KEYRING'>,
): Promise<void> {
  if (config.AI_KEK_DRIVER !== 'env') {
    return;
  }

  // `refineEnv()` already guarantees this parses whenever the driver is "env".
  const parsed = parseKeyring(config.AI_KEK_KEYRING!);
  if (!parsed.ok) {
    throw new Error(`apps/api: AI_KEK_KEYRING failed to parse despite passing refineEnv(): ${parsed.message}`);
  }

  const rows = await sql<{ key_id: string }[]>`SELECT DISTINCT key_id FROM workspace_ai_credentials`;
  const missing = rows.map((row) => row.key_id).filter((keyId) => !parsed.keys.has(keyId));

  if (missing.length > 0) {
    throw new Error(
      `apps/api: ${missing.length} stored credential(s) reference a key id absent from AI_KEK_KEYRING: ${missing.join(', ')}. ` +
        `Restore the retired key in the keyring, or rekey those rows first (bun run -F @deep-wiki/api ai:rekey).`,
    );
  }
}
