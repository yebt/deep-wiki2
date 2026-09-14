/**
 * S3-compatible `BlobStore` adapter (blob-storage spec):
 *  - satisfies the same `BlobStore` port as the filesystem adapter, and
 *    the same key policy — `describeBlobStoreKeyContract` below
 *  - a misconfigured adapter fails startup naming the missing config,
 *    for both drivers (Adapter Selection by Environment)
 *  - the same photo bytes round-trip through each adapter independently
 *
 * The port conformance used to be stated as `const _typeContract:
 * BlobStore = new S3BlobStore(...)`, which the compiler checks and no test
 * run can fail; the shared contract suite exercises all three methods
 * through the port at runtime and replaces it.
 */
import { beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBlobStore } from './index';
import { FsBlobStore } from './fs-blob-store';
import { S3BlobStore } from './s3-blob-store';
import { describeBlobStoreKeyContract } from './blob-store-key-contract';
import {
  ensureMinioBucket,
  ensureTestServices,
  MINIO_ACCESS_KEY_ID,
  MINIO_ENDPOINT,
  MINIO_REGION,
  MINIO_SECRET_ACCESS_KEY,
  MINIO_TEST_BUCKET,
} from '../../../testing/services';

// The same key contract the filesystem adapter runs. The endpoint is
// deliberately unroutable: any key that reaches the network proves the
// adapter did not reject it, so the contract cannot be satisfied by
// MinIO's opinion of the key instead of the adapter's, and it needs no
// running service to be meaningful.
describeBlobStoreKeyContract(
  'S3BlobStore',
  () =>
    new S3BlobStore({
      endpoint: 'http://127.0.0.1:1',
      region: MINIO_REGION,
      bucket: MINIO_TEST_BUCKET,
      accessKeyId: MINIO_ACCESS_KEY_ID,
      secretAccessKey: MINIO_SECRET_ACCESS_KEY,
    }),
);

describe('createBlobStore — adapter selection by environment', () => {
  test('a misconfigured filesystem driver fails startup naming BLOB_STORE_FS_ROOT', () => {
    expect(() => createBlobStore({ BLOB_STORE_DRIVER: 'filesystem' })).toThrow(/BLOB_STORE_FS_ROOT/);
  });

  test('a misconfigured s3 driver fails startup naming the missing variables', () => {
    expect(() => createBlobStore({ BLOB_STORE_DRIVER: 's3' })).toThrow(/BLOB_STORE_S3_ENDPOINT/);
  });

  test('a fully configured filesystem driver constructs an FsBlobStore', () => {
    const store = createBlobStore({ BLOB_STORE_DRIVER: 'filesystem', BLOB_STORE_FS_ROOT: '/tmp/whatever' });
    expect(store).toBeInstanceOf(FsBlobStore);
  });

  test('a fully configured s3 driver constructs an S3BlobStore', () => {
    const store = createBlobStore({
      BLOB_STORE_DRIVER: 's3',
      BLOB_STORE_S3_ENDPOINT: MINIO_ENDPOINT,
      BLOB_STORE_S3_BUCKET: MINIO_TEST_BUCKET,
      BLOB_STORE_S3_ACCESS_KEY_ID: MINIO_ACCESS_KEY_ID,
      BLOB_STORE_S3_SECRET_ACCESS_KEY: MINIO_SECRET_ACCESS_KEY,
    });
    expect(store).toBeInstanceOf(S3BlobStore);
  });
});

describe('BlobStore adapters — adapter-independent retrieval', () => {
  let fsRoot: string;

  beforeAll(async () => {
    await ensureTestServices();
    await ensureMinioBucket();
    fsRoot = mkdtempSync(join(tmpdir(), 'deep-wiki-blob-roundtrip-'));
  }, 120_000);

  test('the same photo bytes round-trip through the filesystem adapter', async () => {
    const store = new FsBlobStore({ root: fsRoot });
    const photoBytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4, 5]);
    const key = 'workspaces/ws-1/avatars/user-1/photo.webp';

    await store.put({ key, data: photoBytes, contentType: 'image/webp' });
    const result = await store.get(key);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect([...result.value]).toEqual([...photoBytes]);
    }
  });

  test('the same photo bytes round-trip through the S3-compatible adapter', async () => {
    const store = new S3BlobStore({
      endpoint: MINIO_ENDPOINT,
      region: MINIO_REGION,
      bucket: MINIO_TEST_BUCKET,
      accessKeyId: MINIO_ACCESS_KEY_ID,
      secretAccessKey: MINIO_SECRET_ACCESS_KEY,
    });
    const photoBytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4, 5]);
    const key = `workspaces/ws-1/avatars/user-1/photo-${crypto.randomUUID()}.webp`;

    await store.put({ key, data: photoBytes, contentType: 'image/webp' });
    const result = await store.get(key);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect([...result.value]).toEqual([...photoBytes]);
    }
  });
});
