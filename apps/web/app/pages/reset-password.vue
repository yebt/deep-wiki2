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
    <div v-if="!token" class="flex items-start gap-3 rounded-md bg-error-container p-4">
      <UIcon name="i-lucide-link-2-off" class="size-5 shrink-0 text-on-error-container" aria-hidden="true" />
      <div>
        <p class="text-body-large-emphasized text-on-error-container">This password reset link isn't valid.</p>
        <p class="text-body-medium text-on-error-container mt-1">
          Request a new one and use the freshest link from your inbox.
        </p>
        <UButton to="/forgot-password" color="error" variant="outline" class="mt-3">
          Request a new link
        </UButton>
      </div>
    </div>

    <div
      v-else-if="status === 'invalid-or-expired'"
      class="flex items-start gap-3 rounded-md bg-error-container p-4"
    >
      <UIcon name="i-lucide-link-2-off" class="size-5 shrink-0 text-on-error-container" aria-hidden="true" />
      <div>
        <p class="text-body-large-emphasized text-on-error-container">{{ message }}</p>
        <UButton to="/forgot-password" color="error" variant="outline" class="mt-3">
          Request a new link
        </UButton>
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
        <div v-if="status === 'network-error'" role="alert" class="flex items-start gap-3 rounded-md bg-error-container p-4">
          <UIcon name="i-lucide-circle-alert" class="size-5 shrink-0 text-on-error-container" aria-hidden="true" />
          <p class="text-body-medium text-on-error-container">{{ message }}</p>
        </div>
      </template>

      <template #footer>
        <NuxtLink to="/login" class="text-label-large text-primary hover:underline">
          Back to sign in
        </NuxtLink>
      </template>
    </UAuthForm>
  </AuthShell>
</template>
