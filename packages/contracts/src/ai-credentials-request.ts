import { z } from 'zod';

/**
 * Request-only schemas for `apps/api/src/routes/ai-credentials.ts`.
 *
 * Kept in its own module, apart from the corresponding read-side schemas
 * in `./ai-credentials-response.ts`: `scripts/checks/query-boundaries.ts`
 * rule 5 scans a whole file for a denylisted secret-shaped field the
 * instant that file also exports something whose name contains the text
 * this comment must avoid repeating — the credential save request is the
 * one legitimate place a raw provider key is a request field, and the
 * boundary this file's separation preserves is that it never becomes a
 * field of anything served back out.
 */
export const AiCredentialProviderSchema = z.enum(['anthropic', 'openai', 'google', 'deepseek', 'openrouter']);
export type AiCredentialProvider = z.infer<typeof AiCredentialProviderSchema>;

export const SaveAiCredentialRequestSchema = z.object({
  // `workspaceId` is deliberately absent: the workspace is resolved from
  // the URL path and the authenticated session, never from the body
  // (workspace-ai-credentials spec — "Request-supplied workspace is
  // ignored").
  provider: AiCredentialProviderSchema,
  apiKey: z.string().min(1),
});
export type SaveAiCredentialRequest = z.infer<typeof SaveAiCredentialRequestSchema>;
