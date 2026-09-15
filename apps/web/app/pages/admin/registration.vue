<script setup lang="ts">
/**
 * `/admin/registration` — how new people may join this instance.
 *
 * Until this screen existed the three admin routes — registration mode,
 * the domain allowlist and the SMTP test send — had no caller; an operator
 * changed the instance's front door with `curl` or not at all.
 *
 * Pre-build contract (docs/UI-CHECKLIST.md §2):
 * - Who: the Super Root — the person who runs this deployment — setting
 *   it up, or reacting to the instance being discovered.
 * - Goal, in their words: "Decide who can make an account here."
 * - Single primary action: save the registration mode. The allowlist and
 *   the SMTP test are secondary, outlined, and exist to make `open` safe
 *   to choose.
 * - Data: `instance_settings` — `registration_mode`,
 *   `open_registration_domains`, `smtp_verified_at` — plus the one-shot
 *   `reverted` fact the reconciling read reports. Nothing here shows the
 *   SMTP host or credentials: they live in the server environment and
 *   are not this screen's to display or edit.
 * - Non-goals: no SMTP configuration (an environment concern), no plans,
 *   no user management, no invitations — those are a workspace's.
 * - Empty / overflow: a fresh instance is `invitation_only` with no
 *   allowlist and SMTP unverified, which is the state below with every
 *   form at its default; an allowlist of hundreds of domains is a
 *   textarea that grows.
 *
 * **Honesty about `open`.** The server refuses `open` until an SMTP test
 * send succeeds, and silently reverts it to `invitation_only` if the
 * SMTP configuration changes afterwards (registration-policy spec;
 * `packages/db/src/auth/instance-settings.ts`). So:
 *
 * - The mode shown is always the server's, re-read after every save —
 *   never the radio the operator last clicked.
 * - The `open` option is *not* disabled while SMTP is unverified: its
 *   description says what it needs, choosing it is allowed, and the
 *   server's refusal is shown as a refusal with the server's own reason.
 *   A disabled radio with the reason hidden behind hover is the §3/§5
 *   defect this avoids.
 * - The read that discovers a revert says so in an alert, because at
 *   that moment the operator believes a switch is on that the instance
 *   has turned off.
 *
 * **A 403 is a plain denied state.** The existence of instance settings
 * is no secret, so "only the operator can change this" discloses nothing.
 *
 * **The frame decision.** This stays in the document frame, deliberately,
 * not the workspace one. Registration is an instance setting — orthogonal
 * to "one workspace at a time" (apps/web/PRODUCT.md: a person lives inside
 * one workspace the way they live inside one Obsidian vault), not a fact
 * *about* whichever workspace happens to be last-visited. The operator who
 * needs this screen most is exactly the one who may hold **no** workspace
 * at all — `e2e/navigation.spec.ts`'s seeded Super Root carries no grant
 * anywhere and reaches "No workspaces you can open" before reaching here —
 * so standing the workspace frame around it would mean either an empty
 * sidebar with nothing to orient around, or silently adopting a workspace
 * this setting has nothing to do with. Both entry points already exist and
 * both stay: the chrome's icon button (`AppShell`'s document frame, for a
 * caller with no workspace open) and the sidebar footer's (for a caller
 * who is in one and wants to jump out to an instance-wide setting without
 * losing their place) — one screen, reached from two rooms, the way
 * `docs/UI-CHECKLIST.md` §4.1 asks a shared thing to be one component
 * rather than one copy per screen. Because it stays in the document frame,
 * it keeps its `PageHeading` — the eyebrow ("Instance") names what makes
 * this different from a workspace's own settings, which a bare `<h1>`
 * cannot say on its own.
 */
import type { FormSubmitEvent } from '@nuxt/ui';
import { RegistrationModeSchema, type RegistrationModeValue } from '@deep-wiki/contracts';
import { z } from 'zod';
import { formatRevisionDate } from '~/utils/format-revision-date';

const {
  status,
  message,
  settings,
  modeStatus,
  modeMessage,
  domainsStatus,
  domainsMessage,
  smtpStatus,
  smtpMessage,
  load,
  saveMode,
  saveDomains,
  sendSmtpTest,
} = useInstanceSettings();

onMounted(() => {
  void load();
});

const smtpVerified = computed(() => settings.value?.smtpVerifiedAt !== null && settings.value?.smtpVerifiedAt !== undefined);

/** The three modes, described in the operator's terms, with `open`'s precondition stated on the option itself. */
const MODE_OPTIONS = computed(() => [
  { value: 'closed', label: 'Closed', description: 'Nobody can create an account. Existing accounts keep working.' },
  { value: 'invitation_only', label: 'Invitation only', description: 'Accounts are created by accepting a workspace invitation. The default.' },
  {
    value: 'open',
    label: 'Open',
    description: smtpVerified.value
      ? 'Anyone may create an account, restricted to the allowed domains below if any are set.'
      : 'Anyone may create an account. Requires a delivered SMTP test message first — see below; choosing it now will be refused.',
  },
]);

// Each form keeps its own draft, seeded from the server's settings whenever
// they are (re)loaded — a save re-reads, and the draft follows the server.
const modeState = reactive<{ mode: RegistrationModeValue }>({ mode: 'invitation_only' });
const domainsState = reactive({ domains: '' });
const smtpState = reactive({ to: '' });

watch(
  settings,
  (next) => {
    if (!next) return;
    modeState.mode = next.registrationMode;
    domainsState.domains = next.openRegistrationDomains.join('\n');
  },
  { immediate: true },
);

const modeSchema = z.object({ mode: RegistrationModeSchema });
const domainsSchema = z.object({ domains: z.string() });
const smtpSchema = z.object({ to: z.string().trim().min(1, 'Enter an address').email('Enter a valid email address') });

async function onSaveMode(event: FormSubmitEvent<{ mode: RegistrationModeValue }>): Promise<void> {
  await saveMode(event.data.mode);
}

async function onSaveDomains(event: FormSubmitEvent<{ domains: string }>): Promise<void> {
  await saveDomains(event.data.domains.split(/[\n,]/));
}

async function onSendSmtpTest(event: FormSubmitEvent<{ to: string }>): Promise<void> {
  await sendSmtpTest(event.data.to);
}

useSeoMeta({ title: 'Registration — deep-wiki' });
</script>

<template>
  <AppShell>
    <!-- The eyebrow adds what the h1 lacks: this is the instance's
         setting, not a workspace's (§4.4). -->
    <PageHeading
      eyebrow="Instance"
      heading="Registration"
      description="Who may create an account on this deep-wiki, and the mail check that makes opening it safe."
    />

    <div v-if="status === 'idle' || status === 'loading'" data-testid="registration-skeleton" class="space-y-2" aria-hidden="true">
      <USkeleton class="h-14 w-full" />
      <USkeleton class="h-10 w-5/6" />
      <USkeleton class="h-10 w-4/6" />
    </div>

    <PageNotice v-else-if="status === 'unauthenticated'" icon="i-lucide-log-in" heading="Sign in to change registration" :level="2">
      Your session has ended, or you have not signed in on this device yet.
      <template #actions>
        <UButton to="/login" color="primary" variant="solid" size="lg" icon="i-lucide-log-in">Sign in</UButton>
      </template>
    </PageNotice>

    <PageNotice v-else-if="status === 'forbidden'" icon="i-lucide-lock" heading="This is the instance operator's" :level="2">
      {{ message }} If that should be you, ask whoever set this deep-wiki up.
      <template #actions>
        <UButton to="/workspaces" variant="outline" color="neutral" icon="i-lucide-library-big">Your workspaces</UButton>
      </template>
    </PageNotice>

    <PageNotice
      v-else-if="status === 'network-error'"
      icon="i-lucide-circle-alert"
      heading="Couldn't load the registration settings"
      :level="2"
      tone="error"
      role="alert"
    >
      {{ message }}
      <template #actions>
        <UButton variant="outline" color="error" icon="i-lucide-refresh-cw" @click="load">Retry</UButton>
      </template>
    </PageNotice>

    <div v-else-if="settings" class="space-y-8">
      <!-- The revert is the one thing on this screen the operator did not
           do and needs to be told about; a failure they did not ask for
           is an alert (§3). -->
      <div v-if="settings.smtpVerificationReverted" role="alert" class="flex items-start gap-3 rounded-md bg-error-container p-4">
        <UIcon name="i-lucide-circle-alert" class="size-5 shrink-0 text-on-error-container" aria-hidden="true" />
        <p class="text-body-medium text-on-error-container">
          Open registration was switched off: the SMTP configuration changed since it was verified, so registration is
          back to invitation only. Send a test message again to re-enable it.
        </p>
      </div>

      <!-- ── SMTP ────────────────────────────────────────────────────── -->
      <section aria-labelledby="smtp-heading">
        <h2 id="smtp-heading" class="text-headline-small text-highlighted mb-4">Mail delivery</h2>
        <UCard variant="soft">
          <UForm :schema="smtpSchema" :state="smtpState" class="space-y-6" aria-labelledby="smtp-heading" @submit="onSendSmtpTest">
            <p class="flex items-start gap-2 text-body-medium text-default">
              <UIcon
                :name="smtpVerified ? 'i-lucide-circle-check' : 'i-lucide-circle-dashed'"
                class="mt-0.5 size-5 shrink-0"
                :class="smtpVerified ? 'text-success' : 'text-muted'"
                aria-hidden="true"
              />
              <span v-if="smtpVerified && settings.smtpVerifiedAt">
                SMTP verified — a test message was delivered
                <time :datetime="settings.smtpVerifiedAt">{{ formatRevisionDate(settings.smtpVerifiedAt) }}</time>.
                Open registration may be chosen.
              </span>
              <span v-else>
                SMTP not verified. Invitations and password resets go through the server's SMTP settings, and open
                registration stays unavailable until a test message is delivered.
              </span>
            </p>

            <div v-if="smtpStatus === 'failed' || smtpStatus === 'network-error'" role="alert" class="flex items-start gap-3 rounded-md bg-error-container p-4">
              <UIcon name="i-lucide-circle-alert" class="size-5 shrink-0 text-on-error-container" aria-hidden="true" />
              <p class="text-body-medium text-on-error-container">{{ smtpMessage }}</p>
            </div>

            <UFormField label="Send a test message to" name="to" required :error="smtpStatus === 'invalid' ? smtpMessage : undefined">
              <UInput v-model="smtpState.to" type="email" class="w-full" autocomplete="off" spellcheck="false" />
            </UFormField>

            <UButton type="submit" variant="outline" color="neutral" icon="i-lucide-send" :loading="smtpStatus === 'sending'">
              {{ smtpStatus === 'sending' ? 'Sending…' : 'Send test message' }}
            </UButton>
          </UForm>
        </UCard>
        <p
          role="status"
          aria-live="polite"
          :class="smtpStatus === 'sent' ? 'mt-4 rounded-md bg-success-container px-3 py-2 text-body-small text-on-success-container' : 'sr-only'"
        >
          {{ smtpStatus === 'sent' ? smtpMessage : '' }}
        </p>
      </section>

      <!-- ── Mode ────────────────────────────────────────────────────── -->
      <section aria-labelledby="mode-heading">
        <h2 id="mode-heading" class="text-headline-small text-highlighted mb-4">Who may register</h2>
        <UCard variant="soft">
          <UForm :schema="modeSchema" :state="modeState" class="space-y-6" aria-labelledby="mode-heading" @submit="onSaveMode">
            <div v-if="modeStatus === 'refused' || modeStatus === 'network-error'" role="alert" class="flex items-start gap-3 rounded-md bg-error-container p-4">
              <UIcon name="i-lucide-circle-alert" class="size-5 shrink-0 text-on-error-container" aria-hidden="true" />
              <p class="text-body-medium text-on-error-container">{{ modeMessage }}</p>
            </div>

            <UFormField label="Registration mode" name="mode" required>
              <URadioGroup v-model="modeState.mode" :items="MODE_OPTIONS" />
            </UFormField>

            <AuthSubmit :label="modeStatus === 'saving' ? 'Saving…' : 'Save mode'" :loading="modeStatus === 'saving'" />
          </UForm>
        </UCard>
        <p
          role="status"
          aria-live="polite"
          :class="modeStatus === 'saved' ? 'mt-4 rounded-md bg-success-container px-3 py-2 text-body-small text-on-success-container' : 'sr-only'"
        >
          {{ modeStatus === 'saved' ? modeMessage : '' }}
        </p>
      </section>

      <!-- ── Allowlist ───────────────────────────────────────────────── -->
      <section aria-labelledby="domains-heading">
        <h2 id="domains-heading" class="text-headline-small text-highlighted mb-4">Allowed domains</h2>
        <UCard variant="soft">
          <UForm :schema="domainsSchema" :state="domainsState" class="space-y-6" aria-labelledby="domains-heading" @submit="onSaveDomains">
            <div v-if="domainsStatus === 'refused' || domainsStatus === 'network-error'" role="alert" class="flex items-start gap-3 rounded-md bg-error-container p-4">
              <UIcon name="i-lucide-circle-alert" class="size-5 shrink-0 text-on-error-container" aria-hidden="true" />
              <p class="text-body-medium text-on-error-container">{{ domainsMessage }}</p>
            </div>

            <UFormField
              label="Allowed domains"
              name="domains"
              help="One per line, like company.com. Applies only while registration is open; leave it empty to allow any address."
            >
              <UTextarea v-model="domainsState.domains" class="w-full" :rows="3" autoresize autocomplete="off" spellcheck="false" />
            </UFormField>

            <UButton type="submit" variant="outline" color="neutral" icon="i-lucide-save" :loading="domainsStatus === 'saving'">
              {{ domainsStatus === 'saving' ? 'Saving…' : 'Save allowed domains' }}
            </UButton>
          </UForm>
        </UCard>
        <p
          role="status"
          aria-live="polite"
          :class="domainsStatus === 'saved' ? 'mt-4 rounded-md bg-success-container px-3 py-2 text-body-small text-on-success-container' : 'sr-only'"
        >
          {{ domainsStatus === 'saved' ? domainsMessage : '' }}
        </p>
      </section>
    </div>
  </AppShell>
</template>
