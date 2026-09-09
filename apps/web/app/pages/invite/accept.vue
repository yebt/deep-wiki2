<script setup lang="ts">
import { z } from 'zod';
import { AcceptInvitationRequestSchema } from '@deep-wiki/contracts';
import type { FormSubmitEvent } from '@nuxt/ui';

useHead({ htmlAttrs: { lang: 'en' } });
useSeoMeta({
  title: 'Accept your invitation — deep-wiki',
  description: 'Set up your account to join a deep-wiki workspace.',
});

/**
 * Pre-build contract (docs/UI-CHECKLIST.md §2):
 * - Who: someone invited to a workspace, following the emailed link, who
 *   may or may not already have an account on this instance.
 * - Goal: "Join the workspace I was invited to."
 * - Single primary action: submit a name and password to accept.
 * - Data: only the `token` query parameter — the target workspace and
 *   starting grants are resolved server-side and never rendered here
 *   before acceptance (invitations spec).
 * - Non-goal: no grant/role picker — starting grants are the inviter's
 *   choice, fixed at invitation-creation time.
 * - This screen's three dead-link states (invalid, expired, already
 *   used) are each their own state per docs/UI-CHECKLIST.md §3, mapped
 *   directly from the API's distinct 400/410/409 responses.
 */

const route = useRoute();
const token = computed(() => (typeof route.query.token === 'string' ? route.query.token : ''));

const { status, message, accept } = useAcceptInvitation();

/** Extends the wire contract's `password`/`displayName` fields with the
 * client-only `confirmPassword` field and a cross-field match check —
 * `token` is never part of this form, it comes from the URL. */
const acceptSchema = z
  .object({
    displayName: AcceptInvitationRequestSchema.shape.displayName.min(1, 'Enter your name'),
    password: AcceptInvitationRequestSchema.shape.password.min(8, 'Use at least 8 characters'),
    confirmPassword: z.string().min(1, 'Confirm your password'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

const fields = [
  { name: 'displayName', type: 'text' as const, label: 'Your name', required: true, autocomplete: 'name', defaultValue: '' },
  {
    name: 'password',
    type: 'password' as const,
    label: 'Choose a password',
    required: true,
    autocomplete: 'new-password',
    defaultValue: '',
  },
  {
    name: 'confirmPassword',
    type: 'password' as const,
    label: 'Confirm password',
    required: true,
    autocomplete: 'new-password',
    defaultValue: '',
  },
];

async function onSubmit(event: FormSubmitEvent<{ displayName: string; password: string; confirmPassword: string }>) {
  await accept({ token: token.value, password: event.data.password, displayName: event.data.displayName });
}
</script>

<template>
  <AuthShell heading="Join your workspace">
    <div v-if="!token" class="flex items-start gap-3 rounded-md bg-error-container p-4">
      <UIcon name="i-lucide-link-2-off" class="size-5 shrink-0 text-on-error-container" aria-hidden="true" />
      <div>
        <p class="text-body-large-emphasized text-on-error-container">This invitation link isn't valid.</p>
        <p class="text-body-medium text-on-error-container mt-1">
          Check that you copied the whole link, or ask whoever invited you to send it again.
        </p>
      </div>
    </div>

    <div v-else-if="status === 'invalid'" class="flex items-start gap-3 rounded-md bg-error-container p-4">
      <UIcon name="i-lucide-link-2-off" class="size-5 shrink-0 text-on-error-container" aria-hidden="true" />
      <div>
        <p class="text-body-large-emphasized text-on-error-container">{{ message }}</p>
        <p class="text-body-medium text-on-error-container mt-1">
          Check that you copied the whole link, or ask whoever invited you to send it again.
        </p>
      </div>
    </div>

    <div v-else-if="status === 'expired'" class="flex items-start gap-3 rounded-md bg-error-container p-4">
      <UIcon name="i-lucide-clock-alert" class="size-5 shrink-0 text-on-error-container" aria-hidden="true" />
      <div>
        <p class="text-body-large-emphasized text-on-error-container">{{ message }}</p>
      </div>
    </div>

    <div v-else-if="status === 'already-used'" class="flex items-start gap-3 rounded-md bg-warning-container p-4">
      <UIcon name="i-lucide-badge-check" class="size-5 shrink-0 text-on-warning-container" aria-hidden="true" />
      <div>
        <p class="text-body-large-emphasized text-on-warning-container">{{ message }}</p>
        <NuxtLink to="/login" class="text-label-large text-primary hover:underline mt-2 inline-block">
          Sign in
        </NuxtLink>
      </div>
    </div>

    <div v-else-if="status === 'success'" role="status" aria-live="polite" class="flex items-start gap-3 rounded-md bg-success-container p-4">
      <UIcon name="i-lucide-circle-check" class="size-5 shrink-0 text-on-success-container" aria-hidden="true" />
      <div>
        <p class="text-body-large-emphasized text-on-success-container">{{ message }}</p>
        <NuxtLink to="/login" class="text-label-large text-primary hover:underline mt-2 inline-block">
          Continue to sign in
        </NuxtLink>
      </div>
    </div>

    <UAuthForm
      v-else
      description="All fields are required."
      :schema="acceptSchema"
      :fields="fields"
      :loading="status === 'loading'"
      @submit="onSubmit"
    >
      <!-- See `AuthSubmit`. This is the screen the guard matters most on:
           the invitation token is single-use, and a native POST before
           hydration re-renders the form empty with no indication that
           anything went wrong — leaving the invitee to wonder whether the
           attempt consumed their one link. -->
      <template #submit="{ loading }">
        <AuthSubmit :label="status === 'loading' ? 'Joining…' : 'Join workspace'" :loading="loading" />
      </template>

      <template #validation>
        <div v-if="status === 'network-error'" role="alert" class="flex items-start gap-3 rounded-md bg-error-container p-4">
          <UIcon name="i-lucide-circle-alert" class="size-5 shrink-0 text-on-error-container" aria-hidden="true" />
          <p class="text-body-medium text-on-error-container">{{ message }}</p>
        </div>
      </template>
    </UAuthForm>
  </AuthShell>
</template>
