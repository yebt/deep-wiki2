/**
 * S3-compatible `BlobStore` adapter (blob-storage spec):
 *  - satisfies the same `BlobStore` port as the filesystem adapter, with
 *    no storage-specific type leaking into `packages/core` (compile-time
 *    check below)
 *  - a misconfigured adapter fails startup naming the missing config,
 *    for both drivers (Adapter Selection by Environment)
 *  - the same photo bytes round-trip through each adapter independently
 */
import { beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BlobStore } from '@deep-wiki/core';
import { createBlobStore } from './index';
import { FsBlobStore } from './fs-blob-store';
import { S3BlobStore } from './s3-blob-store';
import {
  ensureMinioBucket,
  ensureTestServices,
  MINIO_ACCESS_KEY_ID,
  MINIO_ENDPOINT,
  MINIO_REGION,
  MINIO_SECRET_ACCESS_KEY,
  MINIO_TEST_BUCKET,
} from '../../../testing/services';

// Compile-time contract proof: S3BlobStore must satisfy BlobStore exactly
// as declared in packages/core, with no S3-specific type required by the
// port itself.
const _typeContract: BlobStore = new S3BlobStore({
  endpoint: MINIO_ENDPOINT,
  bucket: MINIO_TEST_BUCKET,
  accessKeyId: MINIO_ACCESS_KEY_ID,
  secretAccessKey: MINIO_SECRET_ACCESS_KEY,
});
void _typeContract;

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
