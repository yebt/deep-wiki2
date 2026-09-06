/**
 * `CredentialCipher` adapter: envelope encryption with a per-credential
 * DEK (design.md — "Credentials: envelope encryption a self-hoster can
 * operate"; D5, D7). The DEK is generated fresh per `seal()` call and
 * immediately wrapped by the injected `KeyProvider` — only the wrapped
 * DEK and the key id are persisted, never the plaintext DEK. AES-256-GCM
 * binds the ciphertext to `aad` (workspace_id, credential_id, provider):
 * a wrong AAD or a wrapped DEK unwrapped under the wrong key id both fail
 * authentication rather than producing wrong plaintext.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import {
  buildAad,
  err,
  ok,
  Secret,
  type CipherError,
  type CredentialAad,
  type CredentialCipher,
  type KeyProvider,
  type Result,
  type SealedCredential,
} from '@deep-wiki/core';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12;
const DEK_LENGTH_BYTES = 32;

export class AesGcmCredentialCipher implements CredentialCipher {
  constructor(private readonly keyProvider: KeyProvider) {}

  async seal(plaintext: Secret<string>, aad: CredentialAad): Promise<Result<SealedCredential, CipherError>> {
    const dek = randomBytes(DEK_LENGTH_BYTES);
    const iv = randomBytes(IV_LENGTH_BYTES);

    const cipher = createCipheriv(ALGORITHM, dek, iv);
    cipher.setAAD(buildAad(aad));
    const ciphertext = Buffer.concat([cipher.update(plaintext.reveal(), 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const keyId = this.keyProvider.activeKeyId();
    const wrapped = await this.keyProvider.wrap(dek, keyId);
    if (!wrapped.ok) {
      return err({ reason: `key wrap failed: ${wrapped.error.reason}` });
    }

    return ok({
      ciphertext: new Uint8Array(ciphertext),
      iv: new Uint8Array(iv),
      authTag: new Uint8Array(authTag),
      wrappedDek: wrapped.value,
      keyId,
    });
  }

  async open(sealed: SealedCredential, aad: CredentialAad): Promise<Result<Secret<string>, CipherError>> {
    const unwrapped = await this.keyProvider.unwrap(sealed.wrappedDek, sealed.keyId);
    if (!unwrapped.ok) {
      return err({ reason: `key unwrap failed: ${unwrapped.error.reason}` });
    }

    try {
      const decipher = createDecipheriv(ALGORITHM, unwrapped.value, sealed.iv);
      decipher.setAAD(buildAad(aad));
      decipher.setAuthTag(sealed.authTag);
      const plaintext = Buffer.concat([decipher.update(sealed.ciphertext), decipher.final()]);
      return ok(new Secret(plaintext.toString('utf8')));
    } catch {
      return err({ reason: 'decryption failed: authentication tag mismatch' });
    }
  }
}
