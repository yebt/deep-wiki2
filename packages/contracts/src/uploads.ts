import { z } from 'zod';

/**
 * Response schema for `POST /uploads/avatar` (blob-storage spec —
 * "Profile Photo Upload Validated"). The request is `multipart/form-data`
 * (a `workspaceId` field and a `file` field), which zod does not
 * meaningfully model as an object schema — the route reads the raw
 * `FormData` directly. Only the JSON response is a wire contract here.
 */
export const UploadAvatarResponseSchema = z.object({
  ok: z.literal(true),
  key: z.string(),
});
export type UploadAvatarResponse = z.infer<typeof UploadAvatarResponseSchema>;
