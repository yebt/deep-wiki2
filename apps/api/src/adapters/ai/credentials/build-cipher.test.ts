/**
 * `buildCipher` is the one seam through which the composition root asks
 * for a real `CredentialCipher` without importing the cipher module itself
 * (`scripts/checks/query-boundaries.ts` — the decryption boundary). What
 * it hands back must be the production AES-256-GCM cipher bound to the
 * key provider it was given — not a stub, and not a cipher bound to some
 * other keyring.
 */
import { describe, expect, test } from 'bun:test';
import { Secret, type CredentialAad } from '@deep-wiki/core';
import { EnvKeyProvider } from '../key-provider/env-key-provider';
import { buildCipher } from './build-cipher';

const AAD: CredentialAad = { workspaceId: 'ws1', credentialId: 'cred1', provider: 'anthropic' };

describe('buildCipher', () => {
  test('returns a cipher that seals and opens under the given key provider', async () => {
    const cipher = buildCipher(new EnvKeyProvider(new Map([['k1', Buffer.alloc(32, 7)]]), 'k1'));

    const sealed = await cipher.seal(new Secret('sk-live-example'), AAD);
    expect(sealed.ok).toBe(true);
    if (!sealed.ok) return;

    expect(sealed.value.keyId).toBe('k1');
    expect(Buffer.from(sealed.value.ciphertext).toString('utf8')).not.toContain('sk-live-example');

    const opened = await cipher.open(sealed.value, AAD);
    expect(opened.ok).toBe(true);
    if (opened.ok) expect(opened.value.reveal()).toBe('sk-live-example');
  });

  test('a cipher built over a different keyring cannot open what the first sealed', async () => {
    const first = buildCipher(new EnvKeyProvider(new Map([['k1', Buffer.alloc(32, 7)]]), 'k1'));
    const other = buildCipher(new EnvKeyProvider(new Map([['k1', Buffer.alloc(32, 9)]]), 'k1'));

    const sealed = await first.seal(new Secret('sk-live-example'), AAD);
    expect(sealed.ok).toBe(true);
    if (!sealed.ok) return;

    const opened = await other.open(sealed.value, AAD);
    expect(opened.ok).toBe(false);
  });
});
