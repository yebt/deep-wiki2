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
 */
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
}

export interface PendingConfirm {
  readonly id: number;
  readonly title: string;
  readonly description: string | null;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly tone: 'primary' | 'destructive';
}

export interface UseConfirmResult {
  /** The question on screen, or `null`. `ConfirmDialog` renders it; a call site never needs it. */
  readonly pending: Ref<PendingConfirm | null>;
  /** Ask, and get the answer once the person gives one. */
  readonly confirm: (options: ConfirmOptions) => Promise<boolean>;
  /** Answer the pending question. `ConfirmDialog`'s, and a no-op with nothing pending. */
  readonly settle: (answer: boolean) => void;
}

let nextId = 1;
const resolvers = new Map<number, (answer: boolean) => void>();

export function useConfirm(): UseConfirmResult {
  const pending = useState<PendingConfirm | null>('dw-confirm', () => null);

  function settle(answer: boolean): void {
    const current = pending.value;
    if (!current) return;
    pending.value = null;
    const resolve = resolvers.get(current.id);
    resolvers.delete(current.id);
    resolve?.(answer);
  }

  function confirm(options: ConfirmOptions): Promise<boolean> {
    settle(false);
    const id = nextId++;
    return new Promise<boolean>((resolve) => {
      resolvers.set(id, resolve);
      pending.value = {
        id,
        title: options.title,
        description: options.description ?? null,
        confirmLabel: options.confirmLabel,
        cancelLabel: options.cancelLabel ?? 'Cancel',
        tone: options.tone ?? 'primary',
      };
    });
  }

  return { pending, confirm, settle };
}
