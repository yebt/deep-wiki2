/**
 * `BlobStore` adapter selection by environment (blob-storage spec —
 * "Adapter Selection by Environment"). Resolved once at the composition
 * root. Fails fast, naming the missing configuration, rather than
 * constructing a half-configured adapter that would fail on first use.
 */
import type { BlobStore } from '@deep-wiki/core';
import { FsBlobStore } from './fs-blob-store';
import { S3BlobStore } from './s3-blob-store';

export interface BlobStoreEnv {
  readonly BLOB_STORE_DRIVER: 's3' | 'filesystem';
  readonly BLOB_STORE_FS_ROOT?: string;
  readonly BLOB_STORE_S3_ENDPOINT?: string;
  readonly BLOB_STORE_S3_REGION?: string;
  readonly BLOB_STORE_S3_BUCKET?: string;
  readonly BLOB_STORE_S3_ACCESS_KEY_ID?: string;
  readonly BLOB_STORE_S3_SECRET_ACCESS_KEY?: string;
}

const REQUIRED_S3_VARS = [
  'BLOB_STORE_S3_ENDPOINT',
  'BLOB_STORE_S3_BUCKET',
  'BLOB_STORE_S3_ACCESS_KEY_ID',
  'BLOB_STORE_S3_SECRET_ACCESS_KEY',
] as const satisfies readonly (keyof BlobStoreEnv)[];

export function createBlobStore(env: BlobStoreEnv): BlobStore {
  if (env.BLOB_STORE_DRIVER === 's3') {
    const missing = REQUIRED_S3_VARS.filter((variable) => !env[variable]);
    if (missing.length > 0) {
      throw new Error(`BlobStore (s3 driver): missing required configuration: ${missing.join(', ')}`);
    }

    return new S3BlobStore({
      endpoint: env.BLOB_STORE_S3_ENDPOINT!,
      region: env.BLOB_STORE_S3_REGION,
      bucket: env.BLOB_STORE_S3_BUCKET!,
      accessKeyId: env.BLOB_STORE_S3_ACCESS_KEY_ID!,
      secretAccessKey: env.BLOB_STORE_S3_SECRET_ACCESS_KEY!,
    });
  }

  if (!env.BLOB_STORE_FS_ROOT) {
    throw new Error('BlobStore (filesystem driver): missing required configuration: BLOB_STORE_FS_ROOT');
  }

  return new FsBlobStore({ root: env.BLOB_STORE_FS_ROOT });
}

export { FsBlobStore } from './fs-blob-store';
export { S3BlobStore } from './s3-blob-store';
