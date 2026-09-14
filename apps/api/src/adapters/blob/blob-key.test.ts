/**
 * The shared key policy itself, directly — `blob-store-key-contract.ts`
 * proves each *adapter* applies it, this proves what it says. Both read
 * the same `REJECTED_BLOB_KEYS` list, so the rejected classes are stated
 * once and checked at both levels.
 */
import { describe, expect, test } from 'bun:test';
import { INVALID_BLOB_KEY_REASON, validateBlobKey } from './blob-key';
import { REJECTED_BLOB_KEYS } from './blob-store-key-contract';

describe('validateBlobKey', () => {
  for (const [label, key] of REJECTED_BLOB_KEYS) {
    test(`rejects ${label}`, () => {
      const result = validateBlobKey(key);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.reason).toBe(INVALID_BLOB_KEY_REASON);
    });
  }

  // Both adapters now send `result.value` to their backend rather than the
  // argument they were given, so an accepted key surviving byte-for-byte is
  // part of the contract, not an implementation detail.
  test('returns an accepted key unchanged', () => {
    const key = 'workspaces/ws-1/avatars/user-1/photo.webp';
    const result = validateBlobKey(key);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(key);
  });

  test('accepts a single dot in a filename — only a parent-directory segment is refused', () => {
    // `..` is the rejected sequence; a lone `.` inside a name is ordinary
    // and a policy that refused it would break every key the app writes.
    const result = validateBlobKey('workspaces/ws-1/avatars/user-1/photo.v2.webp');
    expect(result.ok).toBe(true);
  });
});
