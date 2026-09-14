/**
 * The key policy every `BlobStore` adapter must satisfy, as one executable
 * suite both adapters run (blob-storage spec; documentation-like-paths
 * threat matrix — design.md "Threat Matrix").
 *
 * It exists because the policy was written down twice and one of the two
 * copies was empty: `FsBlobStore` had five rejected-key tests and
 * `S3BlobStore` had none, so `/etc/passwd` and `a\b.txt` were accepted and
 * round-tripped. Whether a caller-influenced key escapes its prefix must
 * not depend on which driver `BLOB_STORE_DRIVER` happens to name.
 *
 * The discriminating assertion is `error.reason`, not `ok === false`. An
 * adapter with no key policy at all still *fails* on a bad key whenever
 * its backend is unreachable, so "the call did not succeed" is exactly the
 * kind of green that proves nothing — and it is how an empty S3 policy hid
 * for as long as it did. Requiring `INVALID_BLOB_KEY_REASON` separates
 * "this adapter refused the key" from "something downstream said no", and
 * the accepted-key case at the end pins the other side of that line: a
 * well-formed key must never be refused *by the policy*, so a guard that
 * simply rejects everything cannot pass either.
 */
import { describe, expect, test } from 'bun:test';
import type { BlobStore } from '@deep-wiki/core';
import { INVALID_BLOB_KEY_REASON } from './blob-key';

/** One entry per rejected key class, named as the threat matrix names it. */
export const REJECTED_BLOB_KEYS: readonly (readonly [label: string, key: string])[] = [
  ['an empty key', ''],
  ['a leading parent-directory segment', '../escape.txt'],
  ['an absolute path', '/etc/passwd'],
  ['a backslash', 'a\\b.txt'],
  ['a NUL byte', 'a\0b.txt'],
  // Not merely a leading `../`: the whole key is inspected.
  ['a mid-path parent-directory escape', 'workspaces/ws-1/avatars/../../../../../../etc/passwd'],
  // The exact key `POST /uploads/avatar` produced from a traversal-shaped
  // `workspaceId` before the route validated it.
  ['a traversal interpolated into a workspace prefix', 'workspaces/../../../../etc/avatars/u/x.webp'],
];

/**
 * `makeStore` must return an adapter whose *backend* cannot succeed —
 * an unreachable endpoint, or a throwaway root. Every assertion here is
 * about the adapter's own key policy, and a backend that answers would
 * only blur that.
 */
export function describeBlobStoreKeyContract(adapterName: string, makeStore: () => BlobStore): void {
  describe(`${adapterName} — BlobStore key contract`, () => {
    for (const [label, key] of REJECTED_BLOB_KEYS) {
      test(`rejects ${label}, by its own key policy, on put, get and delete`, async () => {
        const store = makeStore();

        const put = await store.put({ key, data: new Uint8Array([1]), contentType: 'text/plain' });
        expect(put.ok).toBe(false);
        if (!put.ok) expect(put.error.reason).toBe(INVALID_BLOB_KEY_REASON);

        // A read path that accepts what the write path rejects is the same
        // hole facing the other way.
        const got = await store.get(key);
        expect(got.ok).toBe(false);
        if (!got.ok) expect(got.error.reason).toBe(INVALID_BLOB_KEY_REASON);

        const removed = await store.delete(key);
        expect(removed.ok).toBe(false);
        if (!removed.ok) expect(removed.error.reason).toBe(INVALID_BLOB_KEY_REASON);
      });
    }

    test('a well-formed nested key is never refused by the key policy', async () => {
      const store = makeStore();
      const key = 'workspaces/ws-1/avatars/user-1/photo.webp';

      // The backend is deliberately unusable, so this call may well fail —
      // it just may not fail *for this reason*. Without this case a guard
      // that rejected every key would satisfy everything above.
      const put = await store.put({ key, data: new Uint8Array([1]), contentType: 'image/webp' });
      expect(put.ok || put.error.reason !== INVALID_BLOB_KEY_REASON).toBe(true);

      const got = await store.get(key);
      expect(got.ok || got.error.reason !== INVALID_BLOB_KEY_REASON).toBe(true);

      const removed = await store.delete(key);
      expect(removed.ok || removed.error.reason !== INVALID_BLOB_KEY_REASON).toBe(true);
    });
  });
}
