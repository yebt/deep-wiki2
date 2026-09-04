/**
 * Argon2id adapter behind `PasswordHasher` (design.md D13 — `Bun.password`,
 * m=19456 KiB, t=2, p=1 — OWASP floor). Bun's argon2 binding does not expose
 * a parallelism parameter; the underlying `rust-argon2` crate defaults to
 * p=1, which already matches D13.
 */
import { describe, expect, test } from 'bun:test';
import type { PasswordHasher } from '@deep-wiki/core';
import { Argon2idPasswordHasher } from './argon2id-password-hasher';

describe('Argon2idPasswordHasher', () => {
  const hasher: PasswordHasher = new Argon2idPasswordHasher();

  test('hashes a password and verifies it against the same plaintext', async () => {
    const hash = await hasher.hash('correct-horse-battery-staple');

    expect(hash).toContain('$argon2id$');
    expect(await hasher.verify(hash, 'correct-horse-battery-staple')).toBe(true);
  });

  test('rejects verification against a different plaintext', async () => {
    const hash = await hasher.hash('correct-horse-battery-staple');

    expect(await hasher.verify(hash, 'a-completely-different-password')).toBe(false);
  });

  test('the produced hash encodes the configured memory and time cost (m=19456, t=2)', async () => {
    const hash = await hasher.hash('another-password');

    expect(hash).toContain('m=19456');
    expect(hash).toContain('t=2');
  });

  test('hashing the same plaintext twice produces different hashes (random salt)', async () => {
    const first = await hasher.hash('same-plaintext');
    const second = await hasher.hash('same-plaintext');

    expect(first).not.toBe(second);
  });
});
