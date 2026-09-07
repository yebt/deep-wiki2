<script setup lang="ts">
/**
 * One recursive level of the navigation tree (navigation-tree spec: "Drag
 * Reorder Writes Back To Position"). `UTree` (Nuxt UI) has no drag-reorder
 * support today, so this is a deliberate, minimal hand-rolled exception
 * to docs/UI-CHECKLIST.md §4.1's "use the library" rule — native HTML5
 * drag-and-drop, not a third-party DnD library, kept to exactly the
 * mechanism the library does not provide.
 *
 * A drop in the top/bottom quarter of a row reorders among THAT ROW's
 * OWN siblings (before/after it) — hence `parentId`/`index` are required
 * props, not derived, since this component has no way to see its own
 * position in its parent's list otherwise. A drop in the middle band
 * reparents under that row, appended at the end of its children. Depth is
 * `depth * 12px` padding (DESIGN-SYSTEM §7.2's tree-indent value); each
 * row is 40px tall (that table's "default" density row height).
 */
import type { TreeNode } from '~/composables/useTree';

const props = defineProps<{
  node: TreeNode;
  depth: number;
  parentId: string;
  index: number;
}>();

const emit = defineEmits<{
  reorder: [payload: { draggedId: string; newParentId: string; newIndex: number }];
}>();

const NODE_ICONS: Record<string, string> = {
  workspace: 'i-lucide-globe',
  shelf: 'i-lucide-library',
  book: 'i-lucide-book',
  chapter: 'i-lucide-folder',
  page: 'i-lucide-file-text',
};

const dropIndicator = ref<'before' | 'after' | 'on' | null>(null);

function onDragStart(event: DragEvent): void {
  event.dataTransfer?.setData('text/plain', props.node.id);
  event.dataTransfer!.effectAllowed = 'move';
}

function onDragOver(event: DragEvent): void {
  event.preventDefault();
  const target = event.currentTarget as HTMLElement;
  const rect = target.getBoundingClientRect();
  const ratio = (event.clientY - rect.top) / rect.height;
  dropIndicator.value = ratio < 0.25 ? 'before' : ratio > 0.75 ? 'after' : 'on';
}

function onDragLeave(): void {
  dropIndicator.value = null;
}

function onDrop(event: DragEvent): void {
  event.preventDefault();
  const draggedId = event.dataTransfer?.getData('text/plain');
  const indicator = dropIndicator.value;
  dropIndicator.value = null;
  if (!draggedId || draggedId === props.node.id) return;

  if (indicator === 'on') {
    emit('reorder', { draggedId, newParentId: props.node.id, newIndex: props.node.children.length });
  } else {
    emit('reorder', { draggedId, newParentId: props.parentId, newIndex: indicator === 'before' ? props.index : props.index + 1 });
  }
}

function onChildReorder(payload: { draggedId: string; newParentId: string; newIndex: number }): void {
  emit('reorder', payload);
}
</script>

<template>
  <li role="treeitem" :aria-level="depth + 1">
    <div
      draggable="true"
      class="dw-state-layer flex h-10 min-h-10 cursor-grab items-center gap-2 rounded-md text-body-large text-default"
      :class="[
        dropIndicator === 'on' ? 'bg-secondary-container text-on-secondary-container' : 'hover:bg-elevated',
        dropIndicator === 'before' && 'border-t-2 border-primary',
        dropIndicator === 'after' && 'border-b-2 border-primary',
      ]"
      :style="{ paddingLeft: `${depth * 12 + 8}px` }"
      @dragstart="onDragStart"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <UIcon :name="NODE_ICONS[node.type] ?? 'i-lucide-file'" class="size-4 shrink-0 text-muted" aria-hidden="true" />
      <span class="truncate" :title="node.title">{{ node.title }}</span>
    </div>
    <ul v-if="node.children.length > 0" role="group">
      <NavigationTreeNode
        v-for="(child, childIndex) in node.children"
        :key="child.id"
        :node="child"
        :depth="depth + 1"
        :parent-id="node.id"
        :index="childIndex"
        @reorder="onChildReorder"
      />
    </ul>
  </li>
</template>
