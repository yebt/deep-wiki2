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
  <AuthShell heading="Sign in to deep-wiki">
    <!-- The bar tier (`InlineNotice`), which replaces the form the user just
         submitted — so it takes the focus that form's submit control held
         (docs/UI-CHECKLIST.md §5: async state changes are announced, and
         focus must not fall off the page). -->
    <InlineNotice v-if="status === 'success'" tier="bar" tone="success" icon="i-lucide-circle-check" :title="message" focus>
      Taking you to deep-wiki…
    </InlineNotice>

    <UAuthForm
      v-else
      description="All fields are required."
      :schema="loginSchema"
      :fields="fields"
      :loading="status === 'loading'"
      @submit="onSubmit"
    >
      <!-- `AuthSubmit` rather than `UAuthForm`'s own submit button: until
           this page hydrates, its button is not a submit button at all, so
           the browser cannot perform the native POST to this URL that
           re-renders the screen with the fields cleared and looks exactly
           like a rejected password. The whole reason lives in that
           component. -->
      <template #submit="{ loading }">
        <AuthSubmit :label="status === 'loading' ? 'Signing in…' : 'Sign in'" :loading="loading" />
      </template>

      <template #validation>
        <InlineNotice v-if="status === 'invalid-credentials' || status === 'network-error'" tier="bar" tone="error" icon="i-lucide-circle-alert" role="alert">
          {{ message }}
        </InlineNotice>
      </template>

      <template #footer>
        <!-- `min-h-6` (24px) on a 20px `label-large` line: checklist §5's
             24x24 target floor, met by the box and not by the type — measured
             at 19px before (2026-09-14 audit). -->
        <NuxtLink to="/forgot-password" class="inline-flex min-h-6 items-center text-label-large text-primary hover:underline">
          Forgot your password?
        </NuxtLink>
      </template>
    </UAuthForm>
  </AuthShell>
</template>
