<script setup lang="ts">
import { PasswordResetRequestSchema } from '@deep-wiki/contracts';
import type { FormSubmitEvent } from '@nuxt/ui';

useHead({ htmlAttrs: { lang: 'en' } });
useSeoMeta({
  title: 'Reset your password — deep-wiki',
  description: 'Request a password reset link for your deep-wiki account.',
});

/**
 * Pre-build contract (docs/UI-CHECKLIST.md §2):
 * - Who: someone who cannot sign in and believes they have an account.
 * - Goal: "Get a link to set a new password."
 * - Single primary action: submit an email address.
 * - Non-goal, load-bearing: this screen MUST NOT reveal whether the
 *   submitted email corresponds to an existing account (authentication
 *   spec — "Password Reset Responses Do Not Disclose Account
 *   Existence"). The success state below is the same text regardless.
 */

const { status, message, requestReset } = usePasswordResetRequest();

const requestSchema = PasswordResetRequestSchema.extend({
  email: PasswordResetRequestSchema.shape.email.min(1, 'Enter your email address').email('Enter a valid email address'),
});

const fields = [{ name: 'email', type: 'email' as const, label: 'Email', required: true, autocomplete: 'email', defaultValue: '' }];

async function onSubmit(event: FormSubmitEvent<{ email: string }>) {
  await requestReset(event.data);
}
</script>

<template>
  <AuthShell
    heading="Reset your password"
    description="Enter the email address on your account and we'll send a link to reset your password."
  >
    <div v-if="status === 'sent'" role="status" aria-live="polite" class="flex items-start gap-3 rounded-md bg-success-container p-4">
      <UIcon name="i-lucide-mail-check" class="size-5 shrink-0 text-on-success-container" aria-hidden="true" />
      <div>
        <p class="text-body-large-emphasized text-on-success-container">{{ message }}</p>
        <p class="text-body-medium text-on-success-container mt-1">
          Check your inbox for the link. It expires after a while, so use it soon.
        </p>
      </div>
    </div>

    <UAuthForm
      v-else
      description="All fields are required."
      :schema="requestSchema"
      :fields="fields"
      :loading="status === 'loading'"
      @submit="onSubmit"
    >
      <!-- See `AuthSubmit`: before this page hydrates its button is not a
           submit button, so a click cannot make the browser POST this form
           to its own URL and blank the address the visitor just typed. -->
      <template #submit="{ loading }">
        <AuthSubmit :label="status === 'loading' ? 'Sending…' : 'Send reset link'" :loading="loading" />
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
