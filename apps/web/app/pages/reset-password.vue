<script setup lang="ts">
import { z } from 'zod';
import { PasswordResetConfirmRequestSchema } from '@deep-wiki/contracts';
import type { FormSubmitEvent } from '@nuxt/ui';

useHead({ htmlAttrs: { lang: 'en' } });
useSeoMeta({
  title: 'Set a new password — deep-wiki',
  description: 'Choose a new password for your deep-wiki account.',
});

/**
 * Pre-build contract (docs/UI-CHECKLIST.md §2):
 * - Who: someone who followed the emailed reset link.
 * - Goal: "Set a new password so I can sign back in."
 * - Single primary action: submit a new password (typed twice).
 * - Data: only the `token` query parameter — the account it belongs to
 *   is never exposed to this screen (authentication spec — reset
 *   responses do not disclose account existence).
 * - This screen's own dead-link state (missing/invalid/expired token) is
 *   distinct from a generic error — docs/UI-CHECKLIST.md §3.
 */

const route = useRoute();
const token = computed(() => (typeof route.query.token === 'string' ? route.query.token : ''));

const { status, message, confirmReset } = usePasswordResetConfirm();

/** Extends the wire contract's `newPassword` field with the client-only
 * `confirmPassword` field and a cross-field match check — `token` is
 * never part of this form, it comes from the URL. */
const confirmSchema = z
  .object({
    newPassword: PasswordResetConfirmRequestSchema.shape.newPassword.min(8, 'Use at least 8 characters'),
    confirmPassword: z.string().min(1, 'Confirm your new password'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

const fields = [
  {
    name: 'newPassword',
    type: 'password' as const,
    label: 'New password',
    required: true,
    autocomplete: 'new-password',
    defaultValue: '',
  },
  {
    name: 'confirmPassword',
    type: 'password' as const,
    label: 'Confirm new password',
    required: true,
    autocomplete: 'new-password',
    defaultValue: '',
  },
];

async function onSubmit(event: FormSubmitEvent<{ newPassword: string; confirmPassword: string }>) {
  await confirmReset({ token: token.value, newPassword: event.data.newPassword });
}
</script>

<template>
  <AuthShell heading="Set a new password">
    <!-- Every result here is the bar tier (`InlineNotice`). The two that
         arrive after a submit take the focus the submit control held and
         are announced — the refused link as an alert (a failure the user
         did not ask for), the changed password as a status. The no-token
         state renders on first paint with nothing to take focus from. -->
    <InlineNotice v-if="!token" tier="bar" tone="error" icon="i-lucide-link-2-off" title="This password reset link isn't valid.">
      Request a new one and use the freshest link from your inbox.
      <template #actions>
        <UButton to="/forgot-password" color="error" variant="outline">Request a new link</UButton>
      </template>
    </InlineNotice>

    <InlineNotice v-else-if="status === 'invalid-or-expired'" tier="bar" tone="error" icon="i-lucide-link-2-off" :title="message" role="alert" focus>
      <template #actions>
        <UButton to="/forgot-password" color="error" variant="outline">Request a new link</UButton>
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
      :schema="confirmSchema"
      :fields="fields"
      :loading="status === 'loading'"
      @submit="onSubmit"
    >
      <!-- See `AuthSubmit`: before this page hydrates its button is not a
           submit button. A native POST here would re-render the screen with
           both password fields cleared while the token stayed in the URL,
           which reads as "the link is broken" rather than "the page was not
           ready". -->
      <template #submit="{ loading }">
        <AuthSubmit :label="status === 'loading' ? 'Setting your password…' : 'Set new password'" :loading="loading" />
      </template>

      <template #validation>
        <InlineNotice v-if="status === 'network-error'" tier="bar" tone="error" icon="i-lucide-circle-alert" role="alert">
          {{ message }}
        </InlineNotice>
      </template>

      <template #footer>
        <!-- `min-h-6`: the 24px target floor from the box, not the type (§5). -->
        <NuxtLink to="/login" class="inline-flex min-h-6 items-center text-label-large text-primary hover:underline">
          Back to sign in
        </NuxtLink>
      </template>
    </UAuthForm>
  </AuthShell>
</template>
