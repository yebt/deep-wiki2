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
 * the sidebar (its switcher, its tree, its doors) is mounted once and
 * survives a click here from another screen. The breadcrumb now carries
 * the workspace's name — what the eyebrow used to say by hand — so the
 * heading is a bare `<h1>`, the same contract read mode's `PageHeading
 * :heading="title"` keeps (docs/UI-CHECKLIST.md §4.4). The invite form
 * and the two lists use the *pane's* width as columns, not the
 * viewport's — `@container`, the dashboard's own rule — so the same
 * layout holds with the sidebar open, closed or resized: stacked narrow,
 * the invite form beside the member list from `@2xl`.
 */
import type { ActionValue } from '@deep-wiki/contracts';
import type { FormSubmitEvent } from '@nuxt/ui';
import { z } from 'zod';
import { formatRevisionDate } from '~/utils/format-revision-date';

// Inside the workspace layout: the frame is mounted once and this screen
// renders only its pane, so the sidebar's tree keeps its scroll and its
// folds when the person arrives here from a row (`layouts/workspace.vue`).
definePageMeta({ layout: 'workspace' });

const route = useRoute();
const workspaceId = route.params.workspaceId as string;

const { status, message, listing, inviteStatus, inviteMessage, load, invite } = useWorkspaceMembers(workspaceId);

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

async function onInvite(event: FormSubmitEvent<{ email: string; action: ActionValue }>): Promise<void> {
  await invite({ email: event.data.email, action: event.data.action });
  if (inviteStatus.value === 'sent') {
    inviteState.email = '';
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
  <AppShell :workspace-id="workspaceId" title="Members" column="wide">
    <!-- The breadcrumb already names the workspace and links back to it
         (the top crumb, `/workspaces/${workspaceId}`), so a bare `<h1>`
         is the whole heading block here — the same contract read mode's
         `PageHeading :heading="title"` keeps once a screen stands inside
         the frame (§4.4: a screen's `<h1>` keeps one type role across
         every state it has). -->
    <PageHeading heading="Members" />

    <!-- The skeleton occupies the two-column box the loaded content will
         (§3): a wide bar for the invite card, three narrower ones for the
         member rows beside it from `@2xl`, stacked below it. -->
    <div v-if="status === 'idle' || status === 'loading'" data-testid="members-skeleton" class="@container" aria-hidden="true">
      <div class="grid items-start gap-6 @2xl:grid-cols-2">
        <USkeleton class="h-56 w-full" />
        <div class="space-y-2">
          <USkeleton class="h-10 w-full" />
          <USkeleton class="h-10 w-5/6" />
          <USkeleton class="h-10 w-4/6" />
        </div>
      </div>
    </div>

    <PageNotice v-else-if="status === 'unauthenticated'" icon="i-lucide-log-in" heading="Sign in to manage members" :level="2">
      Your session has ended, or you have not signed in on this device yet.
      <template #actions>
        <UButton to="/login" color="primary" variant="solid" size="lg" icon="i-lucide-log-in">Sign in</UButton>
      </template>
    </PageNotice>

    <!-- One state for "no such workspace" and "not yours to manage",
         because the server refuses to tell them apart, on purpose. The
         copy says so rather than picking one. -->
    <PageNotice v-else-if="status === 'not-found'" icon="i-lucide-lock" heading="Nothing to manage here" :level="2">
      This workspace does not exist, or you do not manage it — the two are deliberately indistinguishable. A workspace's
      admin can make you one.
      <template #actions>
        <UButton to="/workspaces" variant="outline" color="neutral" icon="i-lucide-library-big">Your workspaces</UButton>
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

    <div v-else-if="listing" class="@container">
      <!-- The pane's width, not the viewport's, decides the columns
           (dashboard's own rule): the invite form and its own pending list
           stand together — the primary action beside the list it directly
           produces — with the member roster beside them from `@2xl`, both
           stacked in reading order below it. -->
      <div class="grid items-start gap-6 @2xl:grid-cols-2">
        <div class="space-y-8">
          <!-- ── Invite ────────────────────────────────────────────────── -->
          <section aria-labelledby="invite-heading">
            <h2 id="invite-heading" class="text-headline-small text-highlighted mb-4">Invite someone</h2>
            <UCard variant="soft">
              <UForm :schema="inviteSchema" :state="inviteState" class="space-y-6" @submit="onInvite">
                <p class="text-body-small text-muted">
                  They get an email with a link that expires. Someone who already has an account joins with it; someone who
                  does not creates one on the way in.
                </p>

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

                <AuthSubmit :label="inviteStatus === 'sending' ? 'Sending…' : 'Send invitation'" :loading="inviteStatus === 'sending'" />
              </UForm>
            </UCard>

            <!-- Always in the DOM so the announcement is made when its text
                 appears (§5); styled as a success chip only while it has one. -->
            <p
              role="status"
              aria-live="polite"
              :class="inviteStatus === 'sent' ? 'mt-4 rounded-md bg-success-container px-3 py-2 text-body-small text-on-success-container' : 'sr-only'"
            >
              {{ inviteStatus === 'sent' ? inviteMessage : '' }}
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

        <!-- ── Members ─────────────────────────────────────────────────── -->
        <section aria-labelledby="members-heading">
          <h2 id="members-heading" class="text-headline-small text-highlighted mb-4">Members</h2>
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
      </div>
    </div>
  </AppShell>
</template>
