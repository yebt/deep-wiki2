/**
 * Email normalisation backing the `users` table's
 * `CHECK (email = lower(email))` constraint (design.md — Schema). No
 * `citext` extension: normalisation is a pure function, applied before
 * every write and every lookup.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
