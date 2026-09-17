/**
 * The pure rules behind "delete" in this product (node-trash spec;
 * design.md Decision 3). A delete always trashes — there is no hard
 * delete on demand — and this module answers exactly two questions with
 * no I/O of its own: may this trash proceed, and (once `decideRestore` is
 * added) may this restore proceed. Every count, grant and submitted value
 * is gathered by the caller (`packages/db/src/trash/trash-node.ts`); this
 * function only folds them into one of the closed outcomes the
 * `node-trash` spec names.
 */

export type TrashMode = 'trash' | 'force';

export interface TrashLiveCounts {
  /** Live descendant pages — the number the spec and the owner's confirmation both count. */
  readonly pages: number;
  /** Returned beside `pages` for the confirmation sentence; not itself part of the decision. */
  readonly containers: number;
}

export interface TrashSubmission {
  readonly confirmName: string;
  readonly acceptedCount: number;
}

export interface DecideTrashInput {
  readonly mode: TrashMode;
  readonly isOwner: boolean;
  readonly hasManage: boolean;
  readonly isContainer: boolean;
  readonly live: TrashLiveCounts;
  /** Present only on the `force` route (`POST /nodes/:id/force-delete`). */
  readonly submitted?: TrashSubmission;
  readonly title: string;
}

export type DecideTrashReason = 'forbidden' | 'not_empty' | 'name_mismatch' | 'stale_count';

export type DecideTrashResult = { readonly ok: true } | { readonly ok: false; readonly reason: DecideTrashReason };

/**
 * `mode: 'trash'` is the plain `DELETE /nodes/:id`; `mode: 'force'` is
 * `POST /nodes/:id/force-delete`. A non-empty container always refuses on
 * the plain route — even for the owner, who is expected to have already
 * seen the `409 not_empty` response and be resubmitting through force —
 * so the two routes never share a success path for the same request.
 *
 * Already-trashed descendants are never this function's concern: `live`
 * is computed by the caller (`subtree.ts`'s `liveOnly` walk) and already
 * excludes them, so "container with only trashed children is empty" and
 * "force count excludes an already-trashed page" both fall out of the
 * caller's counting, not a branch here.
 */
export function decideTrash(input: DecideTrashInput): DecideTrashResult {
  if (!input.hasManage && !input.isOwner) {
    return { ok: false, reason: 'forbidden' };
  }

  const nonEmpty = input.isContainer && input.live.pages > 0;
  if (!nonEmpty) {
    return { ok: true };
  }

  if (input.mode !== 'force' || !input.isOwner || !input.submitted) {
    return { ok: false, reason: 'not_empty' };
  }

  if (input.submitted.confirmName !== input.title) {
    return { ok: false, reason: 'name_mismatch' };
  }

  if (input.submitted.acceptedCount !== input.live.pages) {
    return { ok: false, reason: 'stale_count' };
  }

  return { ok: true };
}

export interface DecideRestoreInput {
  /** Whether the op root's direct parent is live. The guard trigger's invariant (live ⇒ parent live) makes checking the direct parent equivalent to checking every ancestor. */
  readonly parentLive: boolean;
  /** Whether the (possibly renamed) slug is held by a live sibling. */
  readonly slugTaken: boolean;
  /** Carried through for the caller's own bookkeeping; it plays no part in the decision itself. */
  readonly requestedName?: string;
}

export type DecideRestoreReason = 'ancestor_trashed' | 'slug_taken';

export type DecideRestoreResult = { readonly ok: true } | { readonly ok: false; readonly reason: DecideRestoreReason };

/**
 * Named refusals only — never a minted, automatically-suffixed slug
 * (trash-restore spec). The route maps `ancestor_trashed` to naming the
 * trashed ancestor, and `slug_taken` to naming the live sibling; both
 * names come from data the caller already holds, not from this function.
 */
export function decideRestore(input: DecideRestoreInput): DecideRestoreResult {
  if (!input.parentLive) {
    return { ok: false, reason: 'ancestor_trashed' };
  }

  if (input.slugTaken) {
    return { ok: false, reason: 'slug_taken' };
  }

  return { ok: true };
}

/** A workspace-wide constant (docs/SPECS.md); per-workspace retention is out of scope. */
export const TRASH_RETENTION_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Days remaining before `trashedAt` becomes eligible for purge, rounded up
 * so "0 days left" means eligible now rather than already gone, and never
 * negative for a node whose window has already elapsed.
 */
export function daysUntilPurge(trashedAt: Date, now: Date = new Date()): number {
  const purgeAt = trashedAt.getTime() + TRASH_RETENTION_DAYS * MS_PER_DAY;
  const remainingMs = purgeAt - now.getTime();
  return Math.max(0, Math.ceil(remainingMs / MS_PER_DAY));
}
