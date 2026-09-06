import { z } from 'zod';

// The named trap (design.md D17): a bare `Token` suffix rule would flag
// every one of these legitimate usage counters. This fixture must pass.
export const UsageResponseSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  cachedInputTokens: z.number(),
  reasoningTokens: z.number(),
});
