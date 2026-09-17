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
import { loadEditorMount } from '~/utils/editor-mount';
import { EDITOR_VIEWS, requestView, type EditorViewMode, type SourceRefusal } from '~/utils/editor-view';
import { formatRevisionDate } from '~/utils/format-revision-date';
import { pageUrl, workspacesUrl } from '~/utils/routes';

// Inside the workspace layout: the frame is mounted once and this screen
// renders only its pane, so the room does not change when the mode does —
// the sidebar's tree keeps its scroll and its folds across Read → Edit →
// Read (`layouts/workspace.vue`).
definePageMeta({ layout: 'workspace' });

const route = useRoute();
const nodeId = route.params.id as string;
/** The workspace slug the address carries (`/w/<slug>/p/<id>/edit`): what every link this screen emits is built from. */
const workspaceSlug = route.params.workspace as string;
const readUrl = pageUrl(workspaceSlug, nodeId);
const allWorkspacesUrl = workspacesUrl();

const { status, session, refusal, message, load, takeOver } = useEditSession(nodeId);
// A signed-out visit leaves for sign-in and comes back (`useSignInRedirect`).
useSignInRedirect().redirectWhenSignedOut(status);
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
// The text the server holds — the session's on open, the buffer's after
// each successful Save. "Dirty" means the buffer differs from it, byte
// for byte: a character typed and deleted, or an Undo back to the start,
// leaves nothing to save. Until 2026-09-17 every editor transaction set
// the flag, so Save stayed live on an unchanged document and sent the
// stored bytes back — the client half of "sometimes an empty history
// entry is saved" (docs/TODO.md Findings; the server half is
// `savePage()`'s `unchanged`).
const savedMarkdown = ref('');
const isDirty = ref(false);

// Every "are you sure" on this screen is the product's one confirm
// dialog (`ConfirmDialog`, mounted in `app.vue`), asked as a promise:
// themed, focus-trapped, Escape cancels, focus returns to the control
// that asked (docs/UI-CHECKLIST.md §4.1, §5). Until 2026-09-16 the two
// unsaved-changes prompts were `window.confirm` and the take-over one
// was a modal of its own on this page.
const { confirm } = useConfirm();

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
  // The editor chunk first, then the session request, so the two overlap
  // instead of queueing: measured on 2026-09-16, `EditorSurface` only
  // began `import('@deep-wiki/editor/mount')` once the session had
  // arrived — 14 requests and 230–530 ms in dev on the critical path, on
  // top of the request they could have shared (docs/TODO.md Findings,
  // "edit-mode latency"). Neither depends on the other. A failure here is
  // swallowed on purpose: `EditorSurface` awaits the same loader and is
  // where a chunk that cannot load surfaces; this call only warms it.
  void loadEditorMount().catch(() => {});
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
      savedMarkdown.value = session.value.markdown;
      // page-content spec, D16: `useSavePage`'s `contentHash` genuinely
      // starts `null`, and stays `null` until this session's own first
      // Save resolves. Without seeding it from the edit-session response
      // here, that first Save on an already-saved page sends
      // `expectedContentHash: null` — which `savePage()` treats as a
      // brand-new page and refuses with a stale-content 409 on every page
      // that already has content (docs/TODO.md Finding, this task).
      contentHash.value = session.value.contentHash;
      savedContentHash.value = session.value.contentHash;
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
  isDirty.value = markdown !== savedMarkdown.value;
  // The refusal was about the text as it stood; the next attempt judges
  // the new text.
  viewRefusal.value = null;
}

/* ─── Visual ↔ source (owner decision, 2026-09-17, "like Obsidian") ────
 * One edit mode, two views of the same buffer. `currentMarkdown` is the
 * truth whichever view is up: the visual view reports it 300ms after
 * the last transaction (and `flush()` closes that window), the source
 * view on every keystroke. Dirty state, the lock, the heartbeat,
 * presence and the confirm-on-leave are this screen's and do not know
 * which view is up. The choice persists per browser (`dw-editor-view`,
 * like `dw-comments`); whether a switch is allowed is
 * `~/utils/editor-view`'s decision: leaving the visual view is always
 * granted, leaving the source view only when the probe says the text is
 * canonical — otherwise the person stays in source with the offending
 * line named by its two spellings, and nothing they typed is rewritten.
 */
const { view, set: setView } = useEditorView();
const { getKbdKey } = useKbd();
const viewRefusal = ref<SourceRefusal | null>(null);
const viewAnnouncement = ref('');
const sourceSurface = ref<{ focus: () => void } | null>(null);

const VIEW_LABELS: Record<EditorViewMode, string> = { visual: 'Visual', source: 'Source' };
/** Beside the label, never instead of it (§4.3): the rendered paragraph, and the angle brackets of source. */
const VIEW_ICONS: Record<EditorViewMode, string> = { visual: 'i-lucide-pilcrow', source: 'i-lucide-code' };

async function showView(target: EditorViewMode): Promise<void> {
  if (status.value !== 'ready') return;
  if (view.value === 'visual') editorSurface.value?.flush?.();
  const mod = await loadEditorMount();
  const decision = requestView(target, view.value, currentMarkdown.value, mod.probe, (markdown) => mod.toMarkdown(mod.fromMarkdown(markdown)));
  viewRefusal.value = decision.refusal;
  if (decision.view === view.value) {
    if (decision.refusal) viewAnnouncement.value = `Still in the source view: line ${decision.refusal.line} is not in canonical form.`;
    return;
  }
  setView(decision.view);
  const modifier = getKbdKey('meta');
  viewAnnouncement.value =
    decision.view === 'source' ? `Source view. Press ${modifier}E for the visual view.` : `Visual view. Press ${modifier}E for the source view.`;
  await nextTick();
  if (decision.view === 'source') sourceSurface.value?.focus();
  else editorSurface.value?.focus?.();
}

function toggleView(): void {
  void showView(view.value === 'visual' ? 'source' : 'visual');
}

// Obsidian's binding for the same toggle. `usingInput`: the person is in
// one of the two surfaces when they reach for it.
defineShortcuts({
  meta_e: { usingInput: true, handler: toggleView },
});

// Undo and Redo in the bar, beside Save. The depths are the history
// plugin's own, reported by the surface after every transaction; the
// commands run through the surface's handle — the same ones `Ctrl+Z` and
// `Ctrl+Shift+Z` run inside it — so a button and its keys never disagree.
// A remounted editor (the corrected/canonical document loaded back)
// starts with an empty history, and the buttons say so until it reports.
// `flush` and `focus` are optional in the type only because this
// screen's tests stub the surface as an empty component; the real one
// always exposes both.
const editorSurface = ref<{ undo: () => void; redo: () => void; flush?: () => void; focus?: () => void } | null>(null);
const history = ref({ undoDepth: 0, redoDepth: 0 });
watch(editorRemountKey, () => {
  history.value = { undoDepth: 0, redoDepth: 0 };
});

function onEditorHistory(depths: { undoDepth: number; redoDepth: number }): void {
  history.value = depths;
}

// §3 "Disabled": the reason on hover and focus; §5: `aria-disabled`, so
// the control stays in the tab order and the reason with it.
const undoDisabledReason = computed<string | null>(() => (history.value.undoDepth === 0 ? 'Nothing to undo yet.' : null));
const redoDisabledReason = computed<string | null>(() => (history.value.redoDepth === 0 ? 'Nothing to redo.' : null));

function onUndo(): void {
  if (undoDisabledReason.value !== null) return;
  editorSurface.value?.undo();
}

function onRedo(): void {
  if (redoDisabledReason.value !== null) return;
  editorSurface.value?.redo();
}

/** The platform's modifier as text for `aria-keyshortcuts`, read on mount because the platform is the client's (the same reading `SidebarToggle` makes). */
const modifierName = ref('Control');
onMounted(() => {
  modifierName.value = /Macintosh;/.test(navigator.userAgent) ? 'Meta' : 'Control';
});

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
  // The surface reports 300ms after the last transaction; a Save inside
  // that window read the document before the edit. It reports now.
  editorSurface.value?.flush?.();
  if (saveDisabledReason.value !== null) return;
  await save(currentMarkdown.value, contentHash.value ?? null);
  if (saveStatus.value === 'success') {
    savedContentHash.value = contentHash.value;
    savedMarkdown.value = currentMarkdown.value;
    isDirty.value = false;
  }
}

// A full reload is what actually discards this tab's buffer, so a dirty
// buffer is confirmed first, explicitly naming what is about to be lost
// (docs/UI-CHECKLIST.md §3, "Error — fatal … says explicitly whether the
// work was lost or preserved"). One helper for the two states that name a
// reload, so the confirmation cannot drift between them. Destructive:
// saying yes loses the edits.
async function reloadDiscardingBuffer(why: string): Promise<void> {
  if (isDirty.value && !(await confirm({ title: 'Reload and lose your unsaved changes?', description: why, confirmLabel: 'Reload', tone: 'destructive' }))) return;
  window.location.reload();
}

// The `stale` 409 carries no document body to merge (unlike `not
// canonical`/`dead anchor`) — the only honest recovery is the reload
// `saveMessage` already names.
function reloadForNewerVersion(): Promise<void> {
  return reloadDiscardingBuffer('Someone else saved a newer version. Reloading now discards the unsaved changes in this tab.');
}

// The lock was lost mid-session (the heartbeat answered `lost`): this
// tab can no longer save, and a new session needs a reload.
function reloadAfterLockLost(): Promise<void> {
  return reloadDiscardingBuffer('This tab no longer holds the lock. Reloading now discards the unsaved changes in this tab.');
}

// "Take over" states its consequence for the other person before it is
// confirmed (docs/UI-CHECKLIST.md §4.8) — the same dialog as every other
// confirmation on this screen, in the destructive colour.
async function confirmTakeOver(): Promise<void> {
  const proceed = await confirm({
    title: 'Take over editing?',
    description:
      'The current editor will lose the ability to save further changes immediately, and any unsaved edits in their browser will be lost. This cannot be undone.',
    confirmLabel: 'Take over',
    tone: 'destructive',
  });
  if (!proceed) return;
  await takeOver();
}

// docs/UI-CHECKLIST.md §4.5: "Leaving edit mode with unsaved changes
// prompts." An in-app navigation — a tree row, "Read page", the browser's
// Back — is the router's, so the guard awaits the same dialog; the
// person stays on the editor with nothing lost when they cancel.
onBeforeRouteLeave(async () => {
  if (!isDirty.value) return true;
  return confirm({
    title: 'Leave without saving?',
    description: 'Your unsaved changes in this tab will be lost.',
    confirmLabel: 'Leave',
    cancelLabel: 'Keep editing',
    tone: 'destructive',
  });
});

// "Browser navigation away with unsaved changes prompts" (§4.5): a tab
// closing, a reload, an address typed over this one. That prompt is the
// browser's own and cannot be replaced — no page script may draw a
// dialog while the document is being torn down, and the browser shows
// its generic wording regardless of what is passed — so `beforeunload`
// stays exactly as it is: the one prompt in the product that is not
// `ConfirmDialog`.
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
  <AppShell :workspace-id="session?.workspaceId ?? null" :node-id="nodeId" :title="session?.title || undefined" :trail="[{ label: 'Editing' }]" condensed>
    <!-- `condensed`: the lighter bar, because here the document must
         outrank the chrome — the breadcrumb keeps the page and "Editing"
         and folds the path above them into an overflow menu; the tree
         beside the editor already shows it (docs/UI-CHECKLIST.md Review
         Log, 2026-09-16). Save is the one filled action; "Read page" is
         the Text button beside it.

         The breadcrumb ends in the page — placed through the tree once
         the session names the workspace, the title alone until then — and
         then the state this screen adds: "Editing". The word alone, no
         pencil: at 320 the bar holds the drawer toggle, this one crumb,
         "Read page" and Save, and with an icon the crumb truncated to
         "Edit…". The mode is unmistakable without it (docs/UI-CHECKLIST.md
         §4.5): a Filled Save where read mode has a tonal Edit, and the
         crumb says so.

         The contextual bar: who else is here, then what this screen can
         do — the same order the read screen uses (presence, then its
         actions), so the bar reads the same in both modes. Between them,
         which view of the document is up (Visual | Source). -->
    <template #header-end>
      <!-- editing-presence spec: "show the other holder if one appears
           mid-session" — not the soft lock itself (the `locked` refusal
           below, before the editor ever opens); this is the signal that
           makes a takeover *informed* once this tab is already inside the
           editor (docs/UI-CHECKLIST.md §4.8). -->
      <PresenceIndicator v-if="status === 'ready'" :editors="otherEditors" class="mr-2" />
      <!-- One chrome for one destination: this and the history screen's
           app-bar control both lead to `/pages/:id`, and used to be
           "Read" (eye) here and "Back to page" (arrow-left) there. The
           eye is what every "Open read-only" exit already uses for read
           mode, so it is the one (checklist §4.1). -->
      <!-- Below `sm` the label is for assistive technology only and the
           control is icon-only with its tooltip (§4.3): at 320 the bar
           holds the drawer toggle, the crumb, this, Undo, Redo and Save,
           and with the label drawn the "Editing" crumb clipped (measured
           in `e2e/editor.spec.ts` when Undo and Redo arrived). -->
      <!-- The view: a segmented control mirroring `Ctrl`/`⌘`+`E`, pressed
           as `aria-pressed` plus the opaque `secondary-container` fill the
           selection toolbar uses for the same state (never colour alone,
           §5); the other view is the Outlined emphasis. Named as a group
           and each half tooltipped with the keys (§4.3). Below `sm` the
           group gives way to one icon-only toggle, pressed while the
           source view is up — the comments toggle's own shape: measured
           at 320 with the two halves drawn, even icon-only, the "Editing"
           crumb clipped to "Editi…" beside Undo, Redo and Save. -->
      <UFieldGroup v-if="status === 'ready'" size="sm" role="group" aria-label="Editor view" class="mr-2 hidden sm:inline-flex">
        <UTooltip v-for="option in EDITOR_VIEWS" :key="option" :text="`${VIEW_LABELS[option]} view`" :kbds="['meta', 'E']">
          <UButton
            :icon="VIEW_ICONS[option]"
            :variant="view === option ? 'soft' : 'outline'"
            :color="view === option ? 'secondary' : 'neutral'"
            size="sm"
            :label="VIEW_LABELS[option]"
            :aria-pressed="view === option ? 'true' : 'false'"
            :aria-keyshortcuts="`${modifierName}+E`"
            :data-testid="`editor-view-${option}`"
            @click="showView(option)"
          />
        </UTooltip>
      </UFieldGroup>
      <UTooltip v-if="status === 'ready'" text="Source view" :kbds="['meta', 'E']" class="sm:hidden">
        <UButton
          :icon="VIEW_ICONS.source"
          :variant="view === 'source' ? 'soft' : 'ghost'"
          :color="view === 'source' ? 'secondary' : 'neutral'"
          size="sm"
          square
          aria-label="Source view"
          :aria-pressed="view === 'source' ? 'true' : 'false'"
          :aria-keyshortcuts="`${modifierName}+E`"
          data-testid="editor-view-toggle"
          @click="toggleView"
        />
      </UTooltip>
      <UTooltip v-if="status === 'ready'" text="Read page">
        <UButton icon="i-lucide-eye" variant="ghost" color="neutral" size="sm" :to="readUrl" label="Read page" :ui="{ label: 'max-sm:sr-only' }" />
      </UTooltip>
      <!-- Undo and Redo, beside Save: icon-only, so a name and a tooltip
           that also shows the keys (§4.3); `aria-disabled` with the reason
           while that side of the history is empty (§3, §5). `mousedown`
           is cancelled so a pointer click leaves the caret where it is —
           the command acts on the editor, and the surface hands focus
           back to it — while a keyboard user keeps focus on the button
           they activated. -->
      <!-- Only beside the live view: the text area's undo is the
           keyboard's own, and a button that ran the other view's
           history would be the inert control §6 names. -->
      <template v-if="status === 'ready' && view === 'visual'">
        <UTooltip :text="undoDisabledReason ?? 'Undo'" :kbds="['meta', 'Z']">
          <UButton
            icon="i-lucide-undo-2"
            variant="ghost"
            color="neutral"
            size="sm"
            square
            aria-label="Undo"
            :aria-keyshortcuts="`${modifierName}+Z`"
            :aria-disabled="undoDisabledReason ? 'true' : undefined"
            @mousedown.prevent
            @click="onUndo"
          />
        </UTooltip>
        <UTooltip :text="redoDisabledReason ?? 'Redo'" :kbds="['meta', 'shift', 'Z']">
          <UButton
            icon="i-lucide-redo-2"
            variant="ghost"
            color="neutral"
            size="sm"
            square
            aria-label="Redo"
            :aria-keyshortcuts="`${modifierName}+Shift+Z`"
            :aria-disabled="redoDisabledReason ? 'true' : undefined"
            @mousedown.prevent
            @click="onRedo"
          />
        </UTooltip>
      </template>
      <!-- `aria-disabled`, never `disabled` (docs/UI-CHECKLIST.md §3, §5 —
           the same rule `AuthSubmit.vue` and the `refused` panel's
           "Normalise" button already follow): a disabled control with no
           reason is a defect, and the attribute alone removes it from the
           tab order, hiding that reason from anyone who cannot hover. -->
      <!-- Below `sm` the label is for assistive technology only, as "Read
           page" beside it: measured at 320 on 2026-09-17 with the view
           toggle in the bar, the right-hand group ran to 213px and left
           the "Editing" crumb 31px — "Editi…". The fill and the icon
           still say which control is the primary action (§2); the name
           and the tooltip say what it does (§4.3). -->
      <UTooltip :text="saveDisabledReason ?? 'Save this page.'">
        <UButton
          v-if="status === 'ready'"
          icon="i-lucide-save"
          variant="solid"
          color="primary"
          size="sm"
          :label="saveStatus === 'saving' ? 'Saving…' : 'Save'"
          :ui="{ label: 'max-sm:sr-only' }"
          :loading="saveStatus === 'saving'"
          :aria-disabled="saveDisabledReason ? 'true' : undefined"
          @click="onSave"
        />
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
    <!-- Loading: the read skeleton's shape, because the loaded editor is
         the read article's shape — a title line in `PageHeading`'s block
         (36px `headline-medium`, 32px `mb-8` under it) and text on the
         pane, on `doc-body`'s 26px lines. Not a slab: the editor draws no
         box of its own on the pane (`EditorSurface`). `e2e/editor.spec.ts`
         holds the response back and measures the title and the first line
         against the editor's first paragraph (docs/UI-CHECKLIST.md §3,
         "no layout shift on load — measure it"). -->
    <div v-if="status === 'idle' || status === 'loading'" data-testid="edit-skeleton" aria-hidden="true">
      <div class="mb-8 max-w-measure">
        <USkeleton class="h-9 w-2/3" data-testid="edit-skeleton-title" />
      </div>
      <!-- The prose lines are `DocBodySkeleton` — the one copy the read
           screen, this screen and `EditorSurface` share (§4.1). -->
      <DocBodySkeleton line-test-id="edit-skeleton-line" />
    </div>

    <!-- Never a dead end (§3): read-only is the nearest door, and the two
         `error.vue` gives — the workspaces list and sign-in — follow at the
         quieter Text emphasis so one action stays primary (§2). The
         not-found copy is `error.vue`'s reviewed paragraph, verbatim. -->
    <PageNotice v-else-if="status === 'forbidden'" icon="i-lucide-lock" heading="You don't have access to edit this page">
      Ask a workspace admin for write access, or open it read-only.
      <template #actions>
        <UButton variant="outline" icon="i-lucide-eye" :to="readUrl">Open read-only</UButton>
        <UButton icon="i-lucide-library-big" variant="ghost" color="neutral" :to="allWorkspacesUrl">Your workspaces</UButton>
        <UButton icon="i-lucide-log-in" variant="ghost" color="neutral" to="/login">Sign in</UButton>
      </template>
    </PageNotice>

    <PageNotice v-else-if="status === 'not-found'" icon="i-lucide-file-question" heading="This page does not exist">
      It may have been moved or deleted, or it may be somewhere you don't have access to — deep-wiki deliberately doesn't say which, so that a page you can't see is indistinguishable from one that was never there.
      <template #actions>
        <UButton icon="i-lucide-library-big" variant="solid" color="primary" :to="allWorkspacesUrl">Your workspaces</UButton>
        <UButton icon="i-lucide-log-in" variant="ghost" color="neutral" to="/login">Sign in</UButton>
      </template>
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
        <UButton variant="outline" icon="i-lucide-eye" :to="readUrl">Open read-only</UButton>
        <UButton color="error" variant="solid" icon="i-lucide-log-in" @click="confirmTakeOver">Take over editing</UButton>
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
        <UButton variant="outline" color="error" icon="i-lucide-eye" :to="readUrl">Open read-only</UButton>
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
      <!-- The document's own title is the screen's `<h1>` — the same
           heading, from the same component, in the same box the read
           screen renders it in, so the text under it does not move when
           the mode changes. No eyebrow and no supporting sentence: the
           breadcrumb already says "Editing", and a heading block repeating
           it would title the page twice. -->
      <PageHeading :heading="session?.title ?? ''" />

      <!-- The notices about the editor stand in the pane, directly above
           it, never in the contextual bar: measured at 320×900 with the
           lock lost, a bar holding them overflowed its width and the text
           wrapped to three lines inside the bar's fixed height, clipping
           (docs/UI-CHECKLIST.md §6). Every one of them is the chip tier —
           `InlineNotice tier="chip"`, the one-line notice about the thing
           directly below it (its tiers are stated once, in that
           component). Six hand-rolled copies of the same `div` lived here
           before, and the lock-lost line was a bare `span` — a fourth
           shape; checklist §4.1. -->
      <!-- Lock lost mid-session: the heartbeat answered `lost`, so this
           tab can no longer save. §3 "Error — fatal": says the work is
           kept, and carries the reload it names rather than only naming
           it (never a dead end). -->
      <InlineNotice v-if="heartbeat.status.value === 'lost'" tier="chip" tone="error" role="alert" class="mb-4">
        Lock lost — this tab can no longer save. Your unsaved changes are kept here to copy out; reload to start editing again.
        <template #actions>
          <UButton size="xs" variant="outline" color="error" icon="i-lucide-refresh-cw" @click="reloadAfterLockLost">Reload</UButton>
        </template>
      </InlineNotice>
      <!-- `stale`: a concurrent save already happened, and the server
           offers no document to merge — the only honest recovery is a
           reload, so the banner carries the action it names, and Save
           itself is disabled meanwhile (`saveDisabledReason`) rather than
           inviting a retry that would just 409 again on the same hash. -->
      <InlineNotice v-if="saveStatus === 'stale'" tier="chip" tone="error" role="alert" class="mb-4">
        {{ saveMessage }}
        <template #actions>
          <UButton size="xs" variant="outline" color="error" icon="i-lucide-refresh-cw" @click="reloadForNewerVersion">Reload</UButton>
        </template>
      </InlineNotice>
      <!-- `not-canonical`: distinct from `stale` above — this is D1's "the
           document is not its own fixed point", not a concurrent-edit
           conflict, so it must not read as one either. The one addition is
           the actionable exit docs/UI-CHECKLIST.md §3 requires for a
           recoverable error — the canonicalised text the server already
           computed, loaded back the same way `dead-anchor`'s exit loads
           `corrected`. -->
      <InlineNotice v-else-if="saveStatus === 'not-canonical'" tier="chip" tone="error" role="alert" class="mb-4">
        {{ saveMessage }} Nothing was saved; your edits are still in the editor below.
        <template #actions>
          <UButton size="xs" variant="outline" color="error" @click="useCanonicalDocument">Use the canonical document</UButton>
        </template>
      </InlineNotice>
      <!-- `dead-anchor`: distinct from `stale` above — this is not a
           concurrent-edit conflict, so it must not read as one (the bug
           this state exists to fix). The one addition is the actionable
           exit docs/UI-CHECKLIST.md §3 requires for a recoverable error,
           mirroring how the not-canonical 409 offers `canonical` back. -->
      <InlineNotice v-else-if="saveStatus === 'dead-anchor'" tier="chip" tone="error" role="alert" class="mb-4">
        {{ saveMessage }}
        <template #actions>
          <UButton size="xs" variant="outline" color="error" @click="useCorrectedDocument">Use the corrected document</UButton>
        </template>
      </InlineNotice>
      <!-- `forbidden`: a fatal error, not a recoverable one — retrying
           cannot succeed once write access is gone. §3: a fatal error
           "preserves any unsaved user input and says explicitly whether
           the work was lost or preserved" — this states both explicitly. -->
      <InlineNotice v-else-if="saveStatus === 'forbidden'" tier="chip" tone="error" role="alert" class="mb-4">
        {{ saveMessage }} Nothing was saved, but your edits are still here in this tab — copy them out before leaving if you need them.
        <template #actions>
          <UButton size="xs" variant="outline" color="error" icon="i-lucide-eye" :to="readUrl">Open read-only</UButton>
        </template>
      </InlineNotice>
      <!-- `network-error`: recoverable — `saveMessage` already states the
           work is preserved; this adds the real next action §3 requires
           ("Retry", never a dead end). -->
      <InlineNotice v-else-if="saveStatus === 'network-error'" tier="chip" tone="error" role="alert" class="mb-4">
        {{ saveMessage }}
        <template #actions>
          <UButton size="xs" variant="outline" color="error" icon="i-lucide-refresh-cw" @click="onSave">Retry</UButton>
        </template>
      </InlineNotice>
      <!-- `success`: "Saved." is §3's own example of a confirmation too
           weak to act on ("Saved as revision 12 · 2 min ago" is the bar).
           This names what was saved, and — `showSavedBanner` — stops
           claiming it once the document is dirty again, since a stale
           "Saved." next to unsaved edits is worse than no confirmation. -->
      <InlineNotice v-else-if="showSavedBanner" tier="chip" tone="success" class="mb-4">
        Saved “{{ session?.title }}”.
      </InlineNotice>
      <!-- The source view's refusal: the chip tier, above the text area
           it is about. The line is named by example — as typed beside as
           the pipeline would write it — because "not canonical" alone is
           not something a person can act on (§3, "recoverable"). -->
      <InlineNotice v-if="viewRefusal" tier="chip" tone="error" role="alert" class="mb-4" data-testid="editor-view-refusal">
        <template v-if="viewRefusal.construct">
          Line {{ viewRefusal.line }} holds {{ viewRefusal.construct }}, which the visual view does not support yet. Change it, or keep editing here.
        </template>
        <template v-else>
          Line {{ viewRefusal.line }} is not in canonical form. As typed: <code class="font-mono">{{ viewRefusal.typed }}</code> — canonical:
          <code class="font-mono">{{ viewRefusal.canonical }}</code> Write it the canonical way to open the visual view, or keep editing here.
        </template>
      </InlineNotice>
      <p data-testid="editor-view-status" role="status" aria-live="polite" class="sr-only">{{ viewAnnouncement }}</p>
      <!-- Both surfaces read `currentMarkdown` once, on mount, and are
           keyed alike so the corrected or canonical document loaded back
           after a refusal reaches whichever is up. -->
      <EditorSurface
        v-if="session && view === 'visual'"
        ref="editorSurface"
        :key="editorRemountKey"
        :markdown="currentMarkdown"
        :workspace-id="session.workspaceId"
        :page-id="nodeId"
        @update="onEditorUpdate"
        @history="onEditorHistory"
      />
      <EditorSourceSurface v-else-if="session" ref="sourceSurface" :key="`source-${editorRemountKey}`" :markdown="currentMarkdown" @update="onEditorUpdate" />
    </template>
  </AppShell>
</template>
