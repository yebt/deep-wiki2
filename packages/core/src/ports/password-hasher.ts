/**
 * Port for password hashing (design.md D13 — Argon2id via `Bun.password`,
 * behind this port so the Bun-specific API never leaks into `packages/core`).
 * The adapter lands in `apps/api/src/adapters/crypto/` — this file defines
 * the interface only.
 */
export interface PasswordHasher {
  hash(plaintext: string): Promise<string>;
  verify(hash: string, plaintext: string): Promise<boolean>;
}
