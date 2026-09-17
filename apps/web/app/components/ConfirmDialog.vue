<script setup lang="ts">
/**
 * The product's one confirm dialog — the answer half of `useConfirm`.
 * Mounted once, in `app.vue`, beside every screen; it renders whatever
 * question is pending and settles it, so a call site only ever awaits a
 * boolean.
 *
 * Built on `UModal` (docs/UI-CHECKLIST.md §4.1, §9.6: never a hand-rolled
 * dialog), which brings the Reka contract §5 makes pass/fail — focus
 * trapped inside, Escape closes, a click on the scrim closes — and the
 * design system's treatment of a dialog: `bg-accented`, one rung above
 * the pane it covers (§9.6, set centrally), `shadow-lg` because it floats
 * and can be dismissed (§4.3), the container rung's `rounded-lg` (§3.4).
 * Every exit that is not the confirm action is a "no": closing is
 * cancelling, so a question is never left unanswered.
 *
 * What this adds to `UModal`:
 *
 * - **No "X".** M3's dialog has none; Escape and the cancel action are
 *   the exits, and a third, unlabelled one is a control with no reason.
 * - **Focus lands on the safe action.** The cancel button is first in
 *   the footer, so Reka's open auto-focus reaches it before the confirm
 *   action — a stray Enter never loses work.
 * - **Focus returns to the control that asked** (§5). Reka returns focus
 *   to a *trigger*, and a dialog opened from a promise has none, so the
 *   element that held focus when the question was asked is read then and
 *   focused on close in `onCloseAutoFocus`, with Reka's own default
 *   prevented so the two do not race.
 * - **The confirm action is the one filled button**: `primary` for an
 *   ordinary question, `error` for a destructive one (§9.1 — a
 *   destructive action has a visible boundary, never `ghost`). Cancel is
 *   outlined neutral, as the product's other dialogs already draw it.
 *
 * Type roles are the dialog's (§2.3): `headline-small` headline,
 * `body-medium` supporting text — set on `UModal` centrally in
 * `app.config.ts`, so this and the tree's dialogs read alike.
 *
 * **It outranks every overlay** (owner decision, 2026-09-17; the ladder
 * is docs/DESIGN-SYSTEM.md §4.5). A question the product asks is asked
 * from wherever the person is — a tree row in the 320 drawer, a form in
 * another dialog — and it must be the topmost thing on the screen, or a
 * pointer cannot reach Cancel: measured at 320, the drawer (a Reka
 * dialog opened after this one was mounted, both at `z-index: auto`)
 * stood above "Leave without saving?", and only Escape could answer it.
 * `z-70`, scrim and content, one rung above the modal rung every other
 * dialog takes in `app.config.ts`. Focus is Reka's: the last dialog
 * opened holds the trap, so focus lands here while the drawer waits
 * behind, and returns to the row that asked when this closes.
 */
const { pending, settle } = useConfirm();

const open = computed({
  get: () => pending.value !== null,
  set: (value) => {
    // Every way of closing that is not the confirm button is a "no".
    if (!value) settle(false);
  },
});

/** The control that asked, read the moment the question appears — focus goes back there on close. */
let opener: HTMLElement | null = null;
watch(
  () => pending.value?.id,
  (id, previous) => {
    if (id !== undefined && previous === undefined) {
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
  },
);

function onCloseAutoFocus(event: Event): void {
  event.preventDefault();
  opener?.focus();
  opener = null;
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="pending?.title"
    :description="pending?.description ?? undefined"
    :close="false"
    :content="{ onCloseAutoFocus }"
    :ui="{ overlay: 'z-70', content: 'z-70', footer: 'justify-end' }"
    data-testid="confirm-dialog"
  >
    <template #footer>
      <UButton variant="outline" color="neutral" data-testid="confirm-cancel" @click="settle(false)">
        {{ pending?.cancelLabel }}
      </UButton>
      <UButton
        variant="solid"
        :color="pending?.tone === 'destructive' ? 'error' : 'primary'"
        data-testid="confirm-accept"
        @click="settle(true)"
      >
        {{ pending?.confirmLabel }}
      </UButton>
    </template>
  </UModal>
</template>
