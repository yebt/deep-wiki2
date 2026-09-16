/**
 * Composition-root helper: builds the real `KeyProvider` from the
 * already-validated `Env` (design.md — "Credentials: envelope encryption
 * a self-hoster can operate"; D5, D6). `refineEnv()` (`packages/contracts`)
 * already guarantees, whenever `AI_KEK_DRIVER=env`, that `AI_KEK_KEYRING`
 * parses and `AI_KEK_ACTIVE_ID` names a key present in it — `loadConfig()`
 * throws before this function is ever reached otherwise, so it trusts
 * that guarantee rather than re-validating it.
 */
import { parseKeyring } from '@deep-wiki/contracts/env';
import type { KeyProvider } from '@deep-wiki/core';
import { EnvKeyProvider } from './env-key-provider';

export interface KeyringEnvConfig {
  readonly AI_KEK_DRIVER: 'env' | 'kms';
  readonly AI_KEK_KEYRING?: string;
  readonly AI_KEK_ACTIVE_ID?: string;
  readonly AI_KEK_KMS_KEY_ID?: string;
}

export function buildKeyProvider(config: KeyringEnvConfig): KeyProvider {
  if (config.AI_KEK_DRIVER === 'kms') {
    // D5: KMS is additive, never the assumption. No adapter has been
    // built yet — failing fast here is the honest answer; a silent
    // fallback to the env driver would encrypt under the wrong key
    // without the operator ever choosing that.
    throw new Error('buildKeyProvider: AI_KEK_DRIVER=kms has no adapter yet — only "env" is implemented');
  }

  // `refineEnv()` guarantees both are present and that the keyring parses
  // whenever the driver is "env".
  const parsed = parseKeyring(config.AI_KEK_KEYRING!);
  if (!parsed.ok) {
    throw new Error(`buildKeyProvider: AI_KEK_KEYRING failed to parse despite passing refineEnv(): ${parsed.message}`);
  }

  return new EnvKeyProvider(parsed.keys, config.AI_KEK_ACTIVE_ID!);
}
