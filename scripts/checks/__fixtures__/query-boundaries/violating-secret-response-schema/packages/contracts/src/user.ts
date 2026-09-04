import { z } from 'zod';

export const userResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  password_hash: z.string(),
});
