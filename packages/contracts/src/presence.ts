import { z } from 'zod';

/**
 * The SSE payload shape for `apps/api/src/routes/presence.ts`
 * (editing-presence spec; versioning-and-collaboration design.md
 * Decision 5). `mode` is a literal `'editing'` rather than an enum column
 * — no `presence_mode` type exists, because a `viewing` mode has no lock
 * to derive from and would require a real table, deliberately out of
 * scope for this change.
 */
export const PresenceEventSchema = z.object({
  mode: z.literal('editing'),
  pageId: z.string(),
  pageTitle: z.string(),
  userId: z.string(),
  userDisplayName: z.string(),
  /** ISO timestamp the lock (and therefore this presence) was acquired. */
  since: z.string(),
});
export type PresenceEventPayload = z.infer<typeof PresenceEventSchema>;
