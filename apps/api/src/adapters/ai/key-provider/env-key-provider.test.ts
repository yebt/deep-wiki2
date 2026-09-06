import { describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { Secret } from '@deep-wiki/core';
import { AesGcmCredentialCipher } from '../cipher/aes-gcm-cipher';
import { EnvKeyProvider, rewrapDek } from './env-key-provider';

function keyring(...ids: string[]): ReadonlyMap<string, Uint8Array> {
  return new Map(ids.map((id) => [id, randomBytes(32)]));
}

describe('EnvKeyProvider', () => {
  test('activeKeyId() returns the configured active id', () => {
    const provider = new EnvKeyProvider(keyring('k1', 'k2'), 'k2');

    expect(provider.activeKeyId()).toBe('k2');
  });

  test('wrap then unwrap round-trips the DEK against the parsed keyring', async () => {
    const provider = new EnvKeyProvider(keyring('k1'), 'k1');
    const dek = randomBytes(32);

    const wrapped = await provider.wrap(dek, 'k1');
    expect(wrapped.ok).toBe(true);
    if (!wrapped.ok) return;

    const unwrapped = await provider.unwrap(wrapped.value, 'k1');
    expect(unwrapped.ok).toBe(true);
    if (unwrapped.ok) {
      expect(Buffer.from(unwrapped.value)).toEqual(Buffer.from(dek));
    }
  });

  test('wrap refuses an id absent from the keyring', async () => {
    const provider = new EnvKeyProvider(keyring('k1'), 'k1');

    const wrapped = await provider.wrap(randomBytes(32), 'does-not-exist');

    expect(wrapped.ok).toBe(false);
  });

  test('unwrap refuses when the wrapped bytes were produced under a different key', async () => {
    const provider = new EnvKeyProvider(keyring('k1', 'k2'), 'k1');
    const dek = randomBytes(32);

    const wrapped = await provider.wrap(dek, 'k1');
    expect(wrapped.ok).toBe(true);
    if (!wrapped.ok) return;

    const unwrapped = await provider.unwrap(wrapped.value, 'k2');
    expect(unwrapped.ok).toBe(false);
  });
});

describe('rewrapDek — the primitive ai:rekey (Phase 17) reuses', () => {
  test('rewrapping preserves the DEK: opening the sealed credential under the new key id yields the same plaintext', async () => {
    const keys = keyring('k1', 'k2');
    const provider = new EnvKeyProvider(keys, 'k1');
    const cipher = new AesGcmCredentialCipher(provider);
    const aad = { workspaceId: 'ws1', credentialId: 'cred1', provider: 'anthropic' };

    const sealed = await cipher.seal(new Secret('sk-ant-original'), aad);
    expect(sealed.ok).toBe(true);
    if (!sealed.ok) return;

    const rewrapped = await rewrapDek(provider, sealed.value.wrappedDek, sealed.value.keyId, 'k2');
    expect(rewrapped.ok).toBe(true);
    if (!rewrapped.ok) return;

    // Only wrappedDek and keyId change — ciphertext, iv, and authTag are
    // untouched, exactly as design.md's rotation section requires.
    const rekeyed = { ...sealed.value, wrappedDek: rewrapped.value, keyId: 'k2' };
    expect(rekeyed.ciphertext).toBe(sealed.value.ciphertext);
    expect(rekeyed.iv).toBe(sealed.value.iv);
    expect(rekeyed.authTag).toBe(sealed.value.authTag);

    const opened = await cipher.open(rekeyed, aad);
    expect(opened.ok).toBe(true);
    if (opened.ok) {
      expect(opened.value.reveal()).toBe('sk-ant-original');
    }
  });

  test('rewrapping to a target id not in the keyring is refused, leaving the row untouched', async () => {
    const provider = new EnvKeyProvider(keyring('k1'), 'k1');
    const dek = randomBytes(32);
    const wrapped = await provider.wrap(dek, 'k1');
    expect(wrapped.ok).toBe(true);
    if (!wrapped.ok) return;

    const result = await rewrapDek(provider, wrapped.value, 'k1', 'k-missing');

    expect(result.ok).toBe(false);
  });
});
