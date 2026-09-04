<script setup lang="ts">
import { LoginRequestSchema } from '@deep-wiki/contracts';
import type { FormSubmitEvent } from '@nuxt/ui';

useHead({ htmlAttrs: { lang: 'en' } });
useSeoMeta({
  title: 'Sign in — deep-wiki',
  description: 'Sign in to your deep-wiki workspace.',
});

/**
 * Pre-build contract (docs/UI-CHECKLIST.md §2):
 * - Who: a returning member who already has an account on this instance.
 * - Goal, in their words: "Get back into my workspace."
 * - Single primary action: submit email + password to sign in.
 * - Data needed: only the credential form itself — no workspace list or
 *   profile data exists to render before authentication succeeds.
 * - Non-goals: no self-registration, no SSO, no "remember me" — none of
 *   those exist in this phase's API surface.
 * - Empty / overflow: there is no collection here to overflow; the
 *   pristine, untouched form *is* the "empty" state.
 */

const { status, message, login } = useLogin();

/** Extends the wire contract with client-only UX refinements — the fields
 * and their wire types still come from `LoginRequestSchema`, never a
 * hand-written duplicate. */
const loginSchema = LoginRequestSchema.extend({
  email: LoginRequestSchema.shape.email.min(1, 'Enter your email address').email('Enter a valid email address'),
  password: LoginRequestSchema.shape.password.min(1, 'Enter your password'),
});

const fields = [
  { name: 'email', type: 'email' as const, label: 'Email', required: true, autocomplete: 'email', defaultValue: '' },
  {
    name: 'password',
    type: 'password' as const,
    label: 'Password',
    required: true,
    autocomplete: 'current-password',
    defaultValue: '',
  },
];

async function onSubmit(event: FormSubmitEvent<{ email: string; password: string }>) {
  await login(event.data);

  if (status.value === 'success') {
    setTimeout(() => {
      void navigateTo('/');
    }, 800);
  }
}
</script>

<template>
  <AuthShell eyebrow="Sign in" heading="Sign in to deep-wiki">
    <div v-if="status === 'success'" role="status" aria-live="polite" class="flex items-start gap-3 rounded-md bg-success-container p-4">
      <UIcon name="i-lucide-circle-check" class="size-5 shrink-0 text-on-success-container" aria-hidden="true" />
      <div>
        <p class="text-body-large-emphasized text-on-success-container">{{ message }}</p>
        <p class="text-body-medium text-on-success-container mt-1">Taking you to deep-wiki…</p>
      </div>
    </div>

    <UAuthForm
      v-else
      :schema="loginSchema"
      :fields="fields"
      :loading="status === 'loading'"
      :submit="{ label: status === 'loading' ? 'Signing in…' : 'Sign in' }"
      @submit="onSubmit"
    >
      <template #validation>
        <div
          v-if="status === 'invalid-credentials' || status === 'network-error'"
          role="alert"
          class="flex items-start gap-3 rounded-md bg-error-container p-4"
        >
          <UIcon name="i-lucide-circle-alert" class="size-5 shrink-0 text-on-error-container" aria-hidden="true" />
          <p class="text-body-medium text-on-error-container">{{ message }}</p>
        </div>
      </template>

      <template #footer>
        <NuxtLink to="/forgot-password" class="text-label-large text-primary hover:underline">
          Forgot your password?
        </NuxtLink>
      </template>
    </UAuthForm>
  </AuthShell>
</template>
