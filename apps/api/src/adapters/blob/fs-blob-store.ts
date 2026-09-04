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
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import type { BlobStore, BlobStoreError, PutObjectInput, Result } from '@deep-wiki/core';
import { err, ok } from '@deep-wiki/core';

export interface FsBlobStoreConfig {
  readonly root: string;
}

const REJECTED_KEY_PATTERN = /\.\.|\\|\0/;

export class FsBlobStore implements BlobStore {
  readonly #root: string;

  constructor(config: FsBlobStoreConfig) {
    this.#root = resolve(config.root);
  }

  #resolveKey(key: string): Result<string, BlobStoreError> {
    if (!key || isAbsolute(key) || REJECTED_KEY_PATTERN.test(key)) {
      return err({ reason: 'invalid blob key' });
    }

    const resolved = resolve(this.#root, key);
    if (resolved !== this.#root && !resolved.startsWith(this.#root + sep)) {
      return err({ reason: 'invalid blob key' });
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
