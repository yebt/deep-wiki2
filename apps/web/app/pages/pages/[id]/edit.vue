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
const { status: saveStatus, contentHash, message: saveMessage, save } = useSavePage(nodeId);

const currentMarkdown = ref('');
const savedContentHash = ref<string | null>(null);
const isDirty = ref(false);
const takeOverConfirmOpen = ref(false);

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

    <UContainer class="py-10 sm:py-16">
      <div v-if="status === 'idle' || status === 'loading'" data-testid="edit-skeleton" class="max-w-measure" aria-hidden="true">
        <USkeleton class="h-9 w-2/3" />
        <USkeleton class="mt-6 h-48 w-full" />
      </div>

      <div v-else-if="status === 'forbidden'" role="status" class="flex items-start gap-3 rounded-lg bg-elevated p-6">
        <UIcon name="i-lucide-lock" class="size-5 shrink-0 text-muted" aria-hidden="true" />
        <div>
          <h1 class="text-headline-small text-highlighted">You don't have access to edit this page</h1>
          <p class="text-body-medium text-muted mt-2">Ask a workspace admin for write access, or open it read-only.</p>
          <UButton class="mt-4" variant="outline" :to="`/pages/${nodeId}`">Open read-only</UButton>
        </div>
      </div>

      <div v-else-if="status === 'not-found'" role="status" class="flex items-start gap-3 rounded-lg bg-elevated p-6">
        <UIcon name="i-lucide-file-question" class="size-5 shrink-0 text-muted" aria-hidden="true" />
        <div>
          <h1 class="text-headline-small text-highlighted">This page does not exist</h1>
          <p class="text-body-medium text-muted mt-2">It may have been moved or deleted.</p>
        </div>
      </div>

      <!-- document-modes: "Take Over" And "Open Read-Only" Are Always Both
           Offered — both actions render simultaneously, never one at a
           time, and never a single ambiguous lock icon. -->
      <div v-else-if="status === 'locked'" role="alert" class="flex items-start gap-3 rounded-lg bg-elevated p-6">
        <UIcon name="i-lucide-users" class="size-5 shrink-0 text-muted" aria-hidden="true" />
        <div class="min-w-0">
          <h1 class="text-headline-small text-highlighted">Someone else is editing this page</h1>
          <p class="text-body-medium text-muted mt-2">
            Locked since {{ refusal?.holder ? new Date(refusal.holder.acquiredAt).toLocaleTimeString() : 'a moment ago' }}. Taking over will
            immediately end their editing session — their unsaved changes, if any, will be lost.
          </p>
          <div class="mt-4 flex flex-wrap gap-3">
            <UButton variant="outline" icon="i-lucide-eye" :to="`/pages/${nodeId}`">Open read-only</UButton>
            <UButton color="error" variant="solid" icon="i-lucide-log-in" @click="takeOverConfirmOpen = true">Take over editing</UButton>
          </div>
        </div>
      </div>

      <!-- document-modes / markdown-round-trip: the refused-document
           surface — reason, construct, line, and both exits. -->
      <div v-else-if="status === 'refused'" role="alert" class="flex items-start gap-3 rounded-lg bg-error-container p-6">
        <UIcon name="i-lucide-circle-alert" class="size-5 shrink-0 text-on-error-container" aria-hidden="true" />
        <div class="min-w-0">
          <h1 class="text-headline-small text-on-error-container">This document can't be opened for editing yet</h1>
          <p class="text-body-medium text-on-error-container mt-2">
            <span v-if="refusal?.construct">Found <strong>{{ refusal.construct }}</strong></span>
            <span v-if="refusal?.line"> on line {{ refusal.line }}</span>
            <span v-if="refusal?.construct || refusal?.line">, which this editor does not support yet.</span>
            <span v-else>This document is not in a form the editor can safely round-trip.</span>
          </p>
          <div class="mt-4 flex flex-wrap gap-3">
            <UButton variant="outline" color="error" icon="i-lucide-eye" :to="`/pages/${nodeId}`">Open read-only</UButton>
            <UTooltip text="Normalising rewrites the document to its canonical spelling with a diff preview before saving — that ingest flow is not built yet.">
              <UButton disabled color="error" variant="subtle" icon="i-lucide-wand-2">Normalise this document</UButton>
            </UTooltip>
          </div>
        </div>
      </div>

      <div v-else-if="status === 'network-error'" role="alert" class="flex items-start gap-3 rounded-lg bg-error-container p-6">
        <UIcon name="i-lucide-circle-alert" class="size-5 shrink-0 text-on-error-container" aria-hidden="true" />
        <div>
          <h1 class="text-headline-small text-on-error-container">Couldn't open this page for editing</h1>
          <p class="text-body-medium text-on-error-container mt-2">{{ message }}</p>
          <UButton class="mt-4" variant="outline" color="error" icon="i-lucide-refresh-cw" @click="load">Retry</UButton>
        </div>
      </div>

      <div v-else class="max-w-measure">
        <PageHeading :heading="session?.title ?? ''" />
        <p v-if="saveStatus === 'stale'" role="alert" class="mb-4 rounded-md bg-error-container px-3 py-2 text-body-small text-on-error-container">
          {{ saveMessage }}
        </p>
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
          :markdown="session.markdown"
          :workspace-id="session.workspaceId"
          :page-id="nodeId"
          @update="onEditorUpdate"
        />
      </div>
    </UContainer>

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
