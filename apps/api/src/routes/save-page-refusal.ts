/**
 * The one translation from `savePage()`'s typed refusals into an HTTP answer
 * a client can render.
 *
 * `savePage()` is called from two routes — `PUT /pages/:id` (the editor's
 * save) and `POST /pages/:id/comments` (the anchor mint) — and every refusal
 * it raises is a refusal of a request a person made. `PUT` mapped all four
 * to a status and a body; the comment route mapped none, so the same
 * `NotCanonicalError` that the editor sees as a `409` with the normalised
 * document attached reached a commenter as an unhandled `500` (docs/TODO.md,
 * 2026-09-13's follow-up and 2026-09-23's finding). One mapping, in one
 * place, called from both: a third caller of `savePage()` cannot inherit the
 * gap, and the two existing ones cannot drift into disagreeing about what a
 * stale save is called.
 *
 * `null` means "not one of `savePage()`'s refusals" — the caller rethrows,
 * because a bug must stay a 500 rather than be dressed as a conflict.
 */
import { ErrorResponseSchema } from '@deep-wiki/contracts';
import { DeadAnchorError, NotCanonicalError, PageNotFoundError, StaleContentError } from '@deep-wiki/db';

export interface SavePageRefusal {
  readonly status: 404 | 409;
  readonly body: Record<string, unknown>;
}

export function savePageRefusal(error: unknown): SavePageRefusal | null {
  if (error instanceof StaleContentError) {
    return { status: 409, body: ErrorResponseSchema.parse({ error: 'stale content: reload before saving again' }) };
  }
  // The normalised form travels with the refusal: the client's only route
  // out is to adopt it, so withholding it would make the 409 unactionable.
  if (error instanceof NotCanonicalError) {
    return { status: 409, body: { error: 'not canonical', canonical: error.canonical } };
  }
  if (error instanceof DeadAnchorError) {
    return { status: 409, body: { error: 'dead anchor', corrected: error.corrected, anchors: [...error.anchors] } };
  }
  // A page trashed or deleted between the route's own `live_nodes` lookup
  // and the save. Both callers check first, so this is the race, not the
  // ordinary absence — and it must answer exactly as the absence does, or
  // the timing discloses that the page existed (trash-non-disclosure spec).
  if (error instanceof PageNotFoundError) {
    return { status: 404, body: ErrorResponseSchema.parse({ error: 'not found' }) };
  }
  return null;
}
