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
 *
 * ## Why the screen never says whether you are signed in
 *
 * Rewritten 2026-09-08. The owner reached this screen from `/workspaces/`
 * while signed in and was offered "Go to sign-in", and nothing else. That
 * is worse than an unhelpful action: it is an assertion about the visitor
 * that was false, on a screen whose whole job is to be trustworthy about
 * what just happened.
 *
 * The screen cannot fix that by guessing better. The session cookie is
 * `httpOnly` (`apps/api/src/middleware/session.ts`), so the browser cannot
 * read it; there is no session or `/me` endpoint on the API to ask; and
 * this screen has to render when the server is the thing that failed, so
 * making it depend on a network round trip would break the branch that
 * needs it most.
 *
 * So it stops making the claim. It names a **destination**, never a state.
 * Every destination this product has needs a session — there are no public
 * pages (`invitation_only` registration, docs/SPECS.md §14) — so sign-in
 * stays on the screen as the second door, and is never the only one. A
 * visitor who is signed in takes the first; a visitor who is not takes the
 * second; neither is told which they are.
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
 *
 * It is also the first thing a person checks, which is why it is now set
 * as its own block rather than run into the sentence around it: a typo in
 * a 60-character URL is not findable in prose.
 */
const route = useRoute();
const path = computed(() => route.fullPath);

/**
 * The next action, derived from that address alone.
 *
 * §3 requires a real next action, forbids a dead end, and forbids "go
 * home" as the only offer when the address itself says where the user was
 * trying to go. So the screen reads the address for the most specific
 * place it names, and offers that:
 *
 *   /workspaces/<id>/…  that workspace's tree
 *   /pages/<id>/…       that page
 *   anything else       the list of workspaces, which is where every
 *                       signed-in subject's content starts
 *
 * Every id above comes out of the URL the user typed — the screen learns
 * nothing from the server and therefore cannot leak anything — and none of
 * the links claims its destination exists. It is an offer to try; if it
 * does not resolve, the user lands back here.
 *
 * The third case is the one that was wrong. `/workspaces/` names a real
 * part of the product and no particular workspace, and it used to fall
 * past both patterns into sign-in.
 */
const UUID = '[0-9a-fA-F-]{36}';

interface Recovery {
  readonly to: string;
  readonly label: string;
  readonly icon: string;
}

const recovery = computed<Recovery>(() => {
  const workspace = new RegExp(`^/workspaces/(${UUID})(?:/|$)`).exec(route.path);
  if (workspace) {
    return {
      to: `/workspaces/${workspace[1]}`,
      label: 'Open this workspace',
      icon: 'i-lucide-house',
    };
  }

  const page = new RegExp(`^/pages/(${UUID})(?:/|$)`).exec(route.path);
  if (page) {
    return { to: `/pages/${page[1]}`, label: 'Open this page', icon: 'i-lucide-file-text' };
  }

  return { to: '/workspaces', label: 'Your workspaces', icon: 'i-lucide-library-big' };
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
    <!-- `center` is the shell's `my-auto` on docs/DESIGN-SYSTEM.md §2.4's
         `measure` column, the same column read and edit mode stand in. A
         screen whose entire content is one card reads as an unfinished
         fallback while that card is pinned to the top of a tall empty
         viewport; the auth screens — the nearest existing screens with
         this exact shape — already centre, and checklist §4.1 asks a
         screen to match the nearest one rather than choose again.
         `my-auto` absorbs only *positive* free space, so a card taller
         than the region stays top-aligned and fully reachable. -->
    <AppShell center>
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
        deep-wiki has nothing at this address.
        <!-- The evidence, set as its own block rather than run into the
             sentence around it. `bg-default` is the recessed rung: §9.4
             rules that an inset inside a Filled card steps *down*, because
             the card is already `bg-emphasized` and §1.4 forbids a sixth
             surface level. It therefore carries its own `text-default` and
             is legible on the neutral card and on the `error-container`
             one without a second treatment. 12px is one rung inside the
             card's 16px — §3.3's "don't mix radii" is about a nested shape
             being *rounder* than what holds it — and `body-medium` mono is
             §2.3's code role. -->
        <code class="my-4 block rounded-md bg-default px-3 py-2 font-mono text-body-medium text-default break-all">{{ path }}</code>
        It may have been moved or deleted, or it may be somewhere you don't have access to —
        deep-wiki deliberately doesn't say which, so that a page you can't see is
        indistinguishable from one that was never there.
        <template #actions>
          <UButton :icon="recovery.icon" variant="solid" color="primary" @click="goTo(recovery.to)">
            {{ recovery.label }}
          </UButton>
          <!-- The second door, and deliberately the quieter one: M3's Text
               button (§9.1 — `ghost`), so §2's one-primary-action rule
               holds while the screen stops asserting which of the two the
               visitor needs. See "Why the screen never says whether you
               are signed in" above. -->
          <UButton icon="i-lucide-log-in" variant="ghost" color="neutral" @click="goTo('/login')">
            Sign in
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
        happening, tell whoever runs this instance and quote this:
        <!-- The reference a user quotes when reporting it, in the same
             inset the 404 gives the address, and *inside* the notice
             rather than floating under it: a reference belongs to the
             message it refers to, and a stray line below a card is the
             shape of an afterthought. §3 forbids a bare status code *as
             the message*; it does not forbid one beside a message that
             already said what happened in the user's terms, and a report
             with no reference in it is a report nobody can act on.
             Withheld on the 404, where the code is not a diagnosis and the
             screen has nothing server-side to disclose. -->
        <code class="mt-4 block rounded-md bg-default px-3 py-2 font-mono text-body-medium text-default">Reference: HTTP {{ statusCode }}</code>
        <!-- One action, and it is the one that can actually help. §2 allows
             exactly one primary action, and a second exit rendered beside
             it at the same weight — measured 2026-09-07, `outline error`
             and `subtle error` are barely separable on the
             `error-container` ground — reads as a choice where there is
             none. Unlike the 404, this branch is not ambiguous about what
             the user needs: the address was right and the server was not,
             so leaving for somewhere else is not a recovery, it is giving
             up on what they asked for. `outline` + `color="error"` is what
             the read screen's own network-error retry already uses; the
             nearest existing screen sets the treatment (§4.1). -->
        <template #actions>
          <UButton icon="i-lucide-refresh-cw" variant="outline" color="error" @click="retry">
            Try again
          </UButton>
        </template>
      </PageNotice>
    </AppShell>
  </UApp>
</template>
