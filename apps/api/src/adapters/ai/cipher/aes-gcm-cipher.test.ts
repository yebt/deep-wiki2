import { describe, expect, test } from 'bun:test';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { err, ok, Secret, type CredentialAad, type KeyProvider } from '@deep-wiki/core';
import { AesGcmCredentialCipher } from './aes-gcm-cipher';

/**
 * A self-contained fake `KeyProvider`, isolated from the real
 * `env-key-provider.ts` adapter (built in the next work unit, 7.3–7.4).
 * It wraps a DEK with a real per-key AES-256-GCM operation so that
 * unwrapping under the wrong key id genuinely fails authentication,
 * exactly like the production adapter — this test exercises the cipher's
 * own behaviour, not a stub that always succeeds.
 */
function fakeKeyProvider(activeId: string, keks: Record<string, Uint8Array>): KeyProvider {
  return {
    activeKeyId: () => activeId,
    wrap: async (dek, keyId) => {
      const kek = keks[keyId];
      if (!kek) return err({ reason: `unknown key id "${keyId}"` });
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', kek, iv);
      const ciphertext = Buffer.concat([cipher.update(dek), cipher.final()]);
      const authTag = cipher.getAuthTag();
      return ok(new Uint8Array(Buffer.concat([iv, authTag, ciphertext])));
    },
    unwrap: async (wrapped, keyId) => {
      const kek = keks[keyId];
      if (!kek) return err({ reason: `unknown key id "${keyId}"` });
      const buf = Buffer.from(wrapped);
      const iv = buf.subarray(0, 12);
      const authTag = buf.subarray(12, 28);
      const ciphertext = buf.subarray(28);
      try {
        const decipher = createDecipheriv('aes-256-gcm', kek, iv);
        decipher.setAuthTag(authTag);
        const dek = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        return ok(new Uint8Array(dek));
      } catch {
        return err({ reason: 'unwrap authentication failed' });
      }
    },
  };
}

const KEK_1 = randomBytes(32);
const KEK_2 = randomBytes(32);
const AAD: CredentialAad = { workspaceId: 'ws1', credentialId: 'cred1', provider: 'anthropic' };
const OTHER_AAD: CredentialAad = { workspaceId: 'ws2', credentialId: 'cred1', provider: 'anthropic' };
const PLAINTEXT = 'sk-ant-super-secret-key-value';

describe('AesGcmCredentialCipher', () => {
  test('seal then open round-trips the plaintext', async () => {
    const cipher = new AesGcmCredentialCipher(fakeKeyProvider('k1', { k1: KEK_1 }));

    const sealed = await cipher.seal(new Secret(PLAINTEXT), AAD);
    expect(sealed.ok).toBe(true);
    if (!sealed.ok) return;

    const opened = await cipher.open(sealed.value, AAD);
    expect(opened.ok).toBe(true);
    if (opened.ok) {
      expect(opened.value.reveal()).toBe(PLAINTEXT);
    }
  });

  test('open fails when the AAD does not match the one used to seal', async () => {
    const cipher = new AesGcmCredentialCipher(fakeKeyProvider('k1', { k1: KEK_1 }));

    const sealed = await cipher.seal(new Secret(PLAINTEXT), AAD);
    expect(sealed.ok).toBe(true);
    if (!sealed.ok) return;

    const opened = await cipher.open(sealed.value, OTHER_AAD);
    expect(opened.ok).toBe(false);
  });

  test('open fails when the sealed credential names the wrong key id', async () => {
    const cipher = new AesGcmCredentialCipher(fakeKeyProvider('k1', { k1: KEK_1, k2: KEK_2 }));

    const sealed = await cipher.seal(new Secret(PLAINTEXT), AAD);
    expect(sealed.ok).toBe(true);
    if (!sealed.ok) return;

    // The wrappedDek bytes were produced under k1's real KEK; presenting a
    // different key id must fail unwrap authentication rather than
    // silently succeeding with garbage bytes.
    const tampered = { ...sealed.value, keyId: 'k2' };
    const opened = await cipher.open(tampered, AAD);
    expect(opened.ok).toBe(false);
  });

  test('the sealed blob contains no plaintext substring', async () => {
    const cipher = new AesGcmCredentialCipher(fakeKeyProvider('k1', { k1: KEK_1 }));

    const sealed = await cipher.seal(new Secret(PLAINTEXT), AAD);
    expect(sealed.ok).toBe(true);
    if (!sealed.ok) return;

    const serialized = [
      Buffer.from(sealed.value.ciphertext).toString('base64'),
      Buffer.from(sealed.value.ciphertext).toString('hex'),
      Buffer.from(sealed.value.wrappedDek).toString('base64'),
      Buffer.from(sealed.value.wrappedDek).toString('hex'),
    ].join(' ');

    expect(serialized).not.toContain(PLAINTEXT);
    expect(serialized.toLowerCase()).not.toContain(Buffer.from(PLAINTEXT).toString('hex'));
  });
});
