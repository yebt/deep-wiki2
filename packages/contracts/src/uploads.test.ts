import { describe, expect, test } from 'bun:test';
import { UploadAvatarResponseSchema } from './uploads';

describe('UploadAvatarResponseSchema', () => {
  test('accepts the server-generated storage key', () => {
    const result = UploadAvatarResponseSchema.safeParse({
      ok: true,
      key: 'workspaces/ws1/avatars/user1/uuid.webp',
    });

    expect(result.success).toBe(true);
  });

  test('rejects a body missing the key', () => {
    expect(UploadAvatarResponseSchema.safeParse({ ok: true }).success).toBe(false);
  });
});
