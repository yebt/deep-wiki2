import type { Result } from '../result';

/**
 * Port for binary object storage. A self-hoster on a single VPS will not
 * run MinIO, so a local filesystem adapter is mandatory alongside the
 * S3-compatible one (docs/SPECS.md §12.3). Adapters land in Phase 1 —
 * this file defines the interface only.
 */
export interface PutObjectInput {
  readonly key: string;
  readonly data: Uint8Array;
  readonly contentType: string;
}

export interface BlobStoreError {
  readonly reason: string;
}

export interface BlobStore {
  put(input: PutObjectInput): Promise<Result<void, BlobStoreError>>;
  get(key: string): Promise<Result<Uint8Array, BlobStoreError>>;
  delete(key: string): Promise<Result<void, BlobStoreError>>;
}
