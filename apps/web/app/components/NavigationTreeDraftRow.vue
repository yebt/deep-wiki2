<script setup lang="ts">
/**
 * The row a creation is typed into, as a real row of the tree.
 *
 * VS Code inserts a placeholder item as a child of the target folder so the
 * tree renders it at that folder's own nesting depth, then puts it into
 * editable mode (`fileActions.ts`'s `openExplorerAndCreate` →
 * `folder.addChild(newStat)`). That is what makes creation show *where* the
 * thing will land, which is the whole reason the owner asked for an inline
 * row rather than a dialog (2026-09-23): in a typed hierarchy "which book
 * does this chapter go in" is the question, and a dialog answers it in
 * words while a row answers it in place.
 *
 * It exists as its own component because the draft appears in two places —
 * at the top level, drawn by `NavigationTree`, and under a row, drawn by
 * `NavigationTreeNode` — and the `treeitem` wrapper around the field is
 * ARIA, not decoration. A second copy of it is the defect
 * docs/UI-CHECKLIST.md §4.1 names.
 *
 * It is not part of the roving tabindex: the tree's one tab stop stays on
 * a real row, the field itself holds focus while it exists, and the arrow
 * keys never land on a row that is a text box (`tabindex="-1"`, and
 * `NavigationTree`'s `visible` list does not contain it).
 */
import type { TreeRowEditorBinding } from '~/composables/useTreeRowEditor';

defineProps<{
  editor: TreeRowEditorBinding;
  /** The indent, as `NavigationTreeNode` computes it: 0 at the top level. */
  depth: number;
  /** Where the row stands among its new siblings, for the ARIA tree. */
  posinset: number;
  setSize: number;
}>();
</script>

<template>
  <li
    role="treeitem"
    :aria-level="depth + 1"
    :aria-posinset="posinset"
    :aria-setsize="setSize"
    :aria-selected="false"
    tabindex="-1"
    data-testid="tree-draft-row"
    class="dw-tree-item"
  >
    <NavigationTreeRowEditor
      :snapshot="editor.snapshot"
      :depth="depth"
      @update:value="editor.setValue"
      @commit="editor.commit"
      @cancel="editor.cancel"
    />
  </li>
</template>
