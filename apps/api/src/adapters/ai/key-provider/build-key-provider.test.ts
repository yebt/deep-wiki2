/**
 * Composition-root helper: turns the already-validated `Env` (design.md
 * — "Credentials: envelope encryption a self-hoster can operate") into
 * a real `KeyProvider`. `refineEnv()` already guarantees `AI_KEK_KEYRING`
 * parses and `AI_KEK_ACTIVE_ID` names a key present in it whenever
 * `AI_KEK_DRIVER=env` — `loadConfig()` would have thrown otherwise — so
 * this module trusts that guarantee rather than re-validating it.
 */
import { describe, expect, test } from 'bun:test';
import { buildKeyProvider } from './build-key-provider';

const TEST_KEK = Buffer.alloc(32, 7).toString('base64');

function envConfig(overrides: Partial<{ AI_KEK_DRIVER: 'env' | 'kms'; AI_KEK_KEYRING?: string; AI_KEK_ACTIVE_ID?: string; AI_KEK_KMS_KEY_ID?: string }> = {}) {
  return {
    AI_KEK_DRIVER: 'env' as const,
    AI_KEK_KEYRING: `k1:${TEST_KEK}`,
    AI_KEK_ACTIVE_ID: 'k1',
    ...overrides,
  };
}

describe('buildKeyProvider', () => {
  test('the env driver builds a KeyProvider whose activeKeyId matches AI_KEK_ACTIVE_ID', () => {
    const keyProvider = buildKeyProvider(envConfig());

    expect(keyProvider.activeKeyId()).toBe('k1');
  });

  test('the built provider wraps and unwraps against the parsed keyring', async () => {
    const keyProvider = buildKeyProvider(envConfig());
    const dek = new Uint8Array(32).fill(9);

    const wrapped = await keyProvider.wrap(dek, 'k1');
    expect(wrapped.ok).toBe(true);
    if (!wrapped.ok) return;

    const unwrapped = await keyProvider.unwrap(wrapped.value, 'k1');
    expect(unwrapped.ok).toBe(true);
    if (unwrapped.ok) expect(Buffer.from(unwrapped.value)).toEqual(Buffer.from(dek));
  });

  test('the kms driver has no adapter yet and fails fast rather than silently no-oping', () => {
    expect(() => buildKeyProvider(envConfig({ AI_KEK_DRIVER: 'kms', AI_KEK_KMS_KEY_ID: 'projects/x/keys/y' }))).toThrow(/kms/i);
  });
});
