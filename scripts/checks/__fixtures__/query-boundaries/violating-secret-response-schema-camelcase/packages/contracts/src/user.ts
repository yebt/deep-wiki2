import { z } from 'zod';

// The DB column is `password_hash`; the contracts layer spells the same
// secret `passwordHash`. Both spellings leak the same value.
export const userResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  passwordHash: z.string(),
  sessionToken: z.string(),
  resetToken: z.string(),
});
