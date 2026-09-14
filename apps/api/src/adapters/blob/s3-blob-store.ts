/**
 * S3-compatible `BlobStore` adapter (design.md — "Ports and adapters"; D17
 * — Bun's `S3Client` rather than the AWS SDK, zero extra dependencies, and
 * an explicit `endpoint` so MinIO works unchanged).
 *
 * Keys go through `validateBlobKey` before any request, exactly as they do
 * in the filesystem adapter. This adapter had no key policy of its own and
 * handed the key straight to `Bun.S3Client`, so `/etc/passwd` and
 * `a\b.txt` were accepted and round-tripped — every rejection its tests
 * observed came from MinIO, not from here. A guarantee that holds only
 * under one `BLOB_STORE_DRIVER` is not a guarantee; the shared suite in
 * `blob-store-key-contract.ts` is what now says both adapters agree.
 */
import type { BlobStore, BlobStoreError, PutObjectInput, Result } from '@deep-wiki/core';
import { err, ok } from '@deep-wiki/core';
import { validateBlobKey } from './blob-key';

export interface S3BlobStoreConfig {
  readonly endpoint: string;
  readonly region?: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

export class S3BlobStore implements BlobStore {
  readonly #client: Bun.S3Client;

  constructor(config: S3BlobStoreConfig) {
    this.#client = new Bun.S3Client({
      endpoint: config.endpoint,
      region: config.region ?? 'us-east-1',
      bucket: config.bucket,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    });
  }

  async put(input: PutObjectInput): Promise<Result<void, BlobStoreError>> {
    const key = validateBlobKey(input.key);
    if (!key.ok) return key;

    try {
      await this.#client.write(key.value, input.data, { type: input.contentType });
      return ok(undefined);
    } catch {
      return err({ reason: 'failed to write blob' });
    }
  }

  async get(key: string): Promise<Result<Uint8Array, BlobStoreError>> {
    const validated = validateBlobKey(key);
    if (!validated.ok) return validated;

    try {
      const file = this.#client.file(validated.value);
      if (!(await file.exists())) {
        return err({ reason: 'blob not found' });
      }
      return ok(new Uint8Array(await file.arrayBuffer()));
    } catch {
      return err({ reason: 'failed to read blob' });
    }
  }

  async delete(key: string): Promise<Result<void, BlobStoreError>> {
    const validated = validateBlobKey(key);
    if (!validated.ok) return validated;

    try {
      await this.#client.delete(validated.value);
      return ok(undefined);
    } catch {
      return err({ reason: 'failed to delete blob' });
    }
  }
}
