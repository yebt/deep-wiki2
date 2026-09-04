import { z } from 'zod';

/**
 * Request/response schemas for `apps/api/src/routes/invitations.ts`
 * (invitations spec). `Action` mirrors `@deep-wiki/core`'s action lattice
 * (`read < comment < write < manage`) as a literal enum, so a malformed
 * action is rejected before it ever reaches the resolver.
 */
const ActionSchema = z.enum(['read', 'comment', 'write', 'manage']);
export type ActionValue = z.infer<typeof ActionSchema>;

export const StartingGrantSchema = z.object({
  resourceId: z.string(),
  action: ActionSchema,
});
export type StartingGrant = z.infer<typeof StartingGrantSchema>;

export const CreateInvitationRequestSchema = z.object({
  workspaceId: z.string(),
  email: z.string(),
  startingGrants: z.array(StartingGrantSchema).min(1),
});
export type CreateInvitationRequest = z.infer<typeof CreateInvitationRequestSchema>;

export const CreateInvitationResponseSchema = z.object({
  ok: z.literal(true),
});
export type CreateInvitationResponse = z.infer<typeof CreateInvitationResponseSchema>;

export const AcceptInvitationRequestSchema = z.object({
  token: z.string(),
  password: z.string(),
  displayName: z.string(),
});
export type AcceptInvitationRequest = z.infer<typeof AcceptInvitationRequestSchema>;

export const AcceptInvitationResponseSchema = z.object({
  ok: z.literal(true),
  workspaceId: z.string(),
});
export type AcceptInvitationResponse = z.infer<typeof AcceptInvitationResponseSchema>;
