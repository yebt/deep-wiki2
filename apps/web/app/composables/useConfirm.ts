/**
 * "Are you sure?" as a promise.
 *
 *     if (!(await confirm({ title: 'Leave without saving?', confirmLabel: 'Leave' }))) return;
 *
 * The question half of the product's one confirm dialog. A call site
 * describes the question and awaits a boolean; `ConfirmDialog.vue`,
 * mounted once in `app.vue`, renders whatever is pending here and
 * settles it — on the confirm action, the cancel action, Escape, or a
 * click outside. The call site never sees the dialog, which is what lets
 * every "are you sure" in the product be one component
 * (docs/UI-CHECKLIST.md §4.1) with the focus trap, the focus return and
 * the Escape exit §5 requires, stated once.
 *
 * Until 2026-09-16 edit mode asked with `window.confirm`: the browser's
 * own box, outside every theme, with "OK" for an answer. `beforeunload`
 * — the prompt when a *tab* closes with unsaved work — is the one the
 * browser keeps for itself, and stays.
 *
 * The pending question lives in `useState` so the host and the caller
 * read one value; the resolver lives beside it in module scope, because
 * a function is not state Nuxt can carry. A second question while one is
 * pending answers the first with `false`: there is never a second dialog
 * and never a promise left hanging.
 *
 * Two additions for a delete (design.md Decision 8, 2026-09-18), still
 * one dialog:
 *
 * - **`confirmText`** — the question asks the person to type the thing's
 *   name. The match is the consent: the confirm action stays unavailable
 *   until the typed value equals it exactly, so a stray Enter cannot
 *   agree to something irreversible.
 * - **`onConfirm`** — a "yes" the server must still honour. The owner's
 *   force-delete is re-verified against the current name and count, and
 *   a refusal (`stale_count`, `name_mismatch`) is not a reason to close
 *   the dialog and open another: `accept()` runs the handler with the
 *   dialog still open, closes on `null`, and hands a refusal back to the
 *   dialog to show — under the field, and as a new description when the
 *   consequence itself changed.
 */
export interface ConfirmRefusal {
  /** Shown under the typed-name field (or beside the actions when there is none), and announced. */
  readonly fieldError?: string;
  /** The consequence changed since the question was asked: the new description, replacing the old. */
  readonly description?: string;
}

export interface ConfirmOptions {
  /** The question, as a question: "Leave without saving?" */
  readonly title: string;
  /** What happens if they say yes — the consequence, in the user's terms. */
  readonly description?: string;
  /** The verb, never "OK": "Leave", "Reload", "Take over". */
  readonly confirmLabel: string;
  /** Default "Cancel". */
  readonly cancelLabel?: string;
  /** `destructive` when saying yes loses something: the action is the error colour, not the accent. */
  readonly tone?: 'primary' | 'destructive';
  /** When set, the person must type exactly this — the thing's name — before the confirm action is available. */
  readonly confirmText?: string;
  /**
   * Runs on "yes" with the dialog still open and its action busy. `null`
   * closes the dialog and answers `true`; a refusal keeps it open with the
   * refusal shown. Cancelling while it runs answers `false` and discards
   * whatever it later returns.
   */
  readonly onConfirm?: (typed: string) => Promise<ConfirmRefusal | null>;
}

export interface PendingConfirm {
  readonly id: number;
  readonly title: string;
  readonly description: string | null;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly tone: 'primary' | 'destructive';
  /** The name to type, or `null` when the question has no such field. */
  readonly confirmText: string | null;
}

export interface UseConfirmResult {
  /** The question on screen, or `null`. `ConfirmDialog` renders it; a call site never needs it. */
  readonly pending: Ref<PendingConfirm | null>;
  /** Ask, and get the answer once the person gives one. */
  readonly confirm: (options: ConfirmOptions) => Promise<boolean>;
  /** Answer the pending question. `ConfirmDialog`'s, and a no-op with nothing pending. */
  readonly settle: (answer: boolean) => void;
  /**
   * Say yes. Without an `onConfirm` this is `settle(true)`; with one, the
   * handler runs first and the dialog closes only on `null`. Returns the
   * refusal for the dialog to show, or `null`. `ConfirmDialog`'s.
   */
  readonly accept: (typed?: string) => Promise<ConfirmRefusal | null>;
}

let nextId = 1;
const resolvers = new Map<number, (answer: boolean) => void>();
const handlers = new Map<number, (typed: string) => Promise<ConfirmRefusal | null>>();

export function useConfirm(): UseConfirmResult {
  const pending = useState<PendingConfirm | null>('dw-confirm', () => null);

  function settle(answer: boolean): void {
    const current = pending.value;
    if (!current) return;
    pending.value = null;
    const resolve = resolvers.get(current.id);
    resolvers.delete(current.id);
    handlers.delete(current.id);
    resolve?.(answer);
  }

  async function accept(typed = ''): Promise<ConfirmRefusal | null> {
    const current = pending.value;
    if (!current) return null;
    const handler = handlers.get(current.id);
    if (!handler) {
      settle(true);
      return null;
    }
    const refusal = await handler(typed);
    // Escape, or a second question, may have answered this one while the
    // handler ran: a late "yes" or a late refusal belongs to nothing.
    if (pending.value?.id !== current.id) return null;
    if (refusal) return refusal;
    settle(true);
    return null;
  }

  function confirm(options: ConfirmOptions): Promise<boolean> {
    settle(false);
    const id = nextId++;
    return new Promise<boolean>((resolve) => {
      resolvers.set(id, resolve);
      if (options.onConfirm) handlers.set(id, options.onConfirm);
      pending.value = {
        id,
        title: options.title,
        description: options.description ?? null,
        confirmLabel: options.confirmLabel,
        cancelLabel: options.cancelLabel ?? 'Cancel',
        tone: options.tone ?? 'primary',
        confirmText: options.confirmText ?? null,
      };
    });
  }

  return { pending, confirm, settle, accept };
}
