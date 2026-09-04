import { z } from 'zod';

export const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  SMTP_PASSWORD: z.string().optional(),
});
