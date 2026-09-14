/**
 * The one key policy both `BlobStore` adapters apply (blob-storage spec;
 * documentation-like-paths threat matrix — design.md "Threat Matrix").
 *
 * A blob key is an opaque, logical string — never an OS path and never a
 * URL path — so the same characters are refused whatever the adapter does
 * with the key afterwards. It lived only inside `FsBlobStore` before, which
 * made "a key cannot escape its prefix" a property of one driver rather
 * than of the system: `S3BlobStore` applied no policy at all and accepted
 * `/etc/passwd` and `a\b.txt`. `blob-store-key-contract.ts` is the
 * executable statement that both now agree.
 *
 * This is the *first* line, not the only one: `FsBlobStore` still resolves
 * the key and re-asserts the result sits under its root, because a policy
 * that reasons about characters and a check that reasons about the
 * resolved path fail differently.
 */
import { isAbsolute } from 'node:path';
import type { BlobStoreError, Result } from '@deep-wiki/core';
import { err, ok } from '@deep-wiki/core';

/**
 * The single reason string a key rejection carries. The contract suite
 * asserts on it: without it, "the call failed" cannot be told apart from
 * "the backend was unreachable", which is precisely how an empty policy
 * stayed green.
 */
export const INVALID_BLOB_KEY_REASON = 'invalid blob key';

/**
 * `..` anywhere (not merely a leading segment), any backslash, any NUL.
 * A leading `/` is handled separately so the rule holds on a platform
 * where `isAbsolute` means something else.
 */
const REJECTED_KEY_PATTERN = /\.\.|\\|\0/;

export function validateBlobKey(key: string): Result<string, BlobStoreError> {
  if (!key || key.startsWith('/') || isAbsolute(key) || REJECTED_KEY_PATTERN.test(key)) {
    return err({ reason: INVALID_BLOB_KEY_REASON });
  }
  return ok(key);
}
