/**
 * Filesystem `BlobStore` adapter (blob-storage spec; documentation-like-
 * paths threat matrix — design.md "Threat Matrix").
 *
 * The rejected key classes are no longer enumerated here: they are the
 * shared `describeBlobStoreKeyContract` suite that `S3BlobStore` runs too,
 * because they were a property of the system stated in only one adapter.
 * What stays local is what is genuinely local — that nothing escaped onto
 * disk, and that a well-formed key round-trips through a real root.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsBlobStore } from './fs-blob-store';
import { describeBlobStoreKeyContract, REJECTED_BLOB_KEYS } from './blob-store-key-contract';

let root: string;
let store: FsBlobStore;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'deep-wiki-blob-test-'));
  store = new FsBlobStore({ root });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describeBlobStoreKeyContract('FsBlobStore', () => new FsBlobStore({ root }));

describe('FsBlobStore — containment', () => {
  test('no rejected key class wrote a file outside root', async () => {
    // The contract above asserts each key was refused; this asserts the
    // filesystem consequence of that refusal, which only this adapter has.
    for (const [, key] of REJECTED_BLOB_KEYS) {
      await store.put({ key, data: new Uint8Array([1]), contentType: 'text/plain' });
    }

    const outside = join(root, '..', 'escape.txt');
    // `../escape.txt` resolves to exactly this path, so this assertion can
    // actually fail if the guard goes away.
    expect(await Bun.file(outside).exists()).toBe(false);
  });
});

describe('FsBlobStore — accepted keys round-trip', () => {
  test('a nested, well-formed key can be written, read back, and deleted', async () => {
    const key = 'workspaces/ws-1/avatars/user-1/photo.webp';
    const data = new Uint8Array([1, 2, 3, 4, 5]);

    const putResult = await store.put({ key, data, contentType: 'image/webp' });
    expect(putResult.ok).toBe(true);

    const getResult = await store.get(key);
    expect(getResult.ok).toBe(true);
    if (getResult.ok) {
      expect([...getResult.value]).toEqual([1, 2, 3, 4, 5]);
    }

    const deleteResult = await store.delete(key);
    expect(deleteResult.ok).toBe(true);

    const afterDelete = await store.get(key);
    expect(afterDelete.ok).toBe(false);
  });
});
