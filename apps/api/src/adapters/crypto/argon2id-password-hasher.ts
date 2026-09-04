/**
 * Argon2id `PasswordHasher` adapter (design.md D13). Memory-hard, no
 * bcrypt 72-byte truncation, zero extra dependencies — `Bun.password`
 * already ships the binding. m=19456 KiB, t=2 match the OWASP floor; Bun's
 * argon2 binding exposes no parallelism parameter, and the underlying
 * `rust-argon2` crate defaults to p=1, which already matches D13.
 */
import type { PasswordHasher } from '@deep-wiki/core';

const MEMORY_COST_KIB = 19_456;
const TIME_COST = 2;

export class Argon2idPasswordHasher implements PasswordHasher {
  async hash(plaintext: string): Promise<string> {
    return Bun.password.hash(plaintext, {
      algorithm: 'argon2id',
      memoryCost: MEMORY_COST_KIB,
      timeCost: TIME_COST,
    });
  }

  async verify(hash: string, plaintext: string): Promise<boolean> {
    return Bun.password.verify(plaintext, hash);
  }
}
