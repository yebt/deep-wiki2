/**
 * S3-compatible `BlobStore` adapter (design.md — "Ports and adapters"; D17
 * — Bun's `S3Client` rather than the AWS SDK, zero extra dependencies, and
 * an explicit `endpoint` so MinIO works unchanged).
 */
import type { BlobStore, BlobStoreError, PutObjectInput, Result } from '@deep-wiki/core';
import { err, ok } from '@deep-wiki/core';

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
    try {
      await this.#client.write(input.key, input.data, { type: input.contentType });
      return ok(undefined);
    } catch {
      return err({ reason: 'failed to write blob' });
    }
  }

  async get(key: string): Promise<Result<Uint8Array, BlobStoreError>> {
    try {
      const file = this.#client.file(key);
      if (!(await file.exists())) {
        return err({ reason: 'blob not found' });
      }
      return ok(new Uint8Array(await file.arrayBuffer()));
    } catch {
      return err({ reason: 'failed to read blob' });
    }
  }

  async delete(key: string): Promise<Result<void, BlobStoreError>> {
    try {
      await this.#client.delete(key);
      return ok(undefined);
    } catch {
      return err({ reason: 'failed to delete blob' });
    }
  }
}
