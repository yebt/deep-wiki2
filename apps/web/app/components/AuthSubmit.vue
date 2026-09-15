<script setup lang="ts">
/**
 * The submit control for the four authentication forms — and the guard on
 * the window between the server rendering the form and this page hydrating.
 *
 * ## The defect
 *
 * A server-rendered `<form>` whose submit button is already a submit button
 * is fully operable before a single line of Vue has run. Pressing it makes
 * the browser do what the HTML says: a native submit to the page's own URL.
 * The server answers with the same screen, fields empty, nothing logged —
 * which is indistinguishable from a rejected password. Measured on the dev
 * server, cold hydration of `/login` took **8–17 seconds**; Chromium hit the
 * window on every run, Firefox hydrated fast enough to miss it. A production
 * build closes most of it, but "most" is not a guard, and the worst screen to
 * lose this way is `/invite/accept`, whose token is single-use.
 *
 * ## The guard, and the rule that chose it
 *
 * Until this subtree is mounted the control is **not a submit control**:
 * `type="button"`. That is the part that actually stops the browser, because
 * it is true of the markup itself and needs nothing to have run. A form with
 * no submit control cannot be submitted — not by the button, not by Enter in
 * a field — so nothing is posted and nothing the user typed is cleared.
 *
 * Everything else about the state follows `docs/UI-CHECKLIST.md`:
 *
 * - **§3, "Disabled":** every disabled control explains why, in one sentence;
 *   a disabled button with no reason is its own defect. The reason is the
 *   control's own label, so it is legible with no hover, no focus, and no
 *   JavaScript — it is in the server's bytes.
 * - **§5:** a control that is unavailable *and carries an explanation* uses
 *   `aria-disabled`, never the `disabled` attribute, because the attribute
 *   removes it from the tab order and puts the explanation behind a hover a
 *   keyboard user cannot perform. Nuxt UI already styles `aria-disabled`
 *   (`aria-disabled:opacity-75`, `aria-disabled:cursor-not-allowed`), so the
 *   unavailable *appearance* comes from the same tokens as `disabled` and
 *   holds in both themes.
 * - **§3, "No layout shift on load":** the label is the only thing that
 *   changes. The button is `block`, and `app.config.ts` pins its height at
 *   `min-h-10` (§7.2), so the box is identical on both sides of hydration —
 *   the same element, the same classes, a different word inside it.
 *
 * ## Why there is also a `<noscript>`, and why it comes first
 *
 * "Not hydrated yet" and "will never hydrate" render identically, and a
 * visitor with JavaScript switched off would otherwise sit forever in front
 * of a control that has told them it is nearly ready. `<noscript>` is the one
 * element that can tell the two apart. It costs the hydrated page nothing —
 * the UA stylesheet gives it `display: none` whenever scripting is enabled,
 * which is why it carries no display utility of its own — and it holds a
 * single text child on purpose: a browser that *is* running scripts parses
 * `<noscript>`'s contents as raw text, so any element inside it would be a
 * hydration mismatch. It precedes the button so that the button stays the
 * form's last child: `UAuthForm`'s `space-y-6` pads every child but the
 * last, and a hidden element after the button had left 24px of dead space
 * under the primary action in every card.
 */
const props = defineProps<{
  /** The action in the user's words — "Sign in", "Join workspace". */
  label: string;
  /** True while the request this form started is in flight. */
  loading?: boolean;
}>();

/**
 * False on the server, false through the client's first (hydrating) render,
 * and true from the moment this subtree is mounted — which is the moment the
 * `<form>` above it acquired the Vue submit handler that makes submitting it
 * safe. Deliberately local to this component rather than a global "is the app
 * hydrating" flag: the question is whether *this* form can handle a submit.
 */
const ready = ref(false);
onMounted(() => {
  ready.value = true;
});

const label = computed(() => (ready.value ? props.label : 'Preparing the form…'));
</script>

<template>
  <!-- `<noscript>` comes *before* the button, and the button closes the
       form. `UAuthForm`'s form is `space-y-6`, which pads every child but
       the last; with `<noscript>` last, the button carried 24px of dead
       space under it in every card (measured 2026-09-15). A scriptless
       browser reads the explanation, then meets the control it explains. -->
  <noscript class="text-body-medium text-muted">This form needs JavaScript, and this browser is not running any. Turn it on for this site to continue.</noscript>
  <UButton
    :type="ready ? 'submit' : 'button'"
    :label="label"
    :loading="loading"
    :aria-disabled="ready ? undefined : 'true'"
    block
  />
</template>
