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
 *
 * **The typed-name step** (design.md Decision 8, 2026-09-18). A question
 * asked with `confirmText` — "Delete “Handbook”?", the owner's
 * force-delete of a container with pages in it — renders a labelled
 * `UFormField` ("Type *Handbook* to confirm") over a `UInput` at the
 * content-area field's own metrics (16px, `h-14`, §9.5), and focus lands
 * on the field instead of on Cancel: the match is the consent, so a
 * stray Enter cannot agree. The confirm action is `aria-disabled` with
 * "Type the name exactly as shown." — on hover, on focus and in the
 * accessibility tree (checklist §3 "Disabled", §5: never the attribute,
 * which leaves the tab order) — until the trimmed value equals the name
 * exactly, case and all; Enter in the field agrees only then. A "yes"
 * the server refuses (`useConfirm`'s `onConfirm`: the count changed, the
 * name changed) keeps this same dialog open — the refusal under the
 * field, associated and announced (§5), the new consequence in the
 * description, focus back on the field — never a second dialog.
 */
const { pending, settle, accept } = useConfirm();

/** What the person has typed against `confirmText`; reset with every question. */
const typed = ref('');
/** A refusal the last "yes" met, under the field. */
const fieldError = ref<string | null>(null);
/** The consequence, when the server's refusal changed it. */
const descriptionOverride = ref<string | null>(null);
/** `onConfirm` in flight: the action is busy, a second press does nothing. */
const busy = ref(false);
const fieldInput = ref<{ inputRef?: HTMLInputElement | null } | null>(null);

const description = computed(() => descriptionOverride.value ?? pending.value?.description ?? undefined);
/** No name to type, or the name typed exactly: whitespace around it is forgiven, its case is not. */
const matches = computed(() => pending.value?.confirmText === null || typed.value.trim() === pending.value?.confirmText);
const canAccept = computed(() => matches.value && !busy.value);
const ACCEPT_REASON_ID = 'dw-confirm-accept-reason';

async function onAccept(): Promise<void> {
  if (!canAccept.value) return;
  busy.value = true;
  try {
    const refusal = await accept(typed.value.trim());
    if (!refusal) return;
    fieldError.value = refusal.fieldError ?? null;
    if (refusal.description) descriptionOverride.value = refusal.description;
    fieldInput.value?.inputRef?.focus();
  } finally {
    busy.value = false;
  }
}

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
    if (id !== previous) {
      typed.value = '';
      fieldError.value = null;
      descriptionOverride.value = null;
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
    :description="description"
    :close="false"
    :content="{ onCloseAutoFocus }"
    :ui="{ overlay: 'z-70', content: 'z-70', footer: 'justify-end' }"
    data-testid="confirm-dialog"
  >
    <!-- The typed-name field, only when the question asks for one. The
         name stands in the label itself, emphasised, so the person reads
         what to type where they type it; `autofocus` is what Reka's
         dialog honours for its initial focus. A refusal is the field's
         error — `UFormField` associates and the change is announced. -->
    <template v-if="pending?.confirmText !== null" #body>
      <UFormField :error="fieldError ?? undefined" data-testid="confirm-text-field">
        <template #label>
          Type <span class="font-medium text-highlighted">{{ pending?.confirmText }}</span> to confirm
        </template>
        <UInput
          ref="fieldInput"
          v-model="typed"
          class="w-full"
          autocomplete="off"
          autocapitalize="off"
          spellcheck="false"
          autofocus
          data-testid="confirm-text"
          @keydown.enter.prevent="onAccept"
        />
      </UFormField>
    </template>
    <template #footer>
      <UButton variant="outline" color="neutral" data-testid="confirm-cancel" @click="settle(false)">
        {{ pending?.cancelLabel }}
      </UButton>
      <!-- Unavailable until the name matches: `aria-disabled` with the
           reason on hover, on focus and by `aria-describedby`, never the
           attribute (checklist §3, §5). One button throughout — the
           tooltip is switched off once the name matches, so the element
           the person is looking at is never swapped under them. -->
      <UTooltip text="Type the name exactly as shown." :disabled="matches">
        <UButton
          variant="solid"
          :color="pending?.tone === 'destructive' ? 'error' : 'primary'"
          :loading="busy"
          :aria-disabled="!canAccept || undefined"
          :aria-describedby="matches ? undefined : ACCEPT_REASON_ID"
          data-testid="confirm-accept"
          @click="onAccept"
        >
          {{ pending?.confirmLabel }}
        </UButton>
      </UTooltip>
      <p v-if="pending?.confirmText !== null" :id="ACCEPT_REASON_ID" class="sr-only">Type the name exactly as shown.</p>
    </template>
  </UModal>
</template>
