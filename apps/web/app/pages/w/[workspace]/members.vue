<script setup lang="ts">
/**
 * `/workspaces/:id/members` — who is in a workspace, who has been invited,
 * and the form that invites one more person.
 *
 * Until this screen existed, `POST /invitations` had no caller: the route
 * was built, tested, and reachable from nothing a person could click.
 *
 * Pre-build contract (docs/UI-CHECKLIST.md §2):
 * - Who: a workspace admin — someone holding `manage` on the workspace
 *   root — most often the person who just created it and is bringing
 *   their team in.
 * - Goal, in their words: "Get my team into this wiki."
 * - Single primary action: send an invitation. Nothing else on the
 *   screen is filled.
 * - Data: `GET /workspaces/:id/members` — the workspace's name, its root
 *   node id, the members (display name, email) and the pending
 *   invitations (email, starting grants, expiry). Nothing here is
 *   designed against a column that does not exist: there is no "last
 *   active", no avatar, no role name — a member's access is a set of
 *   grants, and the only one this screen shows is the one it wrote.
 * - Non-goals: no revoking, no changing a member's grants, no cells, no
 *   resending or cancelling an invitation, no per-shelf or per-book
 *   starting grant (a node picker this batch does not have). Each of
 *   those is recorded rather than half-built.
 * - Empty / overflow: a workspace with only its creator and no pending
 *   invitation is the normal first state, and both lists say so in the
 *   product's words. The member list is cut at the server's bound and
 *   the cut is stated, not hidden.
 *
 * **Absence and denial are one state.** The route answers `404` both for
 * a workspace that does not exist and for one the caller may not manage,
 * so a member with `read` cannot learn from this screen that a
 * membership list exists at all. The copy admits the ambiguity instead
 * of guessing (§3, "Permission-denied does not leak existence").
 *
 * **Timestamps** (§4.11): the expiry renders in the viewer's own zone
 * with the zone named, carries the instant in `<time datetime>`, and is
 * never server-rendered — the listing is fetched in `onMounted`, so no
 * row exists during SSR.
 *
 * **The workspace frame.** This screen opts into `layouts/workspace.vue`:
 * the sidebar is mounted once and survives a click here from another
 * screen, and on this screen it shows the management doors rather than
 * the tree (`sidebar: 'management'`). The breadcrumb carries the
 * workspace's name — what the eyebrow used to say by hand — so the
 * heading is a bare `<h1>`, the same contract read mode's `PageHeading
 * :heading="title"` keeps (docs/UI-CHECKLIST.md §4.4).
 *
 * **The invite form is a dialog.** It used to be a permanent column
 * beside the roster, and the owner's word for the result was "saturates"
 * (2026-09-16): a form most visits never fill, standing at full height
 * beside the list they came to read. Now the screen's one primary action
 * — "Invite someone", Filled, in the contextual bar where a screen's
 * actions stand (`AppShell`) — opens a `UModal`, which brings the focus
 * trap, the focus return to the button and Escape (§4.1, §5). Every
 * field, its description and the access radio group inside it are what
 * was reviewed; only where they stand changed. The two lists are the
 * screen's single column, on the reading measure: a roster row is one
 * line read left to right, the tree's own reasoning (docs/DESIGN-
 * SYSTEM.md §2.4), and 1216px of it is a scanning problem. Members first
 * (what exists), then the invitations still pending.
 *
 * **Closing with an address typed asks first.** Escape, the close
 * control and a click on the backdrop all route through one handler:
 * with the email field empty the dialog closes; with text in it, it
 * stays open and its footer swaps to "Discard this invitation?" with
 * Keep editing / Discard — inside the dialog, not a second dialog on
 * top, and not `window.confirm`. A shared confirm surface is arriving on
 * another branch and this screen must not grow its own copy (§4.1);
 * when it lands, this pair is what it replaces. A sent invitation closes
 * the dialog, and the confirmation is announced from a live region on
 * the screen — always in the DOM, never inside the dialog that just
 * closed — beside the pending list it names.
 */
import type { ActionValue } from '@deep-wiki/contracts';
import type { FormSubmitEvent } from '@nuxt/ui';
import { z } from 'zod';
import { formatRevisionDate } from '~/utils/format-revision-date';
import { workspacesUrl } from '~/utils/routes';

// Inside the workspace layout: the frame is mounted once and this screen
// renders only its pane (`layouts/workspace.vue`). A management screen:
// the sidebar beside it switches from the tree to everything that is
// management — this door among them, marked current — and back to the
// tree when the person returns to the workspace (`useSidebarMode`).
definePageMeta({ layout: 'workspace', sidebar: 'management' });

const route = useRoute();
// The address names the workspace by its slug (`/w/<slug>/members`,
// utils/routes.ts); the API takes it as it takes the id, and the listing
// names the id, which the frame and the invitation both need.
const workspaceSlug = route.params.workspace as string;

const { status, message, listing, inviteStatus, inviteMessage, load, invite } = useWorkspaceMembers(workspaceSlug);
const workspaceId = computed(() => listing.value?.workspace.id ?? null);
const allWorkspacesUrl = workspacesUrl();
// A signed-out visit leaves for sign-in and comes back (`useSignInRedirect`).
useSignInRedirect().redirectWhenSignedOut(status);

onMounted(() => {
  void load();
});

/**
 * The four actions of the permission lattice, granted on the workspace
 * root so the resolver inherits them everywhere below. Described in the
 * user's terms rather than the enum's, and in the order the lattice
 * ranks them (`read < comment < write < manage`).
 */
const ACCESS_OPTIONS: { value: ActionValue; label: string; description: string }[] = [
  { value: 'read', label: 'Read', description: 'Can open every shelf, book, chapter and page.' },
  { value: 'comment', label: 'Comment', description: 'Can read, and leave comments on any block.' },
  { value: 'write', label: 'Write', description: 'Can read, comment, and edit or create pages anywhere.' },
  { value: 'manage', label: 'Manage', description: 'Everything above, plus members, invitations and settings. Another admin.' },
];

const inviteSchema = z.object({
  email: z.string().trim().min(1, 'Enter an email address').email('Enter a valid email address'),
  action: z.enum(['read', 'comment', 'write', 'manage']),
});

const inviteState = reactive<{ email: string; action: ActionValue }>({ email: '', action: 'read' });

/** The dialog's `<form>`, so the footer's submit control can belong to it from outside it. */
const INVITE_FORM_ID = 'invite-form';

const inviteOpen = ref(false);
/** True while the footer asks "Discard this invitation?" instead of offering Cancel / Send. */
const discardPrompt = ref(false);
/** Dirty means an address is typed: the access choice alone is not work worth guarding. */
const inviteDirty = computed(() => inviteState.email.trim().length > 0);

const keepEditingButton = useTemplateRef<{ $el?: HTMLElement } | HTMLElement | null>('keep-editing');

function openInvite(): void {
  discardPrompt.value = false;
  inviteOpen.value = true;
}

function closeInvite(): void {
  inviteOpen.value = false;
  discardPrompt.value = false;
}

/** What Escape, the close control, a backdrop click and Cancel all mean: close — unless there is something to lose, then ask. */
function requestClose(): void {
  if (!inviteDirty.value) {
    closeInvite();
    return;
  }
  discardPrompt.value = true;
  void nextTick(() => {
    const target = keepEditingButton.value;
    const element = target instanceof HTMLElement ? target : target?.$el;
    element?.focus();
  });
}

/** `UModal` asks to close by emitting `update:open` false; the dialog is controlled, so nothing closes unless this says so. */
function onInviteOpenChange(open: boolean): void {
  if (open) openInvite();
  else requestClose();
}

function keepEditing(): void {
  discardPrompt.value = false;
}

function discardInvite(): void {
  inviteState.email = '';
  inviteState.action = 'read';
  closeInvite();
}

async function onInvite(event: FormSubmitEvent<{ email: string; action: ActionValue }>): Promise<void> {
  await invite({ email: event.data.email, action: event.data.action });
  if (inviteStatus.value === 'sent') {
    inviteState.email = '';
    closeInvite();
  }
}

function describeGrants(grants: readonly { action: ActionValue }[]): string {
  const strongest = [...grants].sort((a, b) => rank(b.action) - rank(a.action))[0];
  return strongest ? (ACCESS_OPTIONS.find((o) => o.value === strongest.action)?.label ?? strongest.action) : 'No access';
}

function rank(action: ActionValue): number {
  return ACCESS_OPTIONS.findIndex((o) => o.value === action);
}

const inviteFieldError = computed(() => (inviteStatus.value === 'invalid' ? inviteMessage.value : undefined));

useSeoMeta({ title: 'Members — deep-wiki' });
</script>

<template>
  <AppShell :workspace-id="workspaceId" :workspace-slug="workspaceSlug" title="Members">
    <template #header-end>
      <!-- The screen's one primary action, Filled, at the bar's size
           (§7.2) — beside the breadcrumb, where a screen's actions stand.
           Offered only once there is a roster to add to: on the denied,
           failed and signed-out states there is nothing to invite into. -->
      <UButton v-if="listing" color="primary" variant="solid" size="sm" icon="i-lucide-user-plus" @click="openInvite">Invite someone</UButton>
    </template>

    <!-- The breadcrumb already names the workspace and links back to it
         (the top crumb, `/w/<slug>`), so a bare `<h1>`
         is the whole heading block here — the same contract read mode's
         `PageHeading :heading="title"` keeps once a screen stands inside
         the frame (§4.4: a screen's `<h1>` keeps one type role across
         every state it has). -->
    <PageHeading heading="Members" />

    <!-- The skeleton occupies the one-column box the loaded content will
         (§3): a heading-sized bar, then rows, for each of the two lists. -->
    <div v-if="status === 'idle' || status === 'loading'" data-testid="members-skeleton" class="space-y-8" aria-hidden="true">
      <div class="space-y-2">
        <USkeleton class="mb-4 h-8 w-40" />
        <USkeleton class="h-10 w-full" />
        <USkeleton class="h-10 w-5/6" />
        <USkeleton class="h-10 w-4/6" />
      </div>
      <div class="space-y-2">
        <USkeleton class="mb-4 h-8 w-56" />
        <USkeleton class="h-10 w-full" />
      </div>
    </div>

    <!-- One state for "no such workspace" and "not yours to manage",
         because the server refuses to tell them apart, on purpose. The
         copy says so rather than picking one. -->
    <PageNotice v-else-if="status === 'not-found'" icon="i-lucide-lock" heading="Nothing to manage here" :level="2">
      This workspace does not exist, or you do not manage it — the two are deliberately indistinguishable. A workspace's
      admin can make you one.
      <template #actions>
        <UButton :to="allWorkspacesUrl" variant="outline" color="neutral" icon="i-lucide-library-big">Your workspaces</UButton>
      </template>
    </PageNotice>

    <PageNotice
      v-else-if="status === 'network-error'"
      icon="i-lucide-circle-alert"
      heading="Couldn't load the members"
      :level="2"
      tone="error"
      role="alert"
    >
      {{ message }}
      <template #actions>
        <UButton variant="outline" color="error" icon="i-lucide-refresh-cw" @click="load">Retry</UButton>
      </template>
    </PageNotice>

    <div v-else-if="listing" class="space-y-8">
      <!-- Always in the DOM so the announcement is made when its text
           appears (§5) — on the screen, never inside the dialog, which has
           closed by the time there is something to say. Styled as a
           success chip only while it has one. -->
      <p
        role="status"
        aria-live="polite"
        :class="inviteStatus === 'sent' ? 'rounded-md bg-success-container px-3 py-2 text-body-small text-on-success-container' : 'sr-only'"
      >
        {{ inviteStatus === 'sent' ? inviteMessage : '' }}
      </p>

      <!-- ── Members ─────────────────────────────────────────────────── -->
      <!-- "Current", because the `<h1>` above already says "Members" and a
           second "Members" one level down repeats the word and spends the
           level for nothing (§4.4) — it is the counterpart of "Pending". -->
      <section aria-labelledby="members-heading">
        <h2 id="members-heading" class="text-headline-small text-highlighted mb-4">Current members</h2>
        <p v-if="listing.members.length === 0" class="text-body-medium text-muted">No members yet.</p>
        <UCard v-else variant="soft" :ui="{ body: 'p-2' }">
          <ul class="divide-y divide-default">
            <li v-for="member in listing.members" :key="member.id" class="flex min-h-10 flex-wrap items-center gap-x-4 gap-y-1 px-2 py-2">
              <UIcon name="i-lucide-user" class="size-5 shrink-0 text-muted" aria-hidden="true" />
              <span class="min-w-0 truncate text-body-large text-default" :title="member.displayName">{{ member.displayName }}</span>
              <span class="min-w-0 truncate text-body-small text-muted" :title="member.email">{{ member.email }}</span>
            </li>
          </ul>
        </UCard>
        <p v-if="listing.truncated" class="text-body-small text-muted mt-2">
          Only the first {{ listing.members.length }} members are shown; this workspace has more.
        </p>
      </section>

      <!-- ── Pending ───────────────────────────────────────────────── -->
      <section aria-labelledby="pending-heading">
        <h2 id="pending-heading" class="text-headline-small text-highlighted mb-4">Pending invitations</h2>
        <p v-if="listing.invitations.length === 0" class="text-body-medium text-muted">
          No pending invitations. Everyone invited so far has accepted, or their link has expired.
        </p>
        <UCard v-else variant="soft" :ui="{ body: 'p-2' }">
          <ul class="divide-y divide-default">
            <li
              v-for="invitation in listing.invitations"
              :key="invitation.id"
              class="flex min-h-10 flex-wrap items-center gap-x-4 gap-y-1 px-2 py-2"
            >
              <UIcon name="i-lucide-mail" class="size-5 shrink-0 text-muted" aria-hidden="true" />
              <span class="min-w-0 flex-1 truncate text-body-large text-default" :title="invitation.email">{{ invitation.email }}</span>
              <!-- The access is a word, never only a colour (§5). -->
              <UBadge variant="soft" color="secondary" size="sm">{{ describeGrants(invitation.startingGrants) }}</UBadge>
              <span class="text-body-small text-muted">
                Expires <time :datetime="invitation.expiresAt">{{ formatRevisionDate(invitation.expiresAt) }}</time>
              </span>
            </li>
          </ul>
        </UCard>
      </section>
    </div>

    <!-- ── Invite ────────────────────────────────────────────────────── -->
    <!-- Controlled, not `v-model`: every way the dialog asks to close —
         Escape, the close control, the backdrop, Cancel — goes through
         `requestClose`, which asks first when an address is typed. The
         description is the same sentence the card used to open with. The
         headline and description keep the library's own type, as the
         tree's New item and Rename dialogs do (§4.1: match the nearest
         screen) — and a project type role in a `:ui` slot override would
         be dropped by tailwind-merge anyway (docs/TODO.md, 2026-09-16). -->
    <UModal
      :open="inviteOpen"
      title="Invite someone"
      description="They get an email with a link that expires. Someone who already has an account joins with it; someone who does not creates one on the way in."
      @update:open="onInviteOpenChange"
    >
      <template #body>
        <UForm :id="INVITE_FORM_ID" :schema="inviteSchema" :state="inviteState" class="space-y-6" @submit="onInvite">
          <div
            v-if="inviteStatus === 'network-error' || inviteStatus === 'not-found' || inviteStatus === 'unauthenticated'"
            role="alert"
            class="flex items-start gap-3 rounded-md bg-error-container p-4"
          >
            <UIcon name="i-lucide-circle-alert" class="size-5 shrink-0 text-on-error-container" aria-hidden="true" />
            <p class="text-body-medium text-on-error-container">{{ inviteMessage }}</p>
          </div>

          <UFormField label="Email" name="email" required :error="inviteFieldError">
            <UInput v-model="inviteState.email" type="email" class="w-full" autocomplete="off" spellcheck="false" />
          </UFormField>

          <UFormField
            label="Access"
            name="action"
            required
            help="Applies to the whole workspace. Finer-grained access — one shelf, one book — is set afterwards, per node."
          >
            <URadioGroup v-model="inviteState.action" :items="ACCESS_OPTIONS" />
          </UFormField>
        </UForm>
      </template>

      <template #footer>
        <!-- Asking replaces the actions rather than stacking a second
             dialog on the first: the question and its two answers stand
             where Cancel and Send stood, announced, with focus on the safe
             answer. Discard is the destructive one and carries a boundary
             (docs/DESIGN-SYSTEM.md §9.1). -->
        <template v-if="discardPrompt">
          <p id="invite-discard-question" role="status" class="me-auto text-body-medium text-default">Discard this invitation?</p>
          <UButton ref="keep-editing" variant="outline" color="neutral" aria-describedby="invite-discard-question" @click="keepEditing">Keep editing</UButton>
          <UButton color="error" variant="solid" icon="i-lucide-trash-2" aria-describedby="invite-discard-question" @click="discardInvite">Discard</UButton>
        </template>
        <template v-else>
          <UButton class="ms-auto" variant="outline" color="neutral" @click="requestClose">Cancel</UButton>
          <UButton type="submit" :form="INVITE_FORM_ID" color="primary" variant="solid" icon="i-lucide-send" :loading="inviteStatus === 'sending'">
            {{ inviteStatus === 'sending' ? 'Sending…' : 'Send invitation' }}
          </UButton>
        </template>
      </template>
    </UModal>
  </AppShell>
</template>
