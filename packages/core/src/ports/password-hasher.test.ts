/**
 * Port-contract test: any `PasswordHasher` implementation — the real
 * Argon2id adapter (`apps/api`) or a stub used by higher-layer tests —
 * must satisfy this shape and this round-trip behaviour.
 */
import { describe, expect, test } from 'bun:test';
import type { PasswordHasher } from './password-hasher';

class StubPasswordHasher implements PasswordHasher {
  async hash(plaintext: string): Promise<string> {
    return `stub-hash(${plaintext})`;
  }

  async verify(hash: string, plaintext: string): Promise<boolean> {
    return hash === `stub-hash(${plaintext})`;
  }
}

describe('PasswordHasher port contract', () => {
  test('a value hashed by the adapter verifies against the same plaintext', async () => {
    const hasher: PasswordHasher = new StubPasswordHasher();
    const hash = await hasher.hash('correct-horse-battery-staple');

    expect(await hasher.verify(hash, 'correct-horse-battery-staple')).toBe(true);
  });

  test('a hash does not verify against a different plaintext', async () => {
    const hasher: PasswordHasher = new StubPasswordHasher();
    const hash = await hasher.hash('correct-horse-battery-staple');

    expect(await hasher.verify(hash, 'wrong-password')).toBe(false);
  });
});
