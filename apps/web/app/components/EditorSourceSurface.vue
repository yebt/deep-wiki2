<script setup lang="ts">
/**
 * The source view of edit mode (owner decision, 2026-09-17, "source mode,
 * like Obsidian"): the same document `EditorSurface` shows live, as the
 * raw markdown a save would write, in a plain text area. The screen
 * (`pages/[id]/edit.vue`) owns the buffer and decides which of the two
 * surfaces shows it (`~/utils/editor-view`); this one only reports every
 * keystroke back, undebounced — the text *is* the markdown, there is
 * nothing to serialise.
 *
 * ── A text area, not CodeMirror, and not `UTextarea` ─────────────────
 *
 * A second editor dependency is a permanent bug class (CLAUDE.md on the
 * parser; the same argument holds for an editor), so this is `<textarea>`
 * and a highlighting layer, if ever wanted, is a future item
 * (docs/TODO.md, 2026-09-17). Nor is it `UTextarea`: the library's
 * text area is a *form field* — a ring, a 56px rhythm, a size variant
 * that bundles padding and font (docs/DESIGN-SYSTEM.md §9.5's ordering
 * trap) — and this is the document, the same object as the
 * contenteditable beside it, which is not a library component either.
 * Checklist §4.1's hand-rolled contract is small here: a text area
 * brings its own keyboard and ARIA, and the two things it lacks — a
 * name and the description of its keys — are supplied below.
 *
 * ── How it is set ─────────────────────────────────────────────────────
 *
 * The code family (`font-mono`) at the reading surface's own metrics
 * (`text-doc-body`, 16px on 26px): §2.3's code role is 14px, but §9.5's
 * 16px floor binds any text-entry control (below it iOS Safari zooms
 * the viewport on focus), and the checklist wins on correctness. Same
 * measure column, same `-m-4 p-4` reach as `EditorSurface`, so the
 * first character stands where the visual view's does. No box: the
 * caret, in `primary`, is the focus indicator (`main.css` §13).
 *
 * ── Keys ──────────────────────────────────────────────────────────────
 *
 * `Tab` inserts two spaces at the caret — markdown's own indent — and a
 * captured `Tab` is a keyboard trap unless the way out is stated, so
 * `Escape` leaves for the contextual bar and the description says so
 * (checklist §5; WCAG 2.1.2). `Shift`+`Tab` is left to the browser.
 */
const props = defineProps<{
  /** The markdown to show. Read once, on mount; the screen keys the component to load a different document. */
  markdown: string;
}>();

const emit = defineEmits<{
  /** The text as it stands after every edit. */
  update: [markdown: string];
}>();

const DESCRIPTION_ID = 'dw-editor-source-keys';
const textarea = ref<HTMLTextAreaElement | null>(null);
const text = ref(props.markdown);

/**
 * The text area grows with its text and never scrolls inside itself:
 * the pane scrolls, as it does for the visual view, so the two views
 * stand on the same page. Measured from `scrollHeight` after every
 * edit — `field-sizing: content` would do it in CSS, and Firefox does
 * not have it yet.
 */
function fit(): void {
  const el = textarea.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

function onInput(event: Event): void {
  text.value = (event.target as HTMLTextAreaElement).value;
  fit();
  emit('update', text.value);
}

function insertAtCaret(el: HTMLTextAreaElement, insertion: string): void {
  const start = el.selectionStart;
  const end = el.selectionEnd;
  el.value = `${el.value.slice(0, start)}${insertion}${el.value.slice(end)}`;
  const caret = start + insertion.length;
  el.setSelectionRange(caret, caret);
  text.value = el.value;
  fit();
  emit('update', text.value);
}

function onKeydown(event: KeyboardEvent): void {
  const el = textarea.value;
  if (!el) return;
  if (event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
    event.preventDefault();
    insertAtCaret(el, '  ');
    return;
  }
  if (event.key === 'Escape') {
    event.preventDefault();
    const bar = document.getElementById('content-bar');
    if (bar) bar.focus();
    else el.blur();
  }
}

onMounted(fit);

defineExpose({
  focus: () => textarea.value?.focus(),
});
</script>

<template>
  <!-- The `-m-4` on the wrapper, not on the text area: a replaced
       element's `w-full` is its container's width, so the 16px reach on
       the right would go missing; a block wrapper with the negative
       margin is 32px wider than the column and the text area fills it.
       `aria-describedby` rather than a visible caption: the keys are
       said once, to the person who reaches the control, and the measure
       column carries no permanent chrome (PRODUCT.md, principle 6). -->
  <div class="-m-4">
    <textarea
      ref="textarea"
      :value="text"
      data-testid="editor-source"
      class="dw-source-editor block min-h-64 w-full resize-none overflow-hidden border-0 bg-transparent p-4 font-mono text-doc-body text-default whitespace-pre-wrap"
      aria-label="Page source"
      :aria-describedby="DESCRIPTION_ID"
      spellcheck="false"
      autocapitalize="off"
      autocomplete="off"
      autocorrect="off"
      @input="onInput"
      @keydown="onKeydown"
    />
    <p :id="DESCRIPTION_ID" class="sr-only">Markdown source of the page. Tab inserts two spaces; press Escape to leave the editor.</p>
  </div>
</template>
