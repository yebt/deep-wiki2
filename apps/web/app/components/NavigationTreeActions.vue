<script setup lang="ts">
/**
 * Creating and renaming a node, from the navigation tree.
 *
 * ── Where it stands, and why not in a row ──────────────────────────────
 *
 * `NavigationTreeNode` carries native drag-and-drop *and* the keyboard
 * reorder that is this screen's accessibility contract, and a `keydown`
 * bug there — one press arriving at `tree.vue` once per ancestor — was
 * fixed by guarding on `event.target.closest('[role="treeitem"]') !==
 * event.currentTarget`. Every control here therefore lives **outside**
 * the tree, in a toolbar above it. Nothing new is placed inside a row, so
 * there is no new way for a press to be swallowed or duplicated, and
 * `NavigationTreeActions.test.ts` asserts this component renders no
 * `treeitem` and no `tree` at all.
 *
 * ── Where a new node goes ──────────────────────────────────────────────
 *
 * The location is the row the user picked — the one that shows the
 * selected fill — resolved up to the nearest node that can legally hold
 * children — so "New" means "here", which is how a tree is read. The only
 * other offer is the top level, because a second shelf would otherwise
 * be unreachable once the first one exists. Until the user has picked a
 * row there is no "here": the location is the top level, and Rename says
 * plainly that it needs a row first. Before 2026-09-14 the toolbar acted
 * on the row that happened to hold the roving tab stop, which defaults
 * to the first row on load — so "Rename “Engineering”…" read before the
 * user had touched the tree and the "select a row first" state was
 * unreachable (audit defect 8). Two radios rather than a picker of every container: the
 * tree itself is the picker, and arrowing to a row is cheaper than
 * finding it again in a list (docs/UI-CHECKLIST.md §4.4 — this is a tool
 * people live in all day, so the chrome stays quiet).
 *
 * ── What may be created ────────────────────────────────────────────────
 *
 * `legalChildTypes()` — the inverse of the one `LEGAL_PARENT_TYPES` table
 * in `packages/core`, re-exported through `@deep-wiki/contracts`. The
 * menu the user sees and the rule the server enforces are the same fact;
 * a list typed out here would be the sixth instance of docs/TODO.md's own
 * named recurring defect.
 *
 * ── Failure ────────────────────────────────────────────────────────────
 *
 * Classified through `~/utils/fetch-error` — the shared guard, never an
 * eleventh hand-written copy. A collision is a *field* error, because the
 * user fixes it by changing the name; a refusal or a dead connection is a
 * form-level alert, because they do not. Both keep the dialog open with
 * what was typed still in it (§3 — an error is never a dead end).
 */
import { legalChildTypes, type NodeType } from '@deep-wiki/contracts';
import type { CreatedNode, RenamedNode, TreeNode } from '~/composables/useTree';

interface CreateNodeBody {
  readonly parentId: string;
  readonly type: NodeType;
  readonly title: string;
}

interface CreatedNodePayload extends CreatedNode {
  readonly type: NodeType;
}

type RenamedNodePayload = RenamedNode;

export type CreateNodeFetcher = (body: CreateNodeBody) => Promise<CreatedNodePayload>;
export type RenameNodeFetcher = (nodeId: string, body: { title: string }) => Promise<RenamedNodePayload>;

const props = defineProps<{
  nodes: readonly TreeNode[];
  rootId: string | null;
  /** The row the user picked — the "here" a new node goes under, and the one Rename acts on. `null` until they pick one. */
  selectedId: string | null;
  /** Injected in tests, exactly as `useTree` takes its fetchers. */
  createFetcher?: CreateNodeFetcher;
  renameFetcher?: RenameNodeFetcher;
}>();

/**
 * The server's answer, handed to the tree to draw: the row appears from
 * the one request that made it, not from a second `GET /tree` (2026-09-16;
 * until then the tree reloaded on `changed`, and the new row landed on the
 * second round trip).
 */
const emit = defineEmits<{ created: [node: CreatedNodePayload]; renamed: [node: RenamedNodePayload] }>();

const config = useRuntimeConfig();

const createNode: CreateNodeFetcher = (body) =>
  props.createFetcher
    ? props.createFetcher(body)
    : $fetch(`${config.public.apiBaseUrl}/nodes`, { method: 'POST', credentials: 'include', body });

const renameNode: RenameNodeFetcher = (nodeId, body) =>
  props.renameFetcher
    ? props.renameFetcher(nodeId, body)
    : $fetch(`${config.public.apiBaseUrl}/nodes/${nodeId}`, { method: 'PATCH', credentials: 'include', body });

/* ─── The tree, indexed ─────────────────────────────────────────────── */

interface Indexed {
  readonly node: TreeNode;
  readonly parentId: string;
}

const ROOT_LABEL = 'the top level';

const index = computed<Map<string, Indexed>>(() => {
  const map = new Map<string, Indexed>();
  const walk = (list: readonly TreeNode[], parentId: string): void => {
    for (const node of list) {
      map.set(node.id, { node, parentId });
      walk(node.children, node.id);
    }
  };
  walk(props.nodes, props.rootId ?? '');
  return map;
});

const rootLocationId = computed(() => props.rootId ?? '');

function typeOf(nodeId: string): NodeType {
  if (nodeId === rootLocationId.value) return 'workspace';
  return (index.value.get(nodeId)?.node.type ?? 'workspace') as NodeType;
}

function titleOf(nodeId: string): string {
  return index.value.get(nodeId)?.node.title ?? ROOT_LABEL;
}

/** The nearest ancestor-or-self that may legally hold children; the root when there is none. */
const nearestContainerId = computed(() => {
  let current = props.selectedId;
  while (current) {
    const entry = index.value.get(current);
    if (!entry) break;
    if (legalChildTypes(entry.node.type as NodeType).length > 0) return current;
    current = entry.parentId === rootLocationId.value ? null : entry.parentId;
  }
  return rootLocationId.value;
});

const locationOptions = computed(() => {
  const ids = nearestContainerId.value === rootLocationId.value ? [rootLocationId.value] : [nearestContainerId.value, rootLocationId.value];
  return ids.map((id) => ({
    value: id,
    label: id === rootLocationId.value ? 'At the top level' : `In “${titleOf(id)}”`,
  }));
});

/* ─── Create ────────────────────────────────────────────────────────── */

const createOpen = ref(false);
const createParentId = ref('');
const createType = ref<NodeType>('shelf');
const createTitle = ref('');
const createNameError = ref<string | null>(null);
const createFormError = ref<string | null>(null);
const createSubmitting = ref(false);
const announcement = ref('');

const createTypeOptions = computed(() =>
  legalChildTypes(typeOf(createParentId.value)).map((type) => ({ value: type, label: TYPE_LABELS[type] })),
);

/**
 * When the hierarchy leaves exactly one answer, the single radio needs to
 * say *why* it is single — otherwise it reads as a control that forgot its
 * other options. The sentence is composed from the same table, never from
 * a written-out list of what holds what.
 */
const createTypeHelp = computed(() => {
  if (createTypeOptions.value.length !== 1) return undefined;
  const only = TYPE_LABELS[createTypeOptions.value[0]!.value].toLowerCase();
  if (createParentId.value === rootLocationId.value) return `Only a ${only} can sit at the top level.`;
  return `Only a ${only} can go directly inside a ${TYPE_LABELS[typeOf(createParentId.value)].toLowerCase()}.`;
});

const TYPE_LABELS: Record<NodeType, string> = {
  workspace: 'Workspace',
  shelf: 'Shelf',
  book: 'Book',
  chapter: 'Chapter',
  page: 'Page',
};

// A location the user changes may not permit the type they had chosen —
// a chapter holds only pages. Falling back to the first legal type keeps
// the form in a state the server would accept.
watch(createTypeOptions, (options) => {
  if (!options.some((option) => option.value === createType.value)) {
    createType.value = (options[0]?.value ?? 'shelf') as NodeType;
  }
});

/** The toolbar's New…: the first legal type at the picked row. */
function openCreate(): void {
  openCreateAs();
}

/**
 * `type` is the row's context menu asking for a specific child ("New
 * page…" on a chapter); the toolbar asks for none and gets the first
 * legal one. Either way the location is the picked row, so the menu
 * selects its row before calling this and lands in the same dialog.
 */
function openCreateAs(type?: NodeType): void {
  createParentId.value = nearestContainerId.value;
  const legal = legalChildTypes(typeOf(createParentId.value));
  createType.value = (type && legal.includes(type) ? type : (legal[0] ?? 'shelf')) as NodeType;
  createTitle.value = '';
  createNameError.value = null;
  createFormError.value = null;
  createOpen.value = true;
}

const canSubmitCreate = computed(() => createTitle.value.trim().length > 0 && createTypeOptions.value.length > 0);

async function submitCreate(): Promise<void> {
  if (!canSubmitCreate.value || createSubmitting.value) return;
  createNameError.value = null;
  createFormError.value = null;
  createSubmitting.value = true;
  const where = createParentId.value === rootLocationId.value ? ROOT_LABEL : `“${titleOf(createParentId.value)}”`;
  try {
    const created = await createNode({
      parentId: createParentId.value,
      type: createType.value,
      title: createTitle.value.trim(),
    });
    // Specific, not "Saved": the user can act on which object went where
    // (docs/UI-CHECKLIST.md §3).
    announcement.value = `Created ${TYPE_LABELS[created.type].toLowerCase()} “${created.title}” in ${where}.`;
    createOpen.value = false;
    createTitle.value = '';
    emit('created', created);
  } catch (error) {
    applyWriteError(error, createNameError, createFormError, 'create');
  } finally {
    createSubmitting.value = false;
  }
}

/* ─── Rename ────────────────────────────────────────────────────────── */

const renameOpen = ref(false);
const renameTitle = ref('');
const renameNameError = ref<string | null>(null);
const renameFormError = ref<string | null>(null);
const renameSubmitting = ref(false);

const renameTarget = computed(() => (props.selectedId ? (index.value.get(props.selectedId)?.node ?? null) : null));

function openRename(): void {
  if (!renameTarget.value) return;
  renameTitle.value = renameTarget.value.title;
  renameNameError.value = null;
  renameFormError.value = null;
  renameOpen.value = true;
}

const canSubmitRename = computed(() => renameTitle.value.trim().length > 0 && renameTarget.value !== null);

async function submitRename(): Promise<void> {
  const target = renameTarget.value;
  if (!target || !canSubmitRename.value || renameSubmitting.value) return;
  renameNameError.value = null;
  renameFormError.value = null;
  renameSubmitting.value = true;
  try {
    const renamed = await renameNode(target.id, { title: renameTitle.value.trim() });
    announcement.value = `Renamed to “${renamed.title}”.`;
    renameOpen.value = false;
    emit('renamed', renamed);
  } catch (error) {
    applyWriteError(error, renameNameError, renameFormError, 'rename');
  } finally {
    renameSubmitting.value = false;
  }
}

/**
 * The row's context menu (`NavigationTree`) opens these same two dialogs:
 * one create, one rename, one classification of failure, whichever
 * surface asked. A second copy of either dialog is how the toolbar and
 * the menu would drift apart.
 */
defineExpose({ openCreate: openCreateAs, openRename });

/* ─── One classification of failure, for both writes ────────────────── */

function applyWriteError(
  error: unknown,
  nameError: Ref<string | null>,
  formError: Ref<string | null>,
  action: 'create' | 'rename',
): void {
  const status = httpStatusOf(error);
  const body = responseBodyOf(error) as { error?: string } | undefined;

  if (status === 409) {
    // The only failure the user fixes by editing the field, so it is the
    // only one attached to it.
    nameError.value = body?.error ?? 'Something here already has that name. Choose another.';
    return;
  }
  if (status === 403) {
    formError.value =
      action === 'create'
        ? "You don't have permission to create anything here. Ask a workspace admin for write access."
        : "You don't have permission to rename this. Ask a workspace admin for write access.";
    return;
  }
  if (status === 404) {
    formError.value = 'That place is no longer there. Reload the tree and try again.';
    return;
  }
  if (status === 400) {
    formError.value = body?.error ?? 'That is not something that can go here.';
    return;
  }
  formError.value = 'Cannot reach the server. Check your connection and try again.';
}
</script>

<template>
  <div>
    <!-- 12px between two actions and 16px below them: the 4dp grid
         (DESIGN-SYSTEM §7.3). `flex-wrap` so 320px never scrolls
         sideways (checklist §6). This is a toolbar, so its controls are
         §7.2's 32px chrome height (`size="sm"`), not the 40px of a
         content-area action — measured at 40px on 2026-09-14. -->
    <!-- Tonal, not filled: since 2026-09-15 this toolbar stands in the
         sidebar on every screen, and a filled button there would be a
         second primary beside whatever the screen's own is (checklist §2,
         one primary per view). The two read as one group — tonal and
         outlined — apart from the screen's actions in the top bar.
         The row fills the pane: New… grows (`flex-1`), Rename… takes its
         natural width — measured on 2026-09-16, the two at their natural
         widths left the right third of the 280px pane empty. -->
    <div class="mb-2 flex flex-wrap items-center gap-2">
      <UButton size="sm" variant="soft" icon="i-lucide-plus" class="flex-1" data-testid="tree-create-open" @click="openCreate">New…</UButton>

      <!-- `aria-disabled`, never `disabled`: the attribute would take the
           control out of the tab order and put its own explanation behind
           a hover a keyboard user cannot perform (checklist §5). -->
      <UTooltip v-if="!renameTarget" text="Select a row in the tree first.">
        <UButton
          size="sm"
          variant="outline"
          color="neutral"
          icon="i-lucide-pencil-line"
          aria-disabled="true"
          aria-describedby="tree-rename-reason"
          data-testid="tree-rename-open"
        >
          Rename…
        </UButton>
      </UTooltip>
      <!-- The target is in the control's name and its tooltip, not in its
           visible label: "Rename “A long page title”…" wrapped onto two
           lines in a 280px pane (measured 2026-09-15), and the row it
           names is already the one drawn with the fill. -->
      <UTooltip v-else :text="`Rename “${renameTarget.title}”`">
        <UButton
          size="sm"
          variant="outline"
          color="neutral"
          icon="i-lucide-pencil-line"
          :aria-label="`Rename “${renameTarget.title}”…`"
          data-testid="tree-rename-open"
          @click="openRename"
        >
          Rename…
        </UButton>
      </UTooltip>
      <p id="tree-rename-reason" class="sr-only">Select a row in the tree to rename it.</p>
    </div>

    <!-- Success is confirmed visibly *and* announced (checklist §3, §5),
         and it is specific rather than "Saved": it names the object and
         the place it went, which is what the user can act on.
         The live region is always in the DOM — a region inserted at the
         same moment its text appears is frequently not announced at all —
         and only its styling changes, from `sr-only` to a success chip. -->
    <p
      data-testid="tree-actions-status"
      role="status"
      aria-live="polite"
      :class="
        announcement
          ? 'mb-4 rounded-md bg-success-container px-3 py-2 text-body-small text-on-success-container'
          : 'sr-only'
      "
    >
      {{ announcement }}
    </p>

    <UModal v-model:open="createOpen" title="New item" description="Add a shelf, book, chapter or page to this workspace.">
      <template #body>
        <div class="space-y-6">
          <p v-if="createFormError" role="alert" data-testid="tree-create-error" class="rounded-md bg-error-container px-3 py-2 text-body-small text-on-error-container">
            {{ createFormError }}
          </p>

          <UFormField v-if="locationOptions.length > 1" label="Location" required>
            <URadioGroup v-model="createParentId" :items="locationOptions" data-testid="tree-create-location" />
          </UFormField>
          <p v-else data-testid="tree-create-location-fixed" class="text-body-medium text-muted">
            This will be created at the top level of the workspace.
          </p>

          <UFormField label="Type" required :help="createTypeHelp">
            <URadioGroup v-model="createType" :items="createTypeOptions" data-testid="tree-create-type" />
          </UFormField>

          <UFormField label="Name" required :error="createNameError ?? undefined" data-testid="tree-create-title-field">
            <UInput
              v-model="createTitle"
              class="w-full"
              autocomplete="off"
              data-testid="tree-create-title"
              @keydown.enter.prevent="submitCreate"
            />
          </UFormField>

          <p class="text-body-small text-muted">All fields are required. The address is made from the name.</p>
        </div>
      </template>
      <template #footer>
        <UButton variant="outline" color="neutral" @click="createOpen = false">Cancel</UButton>
        <UButton
          :loading="createSubmitting"
          :aria-disabled="!canSubmitCreate || undefined"
          data-testid="tree-create-submit"
          @click="submitCreate"
        >
          Create
        </UButton>
      </template>
    </UModal>

    <UModal v-model:open="renameOpen" title="Rename" :description="`Give “${renameTarget?.title ?? ''}” a new name.`">
      <template #body>
        <div class="space-y-6">
          <p v-if="renameFormError" role="alert" data-testid="tree-rename-error" class="rounded-md bg-error-container px-3 py-2 text-body-small text-on-error-container">
            {{ renameFormError }}
          </p>
          <UFormField label="Name" required :error="renameNameError ?? undefined" data-testid="tree-rename-title-field">
            <UInput
              v-model="renameTitle"
              class="w-full"
              autocomplete="off"
              data-testid="tree-rename-title"
              @keydown.enter.prevent="submitRename"
            />
          </UFormField>
          <p class="text-body-small text-muted">The address changes with the name.</p>
        </div>
      </template>
      <template #footer>
        <UButton variant="outline" color="neutral" @click="renameOpen = false">Cancel</UButton>
        <UButton
          :loading="renameSubmitting"
          :aria-disabled="!canSubmitRename || undefined"
          data-testid="tree-rename-submit"
          @click="submitRename"
        >
          Rename
        </UButton>
      </template>
    </UModal>
  </div>
</template>
