<script setup lang="ts">
/**
 * The floating toolbar over a text selection — Notion's bubble, the
 * only formatting chrome the editor has, and only while there is a
 * range to format: the document stays the primary surface and the
 * tools appear when they are needed (apps/web/PRODUCT.md, principle 6).
 *
 * Presentational, like `MentionMenu`: `EditorSurface` owns when it shows
 * (a non-empty text selection while the editor or this toolbar has
 * focus) and where (`positionToolbar` from the selection plugin's
 * coordinates), and runs every command through the `EditorHandle` so a
 * button and `Mod-b` share one `toggleMark` (`editor-commands.ts`). This
 * component holds what the toolbar *is*:
 *
 * - a named `role="toolbar"` with the WAI-ARIA toolbar keyboard contract
 *   — one tab stop, arrow keys between the controls, Home/End, Escape back
 *   to the editor (docs/UI-CHECKLIST.md §4.1: a hand-rolled primitive owes
 *   the keyboard and ARIA contract; §4.6: Escape returns to the editor);
 * - icon-only controls, so each has a name and a tooltip, the two with a
 *   keystroke naming it (§4.3);
 * - the pressed state as `aria-pressed` plus M3's selected fill —
 *   `secondary-container`, opaque, the same in both themes — never colour
 *   alone (§5; docs/DESIGN-SYSTEM.md §5.2: a container fill is for
 *   selected/active, a state layer for hover/press);
 * - `mousedown` cancelled on every control, so a click never moves focus
 *   out of the editor and the selection it formats stays put — the same
 *   wire the menus use.
 *
 * The link control is the one that needs input, so it opens a `UPopover`
 * (Reka: focus moved in, trapped, Escape closes) with a labelled URL
 * field; Enter applies, and inside an existing link the field is
 * prefilled and "Remove link" is offered. The popover is the one moment
 * focus legitimately leaves the editor; the owner keeps the toolbar up
 * while it is open and takes focus back when it closes.
 *
 * `bg-accented`, `rounded-md`, `shadow-lg`: the menu rung and the control
 * radius (§9.6, §3.4), exactly as the two editor menus beside it.
 */
import type { EditorMountModule } from '~/utils/editor-mount';

/** The toolbar marks, read off the loader's module type: `scripts/checks/bundle-isolation.ts` sweeps every static `@deep-wiki/editor/mount` specifier, `import type` included. */
type ToolbarMarkName = EditorMountModule['TOOLBAR_MARKS'][number];
/** The four toggles, in button order (`TOOLBAR_MARKS` minus `link`, which is set with an address rather than toggled). */
type ToggleName = Exclude<ToolbarMarkName, 'link'>;

const props = defineProps<{
  /** Per toolbar mark: active across the whole range (`selectionSnapshot`). */
  marks: Readonly<Record<ToolbarMarkName, boolean>>;
  /** The link the range sits in, prefilled into the field; `null` when there is none. */
  link: { readonly href: string; readonly title: string | null } | null;
  /** Viewport coordinates (`position: fixed`), from `positionToolbar`. */
  position: { readonly top: number; readonly left: number };
}>();

const emit = defineEmits<{
  toggle: [name: ToggleName];
  setLink: [href: string];
  unsetLink: [];
  /** Escape: the owner focuses the editor. */
  close: [];
  /** The link popover opened or closed — while open, the owner keeps the toolbar up though the editor has lost focus. */
  linkOpen: [open: boolean];
}>();

interface ToggleControl {
  readonly name: ToggleName;
  readonly label: string;
  readonly icon: string;
  readonly kbds?: string[];
}

const TOGGLES: readonly ToggleControl[] = [
  { name: 'strong', label: 'Bold', icon: 'i-lucide-bold', kbds: ['meta', 'B'] },
  { name: 'emphasis', label: 'Italic', icon: 'i-lucide-italic', kbds: ['meta', 'I'] },
  { name: 'delete', label: 'Strikethrough', icon: 'i-lucide-strikethrough' },
  { name: 'inlineCode', label: 'Code', icon: 'i-lucide-code' },
];

/** Every control in tab order: the four toggles, then the link. */
const CONTROL_COUNT = TOGGLES.length + 1;
const focusIndex = ref(0);
const rootEl = ref<HTMLElement | null>(null);

function controls(): HTMLElement[] {
  return Array.from(rootEl.value?.querySelectorAll<HTMLElement>('button') ?? []);
}

function focusControl(index: number): void {
  const next = (index + CONTROL_COUNT) % CONTROL_COUNT;
  focusIndex.value = next;
  controls()[next]?.focus();
}

/** The WAI-ARIA toolbar pattern: arrows move within, Home/End jump, Escape leaves. */
function onKeydown(event: KeyboardEvent): void {
  switch (event.key) {
    case 'ArrowRight':
      focusControl(focusIndex.value + 1);
      break;
    case 'ArrowLeft':
      focusControl(focusIndex.value - 1);
      break;
    case 'Home':
      focusControl(0);
      break;
    case 'End':
      focusControl(CONTROL_COUNT - 1);
      break;
    case 'Escape':
      emit('close');
      break;
    default:
      return;
  }
  event.preventDefault();
}

const linkOpen = ref(false);
const href = ref('');

watch(linkOpen, (open) => {
  if (open) href.value = props.link?.href ?? '';
  emit('linkOpen', open);
});

function applyLink(): void {
  const address = href.value.trim();
  linkOpen.value = false;
  if (!address) return;
  emit('setLink', address);
}

function removeLink(): void {
  linkOpen.value = false;
  emit('unsetLink');
}

/** Reka would return focus to the Link button; the owner takes it back to the editor instead. */
function onLinkCloseAutoFocus(event: Event): void {
  event.preventDefault();
  emit('close');
}

defineExpose({
  /** The keyboard's way in (`Ctrl`/`⌘`+`Shift`+`.` from the editor): the first control. */
  focus: () => focusControl(0),
});
</script>

<template>
  <div
    ref="rootEl"
    role="toolbar"
    aria-label="Text formatting"
    aria-orientation="horizontal"
    data-testid="selection-toolbar"
    class="fixed z-10 flex items-center gap-1 rounded-md bg-accented p-1 shadow-lg ring ring-default"
    :style="{ top: `${position.top}px`, left: `${position.left}px` }"
    @keydown="onKeydown"
  >
    <UTooltip v-for="(control, index) in TOGGLES" :key="control.name" :text="control.label" :kbds="control.kbds">
      <UButton
        :icon="control.icon"
        size="sm"
        square
        :variant="marks[control.name] ? 'soft' : 'ghost'"
        :color="marks[control.name] ? 'secondary' : 'neutral'"
        :aria-label="control.label"
        :aria-pressed="marks[control.name] ? 'true' : 'false'"
        :tabindex="index === focusIndex ? 0 : -1"
        @mousedown.prevent
        @focus="focusIndex = index"
        @click="emit('toggle', control.name)"
      />
    </UTooltip>
    <!-- Capped at what the popper reports free, so at 320 the field
         wraps inside the viewport rather than running off it (§6). -->
    <UPopover
      v-model:open="linkOpen"
      :content="{ side: 'bottom', align: 'end', collisionPadding: 8, onCloseAutoFocus: onLinkCloseAutoFocus }"
      :ui="{ content: 'max-w-(--reka-popover-content-available-width)' }"
    >
      <UTooltip text="Link">
        <UButton
          icon="i-lucide-link"
          size="sm"
          square
          :variant="marks.link ? 'soft' : 'ghost'"
          :color="marks.link ? 'secondary' : 'neutral'"
          aria-label="Link"
          aria-haspopup="dialog"
          :aria-pressed="marks.link ? 'true' : 'false'"
          :tabindex="focusIndex === TOGGLES.length ? 0 : -1"
          @mousedown.prevent
          @focus="focusIndex = TOGGLES.length"
        />
      </UTooltip>
      <template #content>
        <!-- The field is chrome, not a form on the document canvas: `h-10`,
             the tree filter's height for a field standing in chrome
             (docs/DESIGN-SYSTEM.md §14, 2026-09-16), with its 16px text
             kept (§9.5). Apply is the popover's one filled action; Remove
             link, when offered, is Outlined beside it (§9.1). -->
        <form class="flex w-72 max-w-full flex-col gap-3 p-3" @submit.prevent="applyLink">
          <UFormField label="Link URL" name="href">
            <UInput v-model="href" type="url" autofocus placeholder="https://" :ui="{ base: 'h-10' }" class="w-full" />
          </UFormField>
          <div class="flex justify-end gap-2">
            <UButton v-if="link" type="button" variant="outline" color="neutral" size="sm" @click="removeLink">Remove link</UButton>
            <UButton type="submit" variant="solid" color="primary" size="sm">Apply</UButton>
          </div>
        </form>
      </template>
    </UPopover>
  </div>
</template>
