import { z } from 'zod';

/**
 * Request/response schemas for `apps/api/src/routes/admin.ts`: public
 * self-registration (registration-policy spec) and the Super-Root-gated
 * instance settings it depends on. Not named among design.md's
 * illustrative `{auth,invitations,uploads}.ts` list, which predates this
 * refactor; registration and instance-settings shapes belong to the same
 * "every route implemented in work units 9-16" scope, so they get their
 * own file rather than being folded into `auth.ts`.
 */

export const RegisterRequestSchema = z.object({
  email: z.string(),
  password: z.string(),
});
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const RegisterResponseSchema = z.object({
  ok: z.literal(true),
});
export type RegisterResponse = z.infer<typeof RegisterResponseSchema>;

export const RegistrationModeSchema = z.enum(['closed', 'invitation_only', 'open']);
export type RegistrationModeValue = z.infer<typeof RegistrationModeSchema>;

export const RegistrationModeRequestSchema = z.object({
  mode: RegistrationModeSchema,
});
export type RegistrationModeRequest = z.infer<typeof RegistrationModeRequestSchema>;

export const RegistrationModeResponseSchema = z.object({
  ok: z.literal(true),
});
export type RegistrationModeResponse = z.infer<typeof RegistrationModeResponseSchema>;

export const RegistrationDomainsRequestSchema = z.object({
  domains: z.array(z.string()),
});
export type RegistrationDomainsRequest = z.infer<typeof RegistrationDomainsRequestSchema>;

export const RegistrationDomainsResponseSchema = z.object({
  ok: z.literal(true),
});
export type RegistrationDomainsResponse = z.infer<typeof RegistrationDomainsResponseSchema>;

export const SmtpTestRequestSchema = z.object({
  to: z.string(),
});
export type SmtpTestRequest = z.infer<typeof SmtpTestRequestSchema>;

export const SmtpTestResponseSchema = z.object({
  ok: z.literal(true),
});
export type SmtpTestResponse = z.infer<typeof SmtpTestResponseSchema>;
