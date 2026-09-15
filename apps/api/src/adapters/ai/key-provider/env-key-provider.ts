/**
 * `KeyProvider` adapter backed by an operator-supplied keyring read from
 * the environment (design.md — "Credentials: envelope encryption a
 * self-hoster can operate"; D5, D6). The default adapter (`AI_KEK_DRIVER
 * =env`): a self-hoster is not assumed to run a cloud KMS. `wrap`/
 * `unwrap` are themselves AES-256-GCM operations over the DEK, keyed by
 * the named KEK; the wrapped format is `iv (12) || authTag (16) ||
 * ciphertext`.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { err, ok, type KeyError, type KeyProvider, type Result } from '@deep-wiki/core';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;

export class EnvKeyProvider implements KeyProvider {
  constructor(
    private readonly keyring: ReadonlyMap<string, Uint8Array>,
    private readonly activeId: string,
  ) {}

  activeKeyId(): string {
    return this.activeId;
  }

  async wrap(dek: Uint8Array, keyId: string): Promise<Result<Uint8Array, KeyError>> {
    const kek = this.keyring.get(keyId);
    if (!kek) {
      return err({ reason: `unknown key id "${keyId}" — not present in the configured keyring` });
    }

    const iv = randomBytes(IV_LENGTH_BYTES);
    const cipher = createCipheriv(ALGORITHM, kek, iv);
    const ciphertext = Buffer.concat([cipher.update(dek), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return ok(new Uint8Array(Buffer.concat([iv, authTag, ciphertext])));
  }

  async unwrap(wrapped: Uint8Array, keyId: string): Promise<Result<Uint8Array, KeyError>> {
    const kek = this.keyring.get(keyId);
    if (!kek) {
      return err({ reason: `unknown key id "${keyId}" — not present in the configured keyring` });
    }

    const buf = Buffer.from(wrapped);
    const iv = buf.subarray(0, IV_LENGTH_BYTES);
    const authTag = buf.subarray(IV_LENGTH_BYTES, IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);
    const ciphertext = buf.subarray(IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);

    try {
      const decipher = createDecipheriv(ALGORITHM, kek, iv);
      decipher.setAuthTag(authTag);
      const dek = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return ok(new Uint8Array(dek));
    } catch {
      return err({ reason: `unwrap failed for key id "${keyId}": authentication tag mismatch` });
    }
  }
}

/**
 * Unwraps a DEK under `fromKeyId` and re-wraps it under `toKeyId`,
 * touching nothing else. This is the whole of key rotation (design.md —
 * "Rotation"): `ciphertext`, `iv`, and `authTag` never change, because
 * they depend only on the DEK's plaintext bytes, not on which KEK
 * currently wraps it. `apps/api/src/ai/rekey.ts` (Phase 17) calls this
 * per credential row and persists only the new `wrapped_dek`/`key_id`.
 */
export async function rewrapDek(
  keyProvider: KeyProvider,
  wrappedDek: Uint8Array,
  fromKeyId: string,
  toKeyId: string,
): Promise<Result<Uint8Array, KeyError>> {
  const unwrapped = await keyProvider.unwrap(wrappedDek, fromKeyId);
  if (!unwrapped.ok) {
    return unwrapped;
  }

  return keyProvider.wrap(unwrapped.value, toKeyId);
}
