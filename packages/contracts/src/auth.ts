import { z } from 'zod';

/**
 * Request/response schemas for `apps/api/src/routes/auth.ts` (authentication
 * spec; design.md — "Authentication"). Single source of truth for the wire
 * shape consumed by both apps/api's route handlers and apps/web's forms.
 */

export const LoginRequestSchema = z.object({
  email: z.string(),
  password: z.string(),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

/**
 * The session token itself travels only in the `Set-Cookie` header
 * (authentication spec — "Session token absent from response body"),
 * never in this body.
 */
export const LoginResponseSchema = z.object({
  ok: z.literal(true),
});
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

export const PasswordResetRequestSchema = z.object({
  email: z.string(),
});
export type PasswordResetRequest = z.infer<typeof PasswordResetRequestSchema>;

/**
 * The account non-disclosure guarantee (authentication spec — "Password
 * Reset Responses Do Not Disclose Account Existence") lives in the route
 * handler always returning this exact shape regardless of whether the
 * submitted email corresponds to an existing account. One schema, one
 * shape, is what makes that "exact" checkable.
 */
export const PasswordResetResponseSchema = z.object({
  ok: z.literal(true),
  message: z.string(),
});
export type PasswordResetResponse = z.infer<typeof PasswordResetResponseSchema>;

export const PasswordResetConfirmRequestSchema = z.object({
  token: z.string(),
  newPassword: z.string(),
});
export type PasswordResetConfirmRequest = z.infer<typeof PasswordResetConfirmRequestSchema>;

export const PasswordResetConfirmResponseSchema = z.object({
  ok: z.literal(true),
});
export type PasswordResetConfirmResponse = z.infer<typeof PasswordResetConfirmResponseSchema>;
