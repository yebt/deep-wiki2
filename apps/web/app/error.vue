<script setup lang="ts">
/**
 * The screen Nuxt renders when a route did not resolve or a request failed
 * before any page could. Until 2026-09-07 there was none, so a bad URL got
 * Nuxt's built-in error page: no header, no footer, no theme, no type
 * scale — a screen from a different product.
 *
 * This is a screen like any other, so it is `AppShell` and `PageNotice`
 * like any other (docs/UI-CHECKLIST.md §4.1 — anything on more than one
 * screen is one component). Nuxt renders `error.vue` *instead of*
 * `app.vue`, so `UApp` is declared here as well; without it every Reka
 * provider `AppShell`'s tooltip injects is missing and the shell throws
 * while trying to render the error.
 *
 * Two states, because the user's next move differs (§3, "Error —
 * recoverable" vs "Error — fatal"):
 *
 *   404  The address led nowhere. Nothing is broken and retrying is
 *        pointless; what the user needs is a way back to something real.
 *   else Something failed on the server. The address is probably fine, so
 *        the useful action is to try it again.
 *
 * ## Why the 404 branch never reads `error.message`
 *
 * The 404 copy is a constant. It is chosen by `statusCode` alone and no
 * field of the error object reaches the DOM — not `message`, not
 * `statusMessage`, not `data`.
 *
 * That is deliberate, and it is the whole non-disclosure property. This
 * product's API distinguishes a page that does not exist (404) from one
 * that exists and is denied (403) — verified in `apps/api/src/routes/
 * pages.ts`, which looks the node up first and only then calls `can()` —
 * and read mode surfaces that distinction on purpose for a subject who
 * asked for a URL directly (see `usePageRead`'s note). Any *other* surface
 * that decides not to disclose has to be able to answer a denied request
 * with a 404 that is indistinguishable from a genuine one. If this screen
 * rendered `error.message`, a `createError({ statusCode: 404, message:
 * 'forbidden' })` upstream would print the difference on the page and turn
 * every such decision into a leak — the exact channel `docs/SPECS.md` §14
 * and design.md D18 already keep closed for wiki-links.
 *
 * The copy is written to be true of both cases at once for the same
 * reason, and says so, so a reader is not misled into believing a page
 * they cannot see has been deleted.
 *
 * The server branch does not echo the error either: in production Nuxt
 * replaces a server-side `message` with a generic string, but in
 * development it is the raw throw, and a screen that prints one and not
 * the other is a screen nobody has reviewed in the state users get.
 */
import type { NuxtError } from '#app';

const props = defineProps<{ error: NuxtError }>();

/** Nuxt types `statusCode` as optional; an error that arrives without one is a server failure, not a missing address. */
const statusCode = computed(() => props.error.statusCode ?? 500);
const isNotFound = computed(() => statusCode.value === 404);

/**
 * The address the user actually asked for. `useRoute()` inside `error.vue`
 * carries the failed route, which is the one thing about this failure that
 * came from the user rather than from the server — so it is the one thing
 * the screen can use without disclosing anything it was told.
 */
const route = useRoute();
const path = computed(() => route.fullPath);

/**
 * The next action, derived from that address alone.
 *
 * §3 requires a real next action and forbids a dead end; the brief for
 * this screen adds that "go home" is not one, and the brand mark in the
 * header is already the way home. So: a mistyped or stale link *inside* a
 * workspace can still deliver the user to that workspace's tree, and a
 * broken sub-route of a page can still deliver them to the page. Both ids
 * come out of the URL the user typed — the screen learns nothing from the
 * server and therefore cannot leak anything, and neither link claims the
 * destination exists; it is an offer to try, and if it does not resolve
 * the user lands back here.
 *
 * With no such context there is genuinely one route to content in this
 * product: it has no public pages (`invitation_only` registration,
 * docs/SPECS.md §14), so an unrecognised address followed from outside is
 * most often a signed-out session. Sign-in is then the honest action.
 */
const UUID = '[0-9a-fA-F-]{36}';

const recovery = computed(() => {
  const workspace = route.path.match(new RegExp(`^/workspaces/(${UUID})(?:/|$)`));
  if (workspace) {
    return {
      to: `/workspaces/${workspace[1]}/tree`,
      label: 'Open this workspace',
      icon: 'i-lucide-list-tree',
    };
  }

  const page = route.path.match(new RegExp(`^/pages/(${UUID})(?:/|$)`));
  if (page) {
    return { to: `/pages/${page[1]}`, label: 'Open this page', icon: 'i-lucide-file-text' };
  }

  return { to: '/login', label: 'Go to sign-in', icon: 'i-lucide-log-in' };
});

/**
 * `clearError` rather than a plain link: `error.vue` replaces the whole
 * app, and navigating out of it without clearing the error leaves Nuxt
 * holding a failure it will render again on the next server round trip.
 */
function goTo(to: string): void {
  void clearError({ redirect: to });
}

function retry(): void {
  void clearError({ redirect: route.fullPath });
}

useHead({ htmlAttrs: { lang: 'en' } });
useSeoMeta({
  title: () => (isNotFound.value ? 'Not found — deep-wiki' : 'Something went wrong — deep-wiki'),
});
</script>

<template>
  <UApp>
    <AppShell>
      <!-- `PageNotice` at `level="1"` — this notice *is* the screen's
           content, so it owns the page's only `<h1>`, and §4.4 requires
           that `<h1>` to keep one type role across every state a screen
           has. `tone="error"` and `role="alert"` are the server branch's:
           a failure the user did not ask for is announced, where an
           address that leads nowhere is a state they navigated into
           (§3, §5's live-region rule). -->
      <PageNotice
        v-if="isNotFound"
        icon="i-lucide-compass"
        heading="This link doesn't lead anywhere"
      >
        <span class="font-mono break-all">{{ path }}</span> isn't something you can open. It may
        have been moved or deleted, or it may be somewhere you don't have access to — deep-wiki
        deliberately doesn't say which, so that a page you can't see is indistinguishable from one
        that was never there.
        <template #actions>
          <UButton :icon="recovery.icon" variant="solid" color="primary" @click="goTo(recovery.to)">
            {{ recovery.label }}
          </UButton>
        </template>
      </PageNotice>

      <PageNotice
        v-else
        icon="i-lucide-server-crash"
        heading="Something went wrong on our side"
        tone="error"
        role="alert"
      >
        The server couldn't finish this request. Nothing you did caused it, and nothing you had
        open has been lost — the address is fine, so trying again often works. If it keeps
        happening, tell whoever runs this instance and quote the reference below.
        <!-- One action, and it is the one that can actually help: §2 allows
             exactly one primary action, and a second exit rendered beside
             it at the same weight — measured 2026-09-07, `outline error`
             and `subtle error` are barely separable on the
             `error-container` ground — reads as a choice where there is
             none. `outline` + `color="error"` is what the read screen's
             own network-error retry already uses; the nearest existing
             screen sets the treatment (checklist §4.1). -->
        <template #actions>
          <UButton icon="i-lucide-refresh-cw" variant="outline" color="error" @click="retry">
            Try again
          </UButton>
        </template>
      </PageNotice>

      <!-- The reference a user quotes when reporting it. §3 forbids a bare
           status code *as the message*; it does not forbid one beside a
           message that already said what happened in the user's terms, and
           a report with no reference in it is a report nobody can act on.
           Withheld on the 404, where the code is not a diagnosis and the
           screen has nothing server-side to disclose. -->
      <p v-if="!isNotFound" class="text-body-small text-muted mt-6">
        Reference: HTTP {{ statusCode }}
      </p>
    </AppShell>
  </UApp>
</template>
