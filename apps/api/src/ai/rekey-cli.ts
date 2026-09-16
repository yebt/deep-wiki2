import postgres from 'postgres';
import { parseKeyring } from '@deep-wiki/contracts/env';
import { EnvKeyProvider } from '../adapters/ai/key-provider/env-key-provider';
import { rekeyAll } from './rekey';

/**
 * `bun run -F @deep-wiki/api ai:rekey --to <keyId> [--compromised]`
 *
 * Rewraps every stored credential's DEK onto `--to`'s KEK (design.md —
 * "Rotation"). Reads `DATABASE_URL` and `AI_KEK_KEYRING` directly from
 * `process.env` rather than `loadConfig()`, so an operator can run this
 * without satisfying every other startup requirement (SMTP, blob store)
 * the full server needs.
 */
function readFlag(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('ai:rekey: DATABASE_URL is not set');
    process.exit(1);
  }

  const keyringRaw = process.env.AI_KEK_KEYRING;
  if (!keyringRaw) {
    console.error('ai:rekey: AI_KEK_KEYRING is not set');
    process.exit(1);
  }

  const parsed = parseKeyring(keyringRaw);
  if (!parsed.ok) {
    console.error(`ai:rekey: AI_KEK_KEYRING failed to parse: ${parsed.message}`);
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const toKeyId = readFlag(args, 'to');
  if (!toKeyId) {
    console.error('ai:rekey: --to <keyId> is required');
    process.exit(1);
  }
  if (!parsed.keys.has(toKeyId)) {
    console.error(`ai:rekey: --to "${toKeyId}" is not present in AI_KEK_KEYRING`);
    process.exit(1);
  }

  const compromised = args.includes('--compromised');
  const keyProvider = new EnvKeyProvider(parsed.keys, toKeyId);
  const sql = postgres(url);

  try {
    const result = await rekeyAll({ sql, keyProvider }, { toKeyId, compromised });
    if (!result.ok) {
      console.error(`ai:rekey: ${result.error.reason}`);
      process.exit(1);
    }

    const rewrapped = result.value.filter((r) => !r.skipped).length;
    const skipped = result.value.length - rewrapped;
    console.log(`ai:rekey: rewrapped ${rewrapped} credential(s), skipped ${skipped} already at "${toKeyId}"${compromised ? ' (marked compromised)' : ''}`);
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}

if (import.meta.main) {
  await main();
}
