import { z } from 'zod';
import { AiCredentialProviderSchema } from './ai-credentials-request';

/**
 * Read-side schemas for `apps/api/src/routes/ai-credentials.ts`
 * (workspace-ai-credentials spec; ai-provider-foundation design.md —
 * "Credentials: envelope encryption a self-hoster can operate").
 *
 * No field here may ever carry the plaintext or the ciphertext key —
 * `scripts/checks/query-boundaries.ts` rule 5 fails the build on that
 * class of mistake. `lastFour` is the four characters the provider's own
 * console shows (D9), never a hash of the full key. The request schema
 * that legitimately carries the raw key lives in
 * `./ai-credentials-request.ts`, kept apart from this file so rule 5's
 * whole-file scan never has to distinguish the two.
 */
export { AiCredentialProviderSchema };
export type { AiCredentialProvider } from './ai-credentials-request';

export const SaveAiCredentialResponseSchema = z.object({
  ok: z.literal(true),
  lastFour: z.string().length(4),
});
export type SaveAiCredentialResponse = z.infer<typeof SaveAiCredentialResponseSchema>;

export const AiCredentialSummarySchema = z.object({
  provider: AiCredentialProviderSchema,
  lastFour: z.string().length(4),
  validatedAt: z.string().nullable(),
});
export type AiCredentialSummary = z.infer<typeof AiCredentialSummarySchema>;

export const ListAiCredentialsResponseSchema = z.object({
  credentials: z.array(AiCredentialSummarySchema),
});
export type ListAiCredentialsResponse = z.infer<typeof ListAiCredentialsResponseSchema>;
