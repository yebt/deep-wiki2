<script setup lang="ts">
/**
 * The navigation tree (navigation-tree spec: only readable nodes,
 * drag-reorder writes back to `position`). A human-gate screen per
 * `execution_mode.human_gates`.
 *
 * Pre-build contract (docs/UI-CHECKLIST.md §2):
 * - Who: any workspace member, most often navigating from the header
 *   brand link while reading or editing a page.
 * - Goal, in their words: "Find a page, put a new one where it belongs,
 *   or fix a name I got wrong."
 * - Single primary action: **create**. Rename is secondary and demoted to
 *   an outlined button; drag reorder stays an in-place manipulation of the
 *   tree itself rather than a submit step, so there is still exactly one
 *   filled action on the screen.
 * - Data needed: the can()-filtered tree this route already returns, plus
 *   `legalChildTypes()` from `@deep-wiki/contracts` — which is the one
 *   `LEGAL_PARENT_TYPES` table the server enforces, not a client copy of
 *   it. Nothing here is designed against data that does not exist.
 * - Non-goals: **no delete** — what becomes of a node's children, its
 *   revisions and its comments is a product decision nobody has made, and
 *   guessing it is worse than not having it (docs/TODO.md). No move by
 *   dialog (the tree already reorders by drag and by Alt+arrow), no
 *   multi-select, no bulk import.
 * - Empty / overflow: a workspace with nothing yet, and a shelf with
 *   hundreds of pages, are both handled below. The empty state now has a
 *   path forward rather than a sentence about one (checklist §3): the
 *   toolbar renders above it, so the first shelf is one button away. The
 *   tree still renders unvirtualized, a recorded scope limit for a
 *   400-page book.
 */
import type { TreeNode } from '~/composables/useTree';

const route = useRoute();
const workspaceId = route.params.workspaceId as string;

const { status, nodes, rootId, message, load, reorder } = useTree(workspaceId);

onMounted(() => {
  void load();
});

const reorderError = ref<string | null>(null);

/**
 * A create or a rename re-reads the tree rather than splicing the new row
 * in locally. The server decides position, slug and — through `can()` —
 * whether the row is even visible to this viewer, so a locally-inserted
 * node would be a guess about three separate server-side facts.
 */
async function onTreeChanged(): Promise<void> {
  await load();
}

async function onReorder(payload: { draggedId: string; newParentId: string; newIndex: number }): Promise<void> {
  reorderError.value = null;
  const ok = await reorder(payload.draggedId, payload.newParentId, payload.newIndex);
  if (!ok) {
    reorderError.value = "That move isn't allowed — you may only have read access to this item, or the target is in a different workspace.";
  }
}

/* ─── Keyboard: the ARIA tree pattern, owned here ───────────────────────
 * `NavigationTreeNode` is a hand-rolled exception to §4.1 because `UTree`
 * cannot drag-reorder; the keyboard contract `UTree` *would* have brought
 * is therefore this screen's to supply. Measured on 2026-09-07 before this
 * existed: the whole tree was zero tab stops, so a keyboard user could
 * neither open a page nor move one.
 *
 * The tree is one tab stop (roving tabindex) and the arrow keys move
 * within it — the pattern every tree the user has met behaves like, and
 * the reason a 400-page book does not become 400 tab stops.
 */
const activeId = ref<string | null>(null);
const treeEl = ref<HTMLElement | null>(null);

interface FlatNode {
  readonly node: TreeNode;
  readonly parentId: string;
  readonly index: number;
  readonly siblings: readonly TreeNode[];
}

/** Every row currently visible, in the order the eye reads them — which is the order the arrow keys must move in. */
const visible = computed<FlatNode[]>(() => {
  const out: FlatNode[] = [];
  const walk = (list: readonly TreeNode[], parentId: string): void => {
    list.forEach((node, index) => {
      out.push({ node, parentId, index, siblings: list });
      if (node.children.length > 0) walk(node.children, node.id);
    });
  };
  walk(nodes.value, rootId.value ?? '');
  return out;
});

/** The tab stop defaults to the first row, so `Tab` always lands somewhere real. */
watchEffect(() => {
  if (activeId.value && visible.value.some((v) => v.node.id === activeId.value)) return;
  activeId.value = visible.value[0]?.node.id ?? null;
});

function focusNode(nodeId: string | undefined): void {
  if (!nodeId) return;
  activeId.value = nodeId;
  void nextTick(() => {
    treeEl.value?.querySelector<HTMLElement>(`[data-node-id="${nodeId}"]`)?.focus();
  });
}

function onKeydown({ event, node, parentId, index }: { event: KeyboardEvent; node: TreeNode; parentId: string; index: number }): void {
  const flat = visible.value;
  const at = flat.findIndex((v) => v.node.id === node.id);
  if (at === -1) return;
  const entry = flat[at]!;

  // Alt + arrows are the keyboard equivalent of the three drop zones a
  // pointer gets. Without them, reordering — the screen's own manipulation
  // — would be mouse-only (docs/UI-CHECKLIST.md §5).
  if (event.altKey) {
    if (event.key === 'ArrowUp' && index > 0) {
      event.preventDefault();
      void onReorder({ draggedId: node.id, newParentId: parentId, newIndex: index - 1 });
    } else if (event.key === 'ArrowDown' && index < entry.siblings.length - 1) {
      event.preventDefault();
      void onReorder({ draggedId: node.id, newParentId: parentId, newIndex: index + 1 });
    } else if (event.key === 'ArrowRight' && index > 0) {
      event.preventDefault();
      const newParent = entry.siblings[index - 1]!;
      void onReorder({ draggedId: node.id, newParentId: newParent.id, newIndex: newParent.children.length });
    }
    return;
  }

  switch (event.key) {
    case 'ArrowDown':
      event.preventDefault();
      focusNode(flat[at + 1]?.node.id);
      break;
    case 'ArrowUp':
      event.preventDefault();
      focusNode(flat[at - 1]?.node.id);
      break;
    case 'ArrowRight':
      event.preventDefault();
      focusNode(node.children[0]?.id);
      break;
    case 'ArrowLeft':
      event.preventDefault();
      focusNode(flat.find((v) => v.node.id === parentId)?.node.id);
      break;
    case 'Home':
      event.preventDefault();
      focusNode(flat[0]?.node.id);
      break;
    case 'End':
      event.preventDefault();
      focusNode(flat[flat.length - 1]?.node.id);
      break;
    case 'Enter':
    case ' ':
      if (node.type === 'page') {
        event.preventDefault();
        void navigateTo(`/pages/${node.id}`);
      }
      break;
    default:
      break;
  }
}

/** A row reports itself active when it takes focus — moving the tab stop, never navigating. */
function onActivate(nodeId: string): void {
  activeId.value = nodeId;
}

/** Deliberate activation: a click, or Enter/Space. */
function onOpen(nodeId: string): void {
  activeId.value = nodeId;
  void navigateTo(`/pages/${nodeId}`);
}

useHead({ htmlAttrs: { lang: 'en' } });
useSeoMeta({ title: 'Navigation tree — deep-wiki' });
</script>

<template>
  <AppShell>
    <!-- `AppShell`'s `measure` column, the same one read and edit mode
         stand in. A tree row is not prose, but it is a single line of
         `body-large` read left to right, and a label that starts at x=0 and
         ends at x=1216 is the scanning problem the 65-80 character measure
         exists to solve — §2.4's exemptions are content that *exceeds* the
         measure and scrolls inside its own box, which a tree does not. It
         is also the width every other content screen has, and checklist
         §4.1 asks a screen to match the nearest existing one rather than
         choose its own. The heading and the tree therefore share it: the
         heading block was rendering 1216px wide over a 659px tree, so the
         sentence that introduces the tree did not line up with it. -->
    <PageHeading heading="Navigation tree" description="Every shelf, book, chapter and page you can read." />

    <div v-if="status === 'idle' || status === 'loading'" data-testid="tree-skeleton" class="space-y-2" aria-hidden="true">
      <USkeleton class="h-10 w-full" />
      <USkeleton class="h-10 w-5/6 ms-4" />
      <USkeleton class="h-10 w-4/6 ms-8" />
      <USkeleton class="h-10 w-5/6 ms-4" />
    </div>

    <PageNotice
      v-else-if="status === 'forbidden'"
      icon="i-lucide-lock"
      heading="You don't have access to this workspace"
      :level="2"
    >
      Ask a workspace admin to grant you access.
    </PageNotice>

    <PageNotice v-else-if="status === 'not-found'" icon="i-lucide-file-question" heading="This workspace does not exist" :level="2">
      It may have been renamed, or the link may be wrong.
    </PageNotice>

    <PageNotice
      v-else-if="status === 'network-error'"
      icon="i-lucide-circle-alert"
      heading="Couldn't load the tree"
      :level="2"
      tone="error"
      role="alert"
    >
      {{ message }}
      <template #actions>
        <UButton variant="outline" color="error" icon="i-lucide-refresh-cw" @click="load">Retry</UButton>
      </template>
    </PageNotice>

    <template v-else>
      <!-- The write affordances live here, above the tree and outside it,
           for both the empty and the loaded case: a control inside a row
           would sit on top of `NavigationTreeNode`'s drag-and-drop and its
           `Alt`-arrow reorder, which are this screen's §5 contract and
           whose `keydown` guard was fixed only recently. -->
      <NavigationTreeActions :nodes="nodes" :root-id="rootId" :active-id="activeId" @changed="onTreeChanged" />

      <!-- First-run empty state, distinct from "nothing readable" — this
           batch has no filter/search on this screen, so there is no
           filtered-empty variant to distinguish it from. It names the
           object in the product's own vocabulary (checklist §3), and the
           toolbar above it is the path forward. -->
      <PageNotice v-if="nodes.length === 0" icon="i-lucide-library-big" heading="No shelves yet" :level="2">
        Use New… above to create the first shelf, then fill it with books, chapters and pages.
      </PageNotice>

      <div v-else>
        <p v-if="reorderError" role="alert" class="mb-4 rounded-md bg-error-container px-3 py-2 text-body-small text-on-error-container">
          {{ reorderError }}
        </p>
        <!-- The keyboard contract is spelled out on the screen rather
             than left to be discovered: the tree is one tab stop and the
             arrows do the rest, which no visual affordance can say
             (docs/UI-CHECKLIST.md §5). -->
        <p id="tree-keyboard-help" class="text-body-small text-muted mb-2">
          Arrow keys move through the tree, Enter opens a page, and Alt with the arrow keys moves an item among its siblings.
        </p>
        <!-- §1.4 gives `bg-elevated` to the navigation tree *as a pane*.
             This screen has no panes: the tree is content in a column
             sitting directly on the app ground, and drawn at
             `bg-elevated` it measured oklch(0.94828) light /
             oklch(0.28448) dark — byte-identical to the header above it.
             A container on the app ground is the Filled card, the same
             component and tone as the auth card (§9.4). The rows inside
             it keep their own state layer and their `secondary-container`
             drop target, both of which are ground-independent. -->
        <UCard variant="soft" :ui="{ body: 'p-2' }">
          <ul
            ref="treeEl"
            role="tree"
            aria-label="Navigation tree"
            aria-describedby="tree-keyboard-help"
          >
            <NavigationTreeNode
              v-for="(node, index) in nodes"
              :key="node.id"
              :node="node"
              :depth="0"
              :parent-id="rootId ?? ''"
              :index="index"
              :set-size="nodes.length"
              :active-id="activeId"
              @reorder="onReorder"
              @activate="onActivate"
              @open="onOpen"
              @keydown="onKeydown"
            />
          </ul>
        </UCard>
      </div>
    </template>
  </AppShell>
</template>
