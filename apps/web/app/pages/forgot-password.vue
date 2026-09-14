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
    <!-- The bar tier (`InlineNotice`) replaces the form the user just
         submitted, so it takes the focus the submit control held: measured
         on 2026-09-14, `document.activeElement` was `BODY` after this
         submit (docs/UI-CHECKLIST.md §5). -->
    <InlineNotice v-if="status === 'sent'" tier="bar" tone="success" icon="i-lucide-mail-check" :title="message" focus>
      Check your inbox for the link. It expires after a while, so use it soon.
      <template #actions>
        <NuxtLink to="/login" class="inline-flex min-h-6 items-center text-label-large text-primary hover:underline">
          Back to sign in
        </NuxtLink>
      </template>
    </InlineNotice>

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
