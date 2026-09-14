/**
 * Profile photo upload (blob-storage spec; design.md — "Ports and
 * adapters", "Profile photos"). Keys are server-generated, never
 * user-supplied. Type is decided by magic bytes, never the declared
 * `Content-Type` (executable-file-classification threat matrix); every
 * accepted image is resized to 256x256 and re-encoded to webp, which
 * strips EXIF and neutralises polyglot files by construction — the
 * output bytes are always a `sharp`-produced webp, never a byte of the
 * original upload.
 *
 * The request is `multipart/form-data`, which `@deep-wiki/contracts`
 * does not model as a zod object (see packages/contracts/src/uploads.ts);
 * the JSON response is validated against its shared schema.
 */
import type { BlobStore } from '@deep-wiki/core';
import { ErrorResponseSchema, UploadAvatarResponseSchema } from '@deep-wiki/contracts';
import { isWorkspaceMember } from '@deep-wiki/db';
import { Hono } from 'hono';
import type postgres from 'postgres';
import sharp from 'sharp';
import { sessionMiddleware, type SessionVariables } from '../middleware/session';

export interface UploadRouteDeps {
  readonly sql: postgres.Sql;
  readonly blobStore: BlobStore;
  readonly sessionIdleTimeoutMinutes: number;
  readonly maxUploadBytes: number;
}

const AVATAR_SIZE_PX = 256;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type SniffedImageType = 'png' | 'jpeg' | 'webp';

/**
 * Classifies a buffer by its magic bytes only — the declared
 * `Content-Type` is never trusted. Returns `null` for anything that does
 * not match a supported signature, including a polyglot file wearing an
 * image extension.
 */
export function sniffImageType(bytes: Uint8Array): SniffedImageType | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'png';
  }

  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }

  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'webp';
  }

  return null;
}

export function createUploadRoutes(deps: UploadRouteDeps): Hono<{ Variables: SessionVariables }> {
  const app = new Hono<{ Variables: SessionVariables }>();

  app.post('/uploads/avatar', sessionMiddleware(deps.sql, { idleTimeoutMinutes: deps.sessionIdleTimeoutMinutes }), async (c) => {
    const session = c.get('session');

    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      return c.json(ErrorResponseSchema.parse({ error: 'expected multipart/form-data with a file field' }), 400);
    }

    const workspaceId = form.get('workspaceId');
    const file = form.get('file');

    if (typeof workspaceId !== 'string' || !workspaceId) {
      return c.json(ErrorResponseSchema.parse({ error: 'workspaceId is required' }), 400);
    }
    if (!(file instanceof File)) {
      return c.json(ErrorResponseSchema.parse({ error: 'file is required' }), 400);
    }

    // `workspaceId` is caller-supplied and lands verbatim in the blob key
    // below, so it decides which tenant's storage prefix these bytes go
    // under. `FsBlobStore.#resolveKey` bounds the damage — it rejects
    // `..`, backslashes, nulls and absolute paths, then re-checks the
    // resolved path against its root — but `S3BlobStore` applies no key
    // policy at all, and containment was never the point: an
    // authenticated caller must not be able to write into a workspace it
    // does not belong to, whatever the store does with the key
    // afterwards. Checked before the size, sniff and `sharp` work, which
    // an unauthorised caller has no business making us do.
    //
    // A malformed id is answered the same way as a real workspace the
    // caller is not in: `workspace_id` is a uuid column, so anything else
    // would be a Postgres cast error rather than a miss, and there is
    // nothing to disclose by distinguishing the two.
    const member =
      UUID_PATTERN.test(workspaceId) && (await isWorkspaceMember(deps.sql, { workspaceId, userId: session.userId }));
    if (!member) {
      return c.json(ErrorResponseSchema.parse({ error: 'forbidden' }), 403);
    }

    // Enforced before any BlobStore call, and before the (relatively
    // expensive) sharp decode/resize below.
    if (file.size > deps.maxUploadBytes) {
      return c.json(ErrorResponseSchema.parse({ error: `file exceeds the maximum allowed size of ${deps.maxUploadBytes} bytes` }), 413);
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength > deps.maxUploadBytes) {
      return c.json(ErrorResponseSchema.parse({ error: `file exceeds the maximum allowed size of ${deps.maxUploadBytes} bytes` }), 413);
    }

    if (!sniffImageType(bytes)) {
      return c.json(ErrorResponseSchema.parse({ error: 'unsupported or unrecognised file type' }), 415);
    }

    const resized = await sharp(Buffer.from(bytes))
      .resize(AVATAR_SIZE_PX, AVATAR_SIZE_PX, { fit: 'cover' })
      .webp()
      .toBuffer();

    const key = `workspaces/${workspaceId}/avatars/${session.userId}/${crypto.randomUUID()}.webp`;
    const putResult = await deps.blobStore.put({ key, data: new Uint8Array(resized), contentType: 'image/webp' });
    if (!putResult.ok) {
      return c.json(ErrorResponseSchema.parse({ error: 'failed to store the upload' }), 502);
    }

    await deps.sql`UPDATE users SET avatar_key = ${key}, updated_at = now() WHERE id = ${session.userId}`;

    return c.json(UploadAvatarResponseSchema.parse({ ok: true, key }));
  });

  return app;
}
