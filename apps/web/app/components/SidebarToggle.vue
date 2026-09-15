<script setup lang="ts">
/**
 * Focus mode's control: hides the sidebar to nothing, and brings it back.
 *
 * The owner asked for "a toggle for the sidebar, for a cleaner
 * interaction with the document" — and the document alone, not a rail of
 * icons (docs/UI-CHECKLIST.md Review Log, 2026-09-15). It stands in the
 * content pane's bar, at the sidebar's edge, where the drawer's own
 * toggle stands below `lg`; above `lg` this is the one that shows, and
 * below it is hidden, because there the sidebar is a drawer either way
 * and this would be a control that does nothing (§6).
 *
 * Icon-only, so both halves of §4.3: an accessible name and a tooltip.
 * The name says what the next press does — "Hide sidebar" / "Show
 * sidebar" — and the tooltip shows the keys. Those keys are `Ctrl`/`⌘`+`\`:
 * Notion's binding for exactly this, the default Obsidian's users ask for
 * (Obsidian ships it unbound), and a chord no editor claims — `Ctrl+B`,
 * VS Code's, is bold in every text field this product has. `usingInput`
 * so it works from the editor too, the way Notion's does. The state
 * change is announced in a live region that is always in the DOM and
 * only changes text (§5), and the announcement names the keys, because
 * a hidden control's shortcut is the one thing a person cannot see.
 *
 * When the sidebar hides while focus is inside it, focus would fall to
 * the body — the browser drops it some time after the pane goes
 * `display: none`, not at once — so where focus *was* is read before the
 * toggle, and it is moved to the content bar, the same place the skip
 * link lands.
 */
const { collapsed, toggle } = useFocusMode();
const { getKbdKey } = useKbd();

const announcement = ref('');
/** The platform's modifier as text, for the announcement and `aria-keyshortcuts`. Set on mount: the platform is the client's. */
const modifierName = ref('Control');
onMounted(() => {
  modifierName.value = /Macintosh;/.test(navigator.userAgent) ? 'Meta' : 'Control';
});

const label = computed(() => (collapsed.value ? 'Show sidebar' : 'Hide sidebar'));

/** The sidebar's own element id: the frame's storage key, then `WorkspaceSidebar`'s `id`. */
const SIDEBAR_ELEMENT_ID = 'dw-frame-sidebar-workspace';

function onToggle(): void {
  const focusWasInSidebar = Boolean(document.activeElement?.closest(`#${SIDEBAR_ELEMENT_ID}`));
  toggle();
  const modifier = getKbdKey('meta');
  announcement.value = collapsed.value ? `Sidebar hidden. Press ${modifier}\\ to show it.` : 'Sidebar shown.';
  if (collapsed.value && focusWasInSidebar) {
    void nextTick(() => document.getElementById('content-bar')?.focus());
  }
}

defineShortcuts({
  'meta_\\': { usingInput: true, handler: onToggle },
});
</script>

<template>
  <UTooltip :text="label" :kbds="['meta', '\\']">
    <UButton
      size="sm"
      variant="ghost"
      color="neutral"
      square
      :icon="collapsed ? 'i-lucide-panel-left-open' : 'i-lucide-panel-left-close'"
      :aria-label="label"
      :aria-keyshortcuts="`${modifierName}+\\`"
      class="hidden lg:inline-flex"
      @click="onToggle"
    />
  </UTooltip>
  <p role="status" aria-live="polite" class="sr-only">{{ announcement }}</p>
</template>
