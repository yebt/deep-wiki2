/**
 * Filesystem `BlobStore` adapter (blob-storage spec; documentation-like-
 * paths threat matrix — design.md "Threat Matrix"). Every rejected key
 * class gets its own test, plus a containment-escape attempt.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsBlobStore } from './fs-blob-store';

let root: string;
let store: FsBlobStore;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'deep-wiki-blob-test-'));
  store = new FsBlobStore({ root });
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('FsBlobStore — rejected key classes', () => {
  test('rejects a key containing a parent-directory segment (../)', async () => {
    const result = await store.put({ key: '../escape.txt', data: new Uint8Array([1]), contentType: 'text/plain' });
    expect(result.ok).toBe(false);
  });

  test('rejects an absolute path key', async () => {
    const result = await store.put({ key: '/etc/passwd', data: new Uint8Array([1]), contentType: 'text/plain' });
    expect(result.ok).toBe(false);
  });

  test('rejects a key containing a backslash', async () => {
    const result = await store.put({ key: 'a\\b.txt', data: new Uint8Array([1]), contentType: 'text/plain' });
    expect(result.ok).toBe(false);
  });

  test('rejects a key containing a NUL byte', async () => {
    const result = await store.put({ key: 'a\0b.txt', data: new Uint8Array([1]), contentType: 'text/plain' });
    expect(result.ok).toBe(false);
  });

  test('rejects a mid-path parent-directory escape attempt, not just a leading one', async () => {
    // Proves the check inspects the whole key, not merely a leading "../" —
    // and that the resolved path is asserted to stay inside root even for
    // a key shaped to look "normal" until its final segments.
    const result = await store.put({
      key: 'workspaces/ws-1/avatars/../../../../../../etc/passwd',
      data: new Uint8Array([1]),
      contentType: 'text/plain',
    });
    expect(result.ok).toBe(false);
  });

  test('none of the rejected classes wrote a file outside root', async () => {
    // Sanity: nothing above actually escaped onto disk.
    const outside = join(root, '..', 'escape.txt');
    const file = Bun.file(outside);
    expect(await file.exists()).toBe(false);
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
