<script setup lang="ts">
/**
 * Edit mode (document-modes spec: the probe-and-lock request, both take
 * over and open read-only always offered, heartbeat keeps the lock
 * alive; document-editor spec: the WYSIWYG surface itself, in
 * EditorSurface.vue). This capability MUST NOT ship until GATE-2 is
 * green — see design.md's own note on `document-editor`'s purpose.
 *
 * Pre-build contract (docs/UI-CHECKLIST.md §2):
 * - Who: a workspace member with `write` on this page, most often
 *   arriving from "Edit" on the read-mode screen.
 * - Goal, in their words: "Change what this page says, and keep it."
 * - Single primary action: Save.
 * - Data needed: the canonical markdown (edit-session), the lock state,
 *   and — only while a menu is open — mention/slash candidates.
 * - Non-goals: no revision history (Phase 3), no AI panel (a later
 *   phase), no comment gutter (Phase 3).
 * - Empty / overflow: a brand-new page's markdown is `''`, which
 *   `fromMarkdown` turns into a single empty paragraph — there is no
 *   separate empty state to design for beyond that.
 */
const route = useRoute();
const nodeId = route.params.id as string;

const { status, session, refusal, message, load, takeOver } = useEditSession(nodeId);
const heartbeat = useLockHeartbeat(nodeId);
const { status: saveStatus, contentHash, corrected, message: saveMessage, save } = useSavePage(nodeId);

const currentMarkdown = ref('');
const savedContentHash = ref<string | null>(null);
const isDirty = ref(false);
const takeOverConfirmOpen = ref(false);
// Bumped to force `EditorSurface` to remount with `currentMarkdown` as its
// initial doc — it only reads its `markdown` prop once, on mount (see its
// own header comment) — after the author accepts the corrected document
// offered back on a `dead-anchor` refusal.
const editorRemountKey = ref(0);

// document-modes / page-content spec: `DeadAnchorError`'s refusal (docs/TODO.md
// Findings, commit 40f9844) hands back the submitted document with the
// retired anchor(s) stripped. Loading it replaces the editor's content —
// the same corrective action `PageNotice`'s "not in canonical form" exit
// would take with `canonical` — and marks the buffer dirty so Save is
// re-enabled to retry.
function useCorrectedDocument(): void {
  if (corrected.value === null) return;
  currentMarkdown.value = corrected.value;
  isDirty.value = true;
  editorRemountKey.value += 1;
}

onMounted(() => {
  void load();
});

watch(status, (value) => {
  if (value === 'ready' && session.value) {
    currentMarkdown.value = session.value.markdown;
    savedContentHash.value = session.value.lock ? (contentHash.value ?? null) : null;
    isDirty.value = false;
    void heartbeat.start();
  }
});

onBeforeUnmount(() => {
  heartbeat.stop();
});

function onEditorUpdate(markdown: string): void {
  currentMarkdown.value = markdown;
  isDirty.value = true;
}

async function onSave(): Promise<void> {
  await save(currentMarkdown.value, contentHash.value ?? null);
  if (saveStatus.value === 'success') {
    savedContentHash.value = contentHash.value;
    isDirty.value = false;
  }
}

async function confirmTakeOver(): Promise<void> {
  takeOverConfirmOpen.value = false;
  await takeOver();
}

// docs/UI-CHECKLIST.md §4.5: "Leaving edit mode with unsaved changes
// prompts. Browser navigation away with unsaved changes prompts."
onBeforeRouteLeave(() => {
  if (!isDirty.value) return true;
  return window.confirm('You have unsaved changes. Leave without saving?');
});

function onBeforeUnload(event: BeforeUnloadEvent): void {
  if (!isDirty.value) return;
  event.preventDefault();
}

onMounted(() => window.addEventListener('beforeunload', onBeforeUnload));
onBeforeUnmount(() => window.removeEventListener('beforeunload', onBeforeUnload));

useHead({ htmlAttrs: { lang: 'en' } });
useSeoMeta({ title: () => (session.value?.title ? `Editing ${session.value.title} — deep-wiki` : 'deep-wiki') });
</script>

<template>
  <AppShell>
    <template #header-end>
      <span v-if="heartbeat.status.value === 'lost'" role="status" class="text-label-medium text-error mr-2">
        Lock lost — reload to keep editing
      </span>
      <UButton v-if="status === 'ready'" icon="i-lucide-eye" variant="ghost" color="neutral" size="sm" :to="`/pages/${nodeId}`">
        Read
      </UButton>
      <UButton
        v-if="status === 'ready'"
        icon="i-lucide-save"
        variant="solid"
        color="primary"
        size="sm"
        :loading="saveStatus === 'saving'"
        :disabled="!isDirty && saveStatus !== 'stale'"
        @click="onSave"
      >
        {{ saveStatus === 'saving' ? 'Saving…' : 'Save' }}
      </UButton>
    </template>

    <!-- The column is `AppShell`'s `measure` — the same column, from the
         same shell, as read mode. That is the point: switching modes must
         not move the text under the cursor, and two screens that each
         stated their own width were two chances for it to. It holds for
         every state too, not for the ready branch alone: before the column
         was one thing, the denied, missing, locked and refused panels
         rendered 1216px wide while the editor beside them rendered 659px,
         so the screen changed width with its state. -->
    <div v-if="status === 'idle' || status === 'loading'" data-testid="edit-skeleton" aria-hidden="true">
      <USkeleton class="h-9 w-2/3" />
      <USkeleton class="mt-6 h-48 w-full" />
    </div>

    <PageNotice v-else-if="status === 'forbidden'" icon="i-lucide-lock" heading="You don't have access to edit this page">
      Ask a workspace admin for write access, or open it read-only.
      <template #actions>
        <UButton variant="outline" icon="i-lucide-eye" :to="`/pages/${nodeId}`">Open read-only</UButton>
      </template>
    </PageNotice>

    <PageNotice v-else-if="status === 'not-found'" icon="i-lucide-file-question" heading="This page does not exist">
      It may have been moved or deleted.
    </PageNotice>

    <!-- document-modes: "Take Over" And "Open Read-Only" Are Always Both
         Offered — both actions render simultaneously, never one at a
         time, and never a single ambiguous lock icon. -->
    <PageNotice v-else-if="status === 'locked'" icon="i-lucide-users" heading="Someone else is editing this page" role="alert">
      Locked since {{ refusal?.holder ? new Date(refusal.holder.acquiredAt).toLocaleTimeString() : 'a moment ago' }}. Taking over will
      immediately end their editing session — their unsaved changes, if any, will be lost.
      <template #actions>
        <UButton variant="outline" icon="i-lucide-eye" :to="`/pages/${nodeId}`">Open read-only</UButton>
        <UButton color="error" variant="solid" icon="i-lucide-log-in" @click="takeOverConfirmOpen = true">Take over editing</UButton>
      </template>
    </PageNotice>

    <!-- document-modes / markdown-round-trip: the refused-document
         surface — reason, construct, line, and both exits. -->
    <PageNotice
      v-else-if="status === 'refused'"
      icon="i-lucide-circle-alert"
      heading="This document can't be opened for editing yet"
      tone="error"
      role="alert"
    >
      <span v-if="refusal?.construct">Found <strong>{{ refusal.construct }}</strong></span>
      <span v-if="refusal?.line"> on line {{ refusal.line }}</span>
      <span v-if="refusal?.construct || refusal?.line">, which this editor does not support yet.</span>
      <span v-else>This document is not in a form the editor can safely round-trip.</span>
      <template #actions>
        <UButton variant="outline" color="error" icon="i-lucide-eye" :to="`/pages/${nodeId}`">Open read-only</UButton>
        <!-- `aria-disabled`, not `disabled`. The attribute takes the
             control out of the tab order, which put the one sentence
             explaining why this exit is not available yet behind a
             hover a keyboard user cannot perform — measured on
             2026-09-07: the tooltip fired on mouse hover and the
             button could not be focused at all. §3 asks for the reason
             on hover *and* focus; §5 asks that every control be
             reachable by keyboard. It stays focusable, announces
             itself unavailable, and does nothing when activated. -->
        <UTooltip text="Normalising rewrites the document to its canonical spelling with a diff preview before saving — that ingest flow is not built yet.">
          <UButton aria-disabled="true" color="error" variant="subtle" icon="i-lucide-wand-2" @click.prevent>
            Normalise this document
          </UButton>
        </UTooltip>
      </template>
    </PageNotice>

    <PageNotice
      v-else-if="status === 'network-error'"
      icon="i-lucide-circle-alert"
      heading="Couldn't open this page for editing"
      tone="error"
      role="alert"
    >
      {{ message }}
      <template #actions>
        <UButton variant="outline" color="error" icon="i-lucide-refresh-cw" @click="load">Retry</UButton>
      </template>
    </PageNotice>

    <template v-else>
      <PageHeading :heading="session?.title ?? ''" />
      <p v-if="saveStatus === 'stale'" role="alert" class="mb-4 rounded-md bg-error-container px-3 py-2 text-body-small text-on-error-container">
        {{ saveMessage }}
      </p>
      <!-- `dead-anchor`: distinct from `stale` above — this is not a
           concurrent-edit conflict, so it must not read as one (the bug
           this state exists to fix). Same container as `stale`; the one
           addition is the actionable exit docs/UI-CHECKLIST.md §3 requires
           for a recoverable error, mirroring how the not-canonical 409
           offers `canonical` back. -->
      <div
        v-else-if="saveStatus === 'dead-anchor'"
        role="alert"
        class="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md bg-error-container px-3 py-2 text-body-small text-on-error-container"
      >
        <span>{{ saveMessage }}</span>
        <UButton size="xs" variant="outline" color="error" @click="useCorrectedDocument">Use the corrected document</UButton>
      </div>
      <p
        v-else-if="saveStatus === 'success'"
        role="status"
        aria-live="polite"
        class="mb-4 rounded-md bg-success-container px-3 py-2 text-body-small text-on-success-container"
      >
        Saved.
      </p>
      <EditorSurface
        v-if="session"
        :key="editorRemountKey"
        :markdown="currentMarkdown"
        :workspace-id="session.workspaceId"
        :page-id="nodeId"
        @update="onEditorUpdate"
      />
    </template>

    <UModal v-model:open="takeOverConfirmOpen" title="Take over editing?">
      <template #body>
        <p class="text-body-medium text-default">
          The current editor will lose the ability to save further changes immediately, and any unsaved edits in their browser will be lost.
          This cannot be undone.
        </p>
      </template>
      <template #footer>
        <UButton variant="outline" color="neutral" @click="takeOverConfirmOpen = false">Cancel</UButton>
        <UButton color="error" @click="confirmTakeOver">Take over</UButton>
      </template>
    </UModal>
  </AppShell>
</template>
