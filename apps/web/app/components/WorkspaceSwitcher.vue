<script setup lang="ts">
/**
 * The workspace the person is in, named at the top of the sidebar — and
 * the rare, deliberate way to another one (apps/web/PRODUCT.md: "the
 * workspace is chosen once and everything else happens inside it").
 *
 * A menu rather than a visible list, on purpose: the room's name is the
 * thing that must always be legible, and the other rooms are behind it.
 * `UDropdownMenu` brings the keyboard, focus return and Escape handling a
 * hand-rolled popover would forfeit (docs/UI-CHECKLIST.md §4.1). The
 * directory it lists from is loaded once for the whole app
 * (`useWorkspaceDirectory`), because this control mounts on every screen.
 *
 * When the id is unknown to the directory — the list failed to load, or
 * the workspace is not one the caller may open — the trigger says
 * "Workspace" rather than any other workspace's name: a wrong name on the
 * door is worse than no name.
 */
import type { DropdownMenuItem } from '@nuxt/ui';
import { newWorkspaceUrl, workspaceUrl, workspacesUrl } from '~/utils/routes';

const props = defineProps<{
  /** The workspace the person is in; `null` before one is known. */
  workspaceId: string | null;
  /** Its slug, when known — unused here beyond typing the pair the sidebar carries; the rooms link through the directory's own slugs. */
  workspaceSlug?: string | null;
}>();

const directory = useWorkspaceDirectory();

onMounted(() => {
  void directory.ensure();
});

const currentName = computed(() => (props.workspaceId ? directory.nameOf(props.workspaceId) : null));

const label = computed(() => {
  if (!props.workspaceId) return 'Choose a workspace';
  return currentName.value ?? 'Workspace';
});

const items = computed<DropdownMenuItem[][]>(() => {
  const rooms: DropdownMenuItem[] = directory.workspaces.value.map((workspace) => ({
    label: workspace.name,
    // The one the person is in is marked in words as well as by the check,
    // so the mark survives an icon pack that draws it differently (§4.3).
    icon: workspace.id === props.workspaceId ? 'i-lucide-check' : 'i-lucide-library-big',
    to: workspaceUrl(workspace.slug),
    disabled: workspace.id === props.workspaceId,
  }));
  const doors: DropdownMenuItem[] = [
    { label: 'All workspaces', icon: 'i-lucide-list', to: workspacesUrl() },
    { label: 'New workspace', icon: 'i-lucide-plus', to: newWorkspaceUrl() },
  ];
  return rooms.length > 0 ? [rooms, doors] : [doors];
});
</script>

<template>
  <UDropdownMenu :items="items" :content="{ align: 'start' }" :ui="{ content: 'w-64' }">
    <!-- The trigger is the room's name: `title-medium`, the app bar's
         headline role stepped down one size for a 280px pane (docs/DESIGN-
         SYSTEM.md §2.3). Ghost, so it reads as the name rather than as a
         button until hovered; the chevron says it opens. -->
    <UButton
      variant="ghost"
      color="neutral"
      size="sm"
      class="min-w-0 max-w-full justify-start"
      trailing-icon="i-lucide-chevrons-up-down"
      :ui="{ label: 'truncate text-title-medium text-highlighted', trailingIcon: 'text-muted' }"
    >
      {{ label }}
    </UButton>
  </UDropdownMenu>
</template>
