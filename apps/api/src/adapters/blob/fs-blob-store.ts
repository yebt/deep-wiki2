/**
 * Filesystem `BlobStore` adapter (blob-storage spec; design.md — "Ports
 * and adapters"). Mandatory alongside the S3-compatible adapter: a
 * self-hoster on a single VPS will not run MinIO. Keys are treated as
 * opaque, logical strings — never OS paths — and are rejected outright on
 * any traversal-shaped character, then re-checked after resolution to
 * assert the result still lives inside `BLOB_STORE_FS_ROOT` (threat
 * matrix — "Documentation-like paths").
 */
import { mkdir } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import type { BlobStore, BlobStoreError, PutObjectInput, Result } from '@deep-wiki/core';
import { err, ok } from '@deep-wiki/core';
import { INVALID_BLOB_KEY_REASON, validateBlobKey } from './blob-key';

export interface FsBlobStoreConfig {
  readonly root: string;
}

export class FsBlobStore implements BlobStore {
  readonly #root: string;

  constructor(config: FsBlobStoreConfig) {
    this.#root = resolve(config.root);
  }

  #resolveKey(key: string): Result<string, BlobStoreError> {
    // The character policy is shared with the S3 adapter; the resolution
    // check below is this adapter's own, and stays — reasoning about
    // characters and reasoning about the resolved path fail differently.
    const validated = validateBlobKey(key);
    if (!validated.ok) return validated;

    const resolved = resolve(this.#root, key);
    if (resolved !== this.#root && !resolved.startsWith(this.#root + sep)) {
      return err({ reason: INVALID_BLOB_KEY_REASON });
    }

    return ok(resolved);
  }

  async put(input: PutObjectInput): Promise<Result<void, BlobStoreError>> {
    const resolved = this.#resolveKey(input.key);
    if (!resolved.ok) {
      return resolved;
    }

    await mkdir(dirname(resolved.value), { recursive: true });
    await Bun.write(resolved.value, input.data);
    return ok(undefined);
  }

  async get(key: string): Promise<Result<Uint8Array, BlobStoreError>> {
    const resolved = this.#resolveKey(key);
    if (!resolved.ok) {
      return resolved;
    }

    const file = Bun.file(resolved.value);
    if (!(await file.exists())) {
      return err({ reason: 'blob not found' });
    }

    return ok(new Uint8Array(await file.arrayBuffer()));
  }

  async delete(key: string): Promise<Result<void, BlobStoreError>> {
    const resolved = this.#resolveKey(key);
    if (!resolved.ok) {
      return resolved;
    }

    await Bun.file(resolved.value)
      .delete()
      .catch(() => {});
    return ok(undefined);
  }
}
