/**
 * The product's fourth notice surface: a toast (owner decision,
 * 2026-09-23, pointing at the green "Saved “parla”." bar under the title —
 * "estas cosas pueden manejarse como toasts").
 *
 * ── What belongs here, and what does not ───────────────────────────────
 *
 * A toast carries a **transient, successful** confirmation of something
 * the person just did, in one sentence, with at most one way back. It is
 * the only notice tier that removes itself, which is exactly why nothing
 * that must be read may live in it. The rule is stated once in
 * `docs/UI-CHECKLIST.md` §4.12 beside the other three tiers, and the
 * short version is:
 *
 * - **Toast** — "Saved “X”.", "Created page “X” in “Y”.", "Moved “X” to
 *   the trash.", "Invitation sent." Gone in a few seconds.
 * - **Chip / bar / panel** (`InlineNotice`, `PageNotice`) — an error that
 *   must stay until it is read, a refusal that names a conflict, "your
 *   work is preserved" after a failed save, and any state the screen
 *   itself is in.
 *
 * An error is never *only* a toast: the screen that failed keeps its own
 * notice, so a person who looked away has not lost the only copy.
 *
 * ── Why a wrapper around `useToast()` ──────────────────────────────────
 *
 * Nuxt UI's `useToast().add()` takes twenty options, and a product where
 * each call site picks its own colour, icon, duration and dismissal is a
 * fourth notice shape per screen rather than one tier (checklist §4.1 —
 * the defect the three `InlineNotice` tiers exist to prevent). This is the
 * one place those are chosen:
 *
 * - `role="status"` on the toast itself, so a toast is a status wherever
 *   it is read from, and `type: 'background'` so the announcement Reka
 *   makes for it is polite rather than assertive — a confirmation is not
 *   an interruption (checklist §5).
 * - Dismissible, always: the library's close control stays.
 * - An icon beside the words, never instead of them (§4.3), and the tone's
 *   colour is a second signal rather than the only one (§5).
 * - Longer on screen when it carries a way back, because a toast with an
 *   action the person may want has to outlast reading it (M3's snackbar
 *   guidance).
 *
 * How many may stack at once is the toaster's, stated once in `app.vue`.
 */

export interface StatusToastAction {
  readonly label: string;
  /** A destination — "Restore from Trash". */
  readonly to?: string;
  readonly icon?: string;
  readonly onClick?: () => void;
}

export interface StatusToast {
  /** One sentence, naming what happened to what — never a bare "Saved". */
  readonly message: string;
  /** Beside the words, never instead of them (§4.3). */
  readonly icon?: string;
  /** At most one, as a chip has at most one. */
  readonly action?: StatusToastAction;
}

/** A plain confirmation, in milliseconds. The library's own default, stated so it is not a mystery. */
export const STATUS_TOAST_MS = 5_000;
/** One carrying a way back: long enough to read the sentence and reach the control. */
export const STATUS_TOAST_WITH_ACTION_MS = 8_000;

export interface UseStatusToastResult {
  /** Confirms something that succeeded and is over. */
  readonly confirmed: (toast: StatusToast) => void;
}

export function useStatusToast(): UseStatusToastResult {
  const toast = useToast();

  function confirmed(status: StatusToast): void {
    toast.add({
      title: status.message,
      icon: status.icon ?? 'i-lucide-circle-check',
      color: 'success',
      // `role`/`type` are not `UToast` props: they fall through to Reka's
      // toast root (the visible one) and to its announcement respectively.
      role: 'status',
      type: 'background',
      close: true,
      duration: status.action ? STATUS_TOAST_WITH_ACTION_MS : STATUS_TOAST_MS,
      actions: status.action
        ? [
            {
              label: status.action.label,
              icon: status.action.icon,
              to: status.action.to,
              onClick: status.action.onClick,
              color: 'neutral',
              variant: 'outline',
              size: 'xs',
            },
          ]
        : undefined,
    } as Parameters<typeof toast.add>[0]);
  }

  return { confirmed };
}
