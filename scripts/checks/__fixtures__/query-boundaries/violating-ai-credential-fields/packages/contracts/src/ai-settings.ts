import { z } from 'zod';

export const CredentialResponseSchema = z.object({
  id: z.string(),
  provider: z.string(),
  ciphertext: z.string(),
});
