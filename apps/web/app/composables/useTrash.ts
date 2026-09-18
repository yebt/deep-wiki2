import type { ForceDeleteRequest, TrashedCounts, TrashNodeResponse } from '@deep-wiki/contracts';
import type { ConfirmOptions, ConfirmRefusal } from './useConfirm';

/**
 * Deleting a node from the tree — the client half of the node-trash spec
 * (design.md Decision 3 for the server, Decision 8 for this).
 *
 * ── The shape of it ─────────────────────────────────────────────────────
 *
 * A delete is never a hard delete: `DELETE /nodes/:id` moves the node
 * and everything under it to the trash for 30 days. So the first question
 * is a plain one — "Delete “X”?", the consequence in the description —
 * and a "yes" takes the row out of the tree **before** the server has
 * answered, as a drag does (`useTree.removeNode`); a refusal puts it back
 * with the reason beside the tree, and nothing reloads the tree.
 *
 * A container with live children is refused with `409 not_empty` for
 * everyone but the workspace owner. For a manager that is the end: the
 * row comes back and the notice names the counts, so they know what to
 * empty. For the owner the server says `canForce`, and the flow asks a
 * second time — the same dialog, extended: the container's name to type
 * (`confirmText`), the counts the server just gave, the destructive
 * tone. The typed name and the count go to `POST /nodes/:id/force-delete`
 * through the question's own `onConfirm`, so the server's re-verification
 * lands **inside the open dialog**: a `stale_count` (a page was created
 * meanwhile) swaps in the fresh count and the next "yes" submits it; a
 * `name_mismatch` (the container was renamed) says so under the field.
 * Nothing closes the dialog but a yes the server honoured, or the person.
 *
 * A row with children the tree shows is not taken out ahead of the first
 * request: the server will certainly refuse it, and a row that vanishes
 * and returns a moment later is a lie about what happened. The tree's
 * count is a lower bound — children the caller cannot read are invisible
 * — which is why the server's answer, not the tree's, decides the path.
 *
 * ── Why a function with injected pieces ────────────────────────────────
 *
 * The dialog, the two requests and the tree's removal are handed in, so
 * the order of events and every refusal the server can answer with are
 * held by `useTrash.test.ts` without a component, and `NavigationTree`
 * supplies the real ones. Failure is classified through
 * `~/utils/fetch-error`, the shared guard, never a hand-written copy.
 */
export type TrashFetcher = (nodeId: string) => Promise<TrashNodeResponse>;
export type ForceDeleteFetcher = (nodeId: string, body: ForceDeleteRequest) => Promise<TrashNodeResponse>;

export interface DeleteTarget {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  /** Children the tree draws under it — a lower bound on what the server will count. */
  readonly visibleChildren: number;
}

export interface DeleteNodeDeps {
  /** `useConfirm().confirm` — the product's one dialog. */
  readonly confirm: (options: ConfirmOptions) => Promise<boolean>;
  readonly trashFetcher: TrashFetcher;
  readonly forceDeleteFetcher: ForceDeleteFetcher;
  /** Takes the row out of the tree at once and returns the way back. */
  readonly removeRow: (nodeId: string) => () => void;
}

export type DeleteNodeResult =
  | { readonly kind: 'trashed'; readonly operationId: string; readonly trashed: TrashedCounts }
  | { readonly kind: 'cancelled' }
  /** The server said no, and the row is back: the reason, for the notice beside the tree. */
  | { readonly kind: 'refused'; readonly message: string };

interface NotEmptyBody {
  readonly error: 'not_empty';
  readonly pages: number;
  readonly containers: number;
  readonly canForce: boolean;
}

const RETENTION = 'They move to the trash for 30 days, where anyone who manages them can restore them.';
const MESSAGES = {
  forbidden: "You don't have permission to delete this. Ask a workspace admin for manage access.",
  gone: 'That item is no longer there. Reload the tree and try again.',
  network: 'Cannot reach the server. Check your connection and try again.',
  staleCount: 'The count changed while this was open. Check the new count, then confirm again.',
  renamed: 'This item was renamed since the tree was loaded. Cancel, reload the tree and try again.',
} as const;

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

/**
 * "12 pages and 3 chapters" — the counts in the product's vocabulary. A
 * zero is dropped unless both are zero; a shelf's containers are books
 * or chapters, since it holds both.
 */
export function countSentence(counts: TrashedCounts, type: string, separator = ' and '): string {
  const parts: string[] = [];
  if (counts.pages > 0 || counts.containers === 0) parts.push(plural(counts.pages, 'page'));
  if (counts.containers > 0) {
    const one = counts.containers === 1;
    parts.push(type === 'shelf' ? `${counts.containers} ${one ? 'book or chapter' : 'books or chapters'}` : plural(counts.containers, 'chapter'));
  }
  return parts.join(separator);
}

function forceDescription(counts: TrashedCounts, type: string): string {
  return `${countSentence(counts, type)} will be deleted. ${RETENTION}`;
}

function notEmptyOf(error: unknown): NotEmptyBody | null {
  if (httpStatusOf(error) !== 409) return null;
  const body = responseBodyOf(error) as Partial<NotEmptyBody> | undefined;
  if (body?.error !== 'not_empty') return null;
  return { error: 'not_empty', pages: body.pages ?? 0, containers: body.containers ?? 0, canForce: body.canForce === true };
}

/** The sentence for a refusal that is not the container's own: permission, absence, or no answer at all. */
function refusalMessage(error: unknown): string {
  switch (httpStatusOf(error)) {
    case 403:
      return MESSAGES.forbidden;
    case 404:
      return MESSAGES.gone;
    default:
      return MESSAGES.network;
  }
}

export async function deleteNode(target: DeleteTarget, deps: DeleteNodeDeps): Promise<DeleteNodeResult> {
  const agreed = await deps.confirm({
    title: `Delete “${target.title}”?`,
    description: 'It moves to the trash for 30 days, where anyone who manages it can restore it.',
    confirmLabel: 'Delete',
    tone: 'destructive',
  });
  if (!agreed) return { kind: 'cancelled' };

  // Drawn first, like a drag — unless the tree already shows children,
  // in which case the server will certainly refuse and the row stays.
  const undo = target.visibleChildren === 0 ? deps.removeRow(target.id) : null;
  let notEmpty: NotEmptyBody;
  try {
    const trashed = await deps.trashFetcher(target.id);
    return { kind: 'trashed', operationId: trashed.trashOperationId, trashed: trashed.trashed };
  } catch (error) {
    undo?.();
    const refusal = notEmptyOf(error);
    if (!refusal) return { kind: 'refused', message: refusalMessage(error) };
    if (!refusal.canForce) {
      return { kind: 'refused', message: `Empty “${target.title}” before deleting it (${countSentence(refusal, target.type, ', ')}).` };
    }
    notEmpty = refusal;
  }

  // The owner's second question: the name to type, the count the server
  // counted, and the server's re-verification inside the open dialog.
  let acceptedCount = notEmpty.pages;
  // A holder, not a `let`: the answer is written inside the closure the
  // dialog calls, which control flow does not follow.
  const outcome: { forced: TrashNodeResponse | null } = { forced: null };
  const onConfirm = async (typed: string): Promise<ConfirmRefusal | null> => {
    try {
      outcome.forced = await deps.forceDeleteFetcher(target.id, { confirmName: typed, acceptedCount });
      return null;
    } catch (error) {
      const body = responseBodyOf(error) as { error?: string; pages?: number; containers?: number } | undefined;
      if (httpStatusOf(error) === 409 && body?.error === 'stale_count') {
        const fresh = { pages: body.pages ?? acceptedCount, containers: body.containers ?? notEmpty.containers };
        acceptedCount = fresh.pages;
        return { fieldError: MESSAGES.staleCount, description: forceDescription(fresh, target.type) };
      }
      if (httpStatusOf(error) === 409 && body?.error === 'name_mismatch') return { fieldError: MESSAGES.renamed };
      return { fieldError: refusalMessage(error) };
    }
  };

  const forcedAgreed = await deps.confirm({
    title: `Delete “${target.title}” and everything in it?`,
    description: forceDescription(notEmpty, target.type),
    confirmLabel: 'Delete',
    tone: 'destructive',
    confirmText: target.title,
    onConfirm,
  });
  const result = outcome.forced;
  if (!forcedAgreed || !result) return { kind: 'cancelled' };
  // Not optimistic this time: the server has already answered, and the
  // row leaves the way the response says — the container and all under it.
  deps.removeRow(target.id);
  return { kind: 'trashed', operationId: result.trashOperationId, trashed: result.trashed };
}
