import { z } from 'zod';

// This one must still fail: `Token` is allowlisted only for the exact
// usage-counter names above, not for every field ending in "Token".
export const SessionResponseSchema = z.object({
  refreshToken: z.string(),
});
