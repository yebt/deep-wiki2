/**
 * Profile photo upload (blob-storage spec; executable-file-classification
 * threat matrix — design.md "Threat Matrix"): a `.png`-named PHP/HTML
 * polyglot is rejected by magic-byte classification; a valid image with a
 * lying `Content-Type` is accepted, classified by its bytes; an oversized
 * or unsupported-type upload is rejected before reaching `BlobStore`; and
 * the caller must belong to the workspace whose storage prefix the key
 * names. Every caller here is seeded as a real member of the workspace it
 * posts to — these suites used to post a `crypto.randomUUID()` workspace
 * that existed nowhere, which is exactly the hole the membership gate
 * closes.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BlobStore, BlobStoreError, Result } from '@deep-wiki/core';
import { ok } from '@deep-wiki/core';
import { createSession } from '@deep-wiki/db';
import { provisionTestDatabase, type ProvisionedTestDatabase } from '@deep-wiki/db/testing/provision';
import postgres from 'postgres';
import sharp from 'sharp';
import { FsBlobStore } from '../adapters/blob/fs-blob-store';
import { SESSION_COOKIE_NAME } from '../middleware/session';
import { createUploadRoutes } from './uploads';

let db: ProvisionedTestDatabase;
let sql: postgres.Sql;
let blobRoot: string;

beforeAll(async () => {
  db = await provisionTestDatabase();
  sql = postgres(db.url, { max: 5 });
  blobRoot = mkdtempSync(join(tmpdir(), 'deep-wiki-uploads-test-'));
});

afterAll(async () => {
  await sql.end({ timeout: 1 }).catch(() => {});
  await db.drop();
  rmSync(blobRoot, { recursive: true, force: true });
});

class NeverCalledBlobStore implements BlobStore {
  called = false;
  async put(): Promise<Result<void, BlobStoreError>> {
    this.called = true;
    return ok(undefined);
  }
  async get(): Promise<Result<Uint8Array, BlobStoreError>> {
    throw new Error('not implemented');
  }
  async delete(): Promise<Result<void, BlobStoreError>> {
    return ok(undefined);
  }
}

async function insertMemberSessionCookie(): Promise<{ cookie: string; userId: string; workspaceId: string }> {
  const [user] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name)
    VALUES (${`${crypto.randomUUID()}@example.com`}, 'hash', 'Member') RETURNING id
  `;
  const [workspace] = await sql<{ id: string }[]>`
    INSERT INTO workspaces (owner_id, name, slug)
    VALUES (${user!.id}, 'Own Workspace', ${`own-${crypto.randomUUID()}`}) RETURNING id
  `;
  const { token } = await createSession(sql, { userId: user!.id, idleTimeoutMinutes: 30, absoluteTimeoutDays: 30 });
  return { cookie: `${SESSION_COOKIE_NAME}=${token}`, userId: user!.id, workspaceId: workspace!.id };
}

async function seedWorkspaceOwnedByAnotherUser(): Promise<string> {
  const [stranger] = await sql<{ id: string }[]>`
    INSERT INTO users (email, password_hash, display_name)
    VALUES (${`stranger-${crypto.randomUUID()}@example.com`}, 'hash', 'Stranger') RETURNING id
  `;
  const [workspace] = await sql<{ id: string }[]>`
    INSERT INTO workspaces (owner_id, name, slug)
    VALUES (${stranger!.id}, 'Foreign Workspace', ${`foreign-${crypto.randomUUID()}`}) RETURNING id
  `;
  return workspace!.id;
}

async function realPngBytes(): Promise<Uint8Array> {
  const buf = await sharp({ create: { width: 20, height: 20, channels: 3, background: { r: 10, g: 20, b: 30 } } })
    .png()
    .toBuffer();
  return new Uint8Array(buf);
}

function buildApp(blobStore: BlobStore = new FsBlobStore({ root: blobRoot })) {
  return createUploadRoutes({ sql, blobStore, sessionIdleTimeoutMinutes: 30, maxUploadBytes: 5 * 1024 * 1024 });
}

describe('POST /uploads/avatar — executable-file-classification threat matrix', () => {
  test('a .png-named PHP/HTML polyglot is rejected by magic-byte classification', async () => {
    const caller = await insertMemberSessionCookie();
    const app = buildApp();
    const polyglot = new TextEncoder().encode('<?php system($_GET["c"]); ?><html><body>not an image</body></html>');
    const form = new FormData();
    form.set('workspaceId', caller.workspaceId);
    form.set('file', new File([polyglot], 'avatar.png', { type: 'image/png' }));

    const res = await app.request('/uploads/avatar', { method: 'POST', headers: { cookie: caller.cookie }, body: form });

    expect(res.status).toBe(415);
  });

  test('a valid image with a lying Content-Type is accepted, classified by its bytes', async () => {
    const caller = await insertMemberSessionCookie();
    const app = buildApp();
    const pngBytes = await realPngBytes();
    const form = new FormData();
    form.set('workspaceId', caller.workspaceId);
    // Content-Type claims plain text; the real PNG magic bytes must win.
    form.set('file', new File([pngBytes], 'avatar.dat', { type: 'text/plain' }));

    const res = await app.request('/uploads/avatar', { method: 'POST', headers: { cookie: caller.cookie }, body: form });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { key: string };
    // `.+` here used to match a separator, so a key like
    // `workspaces/../../../../etc/avatars/u/x.webp` satisfied it. Each
    // segment must be a single segment.
    expect(body.key).toMatch(/^workspaces\/[^/]+\/avatars\/[^/]+\/[^/]+\.webp$/);
  });
});

describe('POST /uploads/avatar — size and type limits enforced before BlobStore', () => {
  test('an oversized upload is rejected before reaching BlobStore', async () => {
    const caller = await insertMemberSessionCookie();
    const blobStore = new NeverCalledBlobStore();
    const app = createUploadRoutes({ sql, blobStore, sessionIdleTimeoutMinutes: 30, maxUploadBytes: 100 });
    const oversized = new Uint8Array(1000).fill(1);
    const form = new FormData();
    form.set('workspaceId', caller.workspaceId);
    form.set('file', new File([oversized], 'big.png', { type: 'image/png' }));

    const res = await app.request('/uploads/avatar', { method: 'POST', headers: { cookie: caller.cookie }, body: form });

    expect(res.status).toBe(413);
    expect(blobStore.called).toBe(false);
  });

  test('an unsupported file type is rejected before reaching BlobStore', async () => {
    const caller = await insertMemberSessionCookie();
    const blobStore = new NeverCalledBlobStore();
    const app = createUploadRoutes({ sql, blobStore, sessionIdleTimeoutMinutes: 30, maxUploadBytes: 5 * 1024 * 1024 });
    const gifBytes = new TextEncoder().encode('GIF89a-not-a-real-gif-but-not-png-jpeg-or-webp-either');
    const form = new FormData();
    form.set('workspaceId', caller.workspaceId);
    form.set('file', new File([gifBytes], 'avatar.gif', { type: 'image/gif' }));

    const res = await app.request('/uploads/avatar', { method: 'POST', headers: { cookie: caller.cookie }, body: form });

    expect(res.status).toBe(415);
    expect(blobStore.called).toBe(false);
  });
});

// `workspaceId` arrives in the multipart form and is interpolated straight
// into the blob key `workspaces/${workspaceId}/avatars/...`, with nothing
// checking the caller against it. `FsBlobStore.#resolveKey` contains the
// blast radius — no traversal out of the root — but an authenticated user
// could still write bytes under an arbitrary tenant's storage prefix. The
// caller here is a member of a *different* workspace; a caller who belongs
// to the target workspace would prove nothing.
describe('POST /uploads/avatar — the caller must belong to the target workspace', () => {
  test('a member of one workspace cannot write into another workspace prefix', async () => {
    const caller = await insertMemberSessionCookie();
    const foreignWorkspaceId = await seedWorkspaceOwnedByAnotherUser();
    const blobStore = new NeverCalledBlobStore();
    const app = createUploadRoutes({ sql, blobStore, sessionIdleTimeoutMinutes: 30, maxUploadBytes: 5 * 1024 * 1024 });
    const pngBytes = await realPngBytes();
    const form = new FormData();
    form.set('workspaceId', foreignWorkspaceId);
    form.set('file', new File([pngBytes], 'avatar.png', { type: 'image/png' }));

    const res = await app.request('/uploads/avatar', { method: 'POST', headers: { cookie: caller.cookie }, body: form });

    expect(res.status).toBe(403);
    expect(blobStore.called).toBe(false);
    const [row] = await sql<{ avatar_key: string | null }[]>`SELECT avatar_key FROM users WHERE id = ${caller.userId}`;
    expect(row!.avatar_key).toBeNull();
  });
});

// The blob key is `workspaces/${workspaceId}/avatars/...` and
// `workspaceId` was validated only as a non-empty string, so a traversal
// went straight into the key. Whether that escapes the storage root then
// depends entirely on which adapter is configured — which is not a
// property the route may lean on. The route refuses the value itself.
describe('POST /uploads/avatar — a traversal-shaped workspaceId never reaches the key', () => {
  test('a workspaceId of ../../../../etc is refused before any BlobStore call', async () => {
    const caller = await insertMemberSessionCookie();
    const blobStore = new NeverCalledBlobStore();
    const app = createUploadRoutes({ sql, blobStore, sessionIdleTimeoutMinutes: 30, maxUploadBytes: 5 * 1024 * 1024 });
    const pngBytes = await realPngBytes();
    const form = new FormData();
    form.set('workspaceId', '../../../../etc');
    form.set('file', new File([pngBytes], 'avatar.png', { type: 'image/png' }));

    const res = await app.request('/uploads/avatar', { method: 'POST', headers: { cookie: caller.cookie }, body: form });

    expect(res.status).toBe(403);
    expect(blobStore.called).toBe(false);
  });
});

describe('POST /uploads/avatar — resize and re-encode', () => {
  test('the stored image is resized to 256x256 and re-encoded as webp', async () => {
    const caller = await insertMemberSessionCookie();
    const root = blobRoot;
    const blobStore = new FsBlobStore({ root });
    const app = createUploadRoutes({ sql, blobStore, sessionIdleTimeoutMinutes: 30, maxUploadBytes: 5 * 1024 * 1024 });
    const pngBytes = await realPngBytes();
    const form = new FormData();
    form.set('workspaceId', caller.workspaceId);
    form.set('file', new File([pngBytes], 'avatar.png', { type: 'image/png' }));

    const res = await app.request('/uploads/avatar', { method: 'POST', headers: { cookie: caller.cookie }, body: form });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { key: string };

    const stored = await blobStore.get(body.key);
    expect(stored.ok).toBe(true);
    if (stored.ok) {
      const metadata = await sharp(Buffer.from(stored.value)).metadata();
      expect(metadata.width).toBe(256);
      expect(metadata.height).toBe(256);
      expect(metadata.format).toBe('webp');
    }
  });
});
