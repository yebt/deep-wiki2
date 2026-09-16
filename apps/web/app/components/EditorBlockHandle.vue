<script setup lang="ts">
/**
 * The one block handle — `⋮⋮` beside the block under the pointer, the
 * way in to moving a block by drag and to its tunes menu. One element
 * that `EditorSurface` moves to whichever block is hovered, never a
 * decoration per block (docs/TODO.md Findings 2026-09-16, "the `/mount`
 * API": the Tiptap approach, which re-decorates nothing on a
 * transaction). It lives outside the contenteditable, so ProseMirror
 * never sees its `dragstart`; the surface bridges the drag through
 * `startBlockDrag`/`endBlockDrag` (`block-drag.ts`).
 *
 * Presentational, like `MentionMenu`: the owner decides where it stands
 * and what its menu offers (`utils/block-tunes.ts`); this holds what the
 * handle *is*:
 *
 * - a 24px target (docs/UI-CHECKLIST.md §5), icon-only, so it carries an
 *   accessible name and a tooltip, and the tooltip states both the keys
 *   that open the menu and the keys that move a block without a drag —
 *   every pointer-only manipulation has a stated keyboard equivalent
 *   (§5);
 * - the trigger of a `UDropdownMenu` (Reka: focus moved in, arrows,
 *   Escape, `aria-*` wiring — §4.1's primitive, not a hand-rolled list),
 *   whose unavailable items stay in the menu `aria-disabled` with their
 *   reason as the visible description (§3, §5);
 * - draggable — a press-and-move drags the block, a plain click opens
 *   the menu; Reka's trigger opens on `click`, which a drag never fires.
 *
 * Quiet until needed (§4.4, chrome quieter than content): the owner
 * renders it only while a block is hovered or its menu is open, so the
 * measure column carries no permanent chrome. Out of the tab order
 * (`tabindex="-1"`): the keyboard reaches the same menu from the caret's
 * block with the shortcut the tooltip names, so a long page does not
 * gain a stop per block.
 */
import type { DropdownMenuItem } from '@nuxt/ui';
import type { TunesItem } from '~/utils/block-tunes';

const props = defineProps<{
  /** Offset from the owner's top edge, in px: the block's first line, centred on the handle. */
  top: number;
  /** The tunes, from `blockTunesMenu`. */
  items: readonly (readonly TunesItem[])[];
  /** The platform's modifier as text (`Control` / `Meta`) for `aria-keyshortcuts`; the tooltip renders the platform's glyph itself. */
  modifierName: string;
}>();

const open = defineModel<boolean>('open', { default: false });

const emit = defineEmits<{
  /** The handle's own `dragstart`: the owner starts the block drag with this event's `dataTransfer`. */
  dragStart: [event: DragEvent];
  /** The handle's `dragend`: the owner clears a drag no drop consumed. */
  dragEnd: [];
  /** The menu closed: the owner focuses the editor rather than letting focus return here. */
  closed: [];
  pointerEnter: [];
  pointerLeave: [];
}>();

/** Reka would return focus to the handle; the owner takes it back to the editor. */
function onCloseAutoFocus(event: Event): void {
  event.preventDefault();
  emit('closed');
}

const menuItems = computed<DropdownMenuItem[][]>(() => props.items.map((group) => group.map(toMenuItem)));

function toMenuItem(item: TunesItem): DropdownMenuItem {
  return {
    label: item.label,
    icon: item.icon,
    disabled: item.disabled,
    description: item.description,
    kbds: item.kbds,
    children: item.children?.map(toMenuItem),
    onSelect: item.disabled ? undefined : item.onSelect,
  };
}
</script>

<template>
  <!-- From `md` up the handle stands in the margin the centred column
       leaves free, 8px off the text; below `md` there is no margin (16px
       at 320), so it stands inside the column's left edge while it
       shows — over the first glyphs, the way the comment gutter's marks
       stand inside the column there (`CommentGutter`) — and reads as a
       chip floating over the text: the menu rung with elevation 1, the
       shadow §4.3 allows a transient floating control. Not a permanent
       cost: it is up only while hovered, dragging or its menu is open. -->
  <div
    class="absolute max-md:left-0 md:-left-8 max-md:rounded-md max-md:bg-accented max-md:shadow-sm max-md:ring max-md:ring-default"
    :style="{ top: `${top}px` }"
    data-testid="block-handle"
    @pointerenter="emit('pointerEnter')"
    @pointerleave="emit('pointerLeave')"
  >
    <!-- The menu on the menu rung (`bg-accented`, §9.6), capped at what
         the popper reports free so a reason wraps rather than running
         the menu off a 320 screen (the tree's own fix, 2026-09-16). -->
    <UDropdownMenu
      v-model:open="open"
      :items="menuItems"
      :content="{ side: 'bottom', align: 'start', collisionPadding: 8, onCloseAutoFocus }"
      :ui="{ content: 'bg-accented max-w-(--reka-dropdown-menu-content-available-width)', itemDescription: 'whitespace-normal' }"
    >
      <UTooltip text="Block options — drag to move, or Alt with the arrow keys" :kbds="['meta', '/']">
        <UButton
          icon="i-lucide-grip-vertical"
          size="xs"
          square
          variant="ghost"
          color="neutral"
          draggable="true"
          tabindex="-1"
          aria-label="Block options"
          :aria-keyshortcuts="`${modifierName}+/`"
          class="cursor-grab active:cursor-grabbing"
          @dragstart="emit('dragStart', $event)"
          @dragend="emit('dragEnd')"
        />
      </UTooltip>
    </UDropdownMenu>
  </div>
</template>
