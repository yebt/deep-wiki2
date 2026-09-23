<script setup lang="ts">
/**
 * The page's title, edited where it is read (owner decision, 2026-09-23:
 * "El title, se edita y es el mismo title del page, como en obsidian").
 *
 * ── What this is, and what it deliberately is not ──────────────────────
 *
 * It is the page's own `<h1>` — the same heading block read and edit mode
 * already render (`PageHeading`, so the rhythm and the type role are
 * stated once) — with the name editable in place and a rename behind it.
 * It is **not** the title moved into the markdown body: a page's title is
 * `nodes.title` (docs/SPECS.md), the body is the document's canonical
 * bytes, and putting the one inside the other would rewrite every page in
 * the workspace and change what every anchor and every GATE-2 fixture is
 * about. That argument is recorded in `docs/TODO.md` Open Questions,
 * 2026-09-23, for the owner rather than taken here.
 *
 * ── Two ways in, one field ─────────────────────────────────────────────
 *
 * The title itself is clickable, as it is in Obsidian, and a pencil
 * beside it is the keyboard's way in — drawn quiet and revealed on hover
 * or focus, the comment gutter's own treatment for a control that stands
 * beside content (§4.4: chrome is quieter than content), and never
 * removed from the tab order (§5). Both open the same field.
 *
 * ── The field ──────────────────────────────────────────────────────────
 *
 * A plain `<input>` inside the `<h1>`, at the heading's own type role,
 * with no box: this is the document's title, the same object as the text
 * below it, and the reviewed precedent for a text surface that *is* the
 * document is the source view's text area — the caret in `primary` is the
 * focus indicator (`docs/DESIGN-SYSTEM.md` §14, 2026-09-17; WCAG 2.4.7
 * counts the text cursor for a text field). It stands inside the heading
 * rather than replacing it so the screen keeps exactly one `<h1>` in
 * every state it has (§4.4), and it carries its own accessible name
 * because a heading is not a label.
 *
 * Enter renames, Escape cancels and returns focus to the control that
 * opened the field (§5), and moving focus away commits what is typed —
 * Obsidian's own behaviour, and the reason `commit()` is guarded against
 * running twice.
 *
 * ── Optimistic, and refused two ways ───────────────────────────────────
 *
 * The new name is the page's name at once — heading, breadcrumb and tab
 * title together, through `update:title` — and only a refusal puts the
 * old one back (`usePageTitle`). A name already taken reopens the field
 * with the typed text and the server's sentence, wired to the field with
 * `aria-describedby`; anything typing cannot fix stands under the
 * heading as the same `error-container` chip the tree's row editor uses
 * for the same refusal. Both are announced (`role="alert"`).
 *
 * ── The standing gap ───────────────────────────────────────────────────
 *
 * No per-node `write` signal reaches the client (`docs/TODO.md` Open
 * Questions, 2026-09-14), so the field is offered to a caller who may
 * only read and the server refuses them — exactly as the app bar's
 * "Edit" and the empty state's "Start editing" already do. Fixing it here
 * alone would make this control disagree with the two beside it.
 */
import { keysStaledByRename, pageReadKey } from '~/utils/api-keys';
import type { RenamedNode } from '~/composables/useTree';

const props = withDefaults(
  defineProps<{
    nodeId: string;
    /**
     * The name the screen's own response carries. Never the optimistic
     * one — this component owns that, and reports it back through
     * `update:title`; feeding it in again would make a refusal unable to
     * restore anything.
     */
    title: string;
    /** The workspace whose tree holds the row to patch; `null` until the screen knows it. */
    workspaceId?: string | null;
    /** Off while the screen is in a state that has no name to change (a refusal, a skeleton). */
    editable?: boolean;
  }>(),
  { workspaceId: null, editable: true },
);

const emit = defineEmits<{
  /** The name to show everywhere else on the screen: optimistic, then the server's, or the old one back. */
  'update:title': [title: string];
}>();

const fieldId = useId();
const errorId = `${fieldId}-error`;
const hintId = `${fieldId}-hint`;
const openerId = `${fieldId}-rename`;

const tree = useWorkspaceTree(() => props.workspaceId);

const title = usePageTitle({
  nodeId: props.nodeId,
  onRenamed: (renamed: RenamedNode) => {
    // The row the sidebar draws is patched from the answer that renamed
    // it, never refetched (`useTree`'s optimistic writes, 2026-09-16).
    tree.applyRenamed(renamed);
    // The reads that carry the old name, in the two ways they have to be
    // treated differently: the lists on *other* screens are cleared, and
    // this page's own read — which the screen under this heading may be
    // rendering right now — is refreshed in place, so the article stays
    // while the request is in flight. Clearing it instead empties
    // `useApiRead`'s outcome and puts the screen back on its skeleton
    // (that helper's own note).
    clearNuxtData(keysStaledByRename());
    void refreshNuxtData(pageReadKey(props.nodeId));
  },
});

const shown = computed(() => title.shownTitle(props.title));
watch(shown, (value) => emit('update:title', value));

const field = ref<HTMLInputElement | null>(null);

async function begin(): Promise<void> {
  if (!props.editable || title.editing.value) return;
  title.start(shown.value);
  await nextTick();
  field.value?.focus();
  // The whole name, as a rename opens in the tree's row (`VS Code
  // selects a file's basename and a directory's whole name; a wiki title
  // has no extension to exclude`).
  field.value?.select();
}

/**
 * Escape returns focus to the control that opened the field (§5). The
 * control is read out of the document by its id rather than held in a
 * ref, because it is behind the same `v-if` the field is: while the
 * field is open the control does not exist, and it is the one that comes
 * back a tick later.
 */
function returnFocus(): void {
  document.getElementById(openerId)?.focus();
}

function cancel(): void {
  title.cancel();
  void nextTick(returnFocus);
}

function commit(): void {
  void title.commit();
}
</script>

<template>
  <PageHeading :heading="shown">
    <template #default>
      <!-- `.dw-title-editor` is the caret in `primary` and no outline
           (`main.css` §13), the same indicator the source view's text
           area takes for the same reason. -->
      <input
        v-if="title.editing.value"
        :id="fieldId"
        ref="field"
        class="dw-title-editor w-full min-w-0 border-0 bg-transparent p-0 text-headline-medium text-highlighted"
        data-testid="page-title-field"
        :value="title.value.value"
        aria-label="Title of this page"
        :aria-describedby="title.error.value ? errorId : hintId"
        :aria-invalid="title.error.value ? 'true' : undefined"
        autocomplete="off"
        spellcheck="false"
        @input="title.setValue(($event.target as HTMLInputElement).value)"
        @keydown.enter.prevent.stop="commit"
        @keydown.escape.prevent.stop="cancel"
        @blur="commit"
      >
      <!-- The name itself opens the field, as it does in Obsidian. A
           `<span>`, not a control: the heading is not a button, and the
           keyboard's way in is the named control beside it. -->
      <span v-else :class="editable ? 'cursor-text' : undefined" data-testid="page-title-text" @click="begin">{{ shown }}</span>
    </template>

    <template #trailing>
      <!-- Icon-only, so a name and a tooltip both (§4.3); 32px, above the
           24px target floor (§5); quiet until the heading is hovered or
           it is focused, never hidden from the tab order — the comment
           gutter's "+" treatment (2026-09-16). -->
      <UTooltip v-if="editable && !title.editing.value" text="Rename this page">
        <UButton
          :id="openerId"
          icon="i-lucide-pencil"
          variant="ghost"
          color="neutral"
          size="sm"
          square
          aria-label="Rename this page"
          data-testid="page-title-rename"
          class="shrink-0 opacity-0 transition-opacity duration-150 ease-standard group-hover/heading:opacity-100 hover:opacity-100 focus-visible:opacity-100"
          @click="begin"
        />
      </UTooltip>
    </template>

    <template #under>
      <!-- A refusal the person can fix by typing stands under the field
           and is read as part of it (`aria-describedby`); one they
           cannot stands under the heading on its own. Same chip, same
           `error-container` pair, as the tree's row editor (§14,
           2026-09-23). -->
      <p
        v-if="title.error.value"
        :id="errorId"
        role="alert"
        data-testid="page-title-error"
        class="mt-2 rounded-md bg-error-container px-3 py-2 text-body-small text-on-error-container"
      >
        {{ title.error.value }}
      </p>
      <p :id="hintId" class="sr-only">Press Enter to rename this page, or Escape to cancel.</p>
    </template>
  </PageHeading>
</template>
