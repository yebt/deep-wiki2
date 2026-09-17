<script setup lang="ts">
/**
 * `/workspaces/new` — create a workspace.
 *
 * Until this screen existed, `createWorkspace()` was reachable only from
 * `packages/db/seed.ts`: a team could not start using deep-wiki without a
 * developer running a script against the database.
 *
 * Pre-build contract (docs/UI-CHECKLIST.md §2):
 * - Who: a signed-in user with no workspace yet — most often the person
 *   who set the instance up and is about to bring their team in — or an
 *   existing member starting a second one, within their plan.
 * - Goal, in their words: "Start a wiki for my team."
 * - Single primary action: create. There is exactly one filled button.
 * - Data: `workspaces.name` and `workspaces.slug` — the two columns
 *   `POST /workspaces` takes — and, on refusal, the plan's name and its
 *   `max_workspaces`, which the route returns so the number can be shown
 *   rather than described.
 * - Non-goals: no settings, no member picking, no template choice; the
 *   workspace is created empty and the next screens do the rest.
 * - Empty / overflow: the untouched form is the empty state; a name
 *   longer than the limit is refused by the schema before it is sent.
 *
 * **The plan limit is a state, not an edge case.** A user at their limit
 * sees the number, the plan's name, and the one thing they can do (open
 * the workspaces they have); the form is gone because nothing typed into
 * it could succeed. A user with no plan at all — which is what
 * self-registration and invitation acceptance produce today — is told
 * that only the instance operator can change it. Both are `role="status"`
 * (the user asked and was answered), never an alert.
 *
 * **A taken slug keeps the form.** It is the one refusal the user can fix
 * in place, so the error is attached to the slug field and nothing typed
 * is discarded (§3, "Error — fatal … preserves any unsaved user input").
 *
 * **The slug follows the name until it is edited by hand**, through the
 * same `slugifyTitle` the server validates against, so what the user sees
 * in the field is exactly what will be accepted — and once they touch the
 * slug, their choice is not overwritten by further typing in the name.
 */
import { CreateWorkspaceRequestSchema, slugifyTitle, WORKSPACE_NAME_MAX_LENGTH } from '@deep-wiki/contracts';
import type { FormSubmitEvent } from '@nuxt/ui';
import { membersUrl, workspaceUrl, workspacesUrl } from '~/utils/routes';

const { status, message, limit, workspace, create } = useCreateWorkspace();
// A signed-out visit leaves for sign-in and comes back (`useSignInRedirect`).
useSignInRedirect().redirectWhenSignedOut(status);

const schema = CreateWorkspaceRequestSchema.extend({
  name: CreateWorkspaceRequestSchema.shape.name.min(1, 'Give the workspace a name').max(WORKSPACE_NAME_MAX_LENGTH, `Use at most ${WORKSPACE_NAME_MAX_LENGTH} characters`),
  slug: CreateWorkspaceRequestSchema.shape.slug.refine((slug) => slug.length > 0, { message: 'Choose a slug' }),
});

const state = reactive({ name: '', slug: '' });
const slugEdited = ref(false);

watch(
  () => state.name,
  (name) => {
    if (!slugEdited.value) state.slug = slugifyTitle(name);
  },
);

function onSlugInput(): void {
  slugEdited.value = true;
}

const slugError = computed(() => (status.value === 'slug-taken' ? message.value : undefined));

async function onSubmit(event: FormSubmitEvent<{ name: string; slug: string }>): Promise<void> {
  await create({ name: event.data.name, slug: event.data.slug });
}

/** The slug the created workspace answers to — what every address to it now carries; empty until one exists. */
const createdSlug = computed(() => workspace.value?.slug ?? '');

const allWorkspacesUrl = workspacesUrl();

useSeoMeta({ title: 'New workspace — deep-wiki' });
</script>

<template>
  <AppShell column="narrow">
    <!-- `narrow`: one card holding a short form, the column the auth
         screens stand in (docs/DESIGN-SYSTEM.md §2.4). -->
    <PageHeading
      heading="New workspace"
      description="A workspace is a team's wiki: its shelves, books and pages, its members, and its own permissions. You will be its admin."
    />

    <PageNotice
      v-if="status === 'plan-limit'"
      icon="i-lucide-lock"
      heading="You have reached your plan's limit"
      :level="2"
    >
      Your plan, <strong class="text-body-medium text-highlighted">{{ limit?.planName }}</strong>, allows
      {{ limit?.maxWorkspaces }} {{ limit?.maxWorkspaces === 1 ? 'workspace' : 'workspaces' }}, and you already own that many.
      A larger plan is assigned by the instance operator.
      <template #actions>
        <UButton :to="allWorkspacesUrl" variant="outline" color="neutral" icon="i-lucide-library-big">Your workspaces</UButton>
      </template>
    </PageNotice>

    <PageNotice v-else-if="status === 'no-plan'" icon="i-lucide-lock" heading="Your account has no plan yet" :level="2">
      Every workspace is bounded by a plan, and none has been assigned to your account. Ask the instance operator
      to assign one; nothing else on this screen can change that.
      <template #actions>
        <UButton :to="allWorkspacesUrl" variant="outline" color="neutral" icon="i-lucide-library-big">Your workspaces</UButton>
      </template>
    </PageNotice>

    <PageNotice v-else-if="status === 'success'" icon="i-lucide-circle-check" heading="Workspace created" :level="2">
      {{ message }} Invite the people who will work in it, or open its navigation tree and start writing.
      <template #actions>
        <UButton :to="membersUrl(createdSlug)" color="primary" variant="solid" size="lg" icon="i-lucide-user-plus">
          Invite your team
        </UButton>
        <UButton :to="workspaceUrl(createdSlug)" variant="outline" color="neutral" icon="i-lucide-house">
          Open the workspace
        </UButton>
      </template>
    </PageNotice>

    <!-- M3's Filled card on the app ground (§9.4), the same component and
         tone as the auth card this form is nearest to. -->
    <UCard v-else variant="soft">
      <UForm :schema="schema" :state="state" class="space-y-6" @submit="onSubmit">
        <p class="text-body-small text-muted">Both fields are required.</p>

        <div
          v-if="status === 'network-error'"
          role="alert"
          class="flex items-start gap-3 rounded-md bg-error-container p-4"
        >
          <UIcon name="i-lucide-circle-alert" class="size-5 shrink-0 text-on-error-container" aria-hidden="true" />
          <p class="text-body-medium text-on-error-container">{{ message }} What you typed is still here.</p>
        </div>

        <UFormField label="Name" name="name" required help="How the workspace appears in lists and headings.">
          <UInput v-model="state.name" class="w-full" autocomplete="organization" />
        </UFormField>

        <UFormField
          label="Slug"
          name="slug"
          required
          :error="slugError"
          help="The workspace's address: lowercase letters, digits and single hyphens. It follows the name until you edit it."
        >
          <UInput v-model="state.slug" class="w-full" autocomplete="off" spellcheck="false" @input="onSlugInput" />
        </UFormField>

        <AuthSubmit :label="status === 'loading' ? 'Creating…' : 'Create workspace'" :loading="status === 'loading'" />
      </UForm>
    </UCard>
  </AppShell>
</template>
