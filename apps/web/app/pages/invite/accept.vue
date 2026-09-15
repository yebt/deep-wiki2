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
  <AuthShell heading="Join your workspace" description="Your team’s design documents, decisions and runbooks.">
    <!-- The invitee has never seen the product, and the workspace they are
         joining is resolved server-side and never rendered here — so the
         supporting sentence is the same one line of orientation the sign-in
         screen carries: what is inside, in the product's own words. -->
    <!-- Every result here is the bar tier (`InlineNotice`). The three that
         arrive after a submit (invalid, expired, already used) are alerts
         and take the focus the submit control held; the joined confirmation
         is a status and takes it too. Each dead-link state offers a way out
         (docs/UI-CHECKLIST.md §3, never a dead end): an invitation cannot be
         re-requested by the invitee, so the door is the one someone who
         already has an account needs — sign in — the same exit
         `/reset-password`'s no-token state gives with "Request a new link".
         Measured on 2026-09-14, this screen with no token rendered zero
         actions. -->
    <InlineNotice v-if="!token" tier="bar" tone="error" icon="i-lucide-link-2-off" title="This invitation link isn't valid.">
      Check that you copied the whole link, or ask whoever invited you to send it again.
      <template #actions>
        <UButton to="/login" color="error" variant="outline" icon="i-lucide-log-in">Sign in instead</UButton>
      </template>
    </InlineNotice>

    <InlineNotice v-else-if="status === 'invalid'" tier="bar" tone="error" icon="i-lucide-link-2-off" :title="message" role="alert" focus>
      Check that you copied the whole link, or ask whoever invited you to send it again.
      <template #actions>
        <UButton to="/login" color="error" variant="outline" icon="i-lucide-log-in">Sign in instead</UButton>
      </template>
    </InlineNotice>

    <InlineNotice v-else-if="status === 'expired'" tier="bar" tone="error" icon="i-lucide-clock-alert" :title="message" role="alert" focus>
      <template #actions>
        <UButton to="/login" color="error" variant="outline" icon="i-lucide-log-in">Sign in instead</UButton>
      </template>
    </InlineNotice>

    <InlineNotice v-else-if="status === 'already-used'" tier="bar" tone="warning" icon="i-lucide-badge-check" :title="message" role="alert" focus>
      <template #actions>
        <NuxtLink to="/login" class="inline-flex min-h-6 items-center text-label-large text-primary hover:underline">
          Sign in
        </NuxtLink>
      </template>
    </InlineNotice>

    <InlineNotice v-else-if="status === 'success'" tier="bar" tone="success" icon="i-lucide-circle-check" :title="message" focus>
      <template #actions>
        <NuxtLink to="/login" class="inline-flex min-h-6 items-center text-label-large text-primary hover:underline">
          Continue to sign in
        </NuxtLink>
      </template>
    </InlineNotice>

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
        <InlineNotice v-if="status === 'network-error'" tier="bar" tone="error" icon="i-lucide-circle-alert" role="alert">
          {{ message }}
        </InlineNotice>
      </template>
    </UAuthForm>
  </AuthShell>
</template>
