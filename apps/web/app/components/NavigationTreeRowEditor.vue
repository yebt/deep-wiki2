<script setup lang="ts">
/**
 * The tree's one editable row: a name typed where the row lives.
 *
 * The owner rejected the tree's modal create and rename on 2026-09-23 and
 * asked for VS Code's pattern instead — an input box drawn *in* the row, at
 * the nesting depth the node will have, Enter to confirm and Escape to
 * cancel (`explorerViewer.ts`'s `renderInputBox`, which backs creation and
 * rename alike; this batch's research report has the citation). This
 * component is that box, and it is one component because it is used twice:
 * as a draft row inserted under the parent a creation names, and in place
 * of an existing row's title during a rename. Two copies of a field that
 * owns focus, keys and a refusal is exactly the defect
 * docs/UI-CHECKLIST.md §4.1 names.
 *
 * ── What it owes the tree around it ────────────────────────────────────
 *
 * The tree is an ARIA tree with a roving tabindex, arrow-key movement and
 * Enter to open a page (§5, and `NavigationTreeNode`'s own contract). Every
 * one of those keys is a key a person typing a name will press, so the
 * editor marks itself `data-row-editor` — which `NavigationTreeNode`'s
 * `onKeydown` checks before reporting a press to the tree — and stops the
 * two keys it answers itself. Pointer events are stopped for the same
 * reason: a click in the field is not a click on the row, and a row that
 * is being named is not draggable.
 *
 * ── The field's metrics: it *is* the row ───────────────────────────────
 *
 * The owner's fourth finding of 2026-09-23 was that this field read as "a
 * tall bordered box that dwarfs the row it sits in". It was a `UInput` —
 * M3's text field — so it brought a ring, a fill and a radius into a pane
 * whose thirty other rows draw no boundary at all, and the one row being
 * typed in was the only object on screen with an edge. A `h-10` on the
 * `base` slot had made it the row's *height* without making it the row.
 *
 * So the field is a plain `<input>` that draws nothing: no ring, no
 * border, no fill, no radius, no elevation. Its focus indicator is the
 * caret, in the `primary` role (`main.css` §13, `.dw-row-editor-field`) —
 * the treatment docs/DESIGN-SYSTEM.md §14 already records twice, for the
 * source view's text area (2026-09-17) and the page's title field
 * (2026-09-23), for the same reason each time: a text surface that *is*
 * the thing around it is not a control among controls, and WCAG 2.4.7
 * counts the text cursor as a text field's focus indicator. The indicator
 * is relocated, never removed (checklist §5 is pass/fail on it).
 *
 * `h-10` on the line — 40px, the tree row's own height
 * (docs/DESIGN-SYSTEM.md §7.2) — so nothing above or below it moves when
 * the field appears (§3, "no layout shift"), and the row measures the same
 * 40px before and after. The text keeps §9.5's 16px floor
 * (`text-body-large`) rather than the row's own 14px `body-medium`: below
 * 16px iOS Safari zooms the viewport on focus, which binds every
 * text-entry control, and the source view's 14px code role gave way for
 * exactly that (§14, 2026-09-17).
 *
 * A write in flight is said without a box either: a spinner beside the
 * field and `aria-busy` on it, where `UInput`'s `loading` used to put an
 * icon inside the control's own leading slot.
 *
 * A refusal the person can fix by typing stands *under* the field rather
 * than beside it: 280px of pane has no room beside a 40px field, and the
 * sentence is a whole sentence rather than a truncated one. The field
 * points at it with `aria-describedby`, so it is read as part of the field
 * and not as a stray paragraph (§5).
 *
 * ── The two ways out ───────────────────────────────────────────────────
 *
 * Escape, and a pointerdown anywhere outside the field. Both discard what
 * was typed; the note over `onPointerDownOutside` says why that rather
 * than the commit-on-blur the page's title field takes.
 */
import { NODE_TYPE_ICONS, NODE_TYPE_LABELS } from '~/composables/useTreeRowActions';
import type { EditorSnapshot } from '~/composables/useTreeRowEditor';

const props = defineProps<{
  /** The state machine's one snapshot: what is being named, the phase, the value, the refusal. */
  snapshot: EditorSnapshot;
  /** The indent the row stands at — `NavigationTreeNode`'s `depth * 12 + 8` (DESIGN-SYSTEM §7.2). */
  depth: number;
}>();

const emit = defineEmits<{
  'update:value': [value: string];
  commit: [];
  cancel: [];
}>();

const fieldId = useId();
const errorId = `${fieldId}-error`;
const hintId = `${fieldId}-hint`;

const draft = computed(() => props.snapshot.draft);

/**
 * The name says what is being named, because a screen-reader user hears the
 * field and not the row it stands in (§5, the same reasoning that made the
 * menu's history item "Page history" rather than "History").
 */
const label = computed(() =>
  draft.value.mode === 'create'
    ? `Name of the new ${NODE_TYPE_LABELS[draft.value.type].toLowerCase()}`
    : `Rename “${draft.value.originalTitle}”`,
);

const icon = computed(() => NODE_TYPE_ICONS[draft.value.type] ?? 'i-lucide-file');
const isCommitting = computed(() => props.snapshot.phase === 'committing');

const input = ref<HTMLInputElement | null>(null);

/**
 * The field takes focus the moment it exists, and a rename opens with the
 * whole name selected so typing replaces it — VS Code selects the basename
 * of a file and the whole name of a directory, and a wiki title has no
 * extension to exclude.
 *
 * **Why it insists.** One `focus()` on mount is not enough, and the way it
 * failed is worth writing down: a creation started from the header's type
 * menu mounts this field *while Reka's menu is still open*, and a modal
 * Reka menu marks the rest of the page `inert` — where `focus()` is
 * silently a no-op. Then the menu unmounts, its own focus restore runs,
 * and the field is left showing a cursor it does not have. Measured in the
 * browser on 2026-09-23: the input rendered and stayed `inactive` through
 * thirteen polls (`e2e/tree-writes.spec.ts`).
 *
 * So focus is re-asserted on the next few macrotasks until it lands —
 * bounded, and it stops the moment the field has it. The window is a few
 * milliseconds, far inside the time it takes a person to Tab away
 * deliberately, and the alternative — hanging the creation itself off the
 * menu's own close event — makes the write depend on a library event that
 * does not fire in every environment.
 */
const FOCUS_ATTEMPTS = 5;

onMounted(() => {
  let left = FOCUS_ATTEMPTS;
  const take = (): void => {
    const el = input.value;
    if (!el || document.activeElement === el) return;
    el.focus();
    el.select();
    left -= 1;
    if (left > 0 && document.activeElement !== el) window.setTimeout(take, 0);
  };
  void nextTick(take);
});

/* ─── Clicking away ──────────────────────────────────────────────────────
 * A pointerdown anywhere outside the field cancels, and **the half-typed
 * name is discarded** — byte for byte the outcome Escape already has.
 *
 * The owner reported on 2026-09-23 that only Escape got out of a draft row:
 * a person who changed their mind and clicked elsewhere was left with a
 * field still standing in the tree. Two ways out of one field that
 * disagreed about the typed text would be worse than either, so this is
 * deliberately *not* the commit-on-blur the page's title field takes
 * (`PageTitle`, Obsidian's behaviour for a document's own name). The
 * difference is what the two fields are for: the title field is changing a
 * name that already exists, and a stray click there should not throw the
 * edit away; this field's create half has nothing to go back to, so a
 * commit would silently make a node the person had stopped asking for. VS
 * Code's own input box discards on both roads, and both halves of this
 * field are that one road.
 *
 * `pointerdown` in the **capture** phase, so a click on `New…` while a
 * draft is open cancels the old field before the new one is asked for, and
 * so the decision is taken before any other handler acts on the same
 * gesture. A write already in flight is never abandoned: the state machine
 * ignores a cancel during `committing` (`useTreeRowEditor`), and this
 * returns early rather than leaning on that, so the reason stands where the
 * gesture is read.
 */
const root = ref<HTMLElement | null>(null);

function onPointerDownOutside(event: Event): void {
  if (props.snapshot.phase === 'committing') return;
  const target = event.target as Node | null;
  if (target && root.value?.contains(target)) return;
  emit('cancel');
}

onMounted(() => document.addEventListener('pointerdown', onPointerDownOutside, true));
onBeforeUnmount(() => document.removeEventListener('pointerdown', onPointerDownOutside, true));
</script>

<template>
  <div
    ref="root"
    data-row-editor
    class="flex flex-col gap-1 pe-1"
    :style="{ paddingLeft: `${depth * 12 + 8}px` }"
    @click.stop
    @mousedown.stop
    @dblclick.stop
  >
    <div class="flex h-10 min-h-10 items-center gap-2">
      <!-- The chevron's column, reserved and not drawn: a row being named is
           a field, not a disclosure, and the field must start where the
           title it replaces started. Every row reserves it — a leaf as much
           as a container — which is what makes one level read as one level
           (`NavigationTreeNode`, and DESIGN-SYSTEM §7.2's 12px step). -->
      <span class="size-4 shrink-0" aria-hidden="true" />
      <UIcon :name="icon" class="size-4 shrink-0 text-muted" aria-hidden="true" />
      <!-- `.dw-row-editor-field` is the caret in `primary` and no outline
           (`main.css` §13) — the indicator the source view's text area and
           the page's title field take, for the same reason. The field
           draws nothing else: it is the row, being typed in. -->
      <input
        :id="fieldId"
        ref="input"
        class="dw-row-editor-field min-w-0 flex-1 bg-transparent p-0 text-body-large text-default"
        :value="snapshot.value"
        :aria-label="label"
        :aria-describedby="snapshot.error ? errorId : hintId"
        :aria-invalid="snapshot.error ? 'true' : undefined"
        :aria-busy="isCommitting ? 'true' : undefined"
        autocomplete="off"
        spellcheck="false"
        @input="emit('update:value', ($event.target as HTMLInputElement).value)"
        @keydown.enter.prevent.stop="emit('commit')"
        @keydown.escape.prevent.stop="emit('cancel')"
        @keydown.stop
      >
      <!-- The write is in flight. A spinner beside the field rather than
           inside it, because the field has no inside any more; the words
           are on the field itself, as `aria-busy`. -->
      <UIcon
        v-if="isCommitting"
        data-testid="tree-row-editor-busy"
        name="i-lucide-loader-circle"
        class="size-4 shrink-0 animate-spin text-muted"
        aria-hidden="true"
      />
    </div>

    <!-- A name that is already taken: the server's own sentence, the typed
         text still in the field, and nothing renamed behind the person's
         back (§3 — an error states what failed and offers the next action,
         which here is simply to type a different name). -->
    <p
      v-if="snapshot.error"
      :id="errorId"
      role="alert"
      data-testid="tree-row-editor-error"
      class="rounded-md bg-error-container px-2 py-1 text-body-small text-on-error-container"
    >
      {{ snapshot.error }}
    </p>
    <p :id="hintId" class="sr-only">Press Enter to confirm, or Escape to cancel.</p>
  </div>
</template>
