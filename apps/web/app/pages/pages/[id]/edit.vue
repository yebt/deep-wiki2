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
import { formatRevisionDate } from '~/utils/format-revision-date';

const route = useRoute();
const nodeId = route.params.id as string;

const { status, session, refusal, message, load, takeOver } = useEditSession(nodeId);
const heartbeat = useLockHeartbeat(nodeId);
const { status: saveStatus, contentHash, canonical, corrected, message: saveMessage, save } = useSavePage(nodeId);
const presence = usePresenceStream(nodeId);
// Captured once, the first time this session becomes `ready` — at that
// moment `session.lock.holderUserId` names whoever just acquired or took
// over the lock, which is always this tab (editing-presence spec: "On the
// edit screen, show the other holder if one appears mid-session" — that
// only means something once "this holder" is known). It is never
// recomputed afterwards: a later presence event for a *different* holder
// is exactly the mid-session takeover this exists to surface, not a
// reason to forget who "self" was.
const myUserId = ref<string | null>(null);
// Presence for this page, excluding this tab's own holder — the read
// screen (index.vue) shows every editor because nobody reading is one;
// here, the interesting case is only *someone else*.
const otherEditors = computed(() => presence.editors.value.filter((editor) => editor.userId !== myUserId.value));

const currentMarkdown = ref('');
const savedContentHash = ref<string | null>(null);
const isDirty = ref(false);
const takeOverConfirmOpen = ref(false);

// docs/UI-CHECKLIST.md §3: "Saved." persisting over a document the user
// has since kept editing is worse than no confirmation at all — it claims
// something that stopped being true the moment `onEditorUpdate` fired.
// `useSavePage`'s own status legitimately stays `success` until the next
// save resolves (documented there as the page component's call, not the
// composable's); this is that call.
const showSavedBanner = computed(() => saveStatus.value === 'success' && !isDirty.value);
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

// document-modes / page-content spec: a `not canonical` 409 (D1 — the
// document is not its own fixed point) hands back the canonicalised text
// the same way a `dead anchor` 409 hands back the corrected one. Same
// pattern, same shape of exit — load it, mark dirty, remount the editor.
function useCanonicalDocument(): void {
  if (canonical.value === null) return;
  currentMarkdown.value = canonical.value;
  isDirty.value = true;
  editorRemountKey.value += 1;
}

onMounted(() => {
  void load();
});

// `immediate: true`: a session that is already `ready` the first time this
// watcher runs (mounting straight into a cached/pre-resolved state) must
// initialise exactly the same way one that transitions into `ready` a tick
// later does — presence and the lock heartbeat are not "only start on
// change" concerns.
watch(
  status,
  (value) => {
    if (value === 'ready' && session.value) {
      currentMarkdown.value = session.value.markdown;
      savedContentHash.value = session.value.lock ? (contentHash.value ?? null) : null;
      isDirty.value = false;
      void heartbeat.start();
      if (myUserId.value === null) myUserId.value = session.value.lock.holderUserId;
      presence.start(session.value.workspaceId);
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  heartbeat.stop();
  presence.stop();
});

function onEditorUpdate(markdown: string): void {
  currentMarkdown.value = markdown;
  isDirty.value = true;
}

// docs/UI-CHECKLIST.md §3 ("Disabled: every disabled control explains why")
// and §5 (`aria-disabled`, never the bare `disabled` attribute, so the
// reason survives keyboard focus) — the same rule `AuthSubmit.vue` and the
// `refused` panel's "Normalise" button already follow. `null` means Save
// is genuinely actionable.
const saveDisabledReason = computed<string | null>(() => {
  if (saveStatus.value === 'forbidden') return "You don't have permission to save this page anymore.";
  // A retry here would resend the same `expectedContentHash` and 409
  // again — nothing changed since the last refusal. `reloadForNewerVersion`
  // is the action `saveMessage` itself names ("Reload before saving again").
  if (saveStatus.value === 'stale') return 'Reload to get the latest version before saving again.';
  if (!isDirty.value) return 'Nothing to save yet.';
  return null;
});

async function onSave(): Promise<void> {
  if (saveDisabledReason.value !== null) return;
  await save(currentMarkdown.value, contentHash.value ?? null);
  if (saveStatus.value === 'success') {
    savedContentHash.value = contentHash.value;
    isDirty.value = false;
  }
}

// The `stale` 409 carries no document body to merge (unlike `not
// canonical`/`dead anchor`) — the only honest recovery is the reload
// `saveMessage` already names. A full reload is what actually discards
// this tab's buffer, so a dirty buffer is confirmed first, explicitly
// naming what is about to be lost (docs/UI-CHECKLIST.md §3, "Error —
// fatal … says explicitly whether the work was lost or preserved").
function reloadForNewerVersion(): void {
  if (isDirty.value && !window.confirm('Someone else saved a newer version. Reloading now will discard your unsaved changes in this tab. Reload anyway?')) {
    return;
  }
  window.location.reload();
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
      <UButton v-if="status === 'ready'" icon="i-lucide-eye" variant="ghost" color="neutral" size="sm" :to="`/pages/${nodeId}`">
        Read
      </UButton>
      <!-- `aria-disabled`, never `disabled` (docs/UI-CHECKLIST.md §3, §5 —
           the same rule `AuthSubmit.vue` and the `refused` panel's
           "Normalise" button already follow): a disabled control with no
           reason is a defect, and the attribute alone removes it from the
           tab order, hiding that reason from anyone who cannot hover. -->
      <UTooltip :text="saveDisabledReason ?? 'Save this page.'">
        <UButton
          v-if="status === 'ready'"
          icon="i-lucide-save"
          variant="solid"
          color="primary"
          size="sm"
          :loading="saveStatus === 'saving'"
          :aria-disabled="saveDisabledReason ? 'true' : undefined"
          @click="onSave"
        >
          {{ saveStatus === 'saving' ? 'Saving…' : 'Save' }}
        </UButton>
      </UTooltip>
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
      <!-- docs/UI-CHECKLIST.md §4.11: the viewer's own zone, the zone
           named in the string, and the exact instant preserved in
           `<time datetime>` — the same rule and the same helper
           history.vue already uses, not a second ad hoc formatting. -->
      <span v-if="refusal?.holder"
        >Locked since <time :datetime="refusal.holder.acquiredAt">{{ formatRevisionDate(refusal.holder.acquiredAt) }}</time
        >.
      </span>
      <span v-else>Locked a moment ago. </span>
      Taking over will immediately end their editing session — their unsaved changes, if any, will be lost.
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

      <!-- Presence and the lock-heartbeat state live in the content flow,
           not the header: measured at 320×900 with the lock lost, the
           header's `scrollWidth` (352px) exceeded its `clientWidth`
           (320px) and the status text wrapped to three lines inside the
           app bar's fixed height, clipping. This row wraps freely instead
           (docs/UI-CHECKLIST.md §6). -->
      <div v-if="status === 'ready' && (otherEditors.length > 0 || heartbeat.status.value === 'lost')" class="mb-4 flex flex-col gap-2">
        <!-- editing-presence spec: "show the other holder if one appears
             mid-session" — not the soft lock itself (the `locked` refusal
             screen above, before the editor ever opens); this is the
             signal that makes a takeover *informed* once this tab is
             already inside the editor (docs/UI-CHECKLIST.md §4.8). -->
        <PresenceIndicator :editors="otherEditors" />
        <span v-if="heartbeat.status.value === 'lost'" role="status" class="text-label-medium text-error">
          Lock lost — reload to keep editing. Your unsaved changes in this tab are kept, but cannot be saved until you reload and retry.
        </span>
      </div>

      <!-- `stale`: a concurrent save already happened, and the server
           offers no document to merge — the only honest recovery is a
           reload, so the banner carries the action it names, and Save
           itself is disabled meanwhile (`saveDisabledReason`) rather than
           inviting a retry that would just 409 again on the same hash. -->
      <div
        v-if="saveStatus === 'stale'"
        role="alert"
        class="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md bg-error-container px-3 py-2 text-body-small text-on-error-container"
      >
        <span>{{ saveMessage }}</span>
        <UButton size="xs" variant="outline" color="error" icon="i-lucide-refresh-cw" @click="reloadForNewerVersion">Reload</UButton>
      </div>
      <!-- `not-canonical`: distinct from `stale` above — this is D1's "the
           document is not its own fixed point", not a concurrent-edit
           conflict, so it must not read as one either. Same container as
           `stale` and `dead-anchor`; the one addition is the actionable
           exit docs/UI-CHECKLIST.md §3 requires for a recoverable error —
           the canonicalised text the server already computed, loaded back
           the same way `dead-anchor`'s exit loads `corrected`. -->
      <div
        v-else-if="saveStatus === 'not-canonical'"
        role="alert"
        class="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md bg-error-container px-3 py-2 text-body-small text-on-error-container"
      >
        <span>{{ saveMessage }} Nothing was saved; your edits are still in the editor below.</span>
        <UButton size="xs" variant="outline" color="error" @click="useCanonicalDocument">Use the canonical document</UButton>
      </div>
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
      <!-- `forbidden`: a fatal error, not a recoverable one — retrying
           cannot succeed once write access is gone. §3: a fatal error
           "preserves any unsaved user input and says explicitly whether
           the work was lost or preserved" — this states both explicitly. -->
      <div
        v-else-if="saveStatus === 'forbidden'"
        role="alert"
        class="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md bg-error-container px-3 py-2 text-body-small text-on-error-container"
      >
        <span>{{ saveMessage }} Nothing was saved, but your edits are still here in this tab — copy them out before leaving if you need them.</span>
        <UButton size="xs" variant="outline" color="error" icon="i-lucide-eye" :to="`/pages/${nodeId}`">Open read-only</UButton>
      </div>
      <!-- `network-error`: recoverable — `saveMessage` already states the
           work is preserved; this adds the real next action §3 requires
           ("Retry", never a dead end). -->
      <div
        v-else-if="saveStatus === 'network-error'"
        role="alert"
        class="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md bg-error-container px-3 py-2 text-body-small text-on-error-container"
      >
        <span>{{ saveMessage }}</span>
        <UButton size="xs" variant="outline" color="error" icon="i-lucide-refresh-cw" @click="onSave">Retry</UButton>
      </div>
      <!-- `success`: "Saved." is §3's own example of a confirmation too
           weak to act on ("Saved as revision 12 · 2 min ago" is the bar).
           This names what was saved, and — `showSavedBanner` — stops
           claiming it once the document is dirty again, since a stale
           "Saved." next to unsaved edits is worse than no confirmation. -->
      <p
        v-else-if="showSavedBanner"
        role="status"
        aria-live="polite"
        class="mb-4 rounded-md bg-success-container px-3 py-2 text-body-small text-on-success-container"
      >
        Saved “{{ session?.title }}”.
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
