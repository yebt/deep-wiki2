import { z } from 'zod';

/**
 * Generic error response shape shared by every route in this API
 * (design.md — "Ports and adapters", route error bodies). This is the
 * single schema every route's failure path validates against.
 *
 * No field declared here — or in any other `*Response*`-named export in
 * this package — may ever carry a secret-shaped value (a password hash, a
 * session/reset/invitation token, or an SMTP/S3 credential):
 * `scripts/checks/query-boundaries.ts` fails the build on that class of
 * mistake.
 */
export const ErrorResponseSchema = z.object({
  error: z.string(),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
